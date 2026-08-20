import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { TrainingCycleSchema } from '../src/lib/schema';
import { calculateCycleTimeline, calculateCycleSchedule } from '../src/lib/calc/planning';
import { CycleEditor } from '../src/components/Training/planning/CycleEditor';
import type { TrainingCycle, WorkoutRoutine } from '../src/types';

describe('Adversarial Stress Test: Milestone 2 Two-Way Binding & Timeline Edge Cases', () => {
    const mockRoutines: WorkoutRoutine[] = [
        { id: 'r1', name: 'Scheda A', exercises: [{ exId: 'ex1', setsCount: 3 }] }
    ];

    describe('Math & Boundary Adversarial Tests', () => {
        it('handles leap year boundaries correctly (Feb 2028)', () => {
            const leapCycle: TrainingCycle = {
                id: 'c_leap',
                name: 'Leap Year Cycle',
                durationWeeks: 4,
                startDate: '2028-02-01', // Feb 2028 has 29 days
                routines: []
            };

            const timeline = calculateCycleTimeline(leapCycle, '2028-02-01');
            // 2028-02-01 + 27 days = 2028-02-28
            expect(timeline.endDate).toBe('2028-02-28');
            expect(timeline.formattedEndDate).toBe('28/02/2028');
        });

        it('handles year rollover seamlessly (Dec 2026 -> Jan 2027)', () => {
            const yearEndCycle: TrainingCycle = {
                id: 'c_year_end',
                name: 'Year End Cycle',
                durationWeeks: 8,
                startDate: '2026-12-01',
                routines: []
            };

            const timeline = calculateCycleTimeline(yearEndCycle, '2026-12-01');
            // 2026-12-01 + 55 days = 2027-01-25
            expect(timeline.endDate).toBe('2027-01-25');
            expect(timeline.formattedEndDate).toBe('25/01/2027');
        });

        it('falls back gracefully when cycle has malformed or corrupted startDate', () => {
            const malformedCycle: TrainingCycle = {
                id: 'c_bad_start',
                name: 'Bad Start',
                durationWeeks: 4,
                startDate: 'invalid-date-string',
                routines: []
            };

            const timeline = calculateCycleTimeline(malformedCycle);
            expect(timeline.totalWeeks).toBe(4);
            expect(timeline.formattedRange).toBeDefined();
        });

        it('falls back to calculated end date when endDate is before startDate', () => {
            const invertedDatesCycle: TrainingCycle = {
                id: 'c_inverted',
                name: 'Inverted Dates',
                durationWeeks: 4,
                startDate: '2026-09-15',
                endDate: '2026-08-01', // Impossible endDate before startDate
                routines: []
            };

            const timeline = calculateCycleTimeline(invertedDatesCycle, '2026-09-15');
            // Should ignore invalid early endDate and calculate 2026-09-15 + 27 days = 2026-10-12
            expect(timeline.endDate).toBe('2026-10-12');
        });

        it('Zod schema handles strange or non-standard property injections into TrainingCycle', () => {
            const dirtyCycle = {
                id: 'c_dirty',
                name: 'Dirty Object',
                durationWeeks: '6', // string number
                startDate: '2026-05-01',
                endDate: '2026-06-11',
                unexpectedProperty: { hack: true },
                routines: 'not-an-array' // should fallback to []
            };

            const parsed = TrainingCycleSchema.parse(dirtyCycle);
            expect(parsed.durationWeeks).toBe(6);
            expect(parsed.startDate).toBe('2026-05-01');
            expect(parsed.endDate).toBe('2026-06-11');
            expect(parsed.routines).toEqual([]);
        });
    });

    describe('CycleEditor Component Stress & UI Robustness', () => {
        it('handles non-numeric or 0 duration input by clamping to minimum 1 week', () => {
            const onSave = vi.fn();
            render(
                <CycleEditor
                    initialCycle={{
                        id: 'c_zero_weeks',
                        name: 'Zero Weeks',
                        durationWeeks: 4,
                        startDate: '2026-09-01',
                        routines: [{ routineId: 'r1', frequencyPerWeek: 1 }]
                    }}
                    routines={mockRoutines}
                    onSave={onSave}
                    onCancel={vi.fn()}
                />
            );

            const durationInput = screen.getByLabelText('Durata (settimane)') as HTMLInputElement;
            fireEvent.change(durationInput, { target: { value: '0' } });

            const form = durationInput.closest('form')!;
            fireEvent.submit(form);

            expect(onSave).toHaveBeenCalledTimes(1);
            const saved = onSave.mock.calls[0][0];
            expect(saved.durationWeeks).toBeGreaterThanOrEqual(1); // Clamped to valid positive duration
        });

        it('handles typing invalid Italian date text in endDate input and resets gracefully on blur', () => {
            render(
                <CycleEditor
                    initialCycle={{
                        id: 'c_blur_test',
                        name: 'Blur Test',
                        durationWeeks: 4,
                        startDate: '2026-09-01',
                        routines: [{ routineId: 'r1', frequencyPerWeek: 1 }]
                    }}
                    routines={mockRoutines}
                    onSave={vi.fn()}
                    onCancel={vi.fn()}
                />
            );

            const endDateInput = screen.getByLabelText('Data di fine') as HTMLInputElement;
            expect(endDateInput.value).toBe('28/09/2026');

            // Type garbage
            fireEvent.change(endDateInput, { target: { value: 'not-a-date' } });
            expect(endDateInput.value).toBe('not-a-date');

            // Blur should reset to last valid formatted date
            fireEvent.blur(endDateInput);
            expect(endDateInput.value).toBe('28/09/2026');
        });
    });
});
