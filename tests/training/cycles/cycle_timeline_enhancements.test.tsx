import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../setup';
import { useAppStore } from '../../../src/store/useAppStore';
import { captureSession } from '../../../src/lib/sync/session';
import { Logic } from '../../../src/lib/logic';
import { TrainingCycleSchema } from '../../../src/lib/schema';
import { CycleEditor } from '../../../src/components/Training/planning/CycleEditor';
import type { WorkoutRoutine } from '../../../src/types';

describe('Training cycle end date', () => {
    describe('Feature coverage', () => {
    beforeEach(async () => {
        window.localStorage.clear();
        localStorage.setItem(`logbook:v2:${captureSession().owner}:health-consent-generation`, '1');
        useAppStore.getState().resetStore();
        useAppStore.setState({ dataOwner: captureSession().owner });
        vi.clearAllMocks();
    });

    afterEach(() => {
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.restoreAllMocks();
    });

        describe('R5: Data di Fine nei Cicli di Allenamento', () => {
            it('T1.5.1: CycleEditor renders its accessible heading and form fields', () => {
                const routines: WorkoutRoutine[] = [
                    { id: 'r1', name: 'Upper A', exercises: [] }
                ];

                const { container } = renderWithProviders(
                    <CycleEditor
                        routines={routines}
                        onSave={vi.fn()}
                        onCancel={vi.fn()}
                    />
                );

                expect(screen.getByRole('heading', { name: /Crea ciclo di allenamento/i })).toBeDefined();
                const inputs = container.querySelectorAll('input');
                expect(inputs.length).toBeGreaterThan(0);
            });

            it('T1.5.2: Logic.calculateCycleTimeline computes formatted date range from start date and duration', () => {
                const timeline = Logic.calculateCycleTimeline({
                    id: 'c1',
                    name: 'Mesociclo Forza',
                    durationWeeks: 4,
                    sessionsPerWeek: 3,
                    startDate: '2026-08-01',
                    routines: [{ routineId: 'r1', frequencyPerWeek: 1 }]
                });

                expect(timeline.startDate).toBe('2026-08-01');
                expect(timeline.endDate).toBe('2026-08-28'); // 4 weeks = 28 days (01 to 28)
                expect(timeline.totalWeeks).toBe(4);
                expect(timeline.formattedRange).toContain('01/08/2026');
                expect(timeline.formattedRange).toContain('28/08/2026');
            });

            it('T1.5.3: Logic.calculateCycleSchedule distributes sessions across computed timeline', () => {
                const routines: WorkoutRoutine[] = [
                    { id: 'r1', name: 'Push', exercises: [] },
                    { id: 'r2', name: 'Pull', exercises: [] },
                    { id: 'r3', name: 'Legs', exercises: [] }
                ];

                const schedule = Logic.calculateCycleSchedule(
                    {
                        id: 'c1',
                        name: 'PPL 6 Settimane',
                        durationWeeks: 6,
                        sessionsPerWeek: 3,
                        startDate: '2026-09-01',
                        routines: [
                            { routineId: 'r1', frequencyPerWeek: 1 },
                            { routineId: 'r2', frequencyPerWeek: 1 },
                            { routineId: 'r3', frequencyPerWeek: 1 }
                        ]
                    },
                    routines
                );

                expect(schedule.totalSessions).toBe(18); // 6 weeks * 3 sessions/week
                expect(schedule.weeks.length).toBe(6);
                expect(schedule.weeks[0].sessions.length).toBe(3);
                expect(schedule.weeks[0].sessions[0].routineName).toBe('Push');
                expect(schedule.weeks[0].sessions[1].routineName).toBe('Pull');
                expect(schedule.weeks[0].sessions[2].routineName).toBe('Legs');
            });

            it('T1.5.4: Changing duration weeks in CycleEditor updates the timeline range display', () => {
                const routines: WorkoutRoutine[] = [{ id: 'r1', name: 'Full Body', exercises: [] }];

                const { container } = renderWithProviders(
                    <CycleEditor
                        routines={routines}
                        onSave={vi.fn()}
                        onCancel={vi.fn()}
                    />
                );

                const numberInputs = container.querySelectorAll('input[type="number"]');
                // First number input is durationWeeks (default 6)
                const durationInput = numberInputs[0] as HTMLInputElement;
                expect(durationInput).not.toBeNull();

                fireEvent.change(durationInput, { target: { value: '8' } });
                expect(container.textContent).toContain('8 settimane');
                expect(container.textContent).toContain((screen.getByLabelText('Data di fine') as HTMLInputElement).value);
            });

            it('T1.5.5: Submitting CycleEditor form produces valid TrainingCycle conforming to schema', () => {
                const onSave = vi.fn();
                const routines: WorkoutRoutine[] = [{ id: 'r1', name: 'Scheda A', exercises: [] }];

                const { container } = renderWithProviders(
                    <CycleEditor
                        routines={routines}
                        onSave={onSave}
                        onCancel={vi.fn()}
                    />
                );

                // Fill name
                const nameInput = container.querySelector('input[type="text"]') as HTMLInputElement;
                fireEvent.change(nameInput, { target: { value: 'Mesociclo Autunno' } });

                // Add routine and declare the new cycle strategy
                const select = screen.getByRole('combobox', { name: 'Aggiungi scheda alla sequenza' });
                fireEvent.change(select, { target: { value: 'r1' } });
                fireEvent.click(screen.getByRole('button', { name: 'Sviluppo' }));
                fireEvent.click(screen.getByRole('button', { name: 'Performance' }));

                // Submit
                const submitBtn = screen.getByText(/Salva ciclo/i);
                fireEvent.click(submitBtn);

                expect(onSave).toHaveBeenCalledTimes(1);
                const savedCycle = onSave.mock.calls[0][0];
                expect(savedCycle.name).toBe('Mesociclo Autunno');
                expect(savedCycle.routines.length).toBe(1);

                // Verify schema validation passes
                const validated = TrainingCycleSchema.parse(savedCycle);
                expect(validated.name).toBe('Mesociclo Autunno');
            });
        });
    });

    describe('Boundaries and corner cases', () => {
    beforeEach(async () => {
        window.localStorage.clear();
        localStorage.setItem(`logbook:v2:${captureSession().owner}:health-consent-generation`, '1');
        useAppStore.getState().resetStore();
        useAppStore.setState({ dataOwner: captureSession().owner });
        vi.clearAllMocks();
    });

    afterEach(() => {
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.restoreAllMocks();
    });

        describe('R5 Boundaries (Training Cycle Timeline & Limits)', () => {
            it('T2.5.1: 1-week minimum duration cycle computes 7-day timeline', () => {
                const timeline = Logic.calculateCycleTimeline({
                    id: 'c_min',
                    name: 'Mini Ciclo Deload',
                    durationWeeks: 1,
                    startDate: '2026-08-01',
                    routines: []
                });

                expect(timeline.totalWeeks).toBe(1);
                expect(timeline.startDate).toBe('2026-08-01');
                expect(timeline.endDate).toBe('2026-08-07');
            });

            it('T2.5.2: 52-week maximum duration cycle computes year-long timeline accurately', () => {
                const timeline = Logic.calculateCycleTimeline({
                    id: 'c_year',
                    name: 'Macrociclo Annuale',
                    durationWeeks: 52,
                    startDate: '2026-01-01',
                    routines: []
                });

                expect(timeline.totalWeeks).toBe(52);
                expect(timeline.startDate).toBe('2026-01-01');
                expect(timeline.endDate).toBe('2026-12-30');
            });

            it('T2.5.3: Year-end rollover spans across new year seamlessly in timeline calculation', () => {
                const timeline = Logic.calculateCycleTimeline({
                    id: 'c_ny',
                    name: 'Ciclo Invernale',
                    durationWeeks: 6,
                    startDate: '2026-12-15',
                    routines: []
                });

                expect(timeline.startDate).toBe('2026-12-15');
                expect(timeline.endDate).toBe('2027-01-25');
                expect(timeline.formattedRange).toContain('15/12/2026');
                expect(timeline.formattedRange).toContain('25/01/2027');
            });

            it('T2.5.4: Cycle with 0 routines handles timeline calculation defensively without error', () => {
                expect(() => {
                    const timeline = Logic.calculateCycleTimeline({
                        id: 'c_empty',
                        name: 'Empty Cycle',
                        durationWeeks: 4,
                        startDate: '2026-08-01',
                        routines: []
                    });
                    expect(timeline.totalWeeks).toBe(4);
                }).not.toThrow();
            });

            it('T2.5.5: High training frequency (e.g. 6 sessions/week) computes total sessions correctly', () => {
                const schedule = Logic.calculateCycleSchedule(
                    {
                        id: 'c_high_freq',
                        name: 'Alta Frequenza',
                        durationWeeks: 4,
                        sessionsPerWeek: 6,
                        startDate: '2026-08-01',
                        routines: [{ routineId: 'r1', frequencyPerWeek: 1 }]
                    },
                    [{ id: 'r1', name: 'Routine 1', exercises: [] }]
                );

                expect(schedule.totalSessions).toBe(24); // 4 * 6
                expect(schedule.weeks.length).toBe(4);
                expect(schedule.weeks[0].sessions.length).toBe(6);
            });
        });
    });
});
