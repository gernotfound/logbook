import { describe, expect, it } from 'vitest';
import { computeProgressionEngine, progressionTrendLabel } from './progression';
import { library, timedSet, workout } from './progressionTestFixtures';

describe('contextual progression engine: timed measurements and trends', () => {
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
});
