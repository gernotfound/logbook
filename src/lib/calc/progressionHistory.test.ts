import { describe, expect, it } from 'vitest';
import type { WorkoutSession } from '../../types';
import { orderedEarlierSessions } from './progressionHistory';

const session = (id: string, date: string, start?: number, end?: number): WorkoutSession => ({
    id, date, exercises: [],
    ...(start === undefined ? {} : { globalStartTime: start }),
    ...(end === undefined ? {} : { globalEndTime: end }),
});

describe('historical session order for the progression report', () => {
    it('preserves date ordering, input history, and same-day end-before-start fencing', () => {
        const current = session('current', '2026-09-22', 3000, 5000);
        const earlierSameDay = session('same-day', '2026-09-22', 1000, 2000);
        const overlapping = session('overlap', '2026-09-22', 2500, 4000);
        const noEnd = session('no-end', '2026-09-22');
        const older = session('older', '2026-09-20');
        const later = session('later', '2026-09-23');
        const history = [overlapping, later, earlierSameDay, current, older, noEnd];
        const snapshot = structuredClone(history);

        const earlier = orderedEarlierSessions(history, current);
        expect(earlier.map(item => item.id)).toEqual(['older', 'same-day']);
        expect(history).toEqual(snapshot);
        expect(earlier).not.toBe(history);
        expect(earlier[1]).toBe(earlierSameDay);
    });

    it('retains stable ties, timestamp fallbacks, and earlier-day sessions without a clock', () => {
        const current = session('now', '2026-09-22', 6000);
        const tie1 = session('t1', '2026-09-20', 1000);
        const tie2 = session('t2', '2026-09-20', 1000);
        const blankClock = session('blank', '2026-09-19');
        const sameDayEndFallback = session('fallback', '2026-09-22', undefined, 2000);
        const latest = session('latest', '2026-09-21', 9000);
        expect(orderedEarlierSessions(
            [tie2, latest, sameDayEndFallback, tie1, blankClock], current,
        ).map(item => item.id)).toEqual(['blank', 't2', 't1', 'latest', 'fallback']);
    });

    it('preserves the legacy rule for a same-day session with missing or invalid timestamps', () => {
        const current = session('today', '2026-09-22', 1000);
        const missing = session('missing', '2026-09-22');
        const invalid = { ...session('invalid', '2026-09-22'), globalEndTime: Number.NaN };
        expect(orderedEarlierSessions([missing, invalid], current)).toEqual([]);
    });

    it('keeps output identical to the original repeated-per-exercise ordering', () => {
        const current = session('current', '2026-09-30', 10000);
        const history = Array.from({ length: 350 }, (_, i) => (
            session('w-' + i, '2026-09-' + String(1 + (i % 29)).padStart(2, '0'), 1000 + i)
        ));
        const originalOrder = history
            .filter(item => item.id !== current.id && item.date < current.date)
            .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')
                || ((a.globalStartTime ?? 0) - (b.globalStartTime ?? 0)));
        expect(orderedEarlierSessions(history, current).map(item => item.id))
            .toEqual(originalOrder.map(item => item.id));
    });

    it('records non-gating sort cost on a deterministic large workload', () => {
        const current = session('now', '2026-10-01');
        const history = Array.from({ length: 600 }, (_, i) => (
            session('w-' + i, '2026-09-' + String(1 + i % 30).padStart(2, '0'), i * 1000)
        ));
        const exercises = 12;
        const elapsed = (fn: () => void): number => {
            const start = performance.now();
            fn();
            return Math.round((performance.now() - start) * 100) / 100;
        };
        // Diagnostic only: wall-clock timings vary on shared CI runners.
        const repeatedMs = elapsed(() => {
            for (let i = 0; i < exercises; i++) orderedEarlierSessions(history, current);
        });
        const sharedMs = elapsed(() => { orderedEarlierSessions(history, current); });
        console.info('progression-history-sort-diagnostic', JSON.stringify({
            historyLength: history.length, exerciseCount: exercises,
            legacyRepeatedMs: repeatedMs, sharedOnceMs: sharedMs,
        }));
    });
});
