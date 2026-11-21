import { describe, expect, it } from 'vitest';
import { addDays, differenceInCalendarDays, format, parseISO, startOfDay } from 'date-fns';
import { calculateCycleSchedule, calculateCycleTimeline } from '../../../src/lib/calc/planning';
import type { TrainingCycle } from '../../../src/types';
import { sampleRoutines } from './cycleChallengerFixtures';

function computeEndDateDirect(startIso: string, weeks: number): string {
    const parsed = typeof startIso === 'string' && !startIso.includes('T') ? parseISO(startIso) : new Date(startIso);
    const totalWeeks = Math.max(1, weeks);
    const end = addDays(startOfDay(parsed), totalWeeks * 7 - 1);
    return format(end, 'yyyy-MM-dd');
}

function computeWeeksFromDatesDirect(startIso: string, endIso: string): number {
    const start = typeof startIso === 'string' && !startIso.includes('T') ? parseISO(startIso) : new Date(startIso);
    const end = typeof endIso === 'string' && !endIso.includes('T') ? parseISO(endIso) : new Date(endIso);
    const diffDays = differenceInCalendarDays(startOfDay(end), startOfDay(start));
    if (diffDays < 0) return 1;
    return Math.max(1, Math.round((diffDays + 1) / 7));
}

function assertCycleEndDate(startIso: string, weeks: number): string {
    const expected = computeEndDateDirect(startIso, weeks);
    const actual = calculateCycleTimeline({
        id: 'oracle-cycle', name: 'Calendar oracle', startDate: startIso,
        durationWeeks: weeks, routines: []
    }, startIso).endDate;
    expect(actual).toBe(expected);
    return actual!;
}

