import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TrainingPlanning from '../src/components/Training/planning/TrainingPlanning';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';
import type { UserData } from '../src/types';

const originalDispatch = useAppStore.getState().dispatchDomainOperation;

const userData: UserData = {
    library: [],
    routines: [{ id: 'routine-1', name: 'Scheda A', exercises: [] }],
    trainingCycles: [{
        id: 'cycle-1',
        name: 'Ciclo persistente',
        durationWeeks: 4,
        sessionsPerWeek: 1,
        startDate: '2026-09-01',
        endDate: '2026-09-28',
        routines: [{ routineId: 'routine-1', frequencyPerWeek: 1 }],
        isActive: true
    }],
    activeCycleId: 'cycle-1'
};

describe('audit regression: TrainingPlanning persistence failures', () => {
    const showAlert = vi.mocked(useDialogStore.getState().showAlert);
    const dispatchDomainOperation = vi.fn().mockRejectedValue(new Error('write failed'));

    beforeEach(() => {
        showAlert.mockReset();
        showAlert.mockResolvedValue(undefined);
        dispatchDomainOperation.mockReset();
        dispatchDomainOperation.mockRejectedValue(new Error('write failed'));
        useAppStore.setState({
            userData: structuredClone(userData),
            dispatchDomainOperation
        });
        vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    });

    afterEach(() => {
        act(() => {
            useAppStore.setState({ dispatchDomainOperation: originalDispatch });
        });
        vi.restoreAllMocks();
    });

    it('keeps the editor open and shows retry feedback when saving fails', async () => {
        render(<TrainingPlanning />);

        fireEvent.click(screen.getByTitle('Opzioni'));
        fireEvent.click(screen.getByRole('menuitem', { name: /Modifica/i }));
        expect(screen.getByText(/Modifica ciclo/i)).toBeDefined();
        expect(screen.getByDisplayValue('Ciclo persistente')).toBeDefined();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Salva modifiche/i }));
        });

        await waitFor(() => expect(dispatchDomainOperation).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(showAlert).toHaveBeenCalledWith(
            'Salvataggio del ciclo non riuscito. Le modifiche sono ancora nel form: riprova.'
        ));

        expect(screen.getByText(/Modifica ciclo/i)).toBeDefined();
        expect(screen.getByDisplayValue('Ciclo persistente')).toBeDefined();
    });
});
