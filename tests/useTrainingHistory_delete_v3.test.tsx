import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTrainingHistory } from '../src/hooks/useTrainingHistory';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';
import { UserDataSchema } from '../src/lib/schema';
import type { UserData } from '../src/types';

const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;

describe('useTrainingHistory deleteWorkout', () => {
    beforeEach(() => {
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
            userData: initial,
            localWorkout: { id: 'w-to-delete', routineName: 'Full Body', exercises: [] } as any,
            syncing: false,
            saveError: null,
            saveUserData: vi.fn(async (dataOrUpdater: any) => {
                const previous = useAppStore.getState().userData;
                const next = typeof dataOrUpdater === 'function' ? dataOrUpdater(previous) : dataOrUpdater;
                useAppStore.setState({ userData: next });
                return { ok: true, status: 'synced' } as const;
            }) as any
        });
        vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValue(true);
    });

    it('removes the workout, clears pains introduced by it, and clears matching localWorkout', async () => {
        const { result } = renderHook(() => useTrainingHistory());

        await act(async () => {
            await result.current.deleteWorkout('w-to-delete');
        });

        const state = useAppStore.getState();
        expect(state.userData?.history).toEqual([]);
        expect(state.userData?.activePains).toEqual(['shoulder']);
        expect(state.localWorkout).toBeNull();
        expect(state.saveUserData).toHaveBeenCalledTimes(1);
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
        expect(useAppStore.getState().saveUserData).not.toHaveBeenCalled();
    });
});
