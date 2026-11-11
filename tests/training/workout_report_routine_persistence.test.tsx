import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import WorkoutReportModal from '../../src/components/Training/WorkoutReportModal';
import { useAppStore } from '../../src/store/useAppStore';
import { useDialogStore } from '../../src/store/useDialogStore';
import { classifySyncFailure } from '../../src/lib/sync/syncFailure';
import type { SyncResult, WorkoutSession } from '../../src/types';

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
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
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
        expect((screen.getByRole('textbox', { name: 'Nome nuova scheda' }) as HTMLInputElement).value).toBe('Nuova scheda');
        expect((screen.getByRole('button', { name: 'Salva' }) as HTMLButtonElement).disabled).toBe(false);
        expect(screen.queryByRole('button', { name: 'Salva come scheda' })).toBeNull();
    });

    it.each([
        { ok: true, status: 'synced' },
        { ok: false, status: 'local-pending', error: new Error('Retained journal') },
    ] satisfies SyncResult[])('closes the form after a confirmed $status result', async result => {
        const dispatch = openRoutineForm(result);

        await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Nome nuova scheda' })).toBeNull());
        expect(dispatch).toHaveBeenCalledOnce();
        expect(screen.getByRole('button', { name: 'Salva come scheda' })).not.toBeNull();
        expect(useDialogStore.getState().showAlert).not.toHaveBeenCalled();
    });
    it.each([
        { ok: true, status: 'synced' },
        { ok: false, status: 'local-pending', error: new Error('Journal retained') },
    ] satisfies SyncResult[])('dispatches a $status routine save only once during rapid activation', async result => {
        let complete!: (value: SyncResult) => void;
        const pending = new Promise<SyncResult>(resolve => { complete = resolve; });
        const dispatch = vi.fn<typeof originalDispatch>().mockReturnValue(pending);
        useAppStore.setState({ dispatchDomainOperation: dispatch });
        render(<WorkoutReportModal workout={workout} history={[]} library={[]} fromEndWorkout onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Salva come scheda' }));
        const save = screen.getByRole('button', { name: 'Salva' });

        // Two native activations before React commits the disabled state.
        act(() => {
            save.click();
            save.click();
        });
        expect(dispatch).toHaveBeenCalledOnce();

        await act(async () => { complete(result); });
        await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Nome nuova scheda' })).toBeNull());
        expect(dispatch).toHaveBeenCalledOnce();
        expect(useDialogStore.getState().showAlert).not.toHaveBeenCalled();
    });

    it('releases the synchronous guard after a rejected save so the user can retry', async () => {
        let complete!: (value: SyncResult) => void;
        const pending = new Promise<SyncResult>(resolve => { complete = resolve; });
        const dispatch = vi.fn<typeof originalDispatch>()
            .mockReturnValueOnce(pending)
            .mockResolvedValueOnce({ ok: true, status: 'synced' });
        useAppStore.setState({ dispatchDomainOperation: dispatch });
        render(<WorkoutReportModal workout={workout} history={[]} library={[]} fromEndWorkout onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Salva come scheda' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Nome nuova scheda' }), { target: { value: 'Scheda retry' } });
        const save = screen.getByRole('button', { name: 'Salva' });

        act(() => {
            save.click();
            save.click();
        });
        expect(dispatch).toHaveBeenCalledOnce();

        await act(async () => { complete(classifySyncFailure(new Error('Commit locale non confermato'))); });
        await waitFor(() => expect(useDialogStore.getState().showAlert).toHaveBeenCalledOnce());
        expect((screen.getByRole('button', { name: 'Salva' }) as HTMLButtonElement).disabled).toBe(false);

        fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
        await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Nome nuova scheda' })).toBeNull());
        expect(dispatch).toHaveBeenCalledTimes(2);
        expect(dispatch.mock.calls[1][0]).toMatchObject({ type: 'routine.upsert', routine: { name: 'Scheda retry' } });
    });

});
