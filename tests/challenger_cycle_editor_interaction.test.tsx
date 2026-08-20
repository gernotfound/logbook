import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CycleEditor } from '../src/components/Training/planning/CycleEditor';
import { useDialogStore } from '../src/store/useDialogStore';
import type { TrainingCycle, WorkoutRoutine } from '../src/types';

describe('Challenger 2 Empirical Verification: CycleEditor UI & Two-Way Binding', () => {
    const mockRoutines: WorkoutRoutine[] = [
        {
            id: 'routine_1',
            name: 'Push Routine',
            exercises: [
                { exId: 'ex_bench', targetSets: 4, targetReps: '8-10' }
            ]
        },
        {
            id: 'routine_2',
            name: 'Pull Routine',
            exercises: [
                { exId: 'ex_pullup', targetSets: 4, targetReps: '6-8' }
            ]
        },
        {
            id: 'routine_3',
            name: 'Legs Routine',
            exercises: [
                { exId: 'ex_squat', targetSets: 4, targetReps: '5' }
            ]
        }
    ];

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('Scenario 1: Duration Weeks change immediately updates End Date (text and calendar value)', () => {
        const onSave = vi.fn();
        const onCancel = vi.fn();

        const initialCycle: TrainingCycle = {
            id: 'cycle_test_1',
            name: 'Test Cycle',
            durationWeeks: 4,
            sessionsPerWeek: 3,
            startDate: '2026-08-20',
            endDate: '2026-09-16',
            routines: [{ routineId: 'routine_1', frequencyPerWeek: 1 }],
            createdAt: 1000
        };

        const { container } = render(
            <CycleEditor
                initialCycle={initialCycle}
                routines={mockRoutines}
                onSave={onSave}
                onCancel={onCancel}
            />
        );

        const durationInput = container.querySelector('#cycle-duration-weeks') as HTMLInputElement;
        const endDateTextInput = container.querySelector('#cycle-end-date') as HTMLInputElement;

        expect(durationInput.value).toBe('4');
        expect(endDateTextInput.value).toBe('16/09/2026');

        // Change duration from 4 to 8 weeks
        fireEvent.change(durationInput, { target: { value: '8' } });

        // 2026-08-20 + (8 * 7 - 1) = 2026-08-20 + 55 days = 2026-10-14
        expect(durationInput.value).toBe('8');
        expect(endDateTextInput.value).toBe('14/10/2026');
    });

    it('Scenario 2: End Date text change immediately updates Duration Weeks (two-way binding)', () => {
        const onSave = vi.fn();
        const onCancel = vi.fn();

        const initialCycle: TrainingCycle = {
            id: 'cycle_test_2',
            name: 'Test Cycle 2',
            durationWeeks: 4,
            sessionsPerWeek: 3,
            startDate: '2026-08-20',
            endDate: '2026-09-16',
            routines: [{ routineId: 'routine_1', frequencyPerWeek: 1 }],
            createdAt: 1000
        };

        const { container } = render(
            <CycleEditor
                initialCycle={initialCycle}
                routines={mockRoutines}
                onSave={onSave}
                onCancel={onCancel}
            />
        );

        const durationInput = container.querySelector('#cycle-duration-weeks') as HTMLInputElement;
        const endDateTextInput = container.querySelector('#cycle-end-date') as HTMLInputElement;

        // Change end date to 2 weeks later: '02/09/2026' (2026-09-02)
        // 2026-08-20 to 2026-09-02 = 13 days -> (13 + 1) / 7 = 2 weeks
        fireEvent.change(endDateTextInput, { target: { value: '02/09/2026' } });

        expect(durationInput.value).toBe('2');
    });

    it('Scenario 3: Start Date text change shifts End Date preserving duration weeks', () => {
        const onSave = vi.fn();
        const onCancel = vi.fn();

        const initialCycle: TrainingCycle = {
            id: 'cycle_test_3',
            name: 'Test Cycle 3',
            durationWeeks: 4,
            sessionsPerWeek: 3,
            startDate: '2026-08-20',
            endDate: '2026-09-16',
            routines: [{ routineId: 'routine_1', frequencyPerWeek: 1 }],
            createdAt: 1000
        };

        const { container } = render(
            <CycleEditor
                initialCycle={initialCycle}
                routines={mockRoutines}
                onSave={onSave}
                onCancel={onCancel}
            />
        );

        const startDateTextInput = container.querySelector('#cycle-start-date') as HTMLInputElement;
        const endDateTextInput = container.querySelector('#cycle-end-date') as HTMLInputElement;

        // Change start date to 2026-09-01 ('01/09/2026')
        // 4 weeks: 2026-09-01 + 27 days = 2026-09-28
        fireEvent.change(startDateTextInput, { target: { value: '01/09/2026' } });

        expect(endDateTextInput.value).toBe('28/09/2026');
    });

    it('Scenario 4: Text input blur auto-formats valid dates and recovers from invalid partial input', () => {
        const onSave = vi.fn();
        const onCancel = vi.fn();

        const initialCycle: TrainingCycle = {
            id: 'cycle_test_4',
            name: 'Test Cycle 4',
            durationWeeks: 4,
            sessionsPerWeek: 3,
            startDate: '2026-08-20',
            endDate: '2026-09-16',
            routines: [{ routineId: 'routine_1', frequencyPerWeek: 1 }],
            createdAt: 1000
        };

        const { container } = render(
            <CycleEditor
                initialCycle={initialCycle}
                routines={mockRoutines}
                onSave={onSave}
                onCancel={onCancel}
            />
        );

        const startDateTextInput = container.querySelector('#cycle-start-date') as HTMLInputElement;
        const endDateTextInput = container.querySelector('#cycle-end-date') as HTMLInputElement;

        // Type partial/invalid date in start date input
        fireEvent.change(startDateTextInput, { target: { value: 'invalid-date' } });
        expect(startDateTextInput.value).toBe('invalid-date');

        // On blur, it should recover to last valid formatted date (20/08/2026)
        fireEvent.blur(startDateTextInput);
        expect(startDateTextInput.value).toBe('20/08/2026');

        // Type partial/invalid date in end date input
        fireEvent.change(endDateTextInput, { target: { value: 'bad-text' } });
        expect(endDateTextInput.value).toBe('bad-text');

        // On blur, it should recover to last valid formatted end date (16/09/2026)
        fireEvent.blur(endDateTextInput);
        expect(endDateTextInput.value).toBe('16/09/2026');
    });

    it('Scenario 5: Calendar picker for Start Date updates text and recalculates End Date', () => {
        const onSave = vi.fn();
        const onCancel = vi.fn();

        const initialCycle: TrainingCycle = {
            id: 'cycle_test_5',
            name: 'Test Cycle 5',
            durationWeeks: 4,
            sessionsPerWeek: 3,
            startDate: '2026-08-20',
            endDate: '2026-09-16',
            routines: [{ routineId: 'routine_1', frequencyPerWeek: 1 }],
            createdAt: 1000
        };

        const { container } = render(
            <CycleEditor
                initialCycle={initialCycle}
                routines={mockRoutines}
                onSave={onSave}
                onCancel={onCancel}
            />
        );

        const dateInputs = container.querySelectorAll('input[type="date"]');
        const startCalendarInput = dateInputs[0] as HTMLInputElement;
        const startDateTextInput = container.querySelector('#cycle-start-date') as HTMLInputElement;
        const endDateTextInput = container.querySelector('#cycle-end-date') as HTMLInputElement;

        // Change start calendar to 2026-10-01
        fireEvent.change(startCalendarInput, { target: { value: '2026-10-01' } });

        expect(startDateTextInput.value).toBe('01/10/2026');
        // 2026-10-01 + 27 days = 2026-10-28
        expect(endDateTextInput.value).toBe('28/10/2026');
    });

    it('Scenario 6: [CRITICAL ADVERSARIAL] Calendar picker for End Date must NOT overwrite Start Date text', () => {
        const onSave = vi.fn();
        const onCancel = vi.fn();

        const initialCycle: TrainingCycle = {
            id: 'cycle_test_6',
            name: 'Test Cycle 6',
            durationWeeks: 4,
            sessionsPerWeek: 3,
            startDate: '2026-08-20',
            endDate: '2026-09-16',
            routines: [{ routineId: 'routine_1', frequencyPerWeek: 1 }],
            createdAt: 1000
        };

        const { container } = render(
            <CycleEditor
                initialCycle={initialCycle}
                routines={mockRoutines}
                onSave={onSave}
                onCancel={onCancel}
            />
        );

        const dateInputs = container.querySelectorAll('input[type="date"]');
        const endCalendarInput = dateInputs[1] as HTMLInputElement;
        const startDateTextInput = container.querySelector('#cycle-start-date') as HTMLInputElement;
        const endDateTextInput = container.querySelector('#cycle-end-date') as HTMLInputElement;
        const durationInput = container.querySelector('#cycle-duration-weeks') as HTMLInputElement;

        expect(startDateTextInput.value).toBe('20/08/2026');
        expect(endDateTextInput.value).toBe('16/09/2026');

        // User picks 2026-10-14 in the END date calendar picker
        fireEvent.change(endCalendarInput, { target: { value: '2026-10-14' } });

        // End date text must be 14/10/2026
        expect(endDateTextInput.value).toBe('14/10/2026');

        // Duration weeks should be 8
        expect(durationInput.value).toBe('8');

        // CRITICAL CHECK: Start date text MUST NOT have been overwritten by 14/10/2026!
        // In current CycleEditor.tsx line 171, setDateTextInput is wrongly called, causing startDateTextInput to be '14/10/2026'
        expect(startDateTextInput.value).toBe('20/08/2026');
    });

    it('Scenario 7: Form submission delivers sanitized TrainingCycle with startDate and endDate', async () => {
        const onSave = vi.fn();
        const onCancel = vi.fn();

        const { container } = render(
            <CycleEditor
                routines={mockRoutines}
                onSave={onSave}
                onCancel={onCancel}
            />
        );

        // Fill Name
        const nameInput = container.querySelector('#cycle-name') as HTMLInputElement;
        fireEvent.change(nameInput, { target: { value: 'Meso Forza Autunno' } });

        // Set Start Date to 01/10/2026
        const startDateTextInput = container.querySelector('#cycle-start-date') as HTMLInputElement;
        fireEvent.change(startDateTextInput, { target: { value: '01/10/2026' } });

        // Set Duration to 6 weeks -> End Date becomes 2026-11-11 ('11/11/2026')
        const durationInput = container.querySelector('#cycle-duration-weeks') as HTMLInputElement;
        fireEvent.change(durationInput, { target: { value: '6' } });

        // Add 2 routines
        const select = screen.getByRole('combobox');
        fireEvent.change(select, { target: { value: 'routine_1' } });
        fireEvent.change(select, { target: { value: 'routine_2' } });

        // Submit form
        const form = container.querySelector('form')!;
        fireEvent.submit(form);

        await waitFor(() => {
            expect(onSave).toHaveBeenCalledTimes(1);
            const saved: TrainingCycle = onSave.mock.calls[0][0];
            expect(saved.name).toBe('Meso Forza Autunno');
            expect(saved.startDate).toBe('2026-10-01');
            expect(saved.endDate).toBe('2026-11-11');
            expect(saved.durationWeeks).toBe(6);
            expect(saved.routines.length).toBe(2);
        });
    });

    it('Scenario 8: Validation alerts when Name or Routines are missing', async () => {
        const showAlertSpy = useDialogStore.getState().showAlert as any;
        showAlertSpy.mockClear();

        const onSave = vi.fn();
        const onCancel = vi.fn();

        const { container } = render(
            <CycleEditor
                routines={mockRoutines}
                onSave={onSave}
                onCancel={onCancel}
            />
        );

        // Submit without name (or spaces only)
        const nameInput = container.querySelector('#cycle-name') as HTMLInputElement;
        fireEvent.change(nameInput, { target: { value: '   ' } });
        const form = container.querySelector('form')!;
        fireEvent.submit(form);

        await waitFor(() => {
            expect(showAlertSpy).toHaveBeenCalledWith(expect.stringContaining('nome'));
            expect(onSave).not.toHaveBeenCalled();
        });

        showAlertSpy.mockClear();

        // Set name, but no routines
        fireEvent.change(nameInput, { target: { value: 'Ciclo Senza Schede' } });
        fireEvent.submit(form);

        await waitFor(() => {
            expect(showAlertSpy).toHaveBeenCalledWith(expect.stringContaining('almeno una scheda'));
            expect(onSave).not.toHaveBeenCalled();
        });
    });

    it('Scenario 9: Reordering and removing routines in CycleEditor', () => {
        const onSave = vi.fn();
        const onCancel = vi.fn();

        render(
            <CycleEditor
                routines={mockRoutines}
                onSave={onSave}
                onCancel={onCancel}
            />
        );

        const select = screen.getByRole('combobox');
        fireEvent.change(select, { target: { value: 'routine_1' } });
        fireEvent.change(select, { target: { value: 'routine_2' } });
        fireEvent.change(select, { target: { value: 'routine_3' } });

        expect(screen.getByText('Push Routine')).toBeDefined();
        expect(screen.getByText('Pull Routine')).toBeDefined();
        expect(screen.getByText('Legs Routine')).toBeDefined();

        // Move first routine down
        const moveDownBtns = screen.getAllByTitle('Sposta giù nella sequenza');
        fireEvent.click(moveDownBtns[0]);

        // Remove the middle routine
        const removeBtns = screen.getAllByTitle('Rimuovi scheda dalla sequenza');
        fireEvent.click(removeBtns[1]);

        expect(screen.queryByText('Push Routine')).toBeNull();
    });

    it('Scenario 10: Leap year boundary test (2024-02-28, 4 weeks -> 2024-03-26)', () => {
        const onSave = vi.fn();
        const onCancel = vi.fn();

        const initialCycle: TrainingCycle = {
            id: 'cycle_leap',
            name: 'Leap Year Cycle',
            durationWeeks: 4,
            sessionsPerWeek: 3,
            startDate: '2024-02-28',
            endDate: '2024-03-26',
            routines: [{ routineId: 'routine_1', frequencyPerWeek: 1 }],
            createdAt: 1000
        };

        const { container } = render(
            <CycleEditor
                initialCycle={initialCycle}
                routines={mockRoutines}
                onSave={onSave}
                onCancel={onCancel}
            />
        );

        const startDateTextInput = container.querySelector('#cycle-start-date') as HTMLInputElement;
        const endDateTextInput = container.querySelector('#cycle-end-date') as HTMLInputElement;

        expect(startDateTextInput.value).toBe('28/02/2024');
        expect(endDateTextInput.value).toBe('26/03/2024');
    });

    it('Scenario 11: Year transition edge test (2026-12-25, 4 weeks -> 2027-01-21)', () => {
        const onSave = vi.fn();
        const onCancel = vi.fn();

        const initialCycle: TrainingCycle = {
            id: 'cycle_year_transition',
            name: 'Year Transition Cycle',
            durationWeeks: 4,
            sessionsPerWeek: 3,
            startDate: '2026-12-25',
            endDate: '2027-01-21',
            routines: [{ routineId: 'routine_1', frequencyPerWeek: 1 }],
            createdAt: 1000
        };

        const { container } = render(
            <CycleEditor
                initialCycle={initialCycle}
                routines={mockRoutines}
                onSave={onSave}
                onCancel={onCancel}
            />
        );

        const startDateTextInput = container.querySelector('#cycle-start-date') as HTMLInputElement;
        const endDateTextInput = container.querySelector('#cycle-end-date') as HTMLInputElement;

        expect(startDateTextInput.value).toBe('25/12/2026');
        expect(endDateTextInput.value).toBe('21/01/2027');
    });

    it('Scenario 12: Rapid text input deletions and out-of-range weeks recovery', () => {
        const onSave = vi.fn();
        const onCancel = vi.fn();

        const initialCycle: TrainingCycle = {
            id: 'cycle_rapid',
            name: 'Rapid Cycle',
            durationWeeks: 4,
            sessionsPerWeek: 3,
            startDate: '2026-08-20',
            endDate: '2026-09-16',
            routines: [{ routineId: 'routine_1', frequencyPerWeek: 1 }],
            createdAt: 1000
        };

        const { container } = render(
            <CycleEditor
                initialCycle={initialCycle}
                routines={mockRoutines}
                onSave={onSave}
                onCancel={onCancel}
            />
        );

        const durationInput = container.querySelector('#cycle-duration-weeks') as HTMLInputElement;
        const endDateTextInput = container.querySelector('#cycle-end-date') as HTMLInputElement;

        // User clears duration input
        fireEvent.change(durationInput, { target: { value: '' } });
        expect(durationInput.value).toBe('');
        // End date remains stable
        expect(endDateTextInput.value).toBe('16/09/2026');

        // User enters '0'
        fireEvent.change(durationInput, { target: { value: '0' } });
        expect(durationInput.value).toBe('0');
        expect(endDateTextInput.value).toBe('16/09/2026');

        // User enters '12'
        fireEvent.change(durationInput, { target: { value: '12' } });
        // 2026-08-20 + (12 * 7 - 1) = 2026-08-20 + 83 days = 2026-11-11
        expect(endDateTextInput.value).toBe('11/11/2026');
    });
});
