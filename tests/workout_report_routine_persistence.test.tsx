import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import WorkoutReportModal from '../src/components/Training/WorkoutReportModal';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';
import { classifySyncFailure } from '../src/lib/sync/syncFailure';
import type { SyncResult, WorkoutSession } from '../src/types';

const originalDispatch = useAppStore.getState().dispatchDomainOperation;
const workout: WorkoutSession = {
    id: 'report-save-workout',
    date: '2026-11-07',
    exercises: [{
        id: 'report-exercise',
        exId: 'bench',
        sessionNote: '',
        sets: [{ id: 'report-set', kg: '40', reps: '8' }],
    }],
};

beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ userData: null, dataOwner: null });
});

afterEach(() => {
    cleanup();
    useAppStore.setState({ dispatchDomainOperation: originalDispatch });
});

function openRoutineForm(result: SyncResult) {
    const dispatch = vi.fn<typeof originalDispatch>().mockResolvedValue(result);
    useAppStore.setState({ dispatchDomainOperation: dispatch });
    render(<WorkoutReportModal workout={workout} history={[]} library={[]} fromEndWorkout onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Salva come scheda' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome nuova scheda' }), { target: { value: 'Nuova scheda' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva', exact: true }));
    return dispatch;
}

describe('workout report routine persistence result', () => {
    it.each([
        ['failed', new Error('Unsafe delivery wrapper', {
            cause: Object.assign(new Error('Auth network'), { code: 'auth/network-request-failed' }),
        })],
        ['rejected', Object.assign(new Error('Transport wrapper', {
            cause: Object.assign(new Error('Denied'), { code: 'permission-denied' }),
        }), { code: 'deadline-exceeded' })],
    ] as const)('keeps the form when a %s result contains a network-looking error', async (status, error) => {
        const result = classifySyncFailure(error);
        expect(result.status).toBe(status);
        const dispatch = openRoutineForm(result);

        await waitFor(() => expect(useDialogStore.getState().showAlert).toHaveBeenCalledExactlyOnceWith(
            'Errore durante il salvataggio della scheda.',
        ));
        expect(dispatch).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            type: 'routine.upsert',
            routine: expect.objectContaining({ name: 'Nuova scheda' }),
        }));
        expect(screen.getByRole('textbox', { name: 'Nome nuova scheda' })).toHaveValue('Nuova scheda');
        expect(screen.getByRole('button', { name: 'Salva', exact: true })).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'Salva come scheda' })).not.toBeInTheDocument();
    });

    it.each([
        { ok: true, status: 'synced' },
        { ok: false, status: 'local-pending', error: new Error('Retained journal') },
    ] satisfies SyncResult[])('closes the form after a confirmed $status result', async result => {
        const dispatch = openRoutineForm(result);

        await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Nome nuova scheda' })).not.toBeInTheDocument());
        expect(dispatch).toHaveBeenCalledOnce();
        expect(screen.getByRole('button', { name: 'Salva come scheda' })).toBeInTheDocument();
        expect(useDialogStore.getState().showAlert).not.toHaveBeenCalled();
    });
});
