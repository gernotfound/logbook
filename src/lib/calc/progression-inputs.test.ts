import { describe, expect, it } from 'vitest';
import type { WorkoutSession } from '../../types';
import { computeProgressionEngine, normalizeExerciseExposure } from './progression';
import { bench, pullup, plank, library, set, timedSet, workout } from './progressionTestFixtures';

describe('contextual progression engine: incomplete and invalid inputs', () => {
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


    it('reads each historical session once for multiple exercises and keeps first duplicates in chronological order', () => {
        const exercise = (exId: string, reps: number) => ({
            exId, sessionNote: '', sets: [set(100, reps, 2)],
        });
        const oldest = workout({
            id: 'old', date: '2026-08-01',
            exercises: [exercise('bench', 8), exercise('leg-extension', 6)],
        });
        const latest = workout({
            id: 'latest', date: '2026-09-01',
            exercises: [exercise('bench', 9), exercise('bench', 99), exercise('leg-extension', 7)],
        });
        const current = workout({
            id: 'current', date: '2026-09-08',
            exercises: [exercise('bench', 10), exercise('leg-extension', 8)],
        });
        let historicalReads = 0;
        const counted = (session: WorkoutSession): WorkoutSession => ({
            ...session,
            get exercises() {
                historicalReads++;
                return session.exercises;
            },
        });

        const result = computeProgressionEngine(current, [counted(latest), counted(oldest)], library);
        const benchResult = result.exercises.find(item => item.exId === 'bench');
        const legResult = result.exercises.find(item => item.exId === 'leg-extension');

        expect(historicalReads).toBe(2);
        expect(benchResult?.latestExposure?.sessionId).toBe('latest');
        expect(benchResult?.latestExposure?.referenceSet?.reps).toBe(9);
        expect(benchResult?.previousComparable?.referenceSet?.reps).toBe(9);
        expect(benchResult?.cycleBaseline).toBeUndefined();
        expect(legResult?.latestExposure?.sessionId).toBe('latest');
        expect(legResult?.previousComparable?.referenceSet?.reps).toBe(7);
    });

    it('uses the last valid measured bodyweight before each session without adopting future or malformed entries', () => {
        const previous = workout({ id: 'old', date: '2026-05-20', exId: 'pullup', sets: [set(20, 10, 2)] });
        const current = workout({ id: 'current', date: '2026-06-10', exId: 'pullup', sets: [set(20, 10, 2)] });
        const day = (date: string, weight: number | string) => ({
            date, kcal: 0, carbs: 0, pro: 0, fat: 0, weight,
        });
        const nutrition = {
            '2026-07-01': day('2026-07-01', 200),
            '2026-06-09': day('2026-06-09', ''),
            'bad-date': day('bad-date', 900),
            '2026-05-21': day('2026-05-21', 0),
            '2026-05-05': day('2026-05-05', 80),
            '2026-06-01': day('2026-06-01', '87,5'),
        };

        const analysis = computeProgressionEngine(current, [previous], library, { nutrition }).exercises[0];
        expect(analysis.previousComparable?.bodyweightKg).toBe(80);
        expect(analysis.current.bodyweightKg).toBe(87.5);
        expect(analysis.previousComparable?.tonnageKg).toBe(1000);
        expect(analysis.current.tonnageKg).toBe(1075);
    });

    it('preserves first-input tie resolution for the latest eligible density session', () => {
        const earlier = workout({
            id: 'early', date: '2026-08-01', routineId: 'density',
            focus: 'density', duration: '01:30:00', sets: [set(100, 8, 2)],
        });
        const firstTie = workout({
            id: 'tie-first', date: '2026-09-01', routineId: 'density',
            focus: 'density', duration: '01:00:00', sets: [set(100, 8, 2)],
        });
        const secondTie = workout({
            id: 'tie-second', date: '2026-09-01', routineId: 'density',
            focus: 'density', duration: '00:55:00', sets: [set(100, 8, 2)],
        });
        const current = workout({
            id: 'current', date: '2026-09-08', routineId: 'density',
            focus: 'density', duration: '00:45:00', sets: [set(100, 8, 2)],
        });

        const result = computeProgressionEngine(current, [firstTie, earlier, secondTie], library);
        expect(result.density?.previousDurationSeconds).toBe(3600);
        expect(result.density?.currentDurationSeconds).toBe(2700);
        expect(result.density?.quality).toBe('preliminary');
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


    it('uses the same measured-metric parsing for a parent set and its advanced segment', () => {
        const current = workout({
            id: 'shared-measures',
            date: '2026-09-08',
            sets: [{
                id: 'parent',
                kg: '20,5',
                reps: '4',
                rir: 2,
                time: '1:30',
                segments: [{
                    id: 'continuation',
                    technique: 'isometry',
                    kg: '10,5',
                    reps: '2',
                    time: '30s',
                }],
            }],
        });
        const exposure = normalizeExerciseExposure(current, current.exercises[0], bench);

        expect(exposure.sets[0]).toMatchObject({
            kg: 20.5,
            effectiveKg: 20.5,
            reps: 4,
            rir: 2,
            timeSeconds: 90,
            segments: [{
                technique: 'isometry',
                kg: 10.5,
                effectiveKg: 10.5,
                reps: 2,
                timeSeconds: 30,
            }],
        });
        expect(exposure.workSets).toBe(1);
        expect(exposure.totalReps).toBe(6);
        expect(exposure.tonnageKg).toBe(103);
    });

    it('omits invalid measurements in both parent sets and continuations', () => {
        const current = workout({
            id: 'invalid-shared-measures',
            date: '2026-09-08',
            sets: [{
                id: 'parent',
                kg: '',
                reps: '1.5',
                time: 'invalid',
                segments: [{
                    id: 'continuation',
                    kg: '',
                    reps: '-1',
                    time: 'invalid',
                }],
            }],
        });
        const exposure = normalizeExerciseExposure(current, current.exercises[0], bench);
        const [parent] = exposure.sets;
        const [continuation] = parent.segments;

        for (const metric of ['kg', 'effectiveKg', 'reps', 'timeSeconds'] as const) {
            expect(parent).not.toHaveProperty(metric);
            expect(continuation).not.toHaveProperty(metric);
        }
        expect(exposure.workSets).toBe(0);
        expect(exposure.referenceSet).toBeUndefined();
    });


    it('does not publish infinite tonnage from individually finite measured weights', () => {
        const current = workout({
            id: 'overflow-tonnage',
            date: '2026-09-08',
            sets: [set('1e308', '3', 2)],
        });
        const exposure = normalizeExerciseExposure(current, current.exercises[0], bench);

        expect(exposure.referenceSet?.effectiveKg).toBe(1e308);
        expect(exposure.totalReps).toBe(3);
        expect(exposure.tonnageComplete).toBe(false);
        expect(exposure).not.toHaveProperty('tonnageKg');
    });

    it('does not create a performance load when bodyweight plus equipment overflows', () => {
        const current = workout({
            id: 'overflow-bodyweight',
            date: '2026-09-08',
            exId: 'pullup',
            sets: [set('1e308', '3', 2)],
        });
        const exposure = normalizeExerciseExposure(current, current.exercises[0], pullup, {
            explicitBodyweightKg: 1e308,
        });

        expect(exposure.referenceSet?.kg).toBe(1e308);
        expect(exposure.referenceSet?.effectiveKg).toBeUndefined();
        expect(exposure.tonnageComplete).toBe(false);
        expect(exposure).not.toHaveProperty('tonnageKg');
        expect(computeProgressionEngine(current, [], library, {
            explicitBodyweightKg: 1e308,
        }).exercises[0].isRecord).toBe(false);
    });

    it('does not interpret empty colon components as zero-duration measurements', () => {
        for (const time of [':', '1:', ':30', '1::20', '::', '0:', '0x10:30', '1e2:30', '1:+30']) {
            const current = workout({
                id: 'invalid-time-component',
                date: '2026-09-08',
                exId: 'plank',
                sets: [timedSet(time)],
            });
            const exposure = normalizeExerciseExposure(current, current.exercises[0], plank);
            expect(exposure.sets[0].timeSeconds).toBeUndefined();
            expect(exposure.workSets).toBe(0);
            expect(exposure.referenceSet).toBeUndefined();
        }

        const valid = workout({
            id: 'valid-time-components', date: '2026-09-08', exId: 'plank',
            sets: [timedSet('1:30')],
        });
        const exposure = normalizeExerciseExposure(valid, valid.exercises[0], plank);
        expect(exposure.sets[0].timeSeconds).toBe(90);
        expect(exposure.workSets).toBe(1);
    });

    it('rejects colon durations whose intermediate finite values overflow to infinity', () => {
        const current = workout({
            id: 'overflow-duration',
            date: '2026-09-08',
            exId: 'plank',
            sets: [timedSet('1e308:30')],
        });
        const exposure = normalizeExerciseExposure(current, current.exercises[0], plank);
        expect(exposure.sets[0].timeSeconds).toBeUndefined();
        expect(exposure.workSets).toBe(0);
        expect(exposure.referenceSet).toBeUndefined();
    });
});
