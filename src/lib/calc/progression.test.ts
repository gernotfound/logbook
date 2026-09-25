import { describe, expect, it } from 'vitest';
import type { SessionExerciseSet, SetTechnique, WorkoutSession } from '../../types';
import {
    compareExposureCompatibility,
    computeProgressionEngine,
    normalizeExerciseExposure,
    type ProgressionExerciseRef,
} from './progression';

const bench: ProgressionExerciseRef = {
    id: 'bench',
    name: 'Panca piana',
    trackingType: 'weight_reps',
    isBodyweight: false,
    equipmentWeight: 0,
    muscles: ['chest'],
    secondaryMuscles: ['triceps'],
};

const pullup: ProgressionExerciseRef = {
    id: 'pullup',
    name: 'Trazioni',
    trackingType: 'weight_reps',
    isBodyweight: true,
    equipmentWeight: 0,
    muscles: ['lats'],
    secondaryMuscles: ['biceps'],
};

const legExtension: ProgressionExerciseRef = {
    id: 'leg-extension',
    name: 'Leg extension',
    trackingType: 'weight_reps',
    isBodyweight: false,
    equipmentWeight: 0,
    muscles: ['quadriceps'],
    secondaryMuscles: [],
};

const library = new Map<string, ProgressionExerciseRef>([
    [bench.id, bench],
    [pullup.id, pullup],
    [legExtension.id, legExtension],
]);

function set(
    kg: number | string,
    reps: number | string,
    rir?: number,
    extra: Partial<SessionExerciseSet> = {},
): SessionExerciseSet {
    return {
        id: extra.id || `s-${kg}-${reps}-${rir ?? 'x'}`,
        kg: String(kg),
        reps: String(reps),
        ...(rir !== undefined ? { rir } : {}),
        ...extra,
    };
}

function workout(options: {
    id: string;
    date: string;
    routineId?: string;
    cycleId?: string;
    intent?: 'development' | 'maintenance' | 'deload';
    focus?: 'performance' | 'volume' | 'density' | 'execution';
    exId?: string;
    sets?: SessionExerciseSet[];
    exercises?: WorkoutSession['exercises'];
    duration?: string;
    primaryMuscles?: string[];
    secondaryMuscles?: string[];
}): WorkoutSession {
    const strategy = options.intent || options.focus || options.primaryMuscles || options.secondaryMuscles
        ? {
            ...(options.intent ? { intent: options.intent } : {}),
            ...(options.focus ? { progressionFocus: options.focus } : {}),
            ...(options.primaryMuscles ? { primaryMuscles: options.primaryMuscles } : {}),
            ...(options.secondaryMuscles ? { secondaryMuscles: options.secondaryMuscles } : {}),
        }
        : undefined;
    return {
        id: options.id,
        date: options.date,
        routineId: options.routineId,
        routineName: options.routineId || 'Sessione',
        cycleId: options.cycleId,
        ...(strategy ? { cycleStrategy: strategy } : {}),
        ...(options.duration ? { globalDurationStr: options.duration } : {}),
        exercises: options.exercises || [{
            exId: options.exId || 'bench',
            sessionNote: '',
            sets: options.sets || [],
        }],
    };
}

function advancedSet(
    technique: Exclude<SetTechnique, 'straight'>,
    rir = 2,
    restBeforeSeconds = 20,
): SessionExerciseSet {
    return set(100, 8, rir, {
        technique,
        target: technique === 'rep_match' || technique === 'diminishing'
            ? { type: 'reps', reps: 8 }
            : undefined,
        segments: [{
            id: `seg-${technique}`,
            kg: technique === 'cluster' ? '100' : '90',
            reps: '3',
            restBeforeSeconds,
        }],
    });
}

