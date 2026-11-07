import { captureSession } from '../src/lib/sync/session';
import { prepareUnlockedTestArchive } from './secureVaultFixture';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTrainingHistory } from '../src/hooks/useTrainingHistory';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';
import { UserDataSchema } from '../src/lib/schema';
import type { UserData } from '../src/types';
import { applyDomainOperations, type DomainOperationBatch } from '../src/lib/sync/domainOperations';

const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;
const originalDispatchDomainOperation = useAppStore.getState().dispatchDomainOperation;

describe('useTrainingHistory deleteWorkout', () => {
    beforeEach(async () => {
        await prepareUnlockedTestArchive(captureSession().owner);
        vi.clearAllMocks();
        const initial = parse({
            history: [{
                id: 'w-to-delete',
                date: '2026-08-20',
                routineName: 'Full Body',
                duration: '40m',
                exercises: [],
                pains: ['knee']
            }],
            activePains: ['knee', 'shoulder']
        });

        useAppStore.setState({
            dataOwner: captureSession().owner,
            userData: initial,
            localWorkout: { id: 'w-to-delete', routineName: 'Full Body', exercises: [] },
            syncing: false,
            saveError: null,
            dispatchDomainOperation: vi.fn(async (operation: DomainOperationBatch) => {
                const previous = useAppStore.getState().userData;
                if (!previous) throw new Error('Dati utente non caricati');
                useAppStore.setState({ userData: applyDomainOperations(previous, operation) });
                return { ok: true, status: 'synced' } as const;
            })
        });
        vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValue(true);
    });

    afterEach(() => {
        act(() => {
            useAppStore.setState({ dispatchDomainOperation: originalDispatchDomainOperation });
        });
    });

    it('removes the workout, preserves recovery pains, and clears matching localWorkout', async () => {
        const { result } = renderHook(() => useTrainingHistory());

        await act(async () => {
            await result.current.deleteWorkout('w-to-delete');
        });

        const state = useAppStore.getState();
        expect(state.userData?.history).toEqual([]);
        expect(state.userData?.activePains).toEqual(['knee', 'shoulder']);
        expect(state.localWorkout).toBeNull();
        expect(state.dispatchDomainOperation).toHaveBeenCalledTimes(1);
        expect(state.dispatchDomainOperation).toHaveBeenCalledWith({
            type: 'history.delete',
            id: 'w-to-delete',
        });
    });

    it.each(['rejected-result', 'throw'] as const)(
        'preserves the local workout and history when deletion is not committed (%s)',
        async (failureMode) => {
            const dispatch = vi.mocked(useAppStore.getState().dispatchDomainOperation);
            const showAlert = vi.mocked(useDialogStore.getState().showAlert);
            const before = structuredClone(useAppStore.getState().userData);
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

            try {
                if (failureMode === 'rejected-result') {
                    dispatch.mockResolvedValueOnce({
                        ok: false,
                        status: 'rejected',
                        error: new Error('Local deletion not committed'),
                    });
                } else {
                    dispatch.mockRejectedValueOnce(new Error('IndexedDB write failed'));
                }
                const { result } = renderHook(() => useTrainingHistory());

                await act(async () => {
                    await result.current.deleteWorkout('w-to-delete');
                });

                expect(dispatch).toHaveBeenCalledTimes(1);
                expect(dispatch).toHaveBeenCalledWith({
                    type: 'history.delete',
                    id: 'w-to-delete',
                });
                expect(useAppStore.getState().userData).toEqual(before);
                expect(useAppStore.getState().localWorkout?.id).toBe('w-to-delete');
                expect(showAlert).toHaveBeenCalledWith("Errore durante l'eliminazione dell'allenamento.");
                expect(consoleError).toHaveBeenCalledWith(
                    'Eliminazione storico non completata:',
                    expect.any(Error),
                );
            } finally {
                consoleError.mockRestore();
            }
        },
    );

    it('leaves state untouched when confirmation is cancelled', async () => {
        vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValue(false);
        const before = structuredClone(useAppStore.getState().userData);
        const { result } = renderHook(() => useTrainingHistory());

        await act(async () => {
            await result.current.deleteWorkout('w-to-delete');
        });

        expect(useAppStore.getState().userData).toEqual(before);
        expect(useAppStore.getState().localWorkout?.id).toBe('w-to-delete');
        expect(useAppStore.getState().dispatchDomainOperation).not.toHaveBeenCalled();
    });
});
