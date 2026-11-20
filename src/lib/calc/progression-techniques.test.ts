import { describe, expect, it } from 'vitest';
import { computeProgressionEngine } from './progression';
import { library, set, workout, advancedSet } from './progressionTestFixtures';

describe('contextual progression engine: advanced techniques and execution context', () => {
    it('does not compare a straight set directly with a rest-pause set', () => {
        const previous = workout({ id: 'w1', date: '2026-09-01', sets: [set(100, 10, 2)] });
        const current = workout({ id: 'w2', date: '2026-09-08', sets: [advancedSet('rest_pause')] });

        const result = computeProgressionEngine(current, [previous], library);
        const analysis = result.exercises[0];

        expect(analysis.comparison.level).toBe('none');
        expect(analysis.classification).toBe('new_baseline');
        expect(analysis.isRecord).toBe(false);
        expect(analysis.qualityReasons.join(' ')).toContain('Tecnica diversa');
    });

    it.each(['rep_match', 'cluster', 'diminishing'] as const)(
        'preserves %s segment structure in normalization and comparison',
        technique => {
            const previous = workout({ id: 'w1', date: '2026-09-01', sets: [advancedSet(technique)] });
            const current = workout({ id: 'w2', date: '2026-09-08', sets: [advancedSet(technique)] });
            const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

            expect(analysis.current.referenceSet?.technique).toBe(technique);
            expect(analysis.current.referenceSet?.segments).toHaveLength(1);
            expect(analysis.comparison.level).toBe('high');
        },
    );

    it('rejects direct comparison when advanced-set structured rest changes', () => {
        const previous = workout({ id: 'w1', date: '2026-09-01', sets: [advancedSet('cluster', 2, 20)] });
        const current = workout({ id: 'w2', date: '2026-09-08', sets: [advancedSet('cluster', 2, 40)] });

        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.comparison.level).toBe('none');
        expect(analysis.qualityReasons.join(' ')).toContain('Recuperi strutturati');
    });

    it('degrades record confidence when the exposure adds a different advanced-set structure', () => {
        const previous = workout({
            id: 'w1',
            date: '2026-09-01',
            sets: [set(100, 8, 2), set(90, 10, 2)],
        });
        const current = workout({
            id: 'w2',
            date: '2026-09-08',
            sets: [set(100, 9, 2), advancedSet('rest_pause')],
        });

        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.comparison.level).toBe('medium');
        expect(analysis.quality).toBe('preliminary');
        expect(analysis.isRecord).toBe(false);
        expect(analysis.qualityReasons.join(' ')).toContain('mix di tecniche');
    });

    it('starts an independent progression context when the same exercise is used in another routine', () => {
        const previous = workout({ id: 'w1', date: '2026-09-01', routineId: 'push-a', sets: [set(100, 8, 2)] });
        const current = workout({ id: 'w2', date: '2026-09-08', routineId: 'torso', sets: [set(100, 9, 2)] });

        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.previousComparable).toBeUndefined();
        expect(analysis.comparisonStatus).toBe('not_comparable');
        expect(analysis.comparison.reasons.join(' ')).toContain('Scheda diversa');
        expect(analysis.classification).toBe('new_baseline');
        expect(analysis.isRecord).toBe(false);
    });

    it('keeps progression continuous inside the same routine context', () => {
        const previous = workout({ id: 'w1', date: '2026-09-01', routineId: 'push-a', sets: [set(100, 8, 2)] });
        const current = workout({ id: 'w2', date: '2026-09-08', routineId: 'push-a', sets: [set(100, 9, 2)] });

        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.previousComparable?.routineId).toBe('push-a');
        expect(analysis.classification).toBe('performance_record');
    });

    it('uses bodyweight measured for each session date instead of a current global fallback', () => {
        const previous = workout({ id: 'w1', date: '2026-01-10', exId: 'pullup', sets: [set(20, 10, 2)] });
        const current = workout({ id: 'w2', date: '2026-06-10', exId: 'pullup', sets: [set(20, 10, 2)] });
        const nutrition = {
            '2026-01-05': { date: '2026-01-05', kcal: 0, carbs: 0, pro: 0, fat: 0, weight: 80 },
            '2026-06-05': { date: '2026-06-05', kcal: 0, carbs: 0, pro: 0, fat: 0, weight: 90 },
        };

        const analysis = computeProgressionEngine(current, [previous], library, { nutrition }).exercises[0];

        expect(analysis.previousComparable?.bodyweightKg).toBe(80);
        expect(analysis.current.bodyweightKg).toBe(90);
        expect(analysis.previousComparable?.tonnageKg).toBe(1000);
        expect(analysis.current.tonnageKg).toBe(1100);
    });

    it('degrades comparison quality when RIR is missing and suppresses direct records', () => {
        const previous = workout({ id: 'w1', date: '2026-09-01', sets: [set(100, 8)] });
        const current = workout({ id: 'w2', date: '2026-09-08', sets: [set(100, 9, 2)] });

        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.comparison.level).toBe('medium');
        expect(analysis.quality).toBe('preliminary');
        expect(analysis.isRecord).toBe(false);
        expect(analysis.qualityReasons.join(' ')).toContain('RIR mancante');
    });

    it('marks the first execution as a baseline, not a PR', () => {
        const current = workout({ id: 'w1', date: '2026-09-01', sets: [set(100, 8, 2)] });

        const analysis = computeProgressionEngine(current, [], library).exercises[0];

        expect(analysis.classification).toBe('new_baseline');
        expect(analysis.isRecord).toBe(false);
    });

    it('uses the strategy snapshot stored on the historical workout', () => {
        const baseline = workout({
            id: 'w1', date: '2026-09-01', cycleId: 'cycle-a', intent: 'development', focus: 'volume',
            sets: [set(100, 10, 2), set(100, 9, 2)],
        });
        const historicalSession = workout({
            id: 'w2', date: '2026-09-08', cycleId: 'cycle-a', intent: 'development', focus: 'volume',
            sets: [set(100, 10, 2), set(100, 9, 2), set(100, 8, 2)],
        });

        const analysis = computeProgressionEngine(historicalSession, [baseline], library).exercises[0];

        expect(analysis.focus).toBe('volume');
        expect(analysis.classification).toBe('volume_progression');
    });

    it('recalculates recent trend after a manual history edit instead of relying on persisted conclusions', () => {
        const h1 = workout({ id: 'w1', date: '2026-09-01', sets: [set(100, 8, 2)] });
        const h2 = workout({ id: 'w2', date: '2026-09-08', sets: [set(100, 9, 2)] });
        const current = workout({ id: 'w3', date: '2026-09-15', sets: [set(100, 10, 2)] });

        const before = computeProgressionEngine(current, [h2, h1], library).exercises[0];
        const editedH2 = workout({ id: 'w2', date: '2026-09-08', sets: [set(100, 7, 2)] });
        const after = computeProgressionEngine(current, [editedH2, h1], library).exercises[0];

        expect(before.trendDirection).toBe('up');
        expect(after.trendDirection).toBe('mixed');
    });

    it('starts a new baseline when the registered execution mode changes', () => {
        const previous = workout({ id: 'w1', date: '2026-09-01', sets: [set(100, 8, 2, { executionMode: 'standard' })] });
        const current = workout({ id: 'w2', date: '2026-09-08', sets: [set(100, 8, 2, { executionMode: 'stop_reps' })] });

        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.comparison.level).toBe('none');
        expect(analysis.classification).toBe('new_baseline');
    });

    it('does not manufacture conclusions from incomplete set data', () => {
        const previous = workout({ id: 'w1', date: '2026-09-01', sets: [set(100, 8, 2)] });
        const current = workout({
            id: 'w2',
            date: '2026-09-08',
            sets: [{ id: 'broken', kg: '', reps: '', technique: 'straight' }],
        });

        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.isRecord).toBe(false);
        expect(['insufficient_data', 'new_baseline']).toContain(analysis.classification);
    });

    it('leaves workout history untouched because progression conclusions are derived', () => {
        const previous = workout({ id: 'w1', date: '2026-09-01', sets: [set(100, 8, 2)] });
        const current = workout({ id: 'w2', date: '2026-09-08', sets: [set(100, 9, 2)] });
        const before = structuredClone({ previous, current });

        computeProgressionEngine(current, [previous], library);

        expect({ previous, current }).toEqual(before);
        expect(current).not.toHaveProperty('progression');
        expect(previous).not.toHaveProperty('progression');
    });
});
