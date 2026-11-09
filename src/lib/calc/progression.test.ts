import { describe, expect, it } from 'vitest';
import type { SessionExerciseSet, SetTechnique, WorkoutSession } from '../../types';
import {
    compareExposureCompatibility,
    computeProgressionEngine,
    normalizeExerciseExposure,
    progressionTrendLabel,
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

const plank: ProgressionExerciseRef = {
    id: 'plank',
    name: 'Plank',
    trackingType: 'time',
    isBodyweight: false,
    equipmentWeight: 0,
    muscles: ['abs'],
    secondaryMuscles: [],
};

const library = new Map<string, ProgressionExerciseRef>([
    [plank.id, plank],
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

function timedSet(time?: string, extra: Partial<SessionExerciseSet> = {}): SessionExerciseSet {
    return {
        id: `time-${time ?? 'missing'}`,
        kg: '',
        reps: '',
        technique: 'straight',
        ...(time !== undefined ? { time } : {}),
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
    it.each([
        { previousTime: '30', currentTime: '40', change: 'longer', classification: 'descriptive_change' },
        { previousTime: '40', currentTime: '30', change: 'shorter', classification: 'descriptive_change' },
        { previousTime: '30', currentTime: '30', change: 'same', classification: 'stable' },
    ] as const)(
        'compares timed sets $previousTime → $currentTime without inventing a strength record',
        ({ previousTime, currentTime, change, classification }) => {
            const previous = workout({ id: 't1', date: '2026-09-01', exId: 'plank', sets: [timedSet(previousTime)] });
            const current = workout({ id: 't2', date: '2026-09-08', exId: 'plank', sets: [timedSet(currentTime)] });
            const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

            expect(analysis.comparison.level).toBe('high');
            expect(analysis.outputChange).toBe(change);
            expect(analysis.classification).toBe(classification);
            expect(analysis.isRecord).toBe(false);
            expect(analysis.bestHistorical).toBeUndefined();
            expect(analysis.detail).toContain(`${previousTime}s → ${currentTime}s`);
            if (change !== 'same') expect(analysis.detail).toContain('non indica automaticamente');
            else {
                expect(analysis.headline).toBe('Durata registrata stabile');
                expect(analysis.detail).toContain('non prova da sola');
            }
        },
    );

    it.each([
        { times: ['20', '30', '40'], direction: 'duration_up', label: 'Durata in aumento' },
        { times: ['40', '30', '20'], direction: 'duration_down', label: 'Durata in diminuzione' },
    ] as const)('reports an objective time trend without treating it as a performance improvement', ({ times, direction, label }) => {
        const history = [
            workout({ id: 't1', date: '2026-09-01', exId: 'plank', sets: [timedSet(times[0])] }),
            workout({ id: 't2', date: '2026-09-08', exId: 'plank', sets: [timedSet(times[1])] }),
        ];
        const current = workout({ id: 't3', date: '2026-09-15', exId: 'plank', sets: [timedSet(times[2])] });
        const analysis = computeProgressionEngine(current, history, library).exercises[0];

        expect(analysis.trendDirection).toBe(direction);
        expect(progressionTrendLabel(analysis.trendDirection)).toBe(label);
        expect(analysis.isRecord).toBe(false);
    });

    it('compares timed segments even without a parent set duration', () => {
        const previous = workout({ id: 't1', date: '2026-09-01', exId: 'plank', sets: [
            timedSet(undefined, { segments: [{ id: 'seg-1', kg: '', reps: '', time: '10' }, { id: 'seg-2', kg: '', reps: '', time: '15' }] }),
        ] });
        const current = workout({ id: 't2', date: '2026-09-08', exId: 'plank', sets: [
            timedSet(undefined, { segments: [{ id: 'seg-1', kg: '', reps: '', time: '12' }, { id: 'seg-2', kg: '', reps: '', time: '17' }] }),
        ] });
        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.comparison.level).toBe('high');
        expect(analysis.outputChange).toBe('longer');
        expect(analysis.classification).toBe('descriptive_change');
        expect(analysis.detail).toContain('segmenti 10s + 15s → segmenti 12s + 17s');
    });

    it('treats a zero-second parent as unmeasured when segments contain valid durations', () => {
        const previous = workout({ id: 't1', date: '2026-09-01', exId: 'plank', sets: [
            timedSet('0', { segments: [{ id: 'seg-1', kg: '', reps: '', time: '10' }] }),
        ] });
        const current = workout({ id: 't2', date: '2026-09-08', exId: 'plank', sets: [
            timedSet('0', { segments: [{ id: 'seg-1', kg: '', reps: '', time: '15' }] }),
        ] });
        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.comparison.level).toBe('high');
        expect(analysis.outputChange).toBe('longer');
        expect(analysis.classification).toBe('descriptive_change');
        expect(analysis.detail).toContain('segmenti 10s → segmenti 15s');
        expect(analysis.detail).not.toContain('0s ·');
    });

    it('describes mixed timed segment changes without imposing a direction', () => {
        const previous = workout({ id: 't1', date: '2026-09-01', exId: 'plank', sets: [
            timedSet('30', { segments: [{ id: 'seg-1', kg: '', reps: '', time: '10' }, { id: 'seg-2', kg: '', reps: '', time: '15' }] }),
        ] });
        const current = workout({ id: 't2', date: '2026-09-08', exId: 'plank', sets: [
            timedSet('30', { segments: [{ id: 'seg-1', kg: '', reps: '', time: '12' }, { id: 'seg-2', kg: '', reps: '', time: '13' }] }),
        ] });
        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.outputChange).toBe('mixed');
        expect(analysis.classification).toBe('descriptive_change');
        expect(analysis.detail).toContain('30s · segmenti 10s + 15s');
        expect(analysis.detail).toContain('30s · segmenti 12s + 13s');
    });

    it('does not compare missing timed measurements or invent zero-second performance', () => {
        const previous = workout({ id: 't1', date: '2026-09-01', exId: 'plank', sets: [timedSet('30')] });
        const missing = workout({ id: 't2', date: '2026-09-08', exId: 'plank', sets: [timedSet()] });
        const analysis = computeProgressionEngine(missing, [previous], library).exercises[0];

        expect(analysis.current.referenceSet).toBeUndefined();
        expect(analysis.outputChange).toBe('unknown');
        expect(analysis.classification).toBe('insufficient_data');
        expect(analysis.isRecord).toBe(false);
    });

    it('does not silently ignore one missing duration in an otherwise observed segmented set', () => {
        const previous = workout({ id: 't1', date: '2026-09-01', exId: 'plank', sets: [
            timedSet('30', { segments: [{ id: 'seg-1', kg: '', reps: '', time: '10' }] }),
        ] });
        const current = workout({ id: 't2', date: '2026-09-08', exId: 'plank', sets: [
            timedSet('30', { segments: [{ id: 'seg-1', kg: '', reps: '' }] }),
        ] });
        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.comparison.level).toBe('high');
        expect(analysis.outputChange).toBe('unknown');
        expect(analysis.classification).toBe('insufficient_data');
    });

    it('does not claim stable timed performance when neither exposure recorded segment durations', () => {
        const withoutSegmentTime = timedSet('30', {
            segments: [{ id: 'seg-1', kg: '', reps: '' }],
        });
        const previous = workout({ id: 't1', date: '2026-09-01', exId: 'plank', sets: [withoutSegmentTime] });
        const current = workout({ id: 't2', date: '2026-09-08', exId: 'plank', sets: [structuredClone(withoutSegmentTime)] });
        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.comparison.level).toBe('high');
        expect(analysis.outputChange).toBe('unknown');
        expect(analysis.classification).toBe('insufficient_data');
        expect(analysis.quality).toBe('limited');
        expect(analysis.qualityReasons.join(' ')).toContain('Durata non verificabile');
        expect(analysis.trendDirection).toBe('insufficient');
        expect(analysis.isRecord).toBe(false);
    });

    it('does not produce a stable time trend when comparable exposures omit segment measurements', () => {
        const timed = (id: string, date: string) => workout({
            id, date, exId: 'plank', sets: [timedSet('30', {
                segments: [{ id: 'seg-1', kg: '', reps: '' }],
            })],
        });
        const history = [timed('t1', '2026-09-01'), timed('t2', '2026-09-08')];
        const current = timed('t3', '2026-09-15');
        const analysis = computeProgressionEngine(current, history, library).exercises[0];

        expect(analysis.trendDirection).toBe('insufficient');
        expect(analysis.classification).toBe('insufficient_data');
        expect(analysis.quality).toBe('limited');
        expect(analysis.qualityReasons.join(' ')).toContain('Durata non verificabile');
        expect(analysis.isRecord).toBe(false);
    });

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
        expect(analysis.bestHistorical?.sessionId).toBe('w2');
        expect(analysis.quality).toBe('preliminary');
    });

    it('recovers clear record analysis after old incomplete RIR ages out of the recent comparable window', () => {
        const incomplete = workout({ id: 'w0', date: '2026-08-01', sets: [set(120, 10)] });
        const first = workout({ id: 'w1', date: '2026-08-15', sets: [set(100, 8, 2)] });
        const second = workout({ id: 'w2', date: '2026-08-22', sets: [set(100, 9, 2)] });
        const third = workout({ id: 'w3', date: '2026-08-29', sets: [set(100, 10, 2)] });
        const current = workout({ id: 'w4', date: '2026-09-05', sets: [set(100, 11, 2)] });

        const analysis = computeProgressionEngine(current, [incomplete, first, second, third], library).exercises[0];

        expect(analysis.quality).toBe('clear');
        expect(analysis.bestHistorical?.sessionId).toBe('w3');
        expect(analysis.classification).toBe('performance_record');
        expect(analysis.isRecord).toBe(true);
    });

    it('keeps a recent missing-RIR exposure conservative while retaining the best high-comparability reference', () => {
        const first = workout({ id: 'w1', date: '2026-08-15', sets: [set(100, 8, 2)] });
        const second = workout({ id: 'w2', date: '2026-08-22', sets: [set(100, 9, 2)] });
        const incomplete = workout({ id: 'w3', date: '2026-08-29', sets: [set(105, 9)] });
        const current = workout({ id: 'w4', date: '2026-09-05', sets: [set(100, 10, 2)] });

        const analysis = computeProgressionEngine(current, [first, second, incomplete], library).exercises[0];

        expect(analysis.quality).toBe('preliminary');
        expect(analysis.bestHistorical?.sessionId).toBe('w2');
        expect(analysis.isRecord).toBe(false);
        expect(analysis.qualityReasons.join(' ')).toContain('RIR mancante');
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

    it('does not use unperformed planned sets as reference exposures', () => {
        const previous = workout({
            id: 'empty-previous', date: '2026-09-01',
            sets: [{ id: 'planned-previous', kg: '80', reps: '', rir: 2 }],
        });
        const current = workout({
            id: 'empty-current', date: '2026-09-08',
            sets: [{ id: 'planned-current', kg: '80', reps: '', rir: 2 }],
        });

        const analysis = computeProgressionEngine(current, [previous], library).exercises[0];

        expect(analysis.current.workSets).toBe(0);
        expect(analysis.current.referenceSet).toBeUndefined();
        expect(analysis.previousComparable).toBeUndefined();
        expect(analysis.comparison.level).toBe('none');
        expect(analysis.classification).toBe('insufficient_data');
        expect(analysis.isRecord).toBe(false);
    });

    it('counts completed continuation reps even when the parent set is blank', () => {
        const current = workout({
            id: 'segment-only', date: '2026-09-08',
            sets: [{
                id: 'parent', kg: '', reps: '', technique: 'dropset',
                segments: [{ id: 'drop', technique: 'dropset', kg: '50', reps: '6' }],
            }],
        });

        const exposure = normalizeExerciseExposure(current, current.exercises[0], bench);

        expect(exposure.workSets).toBe(1);
        expect(exposure.totalReps).toBe(6);
        expect(exposure.tonnageComplete).toBe(true);
        expect(exposure.tonnageKg).toBe(300);
        expect(exposure.referenceSet?.segments[0]?.reps).toBe(6);
    });

    it('observes timed isometry continuations without inventing a complete tonnage', () => {
        const current = workout({
            id: 'isometry-only', date: '2026-09-08',
            sets: [{
                id: 'parent', kg: '', reps: '',
                segments: [{ id: 'iso', technique: 'isometry', kg: '30', reps: '', time: '30' }],
            }],
        });

        const exposure = normalizeExerciseExposure(current, current.exercises[0], bench);

        expect(exposure.workSets).toBe(1);
        expect(exposure.totalReps).toBe(0);
        expect(exposure.tonnageComplete).toBe(false);
        expect(exposure.tonnageKg).toBeUndefined();
        expect(exposure.referenceSet?.segments[0]?.timeSeconds).toBe(30);
    });

    it('does not infer density improvement from two sessions containing only planned sets', () => {
        const blank = [{ id: 'planned', kg: '100', reps: '', rir: 2 }];
        const previous = workout({
            id: 'zero-work-prev', date: '2026-09-01', routineId: 'density-r',
            focus: 'density', duration: '01:10:00', sets: blank,
        });
        const current = workout({
            id: 'zero-work-current', date: '2026-09-08', routineId: 'density-r',
            focus: 'density', duration: '00:45:00', sets: blank,
        });

        const result = computeProgressionEngine(current, [previous], library);

        expect(result.density?.quality).toBe('limited');
        expect(result.density?.headline).toContain('senza lavoro osservabile');
        expect(result.density?.currentDurationSeconds).toBe(45 * 60);
        expect(result.density?.previousDurationSeconds).toBe(70 * 60);
        expect(result.exercises[0].current.workSets).toBe(0);
    });

    it('preserves historical comparability and exclusion reasons across mixed evidence', () => {
        const old = workout({ id: 'old-high', date: '2026-08-01', routineId: 'same', sets: [set(100, 8, 2)] });
        const limited = workout({ id: 'recent-limited', date: '2026-08-15', routineId: 'same', sets: [set(100, 9)] });
        const excluded = workout({ id: 'latest-other-routine', date: '2026-08-22', routineId: 'other', sets: [set(100, 10, 2)] });
        const current = workout({ id: 'current', date: '2026-09-01', routineId: 'same', sets: [set(100, 10, 2)] });

        const analysis = computeProgressionEngine(current, [excluded, old, limited], library).exercises[0];

        expect(analysis.latestExposure?.sessionId).toBe('latest-other-routine');
        expect(analysis.previousComparable?.sessionId).toBe('recent-limited');
        expect(analysis.bestHistorical?.sessionId).toBe('old-high');
        expect(analysis.comparison.level).toBe('medium');
        expect(analysis.qualityReasons.join(' ')).toContain('Esposizione più recente esclusa');
        expect(analysis.isRecord).toBe(false);
    });

    it('indexes each historical exercise list once and matches independent single-exercise reports', () => {
        const history = Array.from({ length: 72 }, (_, index) => {
            const month = String(1 + (index % 8)).padStart(2, '0');
            const date = `2026-${month}-${String(1 + (index % 26)).padStart(2, '0')}`;
            return workout({
                id: `history-${index}`, date,
                exercises: [
                    { exId: 'bench', sessionNote: '', sets: [set(90 + index % 8, 8, 2)] },
                    { exId: 'pullup', sessionNote: '', sets: [set(10, 8, 2)] },
                    { exId: 'leg-extension', sessionNote: '', sets: [set(60, 10, 2)] },
                ],
            });
        });
        let inspectedLists = 0;
        for (const item of history) {
            const source = item.exercises;
            Object.defineProperty(item, 'exercises', {
                configurable: true,
                get() { inspectedLists++; return source; },
            });
        }
        const current = workout({
            id: 'current-index', date: '2026-10-01',
            exercises: [
                { exId: 'bench', sessionNote: '', sets: [set(100, 8, 2)] },
                { exId: 'pullup', sessionNote: '', sets: [set(12, 8, 2)] },
                { exId: 'leg-extension', sessionNote: '', sets: [set(70, 10, 2)] },
            ],
        });
        const nutrition = {
            '2026-01-01': { date: '2026-01-01', kcal: 0, carbs: 0, pro: 0, fat: 0, weight: 78 },
            '2026-06-01': { date: '2026-06-01', kcal: 0, carbs: 0, pro: 0, fat: 0, weight: 82 },
            '2026-09-15': { date: '2026-09-15', kcal: 0, carbs: 0, pro: 0, fat: 0, weight: 85 },
        };
        const independent = current.exercises.map(exercise =>
            computeProgressionEngine({ ...current, exercises: [exercise] }, history, library, { nutrition }).exercises[0]
        );
        inspectedLists = 0;
        const combined = computeProgressionEngine(current, history, library, { nutrition });
        expect(combined.exercises).toEqual(independent);
        expect(inspectedLists).toBe(history.length);
        expect(combined.exercises.find(exercise => exercise.exId === 'pullup')?.current.bodyweightKg).toBe(85);
    });

    it('keeps the first duplicate historical exercise and never reuses a current-only bodyweight override for history', () => {
        const previous = workout({
            id: 'duplicate-history', date: '2026-03-05',
            exercises: [
                { exId: 'pullup', sessionNote: '', sets: [set(5, 8, 2)] },
                { exId: 'pullup', sessionNote: '', sets: [set(30, 8, 2)] },
            ],
        });
        const current = workout({
            id: 'today', date: '2026-06-10', exId: 'pullup', sets: [set(10, 8, 2)],
        });
        const nutrition = {
            '2026-01-20': { date: '2026-01-20', kcal: 0, carbs: 0, pro: 0, fat: 0, weight: 80 },
            '2026-03-01': { date: '2026-03-01', kcal: 0, carbs: 0, pro: 0, fat: 0, weight: 0 },
            '2026-05-01': { date: '2026-05-01', kcal: 0, carbs: 0, pro: 0, fat: 0, weight: 90 },
            '2026-07-01': { date: '2026-07-01', kcal: 0, carbs: 0, pro: 0, fat: 0, weight: 110 },
        };
        const analysis = computeProgressionEngine(current, [previous], library, {
            nutrition, explicitBodyweightKg: 95,
        }).exercises[0];
        expect(analysis.current.bodyweightKg).toBe(95);
        expect(analysis.previousComparable?.bodyweightKg).toBe(80);
        expect(analysis.previousComparable?.referenceSet?.kg).toBe(5);
        expect(analysis.previousComparable?.referenceSet?.effectiveKg).toBe(85);
    });

    it('keeps the first input session on a density chronology tie', () => {
        const earlier = workout({
            id: 'first-input', date: '2026-09-01', routineId: 'density',
            focus: 'density', duration: '00:42:00', sets: [set(80, 8, 2)],
        });
        const sameChronology = workout({
            id: 'second-input', date: '2026-09-01', routineId: 'density',
            focus: 'density', duration: '00:36:00', sets: [set(80, 8, 2)],
        });
        earlier.globalStartTime = 1000;
        sameChronology.globalStartTime = 1000;
        const current = workout({
            id: 'current', date: '2026-09-08', routineId: 'density',
            focus: 'density', duration: '00:30:00', sets: [set(80, 8, 2)],
        });
        const result = computeProgressionEngine(current, [earlier, sameChronology], library);
        expect(result.density?.previousDurationSeconds).toBe(42 * 60);
        expect(result.density?.currentDurationSeconds).toBe(30 * 60);
    });

});
