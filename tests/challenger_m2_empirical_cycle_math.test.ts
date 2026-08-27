import { describe, it, expect } from 'vitest';
import { parseISO, format, addDays, startOfDay, differenceInCalendarDays } from 'date-fns';
import { calculateCycleTimeline } from '../src/lib/calc/planning';
import { TrainingCycleSchema, DomainParsers } from '../src/lib/schema';
import type { TrainingCycle } from '../src/types';

// Helper mirror functions representing the two-way binding logic contracts
function computeEndDate(startIso: string, weeks: number): string {
    try {
        const parsed = typeof startIso === 'string' && !startIso.includes('T') ? parseISO(startIso) : new Date(startIso);
        const totalWeeks = Math.max(1, weeks);
        const end = addDays(startOfDay(parsed), totalWeeks * 7 - 1);
        return format(end, 'yyyy-MM-dd');
    } catch {
        return startIso;
    }
}

function computeWeeksFromDates(startIso: string, endIso: string): number {
    try {
        const start = typeof startIso === 'string' && !startIso.includes('T') ? parseISO(startIso) : new Date(startIso);
        const end = typeof endIso === 'string' && !endIso.includes('T') ? parseISO(endIso) : new Date(endIso);
        const diffDays = differenceInCalendarDays(startOfDay(end), startOfDay(start));
        if (diffDays < 0) return 1;
        return Math.max(1, Math.round((diffDays + 1) / 7));
    } catch {
        return 1;
    }
}

