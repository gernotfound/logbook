import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { parseISO, format, addDays, startOfDay, differenceInCalendarDays, isValid } from 'date-fns';
import {
    calculateCycleTimeline,
    calculateCycleSchedule
} from '../src/lib/calc/planning';
import { CycleEditor } from '../src/components/Training/planning/CycleEditor';
import { CycleCard } from '../src/components/Training/planning/CycleCard';
import type { TrainingCycle, WorkoutRoutine } from '../src/types';

// Helper mirror functions
function computeEndDate(startIso: string, weeks: number): string {
    try {
        const parsed = typeof startIso === 'string' && !startIso.includes('T') ? parseISO(startIso) : new Date(startIso);
        if (!isValid(parsed)) return startIso;
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
        if (!isValid(start) || !isValid(end)) return 1;
        const diffDays = differenceInCalendarDays(startOfDay(end), startOfDay(start));
        if (diffDays < 0) return 1;
        return Math.max(1, Math.round((diffDays + 1) / 7));
    } catch {
        return 1;
    }
}

describe('Challenger 2 Empirical Stress Test Suite: Requirement R5 Training Cycle Date Math & Two-Way Reactivity', () => {
    const mockRoutines: WorkoutRoutine[] = [
        {
            id: 'r_push',
            name: 'Push Routine A',
            exercises: [{ exId: 'ex_bench', setsCount: 4 }]
        },
        {
            id: 'r_pull',
            name: 'Pull Routine B',
            exercises: [{ exId: 'ex_lat', setsCount: 4 }]
        },
        {
            id: 'r_legs',
            name: 'Legs Routine C',
            exercises: [{ exId: 'ex_squat', setsCount: 5 }]
        }
    ];

    beforeEach(() => {
        vi.clearAllMocks();
    });

    // =========================================================================
    // 1. ADVERSARIAL DATE MATH & CALENDAR BOUNDARIES
    // =========================================================================
    describe('1. Adversarial Date Math & Calendar Boundary Conditions', () => {
        it('1.1 Round-trip invariance: for all weeks 1..52, computeWeeksFromDates(start, computeEndDate(start, W)) === W', () => {
            const sampleStartDates = [
                '2024-01-01', // Normal year start
                '2024-02-29', // Leap day
                '2024-12-31', // Year end
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
            expect(computeEndDate('2024-02-15', 4)).toBe('2024-03-13');
            expect(computeWeeksFromDates('2024-02-15', '2024-03-13')).toBe(4);

            // Non-leap year 2025 comparison: Feb 2025 has 28 days
            // Start 2025-02-15 for 4 weeks -> 2025-03-14
            expect(computeEndDate('2025-02-15', 4)).toBe('2025-03-14');
            expect(computeWeeksFromDates('2025-02-15', '2025-03-14')).toBe(4);

            // Start on leap day itself: 2024-02-29 for 1 week (7 days) -> 2024-03-06
            expect(computeEndDate('2024-02-29', 1)).toBe('2024-03-06');
            expect(computeWeeksFromDates('2024-02-29', '2024-03-06')).toBe(1);

            // Start on leap day 2028-02-29 for 8 weeks (56 days) -> 2028-04-24
            expect(computeEndDate('2028-02-29', 8)).toBe('2028-04-24');
            expect(computeWeeksFromDates('2028-02-29', '2028-04-24')).toBe(8);
        });

        it('1.3 DST Boundaries (Daylight Saving Time transitions): no 23-hour or 25-hour day drift', () => {
            // 2026 Spring Forward: Sunday March 29, 2026
            const startSpring = '2026-03-25'; // Wednesday before DST
            const endSpring = computeEndDate(startSpring, 2); // 14 days: 2026-03-25 to 2026-04-07
            expect(endSpring).toBe('2026-04-07');
            expect(computeWeeksFromDates(startSpring, endSpring)).toBe(2);

            // 2026 Fall Back: Sunday October 25, 2026
            const startFall = '2026-10-20'; // Tuesday before DST
            const endFall = computeEndDate(startFall, 3); // 21 days: 2026-10-20 to 2026-11-09
            expect(endFall).toBe('2026-11-09');
            expect(computeWeeksFromDates(startFall, endFall)).toBe(3);
        });

        it('1.4 Multi-year and extreme duration spans (52 weeks, 104 weeks)', () => {
            // 52 weeks from 2026-01-01 -> 364 days -> 2026-12-30
            expect(computeEndDate('2026-01-01', 52)).toBe('2026-12-30');
            expect(computeWeeksFromDates('2026-01-01', '2026-12-30')).toBe(52);

            // 104 weeks (2 full years) from 2026-01-01 -> 728 days -> 2027-12-29
            expect(computeEndDate('2026-01-01', 104)).toBe('2027-12-29');
            expect(computeWeeksFromDates('2026-01-01', '2027-12-29')).toBe(104);
        });

        it('1.5 Out-of-order dates, 0 duration, negative numbers, and invalid strings', () => {
            // Out of order: endDate < startDate
            expect(computeWeeksFromDates('2026-09-15', '2026-09-01')).toBe(1);
            expect(computeWeeksFromDates('2026-12-31', '2026-01-01')).toBe(1);

            // 0 duration or negative weeks: clamped to minimum 1 week
            expect(computeEndDate('2026-09-01', 0)).toBe('2026-09-07');
            expect(computeEndDate('2026-09-01', -5)).toBe('2026-09-07');
            // When weeks is NaN, computeEndDate catches the error and safely falls back to startIso
            expect(computeEndDate('2026-09-01', NaN)).toBe('2026-09-01');

            // Invalid date strings
            expect(computeEndDate('invalid-date', 4)).toBe('invalid-date');
            expect(computeWeeksFromDates('invalid-date', '2026-09-10')).toBe(1);
            expect(computeWeeksFromDates('2026-09-01', 'bad-date')).toBe(1);
            expect(computeWeeksFromDates('', '')).toBe(1);
        });
    });

    // =========================================================================
    // 2. TIMELINE & SCHEDULE PLANNING CALCULATION STRESS
    // =========================================================================
    describe('2. calculateCycleTimeline and calculateCycleSchedule Stress', () => {
        it('2.1 calculateCycleTimeline accurately computes timeline phases (not started, active, on end date, completed)', () => {
            const cycle: TrainingCycle = {
                id: 'c_test_phases',
                name: 'Ciclo 4 Settimane',
                durationWeeks: 4,
                startDate: '2026-09-01',
                endDate: '2026-09-28', // 28 days
                routines: [{ routineId: 'r_push', frequencyPerWeek: 1 }]
            };

            // Before start (2026-08-25: 7 days before)
            const beforeStart = calculateCycleTimeline(cycle, '2026-08-25');
            expect(beforeStart.isStarted).toBe(false);
            expect(beforeStart.isEnded).toBe(false);
            expect(beforeStart.currentWeek).toBe(0);
            expect(beforeStart.progressPercent).toBe(0);
            expect(beforeStart.statusLabel).toBe('Inizia tra 7 giorni');
            expect(beforeStart.daysRemaining).toBe(7);

            // Exactly 1 day before (2026-08-31)
            const oneDayBefore = calculateCycleTimeline(cycle, '2026-08-31');
            expect(oneDayBefore.statusLabel).toBe('Inizia domani');
            expect(oneDayBefore.daysRemaining).toBe(1);

            // On Start Date (2026-09-01: day 1)
            const onStart = calculateCycleTimeline(cycle, '2026-09-01');
            expect(onStart.isStarted).toBe(true);
            expect(onStart.isEnded).toBe(false);
            expect(onStart.currentWeek).toBe(1);
            expect(onStart.progressPercent).toBe(4); // round(1/28 * 100) = 4
            expect(onStart.statusLabel).toBe('Settimana 1 di 4');
            expect(onStart.daysRemaining).toBe(27);

            // Mid cycle Week 3 (2026-09-16: day 16 -> diff = 15 -> floor(15/7)+1 = 3)
            const midCycle = calculateCycleTimeline(cycle, '2026-09-16');
            expect(midCycle.currentWeek).toBe(3);
            expect(midCycle.statusLabel).toBe('Settimana 3 di 4');
            expect(midCycle.progressPercent).toBe(57); // round(16/28 * 100) = 57%
            expect(midCycle.daysRemaining).toBe(12);

            // On End Date (2026-09-28: day 28)
            const onEnd = calculateCycleTimeline(cycle, '2026-09-28');
            expect(onEnd.isStarted).toBe(true);
            expect(onEnd.isEnded).toBe(false);
            expect(onEnd.currentWeek).toBe(4);
            expect(onEnd.progressPercent).toBe(100);
            expect(onEnd.daysRemaining).toBe(0);

            // After End Date (2026-09-29: day 29)
            const afterEnd = calculateCycleTimeline(cycle, '2026-09-29');
            expect(afterEnd.isStarted).toBe(true);
            expect(afterEnd.isEnded).toBe(true);
            expect(afterEnd.statusLabel).toBe('Ciclo completato');
            expect(afterEnd.progressPercent).toBe(100);
            expect(afterEnd.daysRemaining).toBe(0);
        });

        it('2.2 calculateCycleTimeline safely discards inverted explicit endDate and recomputes valid range', () => {
            const invertedCycle: TrainingCycle = {
                id: 'c_inv_test',
                name: 'Inverted Cycle',
                durationWeeks: 4,
                startDate: '2026-09-20',
                endDate: '2026-09-01', // Out of order!
                routines: []
            };

            const timeline = calculateCycleTimeline(invertedCycle, '2026-09-20');
            expect(timeline.startDate).toBe('2026-09-20');
            // Recomputed: 2026-09-20 + 27 days = 2026-10-17
            expect(timeline.endDate).toBe('2026-10-17');
            expect(timeline.formattedStartDate).toBe('20/09/2026');
            expect(timeline.formattedEndDate).toBe('17/10/2026');
            expect(timeline.formattedRange).toBe('dal 20/09/2026 al 17/10/2026');
        });

        it('2.3 calculateCycleSchedule distributes weeks with exact weekly date ranges', () => {
            const cycle: TrainingCycle = {
                id: 'c_sched_exact',
                name: 'Ciclo Rotazione',
                durationWeeks: 3,
                startDate: '2026-09-01',
                endDate: '2026-09-21',
                sessionsPerWeek: 3,
                routines: [
                    { routineId: 'r_push', frequencyPerWeek: 1 },
                    { routineId: 'r_pull', frequencyPerWeek: 1 },
                    { routineId: 'r_legs', frequencyPerWeek: 1 }
                ]
            };

            const schedule = calculateCycleSchedule(cycle, mockRoutines);
            expect(schedule.weeks).toHaveLength(3);
            expect(schedule.totalSessions).toBe(9);
            expect(schedule.fullRotationsCount).toBe(3);
            expect(schedule.remainderSessions).toBe(0);

            // Week 1: 01/09 to 07/09
            expect(schedule.weeks[0].startDateStr).toBe('2026-09-01');
            expect(schedule.weeks[0].endDateStr).toBe('2026-09-07');
            expect(schedule.weeks[0].formattedRange).toBe('01/09 - 07/09');

            // Week 2: 08/09 to 14/09
            expect(schedule.weeks[1].startDateStr).toBe('2026-09-08');
            expect(schedule.weeks[1].endDateStr).toBe('2026-09-14');
            expect(schedule.weeks[1].formattedRange).toBe('08/09 - 14/09');

            // Week 3: 15/09 to 21/09
            expect(schedule.weeks[2].startDateStr).toBe('2026-09-15');
            expect(schedule.weeks[2].endDateStr).toBe('2026-09-21');
            expect(schedule.weeks[2].formattedRange).toBe('15/09 - 21/09');
        });
    });

    // =========================================================================
    // 3. CYCLEEDITOR TWO-WAY REACTIVE STATE TRANSITIONS
    // =========================================================================
    describe('3. CycleEditor Two-Way Reactive State Transitions', () => {
        it('3.1 Rapid duration input changes and empty string recovery', () => {
            const onSave = vi.fn();
            const onCancel = vi.fn();

            const { container } = render(
                <CycleEditor
                    initialCycle={{
                        id: 'c_rapid_1',
                        name: 'Rapid Cycle',
                        durationWeeks: 4,
                        startDate: '2026-09-01',
                        endDate: '2026-09-28',
                        routines: [{ routineId: 'r_push', frequencyPerWeek: 1 }]
                    }}
                    routines={mockRoutines}
                    onSave={onSave}
                    onCancel={onCancel}
                />
            );

            const durationInput = container.querySelector('#cycle-duration-weeks') as HTMLInputElement;
            const endDateTextInput = container.querySelector('#cycle-end-date') as HTMLInputElement;

            // Clear input -> duration is empty, endDate does not crash or corrupt
            fireEvent.change(durationInput, { target: { value: '' } });
            expect(durationInput.value).toBe('');
            expect(endDateTextInput.value).toBe('28/09/2026');

            // Rapid typing 1 -> 12 -> 6
            fireEvent.change(durationInput, { target: { value: '1' } });
            expect(endDateTextInput.value).toBe('07/09/2026');

            fireEvent.change(durationInput, { target: { value: '12' } });
            // 2026-09-01 + 83 days = 2026-11-23
            expect(endDateTextInput.value).toBe('23/11/2026');

            fireEvent.change(durationInput, { target: { value: '6' } });
            // 2026-09-01 + 41 days = 2026-10-12
            expect(endDateTextInput.value).toBe('12/10/2026');
        });

        it('3.2 Manual date text entry in Italian format (GG/MM/AAAA and G/M/AAAA)', () => {
            const onSave = vi.fn();
            const onCancel = vi.fn();

            const { container } = render(
                <CycleEditor
                    initialCycle={{
                        id: 'c_manual_1',
                        name: 'Manual Date Entry',
                        durationWeeks: 4,
                        startDate: '2026-09-01',
                        endDate: '2026-09-28',
                        routines: [{ routineId: 'r_push', frequencyPerWeek: 1 }]
                    }}
                    routines={mockRoutines}
                    onSave={onSave}
                    onCancel={onCancel}
                />
            );

            const startDateTextInput = container.querySelector('#cycle-start-date') as HTMLInputElement;
            const endDateTextInput = container.querySelector('#cycle-end-date') as HTMLInputElement;
            const durationInput = container.querySelector('#cycle-duration-weeks') as HTMLInputElement;

            // Enter single digit day/month: '1/10/2026'
            fireEvent.change(startDateTextInput, { target: { value: '1/10/2026' } });
            // 4 weeks from 2026-10-01 is 2026-10-28 -> '28/10/2026'
            expect(endDateTextInput.value).toBe('28/10/2026');

            // On blur, canonical formatting applied: '01/10/2026'
            fireEvent.blur(startDateTextInput);
            expect(startDateTextInput.value).toBe('01/10/2026');

            // Now alter endDate manually: '25/11/2026' (2026-11-25)
            // From 2026-10-01 to 2026-11-25 = 55 days -> (55+1)/7 = 8 weeks
            fireEvent.change(endDateTextInput, { target: { value: '25/11/2026' } });
            expect(durationInput.value).toBe('8');

            fireEvent.blur(endDateTextInput);
            expect(endDateTextInput.value).toBe('25/11/2026');
        });

        it('3.3 Invalid format recovery on blur', () => {
            const onSave = vi.fn();
            const onCancel = vi.fn();

            const { container } = render(
                <CycleEditor
                    initialCycle={{
                        id: 'c_inv_rec',
                        name: 'Invalid Recovery',
                        durationWeeks: 4,
                        startDate: '2026-09-01',
                        endDate: '2026-09-28',
                        routines: [{ routineId: 'r_push', frequencyPerWeek: 1 }]
                    }}
                    routines={mockRoutines}
                    onSave={onSave}
                    onCancel={onCancel}
                />
            );

            const startDateTextInput = container.querySelector('#cycle-start-date') as HTMLInputElement;
            const endDateTextInput = container.querySelector('#cycle-end-date') as HTMLInputElement;

            // Enter junk text in start date
            fireEvent.change(startDateTextInput, { target: { value: 'xyz-not-a-date' } });
            expect(startDateTextInput.value).toBe('xyz-not-a-date');

            // On blur, reverts to last valid date '01/09/2026'
            fireEvent.blur(startDateTextInput);
            expect(startDateTextInput.value).toBe('01/09/2026');

            // Enter junk text in end date
            fireEvent.change(endDateTextInput, { target: { value: '32/13/2026' } });
            expect(endDateTextInput.value).toBe('32/13/2026');

            // On blur, reverts to last valid end date '28/09/2026'
            fireEvent.blur(endDateTextInput);
            expect(endDateTextInput.value).toBe('28/09/2026');
        });

        it('3.4 Calendar pickers trigger proper synchronization without field pollution', () => {
            const onSave = vi.fn();
            const onCancel = vi.fn();

            const { container } = render(
                <CycleEditor
                    initialCycle={{
                        id: 'c_cal_sync',
                        name: 'Calendar Sync',
                        durationWeeks: 4,
                        startDate: '2026-09-01',
                        endDate: '2026-09-28',
                        routines: [{ routineId: 'r_push', frequencyPerWeek: 1 }]
                    }}
                    routines={mockRoutines}
                    onSave={onSave}
                    onCancel={onCancel}
                />
            );

            const dateInputs = container.querySelectorAll('input[type="date"]');
            const startCalendar = dateInputs[0] as HTMLInputElement;
            const endCalendar = dateInputs[1] as HTMLInputElement;
            const startDateTextInput = container.querySelector('#cycle-start-date') as HTMLInputElement;
            const endDateTextInput = container.querySelector('#cycle-end-date') as HTMLInputElement;
            const durationInput = container.querySelector('#cycle-duration-weeks') as HTMLInputElement;

            // Pick End Date from Calendar: 2026-10-26 (8 weeks)
            fireEvent.change(endCalendar, { target: { value: '2026-10-26' } });

            expect(endDateTextInput.value).toBe('26/10/2026');
            expect(durationInput.value).toBe('8');
            // Crucial isolation check: start date was NOT modified!
            expect(startDateTextInput.value).toBe('01/09/2026');

            // Pick Start Date from Calendar: 2026-10-01
            fireEvent.change(startCalendar, { target: { value: '2026-10-01' } });

            expect(startDateTextInput.value).toBe('01/10/2026');
            // 8 weeks from 2026-10-01 -> 2026-11-25 ('25/11/2026')
            expect(endDateTextInput.value).toBe('25/11/2026');
            expect(durationInput.value).toBe('8');
        });

        it('3.5 CycleCard displays formatted range with explicit and calculated end dates', () => {
            const onSetActive = vi.fn();
            const onDeactivate = vi.fn();
            const onEdit = vi.fn();
            const onDuplicate = vi.fn();
            const onDelete = vi.fn();

            const cycle: TrainingCycle = {
                id: 'c_card_test',
                name: 'Cycle Card Display',
                durationWeeks: 6,
                startDate: '2026-09-01',
                endDate: '2026-10-12',
                sessionsPerWeek: 4,
                routines: [{ routineId: 'r_push', frequencyPerWeek: 1 }]
            };

            const { container } = render(
                <CycleCard
                    cycle={cycle}
                    isActive={true}
                    routines={mockRoutines}
                    onSetActive={onSetActive}
                    onDeactivate={onDeactivate}
                    onEdit={onEdit}
                    onDuplicate={onDuplicate}
                    onDelete={onDelete}
                />
            );

            expect(container.textContent).toContain('dal 01/09/2026 al 12/10/2026');
            expect(container.textContent).toContain('(6 sett.)');
            expect(container.textContent).toContain('4 sedute / sett.');
        });
    });
});
