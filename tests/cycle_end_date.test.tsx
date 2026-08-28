import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { TrainingCycleSchema, DomainParsers } from '../src/lib/schema';
import { calculateCycleTimeline, calculateCycleSchedule } from '../src/lib/calc/planning';
import { CycleEditor } from '../src/components/Training/planning/CycleEditor';
import type { TrainingCycle, WorkoutRoutine } from '../src/types';

describe('Training Cycle End Date & Two-Way Binding (Milestone 2 - Requirement R5)', () => {
    const mockRoutines: WorkoutRoutine[] = [
        {
            id: 'r_push',
            name: 'Spinta (Push)',
            exercises: [{ exId: 'ex_bench', setsCount: 4 }]
        },
        {
            id: 'r_pull',
            name: 'Trazione (Pull)',
            exercises: [{ exId: 'ex_lat', setsCount: 4 }]
        }
    ];

    describe('1. Zod Schema & DomainParsers Validation', () => {
        it('validates and preserves endDate in TrainingCycleSchema', () => {
            const cycleWithEndDate = {
                id: 'c1',
                name: 'Ciclo Forza',
                durationWeeks: 6,
                startDate: '2026-09-01',
                endDate: '2026-10-12',
                routines: [{ routineId: 'r_push', frequencyPerWeek: 1 }]
            };

            const parsed = TrainingCycleSchema.parse(cycleWithEndDate);
            expect(parsed.endDate).toBe('2026-10-12');
            expect(parsed.startDate).toBe('2026-09-01');
            expect(parsed.durationWeeks).toBe(6);
        });

        it('handles missing or undefined endDate gracefully in TrainingCycleSchema', () => {
            const cycleWithoutEndDate = {
                id: 'c2',
                name: 'Ciclo Senza Fine',
                durationWeeks: 4,
                startDate: '2026-09-01',
                routines: []
            };

            const parsed = TrainingCycleSchema.parse(cycleWithoutEndDate);
            expect(parsed.endDate).toBeUndefined();
        });

        it('sanitizes non-string or corrupted endDate to undefined', () => {
            const cycleWithCorruptedEndDate = {
                id: 'c3',
                name: 'Ciclo Corrotto',
                durationWeeks: 4,
                endDate: null,
                routines: []
            };

            const parsed = TrainingCycleSchema.parse(cycleWithCorruptedEndDate);
            expect(parsed.endDate).toBeUndefined();
        });

        it('DomainParsers.parseTrainingCycles preserves endDate across arrays of cycles', () => {
            const rawCycles = [
                {
                    id: 'c_parsed_1',
                    name: 'Ciclo 1',
                    durationWeeks: 8,
                    startDate: '2026-01-01',
                    endDate: '2026-02-25',
                    routines: []
                },
                {
                    id: 'c_parsed_2',
                    name: 'Ciclo 2',
                    durationWeeks: 4,
                    routines: []
                }
            ];

            const parsedCycles = DomainParsers.parseTrainingCycles(rawCycles);
            expect(parsedCycles).toHaveLength(2);
            expect(parsedCycles[0].endDate).toBe('2026-02-25');
            expect(parsedCycles[1].endDate).toBeUndefined();
        });
    });

    describe('2. Planning Calculations with End Date', () => {
        it('calculateCycleTimeline calculates correct endDate from startDate and durationWeeks when endDate is omitted', () => {
            const cycle: TrainingCycle = {
                id: 'c_timeline_1',
                name: 'Ciclo 4 Settimane',
                durationWeeks: 4,
                startDate: '2026-09-01', // 4 weeks = 28 days -> end is 2026-09-28
                routines: []
            };

            const timeline = calculateCycleTimeline(cycle, '2026-09-01');
            expect(timeline.startDate).toBe('2026-09-01');
            expect(timeline.endDate).toBe('2026-09-28');
            expect(timeline.formattedStartDate).toBe('01/09/2026');
            expect(timeline.formattedEndDate).toBe('28/09/2026');
            expect(timeline.formattedRange).toBe('dal 01/09/2026 al 28/09/2026');
        });

        it('calculateCycleTimeline respects explicitly provided cycle.endDate', () => {
            const cycle: TrainingCycle = {
                id: 'c_timeline_2',
                name: 'Ciclo Personalizzato',
                durationWeeks: 6,
                startDate: '2026-09-01',
                endDate: '2026-10-15',
                routines: []
            };

            const timeline = calculateCycleTimeline(cycle, '2026-09-01');
            expect(timeline.startDate).toBe('2026-09-01');
            expect(timeline.endDate).toBe('2026-10-15');
            expect(timeline.formattedStartDate).toBe('01/09/2026');
            expect(timeline.formattedEndDate).toBe('15/10/2026');
            expect(timeline.formattedRange).toBe('dal 01/09/2026 al 15/10/2026');
        });

        it('calculateCycleSchedule generates weekly schedules matching totalWeeks', () => {
            const cycle: TrainingCycle = {
                id: 'c_sched_1',
                name: 'Ciclo Schede',
                durationWeeks: 4,
                startDate: '2026-09-01',
                endDate: '2026-09-28',
                sessionsPerWeek: 2,
                routines: [
                    { routineId: 'r_push', frequencyPerWeek: 1 },
                    { routineId: 'r_pull', frequencyPerWeek: 1 }
                ]
            };

            const schedule = calculateCycleSchedule(cycle, mockRoutines);
            expect(schedule.weeks).toHaveLength(4);
            expect(schedule.totalSessions).toBe(8);
            expect(schedule.weeks[0].startDateStr).toBe('2026-09-01');
            expect(schedule.weeks[3].endDateStr).toBe('2026-09-28');
        });
    });

    describe('3. CycleEditor Component Two-Way Binding & UI Behavior', () => {
        it('renders Data di inizio and Data di fine with Italian sentence case labels', () => {
            const onSave = vi.fn();
            const onCancel = vi.fn();

            render(
                <CycleEditor
                    routines={mockRoutines}
                    onSave={onSave}
                    onCancel={onCancel}
                />
            );

            expect(screen.getByLabelText('Data di inizio')).toBeDefined();
            expect(screen.getByLabelText('Data di fine')).toBeDefined();
            expect(screen.getByLabelText('Durata (settimane)')).toBeDefined();
            expect(screen.getByText('Frequenza di allenamento (sedute a settimana)')).toBeDefined();
        });

        it('two-way binding: changing durationWeeks updates endDate automatically', () => {
            const onSave = vi.fn();
            const onCancel = vi.fn();

            render(
                <CycleEditor
                    initialCycle={{
                        id: 'c_test_weeks',
                        name: 'Ciclo Test',
                        durationWeeks: 4,
                        startDate: '2026-09-01',
                        routines: [{ routineId: 'r_push', frequencyPerWeek: 1 }]
                    }}
                    routines={mockRoutines}
                    onSave={onSave}
                    onCancel={onCancel}
                />
            );

            const durationInput = screen.getByLabelText('Durata (settimane)') as HTMLInputElement;
            const endDateInput = screen.getByLabelText('Data di fine') as HTMLInputElement;

            // Initially 4 weeks starting 2026-09-01 -> 28/09/2026
            expect(durationInput.value).toBe('4');
            expect(endDateInput.value).toBe('28/09/2026');

            // Change duration to 8 weeks
            fireEvent.change(durationInput, { target: { value: '8' } });

            // 8 weeks = 56 days -> 2026-09-01 + 55 days = 2026-10-26 (26/10/2026)
            expect(endDateInput.value).toBe('26/10/2026');
        });

        it('two-way binding: changing endDate updates durationWeeks automatically', () => {
            const onSave = vi.fn();
            const onCancel = vi.fn();

            render(
                <CycleEditor
                    initialCycle={{
                        id: 'c_test_end',
                        name: 'Ciclo Test',
                        durationWeeks: 4,
                        startDate: '2026-09-01',
                        routines: [{ routineId: 'r_push', frequencyPerWeek: 1 }]
                    }}
                    routines={mockRoutines}
                    onSave={onSave}
                    onCancel={onCancel}
                />
            );

            const durationInput = screen.getByLabelText('Durata (settimane)') as HTMLInputElement;
            const endDateInput = screen.getByLabelText('Data di fine') as HTMLInputElement;

            // Change end date to 12 weeks ahead: 2026-11-23 (23/11/2026)
            fireEvent.change(endDateInput, { target: { value: '23/11/2026' } });
            fireEvent.blur(endDateInput);

            // difference between 2026-09-01 and 2026-11-23 is 83 days -> round(84/7) = 12 weeks
            expect(durationInput.value).toBe('12');
        });

        it('two-way binding: changing startDate updates endDate preserving durationWeeks', () => {
            const onSave = vi.fn();
            const onCancel = vi.fn();

            render(
                <CycleEditor
                    initialCycle={{
                        id: 'c_test_start',
                        name: 'Ciclo Test',
                        durationWeeks: 6,
                        startDate: '2026-09-01',
                        routines: [{ routineId: 'r_push', frequencyPerWeek: 1 }]
                    }}
                    routines={mockRoutines}
                    onSave={onSave}
                    onCancel={onCancel}
                />
            );

            const startDateInput = screen.getByLabelText('Data di inizio') as HTMLInputElement;
            const durationInput = screen.getByLabelText('Durata (settimane)') as HTMLInputElement;
            const endDateInput = screen.getByLabelText('Data di fine') as HTMLInputElement;

            expect(durationInput.value).toBe('6');
            expect(endDateInput.value).toBe('12/10/2026');

            // Shift startDate to 2026-10-01 (01/10/2026)
            fireEvent.change(startDateInput, { target: { value: '01/10/2026' } });
            fireEvent.blur(startDateInput);

            // durationWeeks stays 6, endDate shifts to 6 weeks from 2026-10-01 -> 11/11/2026
            expect(durationInput.value).toBe('6');
            expect(endDateInput.value).toBe('11/11/2026');
        });

        it('submits cycle with both startDate and endDate on save', () => {
            const onSave = vi.fn();
            const onCancel = vi.fn();

            render(
                <CycleEditor
                    initialCycle={{
                        id: 'c_save_test',
                        name: 'Ciclo Salva',
                        durationWeeks: 4,
                        startDate: '2026-09-01',
                        routines: [{ routineId: 'r_push', frequencyPerWeek: 1 }]
                    }}
                    routines={mockRoutines}
                    onSave={onSave}
                    onCancel={onCancel}
                />
            );

            const saveBtn = screen.getByRole('button', { name: /Salva modifiche/i });
            fireEvent.click(saveBtn);

            expect(onSave).toHaveBeenCalledTimes(1);
            const savedData: TrainingCycle = onSave.mock.calls[0][0];
            expect(savedData.name).toBe('Ciclo Salva');
            expect(savedData.durationWeeks).toBe(4);
            expect(savedData.startDate).toBe('2026-09-01');
            expect(savedData.endDate).toBe('2026-09-28');
        });
    });
});
