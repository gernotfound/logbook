import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { CycleEditor } from '../../../src/components/Training/planning/CycleEditor';
import { CycleCard } from '../../../src/components/Training/planning/CycleCard';
import type { TrainingCycle } from '../../../src/types';
import { mockRoutines } from './cycleStressRoutines';

describe('Cycle editor dates and calendar UI interactions', () => {
    beforeEach(() => { vi.clearAllMocks(); });

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

        it('3.6 submits canonical dates and week count after manual date edits', async () => {
            const onSave = vi.fn(async () => undefined);
            const { container } = render(
                <CycleEditor
                    initialCycle={{
                        id: 'c_date_submit',
                        name: 'Date submission',
                        durationWeeks: 4,
                        startDate: '2026-09-01',
                        endDate: '2026-09-28',
                        sessionsPerWeek: 1,
                        routines: [{ routineId: 'r_push', frequencyPerWeek: 1 }],
                    }}
                    routines={mockRoutines}
                    onSave={onSave}
                    onCancel={vi.fn()}
                />
            );

            const start = container.querySelector<HTMLInputElement>('#cycle-start-date')!;
            const end = container.querySelector<HTMLInputElement>('#cycle-end-date')!;
            fireEvent.change(start, { target: { value: '1/10/2026' } });
            fireEvent.blur(start);
            fireEvent.change(end, { target: { value: '25/11/2026' } });
            fireEvent.blur(end);
            expect(container.querySelector<HTMLInputElement>('#cycle-duration-weeks')?.value).toBe('8');

            fireEvent.submit(container.querySelector<HTMLFormElement>('#cycle-editor-form')!);
            await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
            expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
                id: 'c_date_submit',
                name: 'Date submission',
                startDate: '2026-10-01',
                endDate: '2026-11-25',
                durationWeeks: 8,
                sessionsPerWeek: 1,
            }));
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
            expect(container.textContent).toContain('6 settimane');
            expect(container.textContent).toContain('4 sedute / sett.');
        });
    });
});
