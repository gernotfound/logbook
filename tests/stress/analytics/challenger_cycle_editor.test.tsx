import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TrainingCycleSchema } from '../../../src/lib/schema';
import { useDialogStore } from '../../../src/store/useDialogStore';
import { CycleEditor } from '../../../src/components/Training/planning/CycleEditor';
import type { TrainingCycle } from '../../../src/types';
import { sampleRoutines } from './cycleChallengerFixtures';

describe('Empirical Challenger: Cycle editor calendar interactions', () => {
    afterEach(() => vi.restoreAllMocks());
    describe('Inverted date UI', () => {
        it('CycleEditor clamps durationWeeks to 1 when user sets an end date before start date', () => {
            const onSave = vi.fn();
            const onCancel = vi.fn();

            const { container } = render(
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

            // Duration preview is clamped, but an inverted interval must not
            // be submitted as a valid cycle merely because its duration is 1.
            expect(durationInput.value).toBe('1');
            expect((screen.getByLabelText('Data di inizio') as HTMLInputElement).value).toBe('15/09/2026');
            expect(endDateInput.value).toBe('10/09/2026');

            const alert = vi.spyOn(useDialogStore.getState(), 'showAlert').mockResolvedValue(undefined);
            fireEvent.submit(container.querySelector('form')!);
            expect(onSave).not.toHaveBeenCalled();
            expect(alert).toHaveBeenCalledWith(expect.stringContaining('fine non precedente'));
        });
    });

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
});
