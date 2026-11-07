import { captureSession, invalidateSession } from '../src/lib/sync/session';
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
            localWorkout: { id: 'w-to-delete', routineName: 'Full Body', exercises: [] } as any,
            syncing: false,
            saveError: null,
            dispatchDomainOperation: vi.fn(async (operation: DomainOperationBatch) => {
                const previous = useAppStore.getState().userData;
                if (!previous) throw new Error('Dati utente non caricati');
                useAppStore.setState({ userData: applyDomainOperations(previous, operation) });
                return { ok: true, status: 'synced' } as const;
            }) as any
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
    it('does not show an obsolete deletion failure after an Auth epoch replacement', async () => {
        let rejectOperation!: (reason: Error) => void;
        const pendingOperation = new Promise<never>((_, reject) => { rejectOperation = reject; });
        useAppStore.setState({
            dispatchDomainOperation: vi.fn(() => pendingOperation) as any,
        });
        const showAlert = vi.mocked(useDialogStore.getState().showAlert);
        const { result } = renderHook(() => useTrainingHistory());
        let deleting!: Promise<void>;
        act(() => { deleting = result.current.deleteWorkout('w-to-delete'); });
        await vi.waitFor(() => expect(useAppStore.getState().dispatchDomainOperation).toHaveBeenCalledOnce());
        act(() => { invalidateSession(); invalidateSession(); });
        await act(async () => { rejectOperation(new Error('old session write failed')); await deleting; });
        expect(showAlert).not.toHaveBeenCalled();
        expect(useAppStore.getState().userData?.history).toHaveLength(1);
    });

});
