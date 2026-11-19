import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAppStore } from '../../../src/store/useAppStore';
import { useDialogStore } from '../../../src/store/useDialogStore';
import type { WorkoutSession } from '../../../src/types';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict, writeDeviceValue } from '../../../src/lib/sync/deviceStorage';
import { invalidateSession } from '../../../src/lib/sync/session';
import { draftRegistry } from '../../../src/lib/utils/draftRegistry';
import { getInitialLocalWorkout } from '../../../src/store/slices/createWorkoutSlice';
import { readWorkoutTimerSnapshot } from '../../../src/lib/utils/timer';
import { useWorkoutSession } from '../../../src/hooks/useWorkoutSession';
import { initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { localStorageMock } from '../../setup';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { installWorkoutLifecycleFixture, owner, workout, userData, seedCurrentDeviceWorkout } from './workoutLifecycleFixture';

describe('Workout lifecycle durable recovery regressions', () => {
    installWorkoutLifecycleFixture();

    describe('Start, pause and session fencing', () => {
    it('refuses an oversized historical plan without publishing any local workout', async () => {
        const initial = userData({
            routines: [{ id: 'oversized', name: 'Importata', exercises: [
                { exId: 'bench', setsCount: 1, setPlans: [{ technique: 'cluster', segmentCount: 1_000_000_000 }] },
            ] }],
            activeWorkout: null,
        });
        useAppStore.setState({ userData: initial, dataOwner: owner, localWorkout: null });
        const alert = vi.mocked(useDialogStore.getState().showAlert);
        alert.mockResolvedValueOnce(undefined);
        const hook = renderHook(() => useWorkoutSession());
        await act(async () => { await hook.result.current.startWorkout('oversized'); });
        expect(useAppStore.getState().localWorkout).toBeNull();
        expect(alert).toHaveBeenCalledWith(expect.stringContaining('troppe serie o segmenti'));
        expect(useAppStore.getState().userData?.routines?.[0]?.exercises?.[0]?.setPlans?.[0]?.segmentCount)
            .toBe(1_000_000_000);
    });

    it('verifies the owner-scoped IndexedDB snapshot after starting a planned workout', async () => {
        if (owner.startsWith('user:')) localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
        await prepareUnlockedTestArchive(owner);
        const initial = userData({
            routines: [{ id: 'routine-durable', name: 'Durable routine', exercises: [] }],
            activeWorkout: null,
        });
        await initializeLocal(owner, initial);
        useAppStore.setState({ userData: initial, dataOwner: owner, localWorkout: null });

        const hook = renderHook(() => useWorkoutSession());
        await act(async () => {
            await hook.result.current.startWorkout('routine-durable');
            await useAppStore.getState().flushPendingSyncs();
        });

        const visible = useAppStore.getState().localWorkout;
        const durable = await readLocal(owner);
        expect(visible?.routineId).toBe('routine-durable');
        expect(durable?.data.activeWorkout?.id).toBe(visible?.id);
        expect(durable?.data.activeWorkout?.routineId).toBe('routine-durable');
        expect(localStorage.getItem(protectedDeviceKey('workout', owner))).not.toBeNull();
        expect(localStorage.getItem(deviceKey('workout', owner))).toBeNull();
    });

    it('never deletes a replacement workout when confirmation belongs to another session', async () => {
        await prepareUnlockedTestArchive(owner);
        const original = workout('original-confirmation', true);
        const replacement = workout('replacement-confirmation', true);
        const durable = userData({ activeWorkout: replacement });
        await initializeLocal(owner, durable);
        useAppStore.setState({ userData: durable, localWorkout: original });
        vi.mocked(useDialogStore.getState().showConfirm).mockImplementationOnce(async () => {
            useAppStore.setState({ localWorkout: replacement });
            return true;
        });
        const { result } = renderHook(() => useWorkoutSession());
        await act(async () => { expect(await result.current.deleteWorkout()).toBe(false); });
        expect(useAppStore.getState().localWorkout?.id).toBe(replacement.id);
        const stored = await readLocal(owner);
        expect(stored?.data.activeWorkout?.id).toBe(replacement.id);
        expect(stored?.closedWorkoutIds).toBeUndefined();
    });

    it('suspends and restores an active workout without clearing its timer or cloud shadow', async () => {
        if (owner.startsWith('user:')) localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
        await prepareUnlockedTestArchive(owner);
        const active = workout('active', true);
        const old = workout('historical', true);
        const initialTimer = { version: 1, state: 'running', startTime: 1000, accumulated: 0 };
        writeDeviceValue('timer', JSON.stringify(initialTimer), owner);
        seedCurrentDeviceWorkout(owner, active);
        useAppStore.setState({ userData: userData({ activeWorkout: active, history: [old] }), localWorkout: active });
        const { result } = renderHook(() => useWorkoutSession());

        let started = false;
        await act(async () => { started = await result.current.startEditHistoricalWorkout(old); });
        expect(started).toBe(true);
        expect(useAppStore.getState().localWorkout?.isEditingHistory).toBe(true);
        expect(useAppStore.getState().userData?.activeWorkout?.id).toBe('active');
        expect(readWorkoutTimerSnapshot(owner)).toEqual(initialTimer);

        // Rehydrate from the owner-scoped device snapshot while the editor is open.
        const reopened = getInitialLocalWorkout(owner, active, [old]);
        expect(reopened?.isEditingHistory).toBe(true);
        useAppStore.setState({ localWorkout: reopened });

        let canceled = false;
        await act(async () => { canceled = await result.current.cancelHistoryEdit(); });
        expect(canceled).toBe(true);
        expect(useAppStore.getState().localWorkout?.id).toBe('active');
        expect(getInitialLocalWorkout(owner, active, [old])?.id).toBe('active');
        expect(readWorkoutTimerSnapshot(owner)).toEqual(initialTimer);
    });

    it('restores a durable active shadow when the transient device state was absent', async () => {
        if (owner.startsWith('user:')) localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
        await prepareUnlockedTestArchive(owner);
        const active = workout('shadow', true);
        const old = workout('old-shadow', true);
        useAppStore.setState({ userData: userData({ activeWorkout: active, history: [old] }), localWorkout: null });
        const { result } = renderHook(() => useWorkoutSession());
        await act(async () => { expect(await result.current.startEditHistoricalWorkout(old)).toBe(true); });
        await act(async () => { expect(await result.current.cancelHistoryEdit()).toBe(true); });
        expect(useAppStore.getState().localWorkout?.id).toBe('shadow');
    });

    it('does not stop an active timer if switching to the historical editor fails', async () => {
        if (owner.startsWith('user:')) localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
        await prepareUnlockedTestArchive(owner);
        const active = workout('original', true);
        const old = workout('old', true);
        writeDeviceValue('timer', JSON.stringify({ version: 1, state: 'running', startTime: 1000, accumulated: 0 }), owner);
        useAppStore.setState({ userData: userData({ activeWorkout: active, history: [old] }), localWorkout: active });
        const key = protectedDeviceKey('workout', owner);
        // Context and workout are separate owner-scoped writes. Fail only the
        // second write so no persistent mock leaks into subsequent cases.
        localStorageMock.setItem.mockImplementationOnce(() => undefined);
        localStorageMock.setItem.mockImplementationOnce((written: string) => {
            if (written === key) throw new DOMException('blocked', 'SecurityError');
        });
        const { result } = renderHook(() => useWorkoutSession());
        // Failure may hit context write first; either way the original timer stays live.
        let started = true;
        await act(async () => { started = await result.current.startEditHistoricalWorkout(old); });
        expect(started).toBe(false);
        expect(readWorkoutTimerSnapshot(owner).state).toBe('running');
        expect(useAppStore.getState().localWorkout?.id).toBe('original');
        expect(readDeviceValueStrict('history-editor-context', owner)).toBeNull();
    });

    it('does not resurrect a completed session from a stale device snapshot', async () => {
        await prepareUnlockedTestArchive(owner);
        const finished = workout('completed', true);
        seedCurrentDeviceWorkout(owner, finished);
        expect(getInitialLocalWorkout(owner, null, [finished])).toBeNull();
        expect(localStorage.getItem(protectedDeviceKey('workout', owner))).toBeNull();
    });

    it('does not discard an unfinished device-only workout while history is unrelated', async () => {
        await prepareUnlockedTestArchive(owner);
        const prepared = workout('prepared');
        seedCurrentDeviceWorkout(owner, prepared);
        expect(getInitialLocalWorkout(owner, null, [workout('other', true)])?.id).toBe('prepared');
    });


    it('does not complete a workout after a same-owner authentication epoch change during confirmation', async () => {
        const original = workout('finish-old-auth-epoch', true);
        useAppStore.setState({ userData: userData({ activeWorkout: original }), dataOwner: owner, localWorkout: original });
        const previousDispatch = useAppStore.getState().dispatchDomainOperation;
        const dispatch = vi.fn(previousDispatch);
        useAppStore.setState({ dispatchDomainOperation: dispatch });
        let accept!: (value: boolean) => void;
        vi.mocked(useDialogStore.getState().showConfirm).mockImplementationOnce(
            () => new Promise(resolve => { accept = resolve; }),
        );
        try {
            const hook = renderHook(() => useWorkoutSession());
            let pending!: Promise<WorkoutSession | null>;
            act(() => { pending = hook.result.current.endWorkout(); });
            // A-B-A account transitions can restore the original UID and workout ID.
            invalidateSession();
            invalidateSession();
            await act(async () => { accept(true); expect(await pending).toBeNull(); });
            expect(dispatch).not.toHaveBeenCalled();
            expect(useAppStore.getState().localWorkout?.id).toBe(original.id);
        } finally {
            useAppStore.setState({ dispatchDomainOperation: previousDispatch });
        }
    });

    it('never completes a workout replaced while the finish confirmation is open', async () => {
        await prepareUnlockedTestArchive(owner);
        const original = workout('finish-confirm-original', true);
        const replacement = workout('finish-confirm-replacement', true);
        const initial = userData({ activeWorkout: original });
        await initializeLocal(owner, initial);
        useAppStore.setState({ userData: initial, dataOwner: owner, localWorkout: original });
        const previousDispatch = useAppStore.getState().dispatchDomainOperation;
        const mockedDispatch = vi.fn(previousDispatch);
        useAppStore.setState({ dispatchDomainOperation: mockedDispatch });
        vi.mocked(useDialogStore.getState().showConfirm).mockImplementationOnce(async () => {
            useAppStore.setState({ localWorkout: replacement });
            return true;
        });
        try {
            const hook = renderHook(() => useWorkoutSession());
            await act(async () => { expect(await hook.result.current.endWorkout()).toBeNull(); });
            expect(mockedDispatch).not.toHaveBeenCalled();
            expect(useAppStore.getState().localWorkout?.id).toBe(replacement.id);
            expect((await readLocal(owner))?.data.history?.some(w => w.id === original.id)).toBe(false);
            expect((await readLocal(owner))?.data.activeWorkout?.id).toBe(original.id);
        } finally {
            useAppStore.setState({ dispatchDomainOperation: previousDispatch });
        }
    });

    it.each(['finish', 'delete'] as const)(
        'suppresses obsolete %s error dialogs after a same-owner Auth epoch replacement',
        async action => {
            await prepareUnlockedTestArchive(owner);
            const active = workout('superseded-' + action, true);
            const initial = userData({ activeWorkout: active });
            await initializeLocal(owner, initial);
            useAppStore.setState({ userData: initial, dataOwner: owner, localWorkout: active });
            const previousDispatch = useAppStore.getState().dispatchDomainOperation;
            let reject!: (error: Error) => void;
            const dispatch = vi.fn((_operation: Parameters<typeof previousDispatch>[0]) =>
                new Promise<Awaited<ReturnType<typeof previousDispatch>>>((_resolve, fail) => { reject = fail; }));
            useAppStore.setState({ dispatchDomainOperation: dispatch });
            vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValueOnce(true);
            vi.mocked(useDialogStore.getState().showAlert).mockResolvedValue();
            try {
                const { result } = renderHook(() => useWorkoutSession());
                let pending!: Promise<unknown>;
                act(() => {
                    pending = action === 'finish'
                        ? result.current.endWorkout(false)
                        : result.current.deleteWorkout();
                });
                await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
                invalidateSession();
                invalidateSession();
                await act(async () => {
                    reject(new Error('obsolete asynchronous operation'));
                    await pending;
                });
                expect(useDialogStore.getState().showAlert).not.toHaveBeenCalled();
                expect(useAppStore.getState().localWorkout?.id).toBe(active.id);
            } finally {
                useAppStore.setState({ dispatchDomainOperation: previousDispatch });
            }
        },
    );

    it('does not quarantine a replacement Auth session when a stale draft flush fails', async () => {
        const active = workout('flush-obsolete-auth', true);
        useAppStore.setState({ userData: userData({ activeWorkout: active }), dataOwner: owner, localWorkout: active });
        const failOnFlush = () => {
            invalidateSession();
            throw new Error('Obsolete draft flush');
        };
        draftRegistry.register(failOnFlush);
        vi.mocked(useDialogStore.getState().showAlert).mockResolvedValue();
        try {
            const { result } = renderHook(() => useWorkoutSession());
            await act(async () => { expect(await result.current.endWorkout(false)).toBeNull(); });
            expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
            expect(useDialogStore.getState().showAlert).not.toHaveBeenCalled();
            expect(useAppStore.getState().localWorkout?.id).toBe(active.id);
        } finally {
            draftRegistry.unregister(failOnFlush);
        }
    });

    it('rejects a stale completion confirmation even when the same UID and workout ID return', async () => {
        await prepareUnlockedTestArchive(owner);
        const active = workout('finish-auth-epoch', true);
        const initial = userData({ activeWorkout: active });
        await initializeLocal(owner, initial);
        useAppStore.setState({ userData: initial, dataOwner: owner, localWorkout: active });
        const previousDispatch = useAppStore.getState().dispatchDomainOperation;
        const mockedDispatch = vi.fn(previousDispatch);
        useAppStore.setState({ dispatchDomainOperation: mockedDispatch });
        vi.mocked(useDialogStore.getState().showConfirm).mockImplementationOnce(async () => {
            // The new session can have the same identity and locally restored workout.
            invalidateSession();
            return true;
        });
        try {
            const hook = renderHook(() => useWorkoutSession());
            await act(async () => { expect(await hook.result.current.endWorkout()).toBeNull(); });
            expect(mockedDispatch).not.toHaveBeenCalled();
            expect(useAppStore.getState().localWorkout?.id).toBe(active.id);
            const durable = await readLocal(owner);
            expect(durable?.data.activeWorkout?.id).toBe(active.id);
            expect(durable?.data.history?.some(item => item.id === active.id)).toBe(false);
        } finally {
            useAppStore.setState({ dispatchDomainOperation: previousDispatch });
        }
    });
    });
});