describe('Empirical Challenger: Cycle timeline and calendar boundaries', () => {
    it('does not invent a start date for a malformed persisted cycle', () => {
        const cycle: TrainingCycle = {
            id: 'malformed-start',
            name: 'Historical invalid start',
            durationWeeks: 4,
            startDate: 'invalid-date-string',
            routines: [],
        };
        const timeline = calculateCycleTimeline(cycle);
        expect(timeline.totalWeeks).toBe(0);
        expect(timeline.isStarted).toBe(false);
        expect(timeline.statusLabel).toBe('Parametri del ciclo da correggere');
        expect(cycle.startDate).toBe('invalid-date-string');
    });

    describe('1. Boundary & Pathological Weeks Handling', () => {
        it('rejects invalid week counts in production instead of silently clamping them', () => {
            const start = '2026-09-01';
            for (const weeks of [0, -1, -52]) {
                expect(calculateCycleTimeline({
                    id: 'invalid-cycle', name: 'Invalid cycle', startDate: start,
                    durationWeeks: weeks, routines: []
                }, start).endDate).toBeUndefined();
            }
            expect(assertCycleEndDate(start, 1)).toBe('2026-09-07');
        });

        it('supports 100-week historical timelines and rejects unsupported 520-week durations', () => {
            const start = '2026-01-01';
            // 100 weeks = 700 days -> start + 699 days = 2027-12-01
            const end100 = assertCycleEndDate(start, 100);
            expect(end100).toBe('2027-12-01');
            expect(computeWeeksFromDatesDirect(start, end100)).toBe(100);

            // 520 weeks = 3640 days -> start + 3639 days
            const unsupported = calculateCycleTimeline({
                id: 'unsupported', name: 'Unsupported', startDate: start,
                durationWeeks: 520, routines: []
            }, start);
            expect(unsupported.totalWeeks).toBe(0);
            expect(unsupported.endDate).toBeUndefined();
        });

        it('refuses unsafe historical cycle durations without silently replacing the persisted value', () => {
            for (const durationWeeks of [0, -10]) {
                const cycle: TrainingCycle = {
                    id: 'c_invalid',
                    name: 'Ciclo storico',
                    durationWeeks,
                    startDate: '2026-09-01',
                    routines: []
                };
                const timeline = calculateCycleTimeline(cycle, '2026-09-01');
                expect(timeline.totalWeeks).toBe(0);
                expect(timeline.endDate).toBeUndefined();
                expect(timeline.formattedRange).toBe('Parametri del ciclo non validi');
                expect(timeline.statusLabel).toBe('Parametri del ciclo da correggere');
                expect(cycle.durationWeeks).toBe(durationWeeks);
            }
        });

        it('calculateCycleSchedule supports 100 weeks generating exactly 100 weekly items without memory blowup', () => {
            const cycle100: TrainingCycle = {
                id: 'c_100',
                name: 'Ciclo Centenario',
                durationWeeks: 100,
                sessionsPerWeek: 3,
                startDate: '2026-01-01',
                routines: sampleRoutines.map(r => ({ routineId: r.id, frequencyPerWeek: 1 }))
            };

            const schedule = calculateCycleSchedule(cycle100, sampleRoutines);
            expect(schedule.weeks).toHaveLength(100);
            expect(schedule.totalSessions).toBe(300);
            expect(schedule.weeks[0].startDateStr).toBe('2026-01-01');
            expect(schedule.weeks[99].endDateStr).toBe('2027-12-01');
            expect(schedule.fullRotationsCount).toBe(100);
            expect(schedule.remainderSessions).toBe(0);
        });
    });

    describe('Inverted dates and fallback', () => {
        it('inverted date oracle agrees with the production timeline fallback', () => {
            for (const [startDate, endDate] of [
                ['2026-09-10', '2026-09-01'],
                ['2026-12-31', '2026-01-01'],
                ['2030-01-01', '2020-01-01']
            ]) {
                expect(computeWeeksFromDatesDirect(startDate, endDate)).toBe(1);
                const timeline = calculateCycleTimeline({
                    id: 'inverted', name: 'Inverted', durationWeeks: 1,
                    startDate, endDate, routines: []
                }, startDate);
                expect(timeline.endDate).toBe(computeEndDateDirect(startDate, 1));
                expect(timeline.totalWeeks).toBe(1);
            }
        });

        it('calculateCycleTimeline disregards invalid endDate when endDate < startDate and falls back to durationWeeks', () => {
            const invertedCycle: TrainingCycle = {
                id: 'c_inv',
                name: 'Ciclo Invertito',
                durationWeeks: 4,
                startDate: '2026-09-10',
                endDate: '2026-09-01', // Before start date!
                routines: []
            };

            const timeline = calculateCycleTimeline(invertedCycle, '2026-09-10');
            expect(timeline.startDate).toBe('2026-09-10');
            // Correct fallback: 4 weeks from 2026-09-10 -> 2026-10-07
            expect(timeline.endDate).toBe('2026-10-07');
            expect(timeline.formattedRange).toBe('dal 10/09/2026 al 07/10/2026');
        });

    });

    describe('3. Leap Year Spans & Transitions', () => {
        it('correctly accounts for Feb 29 in leap year 2024 vs 28 days in 2025', () => {
            // Leap year 2024: Feb 15 + 4 weeks (28 days) -> Feb 15 + 27 days = March 13
            // Feb 2024 has 29 days (15,16,17,18,19,20,21,22,23,24,25,26,27,28,29 = 15 days in Feb -> +13 days in Mar = Mar 13)
            const leapEnd = assertCycleEndDate('2024-02-15', 4);
            expect(leapEnd).toBe('2024-03-13');

            // Non-leap year 2025: Feb 15 + 4 weeks (28 days) -> Feb 15 + 27 days = March 14
            // Feb 2025 has 28 days (15..28 = 14 days in Feb -> +14 days in Mar = Mar 14)
            const nonLeapEnd = assertCycleEndDate('2025-02-15', 4);
            expect(nonLeapEnd).toBe('2025-03-14');

            expect(computeWeeksFromDatesDirect('2024-02-15', leapEnd)).toBe(4);
            expect(computeWeeksFromDatesDirect('2025-02-15', nonLeapEnd)).toBe(4);
        });

        it('handles start on leap day (2024-02-29) seamlessly', () => {
            const startLeapDay = '2024-02-29';
            // 1 week: Feb 29 + 6 days = March 6
            const end1w = assertCycleEndDate(startLeapDay, 1);
            expect(end1w).toBe('2024-03-06');
            expect(computeWeeksFromDatesDirect(startLeapDay, end1w)).toBe(1);

            // 8 weeks: Feb 29 + 55 days = April 24
            const end8w = assertCycleEndDate(startLeapDay, 8);
            expect(end8w).toBe('2024-04-24');
            expect(computeWeeksFromDatesDirect(startLeapDay, end8w)).toBe(8);
        });

        it('crosses into leap year 2028 from late 2027 accurately', () => {
            const startCross = '2027-12-01'; // 16 weeks span
            const endCross = assertCycleEndDate(startCross, 16);
            // 16 weeks = 112 days -> start + 111 days = 2028-03-21 (includes Feb 29, 2028)
            expect(endCross).toBe('2028-03-21');
            expect(computeWeeksFromDatesDirect(startCross, endCross)).toBe(16);
        });
    });

    describe('4. Year Rollovers & DST Transitions', () => {
        it('calculates accurate end dates across Dec 31 -> Jan 01 boundary', () => {
            const startDec = '2026-12-25';
            // 4 weeks (28 days) -> Dec 25 + 27 days = Jan 21, 2027
            const endDec = assertCycleEndDate(startDec, 4);
            expect(endDec).toBe('2027-01-21');
            expect(computeWeeksFromDatesDirect(startDec, endDec)).toBe(4);

            const startSilvester = '2026-12-31';
            // 1 week -> Dec 31 + 6 days = Jan 06, 2027
            const endSilvester = assertCycleEndDate(startSilvester, 1);
            expect(endSilvester).toBe('2027-01-06');
            expect(computeWeeksFromDatesDirect(startSilvester, endSilvester)).toBe(1);
        });

        it('survives European Daylight Savings Time (DST) Spring & Fall transitions without 23h/25h hour drift', () => {
            // UTC-based CI runners would otherwise never cross CET/CEST.
            // Isolate the calendar oracle to Rome and restore the runner zone.
            const previousZone = process.env.TZ;
            try {
                process.env.TZ = 'Europe/Rome';
                expect(new Date(2026, 2, 28, 12).getTimezoneOffset()).toBe(-60);
                expect(new Date(2026, 2, 30, 12).getTimezoneOffset()).toBe(-120);
                expect(new Date(2026, 9, 24, 12).getTimezoneOffset()).toBe(-120);
                expect(new Date(2026, 9, 26, 12).getTimezoneOffset()).toBe(-60);

                const startSpring = '2026-03-15';
                const endSpring = assertCycleEndDate(startSpring, 4);
                expect(endSpring).toBe('2026-04-11');
                expect(computeWeeksFromDatesDirect(startSpring, endSpring)).toBe(4);

                const startFall = '2026-10-15';
                const endFall = assertCycleEndDate(startFall, 4);
                expect(endFall).toBe('2026-11-11');
                expect(computeWeeksFromDatesDirect(startFall, endFall)).toBe(4);
            } finally {
                if (previousZone === undefined) delete process.env.TZ;
                else process.env.TZ = previousZone;
            }
        });
    });
});
