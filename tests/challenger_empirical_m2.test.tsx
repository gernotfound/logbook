import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { addDays, format, parseISO, startOfDay, differenceInCalendarDays } from 'date-fns';
import { TrainingCycleSchema, DomainParsers } from '../src/lib/schema';
import { calculateCycleTimeline, calculateCycleSchedule, getNextScheduledRoutine, calculateCycleVolume } from '../src/lib/calc/planning';
import { CycleEditor } from '../src/components/Training/planning/CycleEditor';
import type { TrainingCycle, WorkoutRoutine, Exercise } from '../src/types';

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

describe('Empirical Challenger: Training Cycles End Date & Two-Way Binding Adversarial Suite (Milestone 2 - Requirement R5)', () => {
    const sampleRoutines: WorkoutRoutine[] = [
        {
            id: 'r_push',
            name: 'Push A',
            exercises: [{ exId: 'ex_bench', setsCount: 4 }]
        },
        {
            id: 'r_pull',
            name: 'Pull B',
            exercises: [{ exId: 'ex_row', setsCount: 4 }]
        },
        {
            id: 'r_legs',
            name: 'Legs C',
            exercises: [{ exId: 'ex_squat', setsCount: 5 }]
        }
    ];

    const sampleLibrary: Exercise[] = [
        { id: 'ex_bench', name: 'Panca piana', setsCount: 4, muscles: ['chest', 'triceps'], sets: [] },
        { id: 'ex_row', name: 'Rematore bilanciere', setsCount: 4, muscles: ['back', 'biceps'], sets: [] },
        { id: 'ex_squat', name: 'Squat', setsCount: 5, muscles: ['quads', 'glutes'], sets: [] }
    ];

    // =========================================================================
    // 1. Boundary & Pathological Weeks (0, Negative, Float, Huge 100-520 weeks)
    // =========================================================================
    describe('1. Boundary & Pathological Weeks Handling', () => {
        it('clamps 0 weeks and negative weeks to 1 week duration in computeEndDate', () => {
            const start = '2026-09-01';
            // 0 weeks -> clamp to 1 week -> 7 days - 1 = +6 days -> 2026-09-07
            expect(computeEndDateDirect(start, 0)).toBe('2026-09-07');
            expect(computeEndDateDirect(start, -1)).toBe('2026-09-07');
            expect(computeEndDateDirect(start, -52)).toBe('2026-09-07');
        });

        it('computes exact boundaries for 100 weeks and 520 weeks (10 years) without overflow', () => {
            const start = '2026-01-01';
            // 100 weeks = 700 days -> start + 699 days = 2027-12-01
            const end100 = computeEndDateDirect(start, 100);
            expect(end100).toBe('2027-12-01');
            expect(computeWeeksFromDatesDirect(start, end100)).toBe(100);

            // 520 weeks = 3640 days -> start + 3639 days
            const end520 = computeEndDateDirect(start, 520);
            expect(end520).toBe('2035-12-19');
            expect(computeWeeksFromDatesDirect(start, end520)).toBe(520);
        });

        it('calculateCycleTimeline handles 0 (defaults to 4) and negative durationWeeks (clamps to 1)', () => {
            const cycleZero: TrainingCycle = {
                id: 'c_zero',
                name: 'Ciclo Zero',
                durationWeeks: 0,
                startDate: '2026-09-01',
                routines: []
            };

            const timelineZero = calculateCycleTimeline(cycleZero, '2026-09-01');
            // 0 is falsy, so fallback to default 4 weeks
            expect(timelineZero.totalWeeks).toBe(4);
            expect(timelineZero.endDate).toBe('2026-09-28');
            expect(timelineZero.formattedRange).toBe('dal 01/09/2026 al 28/09/2026');

            const cycleNeg: TrainingCycle = {
                id: 'c_neg',
                name: 'Ciclo Negativo',
                durationWeeks: -10,
                startDate: '2026-09-01',
                routines: []
            };

            const timelineNeg = calculateCycleTimeline(cycleNeg, '2026-09-01');
            // Negative number is clamped via Math.max(1, -10) -> 1 week
            expect(timelineNeg.totalWeeks).toBe(1);
            expect(timelineNeg.endDate).toBe('2026-09-07');
            expect(timelineNeg.formattedRange).toBe('dal 01/09/2026 al 07/09/2026');
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

    // =========================================================================
    // 2. Temporal Anachronism & Inverted Dates (End Date Before Start Date)
    // =========================================================================
    describe('2. Temporal Anachronism (End Date < Start Date)', () => {
        it('computeWeeksFromDates safely returns 1 if end date is strictly before start date', () => {
            expect(computeWeeksFromDatesDirect('2026-09-10', '2026-09-01')).toBe(1);
            expect(computeWeeksFromDatesDirect('2026-12-31', '2026-01-01')).toBe(1);
            expect(computeWeeksFromDatesDirect('2030-01-01', '2020-01-01')).toBe(1);
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

        it('CycleEditor clamps durationWeeks to 1 when user sets an end date before start date', () => {
            const onSave = vi.fn();
            const onCancel = vi.fn();

            render(
                <CycleEditor
                    initialCycle={{
                        id: 'c_edit_inv',
                        name: 'Ciclo Invertito UI',
                        durationWeeks: 4,
                        startDate: '2026-09-15',
                        routines: [{ routineId: 'r_push', frequencyPerWeek: 1 }]
                    }}
                    routines={sampleRoutines}
                    onSave={onSave}
                    onCancel={onCancel}
                />
            );

            const durationInput = screen.getByLabelText('Durata (settimane)') as HTMLInputElement;
            const endDateInput = screen.getByLabelText('Data di fine') as HTMLInputElement;

            // Type end date earlier than start date
            fireEvent.change(endDateInput, { target: { value: '10/09/2026' } });
            fireEvent.blur(endDateInput);

            // Duration is clamped safely to 1
            expect(durationInput.value).toBe('1');
        });
    });

    // =========================================================================
    // 3. Leap Year Transitions (2024, 2028 & Non-Leap Years)
    // =========================================================================
    describe('3. Leap Year Spans & Transitions', () => {
        it('correctly accounts for Feb 29 in leap year 2024 vs 28 days in 2025', () => {
            // Leap year 2024: Feb 15 + 4 weeks (28 days) -> Feb 15 + 27 days = March 13
            // Feb 2024 has 29 days (15,16,17,18,19,20,21,22,23,24,25,26,27,28,29 = 15 days in Feb -> +13 days in Mar = Mar 13)
            const leapEnd = computeEndDateDirect('2024-02-15', 4);
            expect(leapEnd).toBe('2024-03-13');

            // Non-leap year 2025: Feb 15 + 4 weeks (28 days) -> Feb 15 + 27 days = March 14
            // Feb 2025 has 28 days (15..28 = 14 days in Feb -> +14 days in Mar = Mar 14)
            const nonLeapEnd = computeEndDateDirect('2025-02-15', 4);
            expect(nonLeapEnd).toBe('2025-03-14');

            expect(computeWeeksFromDatesDirect('2024-02-15', leapEnd)).toBe(4);
            expect(computeWeeksFromDatesDirect('2025-02-15', nonLeapEnd)).toBe(4);
        });

        it('handles start on leap day (2024-02-29) seamlessly', () => {
            const startLeapDay = '2024-02-29';
            // 1 week: Feb 29 + 6 days = March 6
            const end1w = computeEndDateDirect(startLeapDay, 1);
            expect(end1w).toBe('2024-03-06');
            expect(computeWeeksFromDatesDirect(startLeapDay, end1w)).toBe(1);

            // 8 weeks: Feb 29 + 55 days = April 24
            const end8w = computeEndDateDirect(startLeapDay, 8);
            expect(end8w).toBe('2024-04-24');
            expect(computeWeeksFromDatesDirect(startLeapDay, end8w)).toBe(8);
        });

        it('crosses into leap year 2028 from late 2027 accurately', () => {
            const startCross = '2027-12-01'; // 16 weeks span
            const endCross = computeEndDateDirect(startCross, 16);
            // 16 weeks = 112 days -> start + 111 days = 2028-03-21 (includes Feb 29, 2028)
            expect(endCross).toBe('2028-03-21');
            expect(computeWeeksFromDatesDirect(startCross, endCross)).toBe(16);
        });
    });

    // =========================================================================
    // 4. Year Rollovers & DST Daylight Savings Transitions
    // =========================================================================
    describe('4. Year Rollovers & DST Transitions', () => {
        it('calculates accurate end dates across Dec 31 -> Jan 01 boundary', () => {
            const startDec = '2026-12-25';
            // 4 weeks (28 days) -> Dec 25 + 27 days = Jan 21, 2027
            const endDec = computeEndDateDirect(startDec, 4);
            expect(endDec).toBe('2027-01-21');
            expect(computeWeeksFromDatesDirect(startDec, endDec)).toBe(4);

            const startSilvester = '2026-12-31';
            // 1 week -> Dec 31 + 6 days = Jan 06, 2027
            const endSilvester = computeEndDateDirect(startSilvester, 1);
            expect(endSilvester).toBe('2027-01-06');
            expect(computeWeeksFromDatesDirect(startSilvester, endSilvester)).toBe(1);
        });

        it('survives European Daylight Savings Time (DST) Spring & Fall transitions without 23h/25h hour drift', () => {
            // Spring transition (March 2026 - clock springs forward)
            const startSpring = '2026-03-15';
            const endSpring = computeEndDateDirect(startSpring, 4);
            // 4 weeks = 28 days -> start + 27 days = 2026-04-11
            expect(endSpring).toBe('2026-04-11');
            expect(computeWeeksFromDatesDirect(startSpring, endSpring)).toBe(4);

            // Fall transition (October 2026 - clock falls back)
            const startFall = '2026-10-15';
            const endFall = computeEndDateDirect(startFall, 4);
            // 4 weeks = 28 days -> start + 27 days = 2026-11-11
            expect(endFall).toBe('2026-11-11');
            expect(computeWeeksFromDatesDirect(startFall, endFall)).toBe(4);
        });
    });

    // =========================================================================
    // 5. Bidirectional Mathematical Invariance (Round-trip stability)
    // =========================================================================
    describe('5. Mathematical Invariance & Two-Way Binding Round-trip', () => {
        const testStartDates = [
            '2024-01-01', // Leap year start
            '2024-02-29', // Leap day
            '2025-06-15', // Mid year
            '2026-09-01', // Canonical test date
            '2026-12-28', // Late December
            '2028-02-14', // Leap year Valentine
            '2030-07-04'  // Far future
        ];

        testStartDates.forEach(startDate => {
            it(`maintains exact round-trip computeEndDate <-> computeWeeksFromDates for all W in [1..52] starting ${startDate}`, () => {
                for (let w = 1; w <= 52; w++) {
                    const endDate = computeEndDateDirect(startDate, w);
                    const computedWeeks = computeWeeksFromDatesDirect(startDate, endDate);
                    expect(computedWeeks).toBe(w);

                    const start = parseISO(startDate);
                    const end = parseISO(endDate);
                    const diffDays = differenceInCalendarDays(end, start);
                    expect(diffDays + 1).toBe(w * 7);
                }
            });
        });
    });

    // =========================================================================
    // 6. CycleEditor Component UI & Form Adversarial Interactions
    // =========================================================================
    describe('6. CycleEditor UI Stress & Interaction Robustness', () => {
        it('handles malformed, gibberish and empty date inputs on blur by reverting to last valid date', () => {
            const onSave = vi.fn();
            const onCancel = vi.fn();

            render(
                <CycleEditor
                    initialCycle={{
                        id: 'c_malformed_test',
                        name: 'Ciclo Corrotto UI',
                        durationWeeks: 4,
                        startDate: '2026-09-01',
                        routines: [{ routineId: 'r_push', frequencyPerWeek: 1 }]
                    }}
                    routines={sampleRoutines}
                    onSave={onSave}
                    onCancel={onCancel}
                />
            );

            const startDateInput = screen.getByLabelText('Data di inizio') as HTMLInputElement;
            const endDateInput = screen.getByLabelText('Data di fine') as HTMLInputElement;

            expect(startDateInput.value).toBe('01/09/2026');
            expect(endDateInput.value).toBe('28/09/2026');

            // Type garbage in startDate
            fireEvent.change(startDateInput, { target: { value: '99/99/9999-invalid' } });
            fireEvent.blur(startDateInput);
            // Reverts to formatted last valid date
            expect(startDateInput.value).toBe('01/09/2026');

            // Type garbage in endDate
            fireEvent.change(endDateInput, { target: { value: 'gibberish' } });
            fireEvent.blur(endDateInput);
            expect(endDateInput.value).toBe('28/09/2026');
        });

        it('handles rapid alternating typing between weeks and end date without feedback oscillation', () => {
            const onSave = vi.fn();
            const onCancel = vi.fn();

            render(
                <CycleEditor
                    initialCycle={{
                        id: 'c_oscillation_test',
                        name: 'Ciclo Test Oscillazione',
                        durationWeeks: 4,
                        startDate: '2026-09-01',
                        routines: [{ routineId: 'r_push', frequencyPerWeek: 1 }]
                    }}
                    routines={sampleRoutines}
                    onSave={onSave}
                    onCancel={onCancel}
                />
            );

            const durationInput = screen.getByLabelText('Durata (settimane)') as HTMLInputElement;
            const endDateInput = screen.getByLabelText('Data di fine') as HTMLInputElement;

            // Step 1: change duration to 6
            fireEvent.change(durationInput, { target: { value: '6' } });
            expect(endDateInput.value).toBe('12/10/2026');

            // Step 2: change end date to 26/10/2026 (8 weeks)
            fireEvent.change(endDateInput, { target: { value: '26/10/2026' } });
            fireEvent.blur(endDateInput);
            expect(durationInput.value).toBe('8');

            // Step 3: change duration to 12
            fireEvent.change(durationInput, { target: { value: '12' } });
            expect(endDateInput.value).toBe('23/11/2026');

            // Step 4: change end date to 07/09/2026 (1 week)
            fireEvent.change(endDateInput, { target: { value: '07/09/2026' } });
            fireEvent.blur(endDateInput);
            expect(durationInput.value).toBe('1');
        });

        it('verifies selecting end date from calendar picker updates endDate without modifying startDate text input', () => {
            const onSave = vi.fn();
            const onCancel = vi.fn();

            const { container } = render(
                <CycleEditor
                    initialCycle={{
                        id: 'c_picker_test',
                        name: 'Ciclo Picker Test',
                        durationWeeks: 4,
                        startDate: '2026-09-01',
                        routines: [{ routineId: 'r_push', frequencyPerWeek: 1 }]
                    }}
                    routines={sampleRoutines}
                    onSave={onSave}
                    onCancel={onCancel}
                />
            );

            const startDateInput = screen.getByLabelText('Data di inizio') as HTMLInputElement;
            const endDateInput = screen.getByLabelText('Data di fine') as HTMLInputElement;

            expect(startDateInput.value).toBe('01/09/2026');
            expect(endDateInput.value).toBe('28/09/2026');

            // Find end date calendar input
            const datePickers = container.querySelectorAll('input[type="date"]');
            const endPicker = datePickers[1] as HTMLInputElement; // second date picker is for End Date

            fireEvent.change(endPicker, { target: { value: '2026-10-26' } });

            expect(endDateInput.value).toBe('26/10/2026');
            // Check start date is NOT corrupted
            expect(startDateInput.value).toBe('01/09/2026');
        });

        it('parses Italian slash date formats with single digits e.g. 1/9/2026', () => {
            const onSave = vi.fn();
            const onCancel = vi.fn();

            render(
                <CycleEditor
                    initialCycle={{
                        id: 'c_format_test',
                        name: 'Ciclo Formato',
                        durationWeeks: 4,
                        startDate: '2026-09-01',
                        routines: [{ routineId: 'r_push', frequencyPerWeek: 1 }]
                    }}
                    routines={sampleRoutines}
                    onSave={onSave}
                    onCancel={onCancel}
                />
            );

            const startDateInput = screen.getByLabelText('Data di inizio') as HTMLInputElement;
            const endDateInput = screen.getByLabelText('Data di fine') as HTMLInputElement;

            fireEvent.change(startDateInput, { target: { value: '5/5/2026' } });
            fireEvent.blur(startDateInput);

            // Start date normalized to 05/05/2026
            expect(startDateInput.value).toBe('05/05/2026');
            // End date updated to 4 weeks from 05/05/2026 -> 01/06/2026
            expect(endDateInput.value).toBe('01/06/2026');
        });

        it('saves cycle with correct sanitized startDate, endDate and durationWeeks upon submit', () => {
            const onSave = vi.fn();
            const onCancel = vi.fn();

            const { container } = render(
                <CycleEditor
                    initialCycle={{
                        id: 'c_save_val',
                        name: 'Ciclo Finale',
                        durationWeeks: 6,
                        startDate: '2026-09-01',
                        routines: [{ routineId: 'r_push', frequencyPerWeek: 1 }]
                    }}
                    routines={sampleRoutines}
                    onSave={onSave}
                    onCancel={onCancel}
                />
            );

            const form = container.querySelector('form')!;
            fireEvent.submit(form);

            expect(onSave).toHaveBeenCalledTimes(1);
            const saved: TrainingCycle = onSave.mock.calls[0][0];
            expect(saved.startDate).toBe('2026-09-01');
            expect(saved.endDate).toBe('2026-10-12');
            expect(saved.durationWeeks).toBe(6);

            // Pass through TrainingCycleSchema to verify runtime contract
            const parsed = TrainingCycleSchema.parse(saved);
            expect(parsed.endDate).toBe('2026-10-12');
            expect(parsed.startDate).toBe('2026-09-01');
        });
    });

    // =========================================================================
    // 7. Schema & Domain Parsers Resilience
    // =========================================================================
    describe('7. Schema & Domain Parsers Resilience', () => {
        it('DomainParsers.parseTrainingCycles sanitizes individual cycle fields and retains valid objects', () => {
            const raw = [
                {
                    id: 'c1',
                    name: 'C1',
                    durationWeeks: 4,
                    startDate: '2026-09-01',
                    endDate: '2026-09-28',
                    routines: []
                },
                {
                    id: 'c2',
                    name: 'C2',
                    durationWeeks: 8,
                    startDate: '2026-10-01',
                    endDate: { invalid: true } as unknown as string, // Object converted to undefined
                    routines: []
                },
                {
                    id: 'c3',
                    name: 'C3',
                    durationWeeks: '6', // String coerced
                    startDate: null,
                    endDate: null,
                    routines: []
                }
            ];

            const parsed = DomainParsers.parseTrainingCycles(raw);
            expect(parsed).toHaveLength(3);
            expect(parsed[0].endDate).toBe('2026-09-28');
            expect(parsed[1].endDate).toBeUndefined(); // Coerced safely from invalid object
            expect(parsed[2].endDate).toBeUndefined();
            expect(parsed[2].durationWeeks).toBe(6);
        });

        it('getNextScheduledRoutine handles cycles with startDate and endDate gracefully', () => {
            const cycle: TrainingCycle = {
                id: 'c_next_test',
                name: 'Ciclo Next',
                durationWeeks: 4,
                sessionsPerWeek: 3,
                startDate: '2026-09-01',
                endDate: '2026-09-28',
                routines: [
                    { routineId: 'r_push', frequencyPerWeek: 1 },
                    { routineId: 'r_pull', frequencyPerWeek: 1 },
                    { routineId: 'r_legs', frequencyPerWeek: 1 }
                ]
            };

            // History with 2 sessions completed
            const history = [
                { id: 'w1', cycleId: 'c_next_test', routineId: 'r_push', exercises: [] },
                { id: 'w2', cycleId: 'c_next_test', routineId: 'r_pull', exercises: [] }
            ];

            const next = getNextScheduledRoutine(cycle, sampleRoutines, history);
            expect(next).not.toBeNull();
            expect(next?.completedCount).toBe(2);
            expect(next?.totalSessions).toBe(12);
            expect(next?.nextRoutineId).toBe('r_legs');
            expect(next?.nextRoutineName).toBe('Legs C');
            expect(next?.isCycleCompleted).toBe(false);
        });

        it('calculateCycleVolume computes volume with full muscle distribution when cycle has endDate', () => {
            const cycle: TrainingCycle = {
                id: 'c_vol',
                name: 'Ciclo Volume',
                durationWeeks: 4,
                sessionsPerWeek: 3,
                startDate: '2026-09-01',
                endDate: '2026-09-28',
                routines: [
                    { routineId: 'r_push', frequencyPerWeek: 1 },
                    { routineId: 'r_pull', frequencyPerWeek: 1 },
                    { routineId: 'r_legs', frequencyPerWeek: 1 }
                ]
            };

            const vol = calculateCycleVolume(cycle, sampleRoutines, sampleLibrary);
            expect(vol.totalWorkoutsPerWeek).toBe(3);
            expect(vol.totalSetsPerWeek).toBe(13); // 4 + 4 + 5
            expect(vol.muscleVolumes.length).toBeGreaterThan(0);
            expect(vol.highlightedMuscles).toContain('chest');
            expect(vol.highlightedMuscles).toContain('back');
            expect(vol.highlightedMuscles).toContain('quads');
        });
    });
});