describe('Challenger 1 Empirical Verification: Cycle Planning Mathematics & Edge Cases (Milestone 2 - Requirement R5)', () => {
    // -------------------------------------------------------------------------
    // 1. Exact Day Calculations
    // -------------------------------------------------------------------------
    describe('1. Exact Day Calculations', () => {
        it('calculates exact 28 inclusive days (27 days later) for Start 2026-08-20, 4 weeks -> End 2026-09-16', () => {
            const startDate = '2026-08-20';
            const weeks = 4;

            // 4 weeks * 7 days/week = 28 days total (inclusive).
            // Start: 2026-08-20
            // August has 31 days -> days 20,21,22,23,24,25,26,27,28,29,30,31 = 12 days in Aug.
            // Remaining days in Sept = 28 - 12 = 16 -> 2026-09-16.
            const calculatedEnd = computeEndDate(startDate, weeks);
            expect(calculatedEnd).toBe('2026-09-16');

            // Verify inclusive day count
            const startParsed = parseISO(startDate);
            const endParsed = parseISO(calculatedEnd);
            const diffDays = differenceInCalendarDays(endParsed, startParsed);
            expect(diffDays).toBe(27);
            expect(diffDays + 1).toBe(28); // 28 total inclusive days
        });

        it('calculateCycleTimeline generates correct timeline fields for 2026-08-20, 4 weeks', () => {
            const cycle: TrainingCycle = {
                id: 'cycle_exact_day',
                name: 'Ciclo 4 Settimane',
                durationWeeks: 4,
                startDate: '2026-08-20',
                routines: []
            };

            const timeline = calculateCycleTimeline(cycle, '2026-08-20');
            expect(timeline.startDate).toBe('2026-08-20');
            expect(timeline.endDate).toBe('2026-09-16');
            expect(timeline.formattedStartDate).toBe('20/08/2026');
            expect(timeline.formattedEndDate).toBe('16/09/2026');
            expect(timeline.formattedRange).toBe('dal 20/08/2026 al 16/09/2026');
            expect(timeline.totalWeeks).toBe(4);
            expect(timeline.currentWeek).toBe(1);
            expect(timeline.isStarted).toBe(true);
            expect(timeline.isEnded).toBe(false);
            expect(timeline.daysRemaining).toBe(27); // 28 - 1
            expect(timeline.progressPercent).toBe(4); // round(1 / 28 * 100) = 4%
        });

        it('calculateCycleTimeline computes correct status on mid-cycle date (2026-09-01)', () => {
            const cycle: TrainingCycle = {
                id: 'cycle_mid',
                name: 'Ciclo In Corso',
                durationWeeks: 4,
                startDate: '2026-08-20',
                endDate: '2026-09-16',
                routines: []
            };

            // 2026-09-01 is day 13 (diffDays = 12, so week 2: floor(12/7) + 1 = 2)
            const timeline = calculateCycleTimeline(cycle, '2026-09-01');
            expect(timeline.currentWeek).toBe(2);
            expect(timeline.statusLabel).toBe('Settimana 2 di 4');
            expect(timeline.isStarted).toBe(true);
            expect(timeline.isEnded).toBe(false);
            expect(timeline.daysRemaining).toBe(15); // 28 - 13 = 15
            expect(timeline.progressPercent).toBe(46); // round(13 / 28 * 100) = 46%
        });

        it('calculateCycleTimeline computes completed status on end date (2026-09-16) vs day after (2026-09-17)', () => {
            const cycle: TrainingCycle = {
                id: 'cycle_end_day',
                name: 'Ciclo Fine',
                durationWeeks: 4,
                startDate: '2026-08-20',
                endDate: '2026-09-16',
                routines: []
            };

            // On the final day (2026-09-16, diffDays = 27)
            const timelineFinalDay = calculateCycleTimeline(cycle, '2026-09-16');
            expect(timelineFinalDay.currentWeek).toBe(4);
            expect(timelineFinalDay.isEnded).toBe(false);
            expect(timelineFinalDay.daysRemaining).toBe(0);
            expect(timelineFinalDay.progressPercent).toBe(100);

            // One day after cycle ends (2026-09-17, diffDays = 28 >= 28)
            const timelineAfter = calculateCycleTimeline(cycle, '2026-09-17');
            expect(timelineAfter.isEnded).toBe(true);
            expect(timelineAfter.statusLabel).toBe('Ciclo completato');
            expect(timelineAfter.progressPercent).toBe(100);
            expect(timelineAfter.daysRemaining).toBe(0);
        });
    });

    // -------------------------------------------------------------------------
    // 2. End Date Alteration & Two-Way Binding Recalculation
    // -------------------------------------------------------------------------
    describe('2. End Date Alteration & Recalculation of Duration Weeks', () => {
        it('recalculates duration in weeks correctly when altering end date to 2026-09-30 (Start 2026-08-20)', () => {
            const startDate = '2026-08-20';
            const alteredEndDate = '2026-09-30';

            // From Aug 20 to Sept 30:
            // Aug 20 to Aug 31 = 11 days difference.
            // + 30 days in Sept = 41 days difference (42 inclusive days).
            // 42 / 7 = exactly 6.0 weeks.
            const weeks = computeWeeksFromDates(startDate, alteredEndDate);
            expect(weeks).toBe(6);

            // Re-feeding 6 weeks into computeEndDate produces 2026-09-30
            expect(computeEndDate(startDate, weeks)).toBe('2026-09-30');
        });

        it('recalculates duration weeks accurately across various end date alterations', () => {
            const startDate = '2026-08-20';

            // 1 week ahead: 2026-08-26 (diff = 6, total = 7 days) -> 1 week
            expect(computeWeeksFromDates(startDate, '2026-08-26')).toBe(1);

            // 2 weeks ahead: 2026-09-02 (diff = 13, total = 14 days) -> 2 weeks
            expect(computeWeeksFromDates(startDate, '2026-09-02')).toBe(2);

            // 3 weeks ahead: 2026-09-09 (diff = 20, total = 21 days) -> 3 weeks
            expect(computeWeeksFromDates(startDate, '2026-09-09')).toBe(3);

            // 4 weeks ahead: 2026-09-16 (diff = 27, total = 28 days) -> 4 weeks
            expect(computeWeeksFromDates(startDate, '2026-09-16')).toBe(4);

            // 8 weeks ahead: 2026-10-14 (diff = 55, total = 56 days) -> 8 weeks
            expect(computeWeeksFromDates(startDate, '2026-10-14')).toBe(8);

            // 12 weeks ahead: 2026-11-11 (diff = 83, total = 84 days) -> 12 weeks
            expect(computeWeeksFromDates(startDate, '2026-11-11')).toBe(12);
        });

        it('handles non-exact multi-day offsets via rounding to nearest week', () => {
            const startDate = '2026-08-20';

            // 2026-09-28 (diff = 39, total = 40 days) -> 40/7 = 5.71 -> round = 6 weeks
            expect(computeWeeksFromDates(startDate, '2026-09-28')).toBe(6);

            // 2026-09-26 (diff = 37, total = 38 days) -> 38/7 = 5.42 -> round = 5 weeks
            expect(computeWeeksFromDates(startDate, '2026-09-26')).toBe(5);

            // 2026-08-23 (diff = 3, total = 4 days) -> 4/7 = 0.57 -> round = 1 week
            expect(computeWeeksFromDates(startDate, '2026-08-23')).toBe(1);

            // Same day: 2026-08-20 (diff = 0, total = 1 day) -> 1/7 = 0.14 -> max(1, round(0.14)) = 1 week
            expect(computeWeeksFromDates(startDate, '2026-08-20')).toBe(1);
        });
    });

    // -------------------------------------------------------------------------
    // 3. Leap Year Boundaries & Year Transitions
    // -------------------------------------------------------------------------
    describe('3. Leap Year Boundaries & Year Transitions', () => {
        it('calculates correct end dates across leap year 2024 boundary (Feb has 29 days)', () => {
            // Start 2024-02-01, 4 weeks (28 days) -> 2024-02-28 (since Feb has 29 days)
            expect(computeEndDate('2024-02-01', 4)).toBe('2024-02-28');
            expect(computeWeeksFromDates('2024-02-01', '2024-02-28')).toBe(4);

            // Start 2024-02-28, 4 weeks (28 days) -> 2024-02-28 + 27 days
            // Feb 28, 29 (2 days) + 26 days in Mar = 2024-03-26
            expect(computeEndDate('2024-02-28', 4)).toBe('2024-03-26');
            expect(computeWeeksFromDates('2024-02-28', '2024-03-26')).toBe(4);

            // Start on leap day itself: 2024-02-29, 4 weeks -> 2024-03-27
            expect(computeEndDate('2024-02-29', 4)).toBe('2024-03-27');
            expect(computeWeeksFromDates('2024-02-29', '2024-03-27')).toBe(4);
        });

        it('calculates correct end dates across leap year 2028 boundary', () => {
            // Start 2028-02-01, 4 weeks (28 days) -> 2028-02-28
            expect(computeEndDate('2028-02-01', 4)).toBe('2028-02-28');
            expect(computeWeeksFromDates('2028-02-01', '2028-02-28')).toBe(4);

            // Start 2028-02-15, 4 weeks (28 days) -> Feb 15 + 27 days
            // Feb 15 to Feb 29 = 14 days diff. 27 - 14 = 13 days in March -> 2028-03-13
            expect(computeEndDate('2028-02-15', 4)).toBe('2028-03-13');
            expect(computeWeeksFromDates('2028-02-15', '2028-03-13')).toBe(4);

            // Non-leap comparison: 2027-02-15, 4 weeks -> 2027-03-14
            expect(computeEndDate('2027-02-15', 4)).toBe('2027-03-14');
            expect(computeWeeksFromDates('2027-02-15', '2027-03-14')).toBe(4);
        });

        it('calculates accurate end dates across year transitions (Dec 2026 -> Jan 2027)', () => {
            // Start 2026-12-01, 6 weeks (42 days) -> Dec 1 + 41 days = 2027-01-11
            expect(computeEndDate('2026-12-01', 6)).toBe('2027-01-11');
            expect(computeWeeksFromDates('2026-12-01', '2027-01-11')).toBe(6);

            // Start 2026-12-25, 4 weeks (28 days) -> Dec 25 + 27 days = 2027-01-21
            expect(computeEndDate('2026-12-25', 4)).toBe('2027-01-21');
            expect(computeWeeksFromDates('2026-12-25', '2027-01-21')).toBe(4);

            // Start 2026-12-31, 1 week (7 days) -> Dec 31 + 6 days = 2027-01-06
            expect(computeEndDate('2026-12-31', 1)).toBe('2027-01-06');
            expect(computeWeeksFromDates('2026-12-31', '2027-01-06')).toBe(1);

            // Start 2026-12-31, 8 weeks (56 days) -> Dec 31 + 55 days = 2027-02-24
            expect(computeEndDate('2026-12-31', 8)).toBe('2027-02-24');
            expect(computeWeeksFromDates('2026-12-31', '2027-02-24')).toBe(8);
        });
    });

    // -------------------------------------------------------------------------
    // 4. Boundary & Edge Cases (1 week, 52 weeks, invalid, empty)
    // -------------------------------------------------------------------------
    describe('4. Edge Cases: 1 Week, 52 Weeks, Invalid & Empty Dates', () => {
        it('handles 1 week cycle (minimum valid duration)', () => {
            const start = '2026-08-20';
            const end = computeEndDate(start, 1);
            // 1 week = 7 days -> start + 6 days = 2026-08-26
            expect(end).toBe('2026-08-26');
            expect(computeWeeksFromDates(start, end)).toBe(1);

            const cycle: TrainingCycle = {
                id: 'c_1w',
                name: 'Ciclo Mini 1 Settimana',
                durationWeeks: 1,
                startDate: start,
                endDate: end,
                routines: []
            };

            const timeline = calculateCycleTimeline(cycle, '2026-08-20');
            expect(timeline.totalWeeks).toBe(1);
            expect(timeline.currentWeek).toBe(1);
            expect(timeline.formattedRange).toBe('dal 20/08/2026 al 26/08/2026');
            expect(timeline.isStarted).toBe(true);
            expect(timeline.isEnded).toBe(false);
            expect(timeline.daysRemaining).toBe(6);
        });

        it('handles 52 week cycle (full year cycle)', () => {
            const start = '2026-01-01';
            const end = computeEndDate(start, 52);
            // 52 weeks = 364 days -> Jan 1 + 363 days = 2026-12-30
            expect(end).toBe('2026-12-30');
            expect(computeWeeksFromDates(start, end)).toBe(52);

            const cycle: TrainingCycle = {
                id: 'c_52w',
                name: 'Ciclo Annuale 52 Settimane',
                durationWeeks: 52,
                startDate: start,
                endDate: end,
                routines: []
            };

            const timeline = calculateCycleTimeline(cycle, '2026-01-01');
            expect(timeline.totalWeeks).toBe(52);
            expect(timeline.formattedRange).toBe('dal 01/01/2026 al 30/12/2026');
            expect(timeline.currentWeek).toBe(1);
            expect(timeline.daysRemaining).toBe(363);
        });

        it('gracefully handles missing, empty or undefined startDate in calculateCycleTimeline', () => {
            const cycleNoStart: TrainingCycle = {
                id: 'c_no_start',
                name: 'Ciclo Senza Data',
                durationWeeks: 6,
                routines: []
            };

            const timeline = calculateCycleTimeline(cycleNoStart);
            expect(timeline.formattedRange).toBe('6 settimane');
            expect(timeline.formattedStartDate).toBe('');
            expect(timeline.formattedEndDate).toBe('');
            expect(timeline.totalWeeks).toBe(6);
            expect(timeline.currentWeek).toBe(1);
            expect(timeline.isStarted).toBe(true);
            expect(timeline.isEnded).toBe(false);
        });

        it('gracefully handles invalid / malformed date strings', () => {
            const cycleInvalidDate: TrainingCycle = {
                id: 'c_invalid',
                name: 'Ciclo Data Non Valida',
                durationWeeks: 4,
                startDate: 'not-a-real-date',
                endDate: 'gibberish',
                routines: []
            };

            // Should not throw or crash
            expect(() => calculateCycleTimeline(cycleInvalidDate)).not.toThrow();
            const timeline = calculateCycleTimeline(cycleInvalidDate);
            expect(timeline.totalWeeks).toBe(4);
            expect(timeline.isStarted).toBe(true);
        });

        it('gracefully handles inverted dates (endDate < startDate)', () => {
            const cycleInverted: TrainingCycle = {
                id: 'c_inv',
                name: 'Ciclo Invertito',
                durationWeeks: 4,
                startDate: '2026-09-15',
                endDate: '2026-09-01', // End date is before start date
                routines: []
            };

            // calculateCycleTimeline falls back to computing end date from durationWeeks
            const timeline = calculateCycleTimeline(cycleInverted, '2026-09-15');
            expect(timeline.startDate).toBe('2026-09-15');
            expect(timeline.endDate).toBe('2026-10-12'); // 4 weeks from 2026-09-15
            expect(timeline.formattedRange).toBe('dal 15/09/2026 al 12/10/2026');

            // computeWeeksFromDates safely clamps to 1
            expect(computeWeeksFromDates('2026-09-15', '2026-09-01')).toBe(1);
        });

        it('schema and domain parser resilience with endDate and edge cases', () => {
            const rawCycle = {
                id: 'c_raw_1',
                name: 'Ciclo Raw Test',
                durationWeeks: 4,
                startDate: '2026-08-20',
                endDate: '2026-09-16',
                routines: []
            };

            const parsed = TrainingCycleSchema.parse(rawCycle);
            expect(parsed.id).toBe('c_raw_1');
            expect(parsed.startDate).toBe('2026-08-20');
            expect(parsed.endDate).toBe('2026-09-16');
            expect(parsed.durationWeeks).toBe(4);

            const domainParsed = DomainParsers.parseTrainingCycles([rawCycle, { id: 'c_raw_2', name: 'C2', durationWeeks: 8, routines: [] }]);
            expect(domainParsed).toHaveLength(2);
            expect(domainParsed[0].endDate).toBe('2026-09-16');
            expect(domainParsed[1].endDate).toBeUndefined();
        });
    });
});
