import { describe, expect, it } from 'vitest';
import { parseISO, differenceInCalendarDays } from 'date-fns';
import { computeEndDate, computeWeeksFromDates } from '../../../src/components/Training/planning/useCycleForm';
import { calculateCycleTimeline } from '../../../src/lib/calc/planning';

describe('Cycle date calendar and DST invariants', () => {
    describe('1. Adversarial Date Math & Calendar Boundary Conditions', () => {
        it('1.1 Round-trip invariance: for all weeks 1..52, computeWeeksFromDates(start, computeEndDate(start, W)) === W', () => {
            const sampleStartDates = [
                '2024-01-01', // Normal year start
                '2024-02-29', // Leap day
                '2024-12-31', // Year end
                '2026-09-01', // September boundary
                '2026-12-28', // Late December
                '2028-02-14', // February in leap year
                '2030-07-04', // Mid-year future date
                '2025-06-15', // Mid year
                '2026-03-28', // Day before EU DST spring forward (March 29)
                '2026-10-24', // Day before EU DST fall back (October 25)
                '2028-02-29', // Next leap day
                '2030-12-31'  // Future date
            ];

            for (const start of sampleStartDates) {
                for (let w = 1; w <= 52; w++) {
                    const end = computeEndDate(start, w);
                    const calculatedWeeks = computeWeeksFromDates(start, end);
                    const production = calculateCycleTimeline({ id: 'date-contract', name: 'Date contract', startDate: start, durationWeeks: w, routines: [] }, start);
                    expect(production.endDate, `start=${start} weeks=${w}`).toBe(end);
                    expect(production.totalWeeks).toBe(w);
                    expect(calculatedWeeks).toBe(w);

                    // Verify exact inclusive calendar day count
                    const startD = parseISO(start);
                    const endD = parseISO(end);
                    const diffDays = differenceInCalendarDays(endD, startD);
                    expect(diffDays + 1).toBe(w * 7);
                }
            }
        });

        it('1.2 Leap Year Stress: verifies transitions across Feb 29 for 2024 and 2028', () => {
            // 2024 leap year: Feb 2024 has 29 days
            // Start 2024-02-15 for 4 weeks (28 days) -> Feb 15 to Feb 29 is 14 days diff (15 days). Remaining = 13 days in March -> 2024-03-13
            expect(calculateCycleTimeline({ id: 'leap', name: 'Leap', startDate: '2024-02-15', durationWeeks: 4, routines: [] }, '2024-02-15').endDate).toBe('2024-03-13');
            expect(computeWeeksFromDates('2024-02-15', '2024-03-13')).toBe(4);

            // Non-leap year 2025 comparison: Feb 2025 has 28 days
            // Start 2025-02-15 for 4 weeks -> 2025-03-14
            expect(calculateCycleTimeline({ id: 'normal', name: 'Normal', startDate: '2025-02-15', durationWeeks: 4, routines: [] }, '2025-02-15').endDate).toBe('2025-03-14');
            expect(computeWeeksFromDates('2025-02-15', '2025-03-14')).toBe(4);

            // Start on leap day itself: 2024-02-29 for 1 week (7 days) -> 2024-03-06
            expect(calculateCycleTimeline({ id: 'leap-day', name: 'Leap day', startDate: '2024-02-29', durationWeeks: 1, routines: [] }, '2024-02-29').endDate).toBe('2024-03-06');
            expect(computeWeeksFromDates('2024-02-29', '2024-03-06')).toBe(1);

            // Start on leap day 2028-02-29 for 8 weeks (56 days) -> 2028-04-24
            expect(calculateCycleTimeline({ id: 'leap-2028', name: 'Leap 2028', startDate: '2028-02-29', durationWeeks: 8, routines: [] }, '2028-02-29').endDate).toBe('2028-04-24');
            expect(computeWeeksFromDates('2028-02-29', '2028-04-24')).toBe(8);
        });

        it('1.3 DST Boundaries (Daylight Saving Time transitions): no 23-hour or 25-hour day drift', () => {
            // 2026 Spring Forward: Sunday March 29, 2026
            const startSpring = '2026-03-25'; // Wednesday before DST
            const endSpring = computeEndDate(startSpring, 2); // 14 days: 2026-03-25 to 2026-04-07
            expect(endSpring).toBe('2026-04-07');
            expect(calculateCycleTimeline({ id: 'spring', name: 'Spring', startDate: startSpring, durationWeeks: 2, routines: [] }, startSpring).endDate).toBe(endSpring);
            expect(computeWeeksFromDates(startSpring, endSpring)).toBe(2);

            // 2026 Fall Back: Sunday October 25, 2026
            const startFall = '2026-10-20'; // Tuesday before DST
            const endFall = computeEndDate(startFall, 3); // 21 days: 2026-10-20 to 2026-11-09
            expect(endFall).toBe('2026-11-09');
            expect(calculateCycleTimeline({ id: 'fall', name: 'Fall', startDate: startFall, durationWeeks: 3, routines: [] }, startFall).endDate).toBe(endFall);
            expect(computeWeeksFromDates(startFall, endFall)).toBe(3);
        });

        it('1.4 Multi-year and extreme duration spans (52 weeks, 104 weeks)', () => {
            // 52 weeks from 2026-01-01 -> 364 days -> 2026-12-30
            expect(calculateCycleTimeline({ id: 'year', name: 'Year', startDate: '2026-01-01', durationWeeks: 52, routines: [] }, '2026-01-01').endDate).toBe('2026-12-30');
            expect(computeWeeksFromDates('2026-01-01', '2026-12-30')).toBe(52);

            // 104 weeks (2 full years) from 2026-01-01 -> 728 days -> 2027-12-29
            expect(calculateCycleTimeline({ id: 'two-years', name: 'Two years', startDate: '2026-01-01', durationWeeks: 104, routines: [] }, '2026-01-01').endDate).toBe('2027-12-29');
            expect(computeWeeksFromDates('2026-01-01', '2027-12-29')).toBe(104);
        });

        it('1.5 Out-of-order dates, 0 duration, negative numbers, and invalid strings', () => {
            // Out of order: endDate < startDate
            expect(computeWeeksFromDates('2026-09-15', '2026-09-01')).toBe(1);
            expect(calculateCycleTimeline({ id: 'inverted', name: 'Inverted', startDate: '2026-09-15', endDate: '2026-09-01', durationWeeks: 2, routines: [] }, '2026-09-15').endDate).toBe('2026-09-28');
            expect(computeWeeksFromDates('2026-12-31', '2026-01-01')).toBe(1);

            // Nonpositive and non-finite durations are rejected as invalid cycles.
            expect(calculateCycleTimeline({ id: 'zero', name: 'Zero', startDate: '2026-09-01', durationWeeks: 0, routines: [] }, '2026-09-01').totalWeeks).toBe(0);
            expect(calculateCycleTimeline({ id: 'negative', name: 'Negative', startDate: '2026-09-01', durationWeeks: -5, routines: [] }, '2026-09-01').totalWeeks).toBe(0);
            // When weeks is NaN, computeEndDate catches the error and safely falls back to startIso
            expect(calculateCycleTimeline({ id: 'nan', name: 'NaN', startDate: '2026-09-01', durationWeeks: NaN, routines: [] }, '2026-09-01').totalWeeks).toBe(0);

            // Invalid date strings
            expect(calculateCycleTimeline({ id: 'invalid', name: 'Invalid', startDate: 'invalid-date', durationWeeks: 4, routines: [] }).totalWeeks).toBe(0);
            expect(computeWeeksFromDates('invalid-date', '2026-09-10')).toBe(1);
            expect(computeWeeksFromDates('2026-09-01', 'bad-date')).toBe(1);
            expect(computeWeeksFromDates('', '')).toBe(1);
        });
    });

    // =========================================================================
    // 2. TIMELINE & SCHEDULE PLANNING CALCULATION STRESS
    // =========================================================================
});