describe('contextual progression engine', () => {
    it('recognizes +1 rep at the same load and RIR as a strong performance record', () => {
        const previous = workout({ id: 'w1', date: '2026-09-01', sets: [set(100, 8, 2)] });
        const current = workout({ id: 'w2', date: '2026-09-08', sets: [set(100, 9, 2)] });

        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.comparison.level).toBe('high');
        expect(analysis.classification).toBe('performance_record');
        expect(analysis.isRecord).toBe(true);
        expect(analysis.detail).toContain('100 kg × 8 · RIR 2');
        expect(analysis.detail).toContain('100 kg × 9 · RIR 2');
    });

    it('does not award a new record when the current output only ties the historical best', () => {
        const older = workout({ id: 'w1', date: '2026-08-25', sets: [set(100, 8, 2)] });
        const best = workout({ id: 'w2', date: '2026-09-01', sets: [set(100, 10, 2)] });
        const current = workout({ id: 'w3', date: '2026-09-08', sets: [set(100, 10, 2)] });

        const analysis = computeProgressionEngine(current, [older, best], library).exercises[0];

        expect(analysis.isRecord).toBe(false);
        expect(analysis.classification).toBe('stable');
    });

    it('suppresses a historical record claim when an otherwise relevant exposure has missing RIR', () => {
        const incomplete = workout({ id: 'w1', date: '2026-08-25', sets: [set(105, 10)] });
        const comparable = workout({ id: 'w2', date: '2026-09-01', sets: [set(100, 8, 2)] });
        const current = workout({ id: 'w3', date: '2026-09-08', sets: [set(100, 9, 2)] });

        const analysis = computeProgressionEngine(current, [incomplete, comparable], library).exercises[0];

        expect(analysis.isRecord).toBe(false);
        expect(analysis.bestHistorical).toBeUndefined();
        expect(analysis.quality).toBe('preliminary');
    });

    it('qualifies more reps when the athlete also reports more effort', () => {
        const previous = workout({ id: 'w1', date: '2026-09-01', sets: [set(100, 8, 2)] });
        const current = workout({ id: 'w2', date: '2026-09-08', sets: [set(100, 9, 0)] });

        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.classification).toBe('output_up_effort_up');
        expect(analysis.isRecord).toBe(false);
        expect(analysis.headline).toContain('effort maggiore');
    });

    it('describes the same output with a higher RIR as lower declared effort, not a PR', () => {
        const previous = workout({ id: 'w1', date: '2026-09-01', sets: [set(100, 8, 1)] });
        const current = workout({ id: 'w2', date: '2026-09-08', sets: [set(100, 8, 3)] });

        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.classification).toBe('stable_less_effort');
        expect(analysis.isRecord).toBe(false);
    });

    it('treats a 2 to 4 work-set increase as volume progression under a volume focus', () => {
        const previous = workout({
            id: 'w1', date: '2026-09-01', cycleId: 'c1', intent: 'development', focus: 'volume',
            sets: [set(100, 10, 2), set(100, 9, 2)],
        });
        const current = workout({
            id: 'w2', date: '2026-09-08', cycleId: 'c1', intent: 'development', focus: 'volume',
            sets: [set(100, 10, 2), set(100, 9, 2), set(100, 8, 2), set(100, 7, 2)],
        });

        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.classification).toBe('volume_progression');
        expect(analysis.current.workSets).toBe(4);
        expect(analysis.previousComparable?.workSets).toBe(2);
    });

    it('does not call reduced dose a regression during maintenance when reference performance is stable', () => {
        const previous = workout({
            id: 'w1', date: '2026-09-01', intent: 'maintenance', focus: 'performance',
            sets: [set(100, 8, 2), set(100, 8, 2), set(100, 8, 2)],
        });
        const current = workout({
            id: 'w2', date: '2026-09-08', intent: 'maintenance', focus: 'performance',
            sets: [set(100, 8, 2), set(100, 8, 2)],
        });

        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.classification).toBe('maintenance_stable');
        expect(analysis.detail).toContain('Dose osservata: 3 → 2 serie');
    });

    it('describes deload reductions without classifying them as regression', () => {
        const previous = workout({
            id: 'w1', date: '2026-09-01', intent: 'development', focus: 'performance',
            sets: [set(100, 8, 1), set(100, 8, 1), set(100, 8, 1)],
        });
        const current = workout({
            id: 'w2', date: '2026-09-08', intent: 'deload', focus: 'performance',
            sets: [set(80, 6, 4), set(80, 6, 4)],
        });

        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.classification).toBe('deload_change');
        expect(analysis.headline).toContain('Deload');
        expect(analysis.isRecord).toBe(false);
    });

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

    it('keeps exercise progression continuous when the exercise moves to another routine', () => {
        const previous = workout({ id: 'w1', date: '2026-09-01', routineId: 'push-a', sets: [set(100, 8, 2)] });
        const current = workout({ id: 'w2', date: '2026-09-08', routineId: 'torso', sets: [set(100, 9, 2)] });

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

    it('partitions progression history by explicit baseline version', () => {
        const previous = workout({
            id: 'base-v1',
            date: '2026-09-01',
            exercises: [{
                exId: 'bench',
                sessionNote: '',
                technicalStandard: 'ROM completo',
                progressionContract: { baselineVersion: 1, baselineState: 'historical', metric: 'performance' },
                sets: [set(100, 8, 2)],
            }],
        });
        const current = workout({
            id: 'base-v2',
            date: '2026-09-08',
            exercises: [{
                exId: 'bench',
                sessionNote: '',
                technicalStandard: 'ROM completo',
                progressionContract: { baselineVersion: 2, baselineState: 'reacclimation', metric: 'performance' },
                sets: [set(90, 8, 3)],
            }],
        });

        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.comparisonStatus).toBe('not_comparable');
        expect(analysis.baselineState).toBe('reacclimation');
        expect(analysis.baselineVersion).toBe(2);
        expect(analysis.progressionContract?.metric).toBe('performance');
        expect(analysis.comparison.reasons.join(' ')).toContain('Versione baseline');
    });

    it('uses advanced segment execution metadata as part of comparability without assigning stimulus scores', () => {
        const previousSet = set(80, 8, 2, {
            technique: 'cluster',
            segments: [{ id: 'seg-1', kg: '80', reps: '4', restBeforeSeconds: 20, eccentricSeconds: 2, holdPosition: 'stretched', assistance: 'none' }],
        });
        const currentSet = set(80, 8, 2, {
            technique: 'cluster',
            segments: [{ id: 'seg-2', kg: '80', reps: '4', restBeforeSeconds: 20, eccentricSeconds: 4, holdPosition: 'stretched', assistance: 'none' }],
        });
        const previous = workout({ id: 'seg-prev', date: '2026-09-01', sets: [previousSet] });
        const current = workout({ id: 'seg-current', date: '2026-09-08', sets: [currentSet] });

        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.comparisonStatus).toBe('not_comparable');
        expect(analysis.comparison.reasons.join(' ')).toContain('Parametri tecnici');
        expect(analysis).not.toHaveProperty('stimulusScore');
    });

    it('lets the exercise progression contract refine role and metric without changing the programmed work', () => {
        const current = workout({
            id: 'contract-current',
            date: '2026-09-15',
            focus: 'performance',
            exercises: [{
                exId: 'bench',
                sessionNote: '',
                progressionContract: { role: 'primary', metric: 'volume', target: '3 serie da 10' },
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
                progressionContract: { role: 'primary', metric: 'volume', target: '3 serie da 10' },
                sets: [set(100, 8, 2), set(100, 8, 2)],
            }],
        });

        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.priority).toBe('primary');
        expect(analysis.focus).toBe('volume');
        expect(analysis.classification).toBe('volume_progression');
        expect(current.exercises[0].sets).toHaveLength(3);
    });

});
