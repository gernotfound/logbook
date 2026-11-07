import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkoutReportModal from '../src/components/Training/WorkoutReportModal';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';
import type { WorkoutSession } from '../src/types';

const originalDispatch = useAppStore.getState().dispatchDomainOperation;
const workout: WorkoutSession = {
    id: 'workout-1',
    routineName: 'Allenamento libero',
    date: '2026-11-07',
    exercises: [{
        id: 'session-exercise-1',
        exId: 'exercise-1',
        sessionNote: '',
        sets: [{ id: 'set-1', kg: '20', reps: '10', done: true }],
    }],
};

describe('workout report routine-save durability', () => {
    const dispatch = vi.fn();
    const showAlert = vi.mocked(useDialogStore.getState().showAlert);

    beforeEach(() => {
        dispatch.mockReset();
        showAlert.mockReset();
        showAlert.mockResolvedValue(undefined);
        useAppStore.setState({ dispatchDomainOperation: dispatch });
    });

    afterEach(() => {
        useAppStore.setState({ dispatchDomainOperation: originalDispatch });
        vi.restoreAllMocks();
    });

    function openRoutineForm() {
        const onClose = vi.fn();
        render(<WorkoutReportModal workout={workout} history={[]} library={[]} fromEndWorkout onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'Salva come scheda' }));
        return onClose;
    }

    it.each([
        ['rejected Promise', () => dispatch.mockRejectedValueOnce(Object.assign(new Error('Network unavailable'), { code: 'unavailable' }))],
        ['resolved failed status', () => dispatch.mockResolvedValueOnce({
            ok: false, status: 'failed', error: Object.assign(new Error('Cloud quota exceeded'), { code: 'resource-exhausted' }),
        })],
    ])('keeps the draft open without claiming a local save after %s', async (_scenario, arrange) => {
        arrange();
        const onClose = openRoutineForm();
        fireEvent.click(screen.getByRole('button', { name: 'Salva', exact: true }));

        await waitFor(() => expect(showAlert).toHaveBeenCalledWith(expect.stringContaining('Salvataggio della scheda non confermato')));
        expect(screen.getByLabelText('Nome nuova scheda')).toBeDefined();
        expect(screen.getByRole('button', { name: 'Salva', exact: true })).toBeDefined();
        expect(onClose).not.toHaveBeenCalled();
        expect(showAlert).not.toHaveBeenCalledWith('Scheda salvata in locale (offline).');
    });

    it('closes the form only for a journal-confirmed local-pending result', async () => {
        dispatch.mockResolvedValueOnce({ ok: false, status: 'local-pending' });
        openRoutineForm();
        fireEvent.click(screen.getByRole('button', { name: 'Salva', exact: true }));
        await waitFor(() => expect(screen.queryByLabelText('Nome nuova scheda')).toBeNull());
        expect(showAlert).not.toHaveBeenCalled();
    });
});
