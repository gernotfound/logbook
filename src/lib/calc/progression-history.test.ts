import { describe, expect, it } from 'vitest';
import { compareExposureCompatibility, computeProgressionEngine, normalizeExerciseExposure } from './progression';
import { bench, pullup, library, set, workout } from './progressionTestFixtures';

describe('contextual progression engine: historical comparability and reference selection', () => {
    it('orders cycle primary muscles before secondary muscles without changing numeric results', () => {
        const current = workout({
            id: 'w1',
            date: '2026-09-08',
            intent: 'development',
            focus: 'performance',
            primaryMuscles: ['quadriceps'],
            secondaryMuscles: ['chest'],
            exercises: [
                { exId: 'bench', sessionNote: '', sets: [set(100, 8, 2)] },
                { exId: 'leg-extension', sessionNote: '', sets: [set(80, 12, 2)] },
            ],
        });

        const analyses = computeProgressionEngine(current, [], library).exercises;

        expect(analyses.map(item => item.exId)).toEqual(['leg-extension', 'bench']);
        expect(analyses.map(item => item.priority)).toEqual(['primary', 'secondary']);
    });

    it('uses session duration only as a cautious density signal when observed work is similar', () => {
        const previous = workout({
            id: 'w1', date: '2026-09-01', routineId: 'torso', intent: 'development', focus: 'density',
            duration: '01:14:00', sets: [set(100, 8, 2), set(100, 8, 2)],
        });
        const current = workout({
            id: 'w2', date: '2026-09-08', routineId: 'torso', intent: 'development', focus: 'density',
            duration: '01:08:00', sets: [set(100, 8, 2), set(100, 8, 2)],
        });

        const result = computeProgressionEngine(current, [previous], library);

        expect(result.density?.quality).toBe('preliminary');
        expect(result.density?.detail).toContain('74 → 68 min');
        expect(result.exercises[0].classification).toBe('density_limited');
    });

    it('marks missing historical bodyweight as a limited input instead of inventing a value', () => {
        const previous = workout({ id: 'w1', date: '2026-01-10', exId: 'pullup', sets: [set(0, 10, 2)] });
        const current = workout({ id: 'w2', date: '2026-01-17', exId: 'pullup', sets: [set(0, 10, 2)] });

        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.current.bodyweightKg).toBeUndefined();
        expect(analysis.current.tonnageComplete).toBe(false);
        expect(analysis.comparison.level).toBe('medium');
        expect(analysis.qualityReasons.join(' ')).toContain('Peso corporeo storico');
    });

    it('exposes cycle baseline and best historical comparable references separately', () => {
        const h1 = workout({ id: 'w1', date: '2026-09-01', cycleId: 'c1', sets: [set(100, 8, 2)] });
        const h2 = workout({ id: 'w2', date: '2026-09-08', cycleId: 'c1', sets: [set(100, 9, 2)] });
        const current = workout({ id: 'w3', date: '2026-09-15', cycleId: 'c1', sets: [set(100, 10, 2)] });

        const analysis = computeProgressionEngine(current, [h2, h1], library).exercises[0];

        expect(analysis.cycleBaseline?.sessionId).toBe('w1');
        expect(analysis.bestHistorical?.sessionId).toBe('w2');
        expect(analysis.previousComparable?.sessionId).toBe('w2');
    });

    it('exposes comparability directly for normalized exposures', () => {
        const first = workout({ id: 'w1', date: '2026-09-01', sets: [set(100, 8, 2)] });
        const second = workout({ id: 'w2', date: '2026-09-08', sets: [set(100, 8, 2)] });
        const firstExposure = normalizeExerciseExposure(first, first.exercises[0], bench);
        const secondExposure = normalizeExerciseExposure(second, second.exercises[0], bench);

        expect(compareExposureCompatibility(secondExposure, firstExposure)).toEqual({ level: 'high', reasons: [] });
    });

    it('uses an earlier same-day session when timestamps establish chronology', () => {
        const previous = { ...workout({ id: 'same-day-1', date: '2026-09-24', sets: [set(100, 8, 2)] }), globalStartTime: 1_000, globalEndTime: 2_000 };
        const current = { ...workout({ id: 'same-day-2', date: '2026-09-24', sets: [set(100, 9, 2)] }), globalStartTime: 3_000, globalEndTime: 4_000 };
        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];
        expect(analysis.previousComparable?.sessionId).toBe('same-day-1');
        expect(analysis.classification).toBe('performance_record');
    });

    it('does not treat blank planned sets as observed density work', () => {
        const observed = [set(100, 8, 2), set(100, 8, 2), set(100, 8, 2), set(100, 8, 2)];
        const blanks = [
            set(100, 8, 2),
            { id: 'blank-1', kg: '', reps: '', technique: 'straight' as const },
            { id: 'blank-2', kg: '', reps: '', technique: 'straight' as const },
            { id: 'blank-3', kg: '', reps: '', technique: 'straight' as const },
        ];
        const previous = workout({ id: 'density-prev', date: '2026-09-17', routineId: 'density-r', focus: 'density', duration: '01:00:00', sets: observed });
        const current = workout({ id: 'density-current', date: '2026-09-24', routineId: 'density-r', focus: 'density', duration: '00:50:00', sets: blanks });
        const density = computeProgressionEngine(current, [previous], library).density;
        expect(density?.quality).toBe('limited');
        expect(density?.headline).toContain('lavoro diverso');
    });

    it('marks a changed technical standard as not comparable and starts a new baseline', () => {
        const previous = workout({
            id: 'std-prev',
            date: '2026-09-01',
            exercises: [{ exId: 'bench', sessionNote: '', technicalStandard: 'ROM completo · fermo 1 s', sets: [set(100, 8, 2)] }],
        });
        const current = workout({
            id: 'std-current',
            date: '2026-09-08',
            exercises: [{ exId: 'bench', sessionNote: '', technicalStandard: 'ROM parziale', sets: [set(100, 9, 2)] }],
        });

        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.comparisonStatus).toBe('not_comparable');
        expect(analysis.comparison.reasons.join(' ')).toContain('Standard tecnico');
        expect(analysis.classification).toBe('new_baseline');
        expect(analysis.isRecord).toBe(false);
    });

    it('lets the exercise progression contract refine role and metric without changing the programmed work', () => {
        const current = workout({
            id: 'contract-current',
            date: '2026-09-15',
            focus: 'performance',
            exercises: [{
                exId: 'bench',
                sessionNote: '',
                progressionContract: { role: 'primary', metric: 'volume' },
                sets: [set(100, 10, 2), set(100, 10, 2), set(100, 10, 2)],
            }],
        });
        const previous = workout({
            id: 'contract-previous',
            date: '2026-09-08',
            focus: 'performance',
            exercises: [{
                exId: 'bench',
                sessionNote: '',
                progressionContract: { role: 'primary', metric: 'volume' },
                sets: [set(100, 8, 2), set(100, 8, 2)],
            }],
        });

        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.priority).toBe('primary');
        expect(analysis.focus).toBe('volume');
        expect(analysis.classification).toBe('volume_progression');
        expect(current.exercises[0].sets).toHaveLength(3);
    });

    it('never applies a current-only weight fallback to a historical exposure', () => {
        const previous = workout({ id: 'weight-old', date: '2026-01-10', exId: 'pullup', sets: [set(20, 10, 2)] });
        const current = workout({ id: 'weight-new', date: '2026-06-10', exId: 'pullup', sets: [set(20, 10, 2)] });
        const nutrition = {
            '2026-01-05': { date: '2026-01-05', kcal: 0, carbs: 0, pro: 0, fat: 0, weight: 80 },
            '2026-06-05': { date: '2026-06-05', kcal: 0, carbs: 0, pro: 0, fat: 0, weight: 90 },
        };

        const withHistory = computeProgressionEngine(current, [previous], library, {
            nutrition, explicitBodyweightKg: 95,
        }).exercises[0];
        expect(withHistory.current.bodyweightKg).toBe(95);
        expect(withHistory.previousComparable?.bodyweightKg).toBe(80);
        expect(withHistory.previousComparable?.tonnageKg).toBe(1000);
        expect(withHistory.current.tonnageKg).toBe(1150);

        const withoutHistory = computeProgressionEngine(current, [previous], library, {
            explicitBodyweightKg: 95,
        }).exercises[0];
        expect(withoutHistory.current.bodyweightKg).toBe(95);
        expect(withoutHistory.previousComparable?.bodyweightKg).toBeUndefined();
        expect(withoutHistory.comparison.level).toBe('medium');
    });

    it('does not adopt infinite explicit bodyweight as a valid historical or current measurement', () => {
        const current = workout({ id: 'weight-invalid', date: '2026-06-10', exId: 'pullup', sets: [set(20, 10, 2)] });
        const analysis = computeProgressionEngine(current, [], library, {
            explicitBodyweightKg: Infinity,
        }).exercises[0];
        expect(analysis.current.bodyweightKg).toBeUndefined();
        expect(analysis.current.tonnageComplete).toBe(false);
    });

    it('does not truncate fractional repetitions into a fabricated performance comparison', () => {
        const current = workout({ id: 'invalid-reps', date: '2026-09-08', sets: [set(100, '8.5', 2)] });
        const exposure = normalizeExerciseExposure(current, current.exercises[0], bench);
        expect(exposure.workSets).toBe(0);
        expect(exposure.totalReps).toBe(0);
        expect(exposure.referenceSet?.reps).toBeUndefined();
        expect(computeProgressionEngine(current, [], library).exercises[0].isRecord).toBe(false);
    });
});
