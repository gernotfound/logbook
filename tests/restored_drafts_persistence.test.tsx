import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useTrainingExercises } from '../src/hooks/useTrainingExercises';
import { useTrainingRoutines } from '../src/hooks/useTrainingRoutines';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict, writeDeviceValue } from '../src/lib/sync/deviceStorage';
import { writeWorkoutRecoveryDraft } from '../src/lib/sync/workoutRecoveryDraft';
import { prepareUnlockedTestArchive } from './secureVaultFixture';
import { localStorageMock } from './setup';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';
import { UserDataSchema } from '../src/lib/schema';
import { initializeLocal, readLocal } from '../src/lib/sync/localRepository';
import type { UserData } from '../src/types';
import { storageOwner } from '../src/lib/sync/session';

const initialStorageWrite = localStorageMock.setItem.getMockImplementation()!;

describe('restored owner-scoped drafts', () => {
    beforeEach(async () => {
        localStorageMock.setItem.mockImplementation(initialStorageWrite);
        localStorage.clear();
        await prepareUnlockedTestArchive(storageOwner());
        localStorage.setItem(`logbook:v2:${storageOwner()}:health-consent-generation`, '3');
        const initial = UserDataSchema.parse({}) as UserData;
        await initializeLocal(storageOwner(), initial);
        useAppStore.setState({
            userData: initial, dataOwner: storageOwner(),
            localPersistenceBlocked: false, syncHealth: 'synced', saveError: null,
        });
    });
    afterEach(() => vi.restoreAllMocks());

    it('does not clear the exercise draft before hydration is reflected in React state', () => {
        const key = deviceKey('draft_exercise', storageOwner());
        const draft = JSON.stringify({
            name: 'Draft exercise', notes: 'Keep me',
            trackingType: 'weight_reps', selectedMuscles: [], secondaryMuscles: [],
            isBodyweight: false, equipmentWeight: '20',
        });
        writeWorkoutRecoveryDraft('draft_exercise', storageOwner(), JSON.parse(draft));
        const remove = vi.spyOn(localStorageMock, 'removeItem');
        try {
            const { result, unmount } = renderHook(() => useTrainingExercises());
            expect(result.current.exName).toBe('Draft exercise');
            expect(localStorage.getItem(key)).toBeNull();
            expect(localStorage.getItem(protectedDeviceKey('draft_exercise', storageOwner()))).toMatch(/^tlb-sealed:v1:/);
            expect(JSON.parse(readDeviceValueStrict('draft_exercise', storageOwner())!)).toMatchObject({
                __logbookWorkoutRecoveryDraft: 1, owner: storageOwner(), name: 'draft_exercise',
                consentRevision: 3, data: JSON.parse(draft),
            });
            expect(remove).not.toHaveBeenCalledWith(protectedDeviceKey('draft_exercise', storageOwner()));
            unmount();
        } finally {
            remove.mockRestore();
        }
    });

    it('does not clear the routine draft before hydration is reflected in React state', () => {
        const key = deviceKey('draft_routine', storageOwner());
        const draft = JSON.stringify({ name: 'Draft routine', exercises: [] });
        writeWorkoutRecoveryDraft('draft_routine', storageOwner(), JSON.parse(draft));
        const remove = vi.spyOn(localStorageMock, 'removeItem');
        try {
            const { result, unmount } = renderHook(() => useTrainingRoutines());
            expect(result.current.routineName).toBe('Draft routine');
            expect(localStorage.getItem(key)).toBeNull();
            expect(localStorage.getItem(protectedDeviceKey('draft_routine', storageOwner()))).toMatch(/^tlb-sealed:v1:/);
            expect(JSON.parse(readDeviceValueStrict('draft_routine', storageOwner())!)).toMatchObject({
                __logbookWorkoutRecoveryDraft: 1, owner: storageOwner(), name: 'draft_routine',
                consentRevision: 3, data: JSON.parse(draft),
            });
            expect(remove).not.toHaveBeenCalledWith(protectedDeviceKey('draft_routine', storageOwner()));
            unmount();
        } finally {
            remove.mockRestore();
        }
    });
    it('retains the last sealed exercise draft and refuses business save when a later physical write fails', async () => {
        const owner = storageOwner();
        writeWorkoutRecoveryDraft('draft_exercise', owner, { name: 'Recovered exercise', notes: 'Last durable note' });
        const hook = renderHook(() => useTrainingExercises());
        const key = protectedDeviceKey('draft_exercise', owner);
        const before = localStorage.getItem(key);
        const originalSet = localStorageMock.setItem.getMockImplementation()!;
        const dispatch = vi.spyOn(useAppStore.getState(), 'dispatchDomainOperation');
        vi.spyOn(useDialogStore.getState(), 'showAlert').mockResolvedValue(undefined);
        vi.spyOn(localStorageMock, 'setItem').mockImplementation((name, value) => {
            if (name === key) throw new DOMException('storage full', 'QuotaExceededError');
            originalSet(name, value);
        });

        act(() => hook.result.current.setExNotes('Only in memory'));
        expect(hook.result.current.exNotes).toBe('Only in memory');
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(localStorage.getItem(key)).toBe(before);
        await act(async () => { expect(await hook.result.current.handleSaveExercise()).toBe(false); });
        expect(dispatch).not.toHaveBeenCalled();
        expect((await readLocal(owner))?.data.library).toEqual([]);
        expect(localStorage.getItem(key)).toBe(before);
        hook.unmount();
    });

    it('commits an edited restored exercise through the durable domain boundary before clearing its draft', async () => {
        const owner = storageOwner();
        writeWorkoutRecoveryDraft('draft_exercise', owner, {
            name: 'Recovered exercise', notes: 'Recovered note',
            trackingType: 'weight_reps', selectedMuscles: [], secondaryMuscles: [],
            isBodyweight: false, equipmentWeight: '20',
        });
        const hook = renderHook(() => useTrainingExercises());
        expect(hook.result.current.exName).toBe('Recovered exercise');
        act(() => hook.result.current.setExNotes('Edited after recovery'));
        await act(async () => { expect(await hook.result.current.handleSaveExercise()).toBe(true); });

        const durable = await readLocal(owner);
        expect(durable?.data.library).toEqual([
            expect.objectContaining({ name: 'Recovered exercise', notes: 'Edited after recovery', equipmentWeight: 20 }),
        ]);
        expect(durable?.pending.length).toBeGreaterThan(0);
        expect(readDeviceValueStrict('draft_exercise', owner)).toBeNull();
        expect(hook.result.current.exName).toBe('');
        hook.unmount();
    });

    it('commits an edited restored routine before clearing its temporary copy', async () => {
        const owner = storageOwner();
        writeWorkoutRecoveryDraft('draft_routine', owner, { name: 'Recovered routine', exercises: [] });
        const hook = renderHook(() => useTrainingRoutines());
        expect(hook.result.current.routineName).toBe('Recovered routine');
        act(() => hook.result.current.setRoutineName('Edited recovered routine'));
        await act(async () => { expect(await hook.result.current.handleSave()).toBe(true); });

        const durable = await readLocal(owner);
        expect(durable?.data.routines).toEqual([
            expect.objectContaining({ name: 'Edited recovered routine', exercises: [] }),
        ]);
        expect(durable?.pending.length).toBeGreaterThan(0);
        expect(readDeviceValueStrict('draft_routine', owner)).toBeNull();
        expect(hook.result.current.routineName).toBe('');
        hook.unmount();
    });

    it('quarantines old exercise and routine drafts before hydration or mount cleanup', async () => {
        const owner = storageOwner();
        const marker = `logbook:v2:${owner}:health-consent-generation`;
        const exercise = JSON.stringify({ name: 'Deleted old exercise', notes: 'Old notes' });
        const routine = JSON.stringify({ name: 'Deleted old routine', exercises: [] });
        // An authentic sealed record with no known source revision remains
        // quarantined after a consent-epoch change, without losing its bytes.
        writeDeviceValue('draft_exercise', exercise, owner);
        writeDeviceValue('draft_routine', routine, owner);
        const exerciseCiphertext = localStorage.getItem(protectedDeviceKey('draft_exercise', owner));
        const routineCiphertext = localStorage.getItem(protectedDeviceKey('draft_routine', owner));
        localStorage.setItem(marker, '3');

        const ex = renderHook(() => useTrainingExercises());
        const rt = renderHook(() => useTrainingRoutines());
        expect(ex.result.current.exName).toBe('');
        expect(rt.result.current.routineName).toBe('');
        await waitFor(() => expect(useAppStore.getState().localPersistenceBlocked).toBe(true));
        expect(readDeviceValueStrict('draft_exercise', owner)).toBe(exercise);
        expect(readDeviceValueStrict('draft_routine', owner)).toBe(routine);
        expect(localStorage.getItem(protectedDeviceKey('draft_exercise', owner))).toBe(exerciseCiphertext);
        expect(localStorage.getItem(protectedDeviceKey('draft_routine', owner))).toBe(routineCiphertext);
        expect(localStorage.getItem(deviceKey('draft_exercise', owner))).toBeNull();
        expect(localStorage.getItem(deviceKey('draft_routine', owner))).toBeNull();
        ex.unmount();
        rt.unmount();
    });

    it('prevents an already mounted routine editor from committing old values after another tab advances consent', async () => {
        const owner = storageOwner();
        const marker = `logbook:v2:${owner}:health-consent-generation`;
        localStorage.setItem(marker, '3');
        const dispatch = vi.fn(async () => ({ ok: true as const, status: 'synced' as const }));
        const originalDispatch = useAppStore.getState().dispatchDomainOperation;
        const originalAlert = useDialogStore.getState().showAlert;
        useAppStore.setState({ dispatchDomainOperation: dispatch });
        useDialogStore.setState({ showAlert: vi.fn(async () => {}) });
        try {
            const { result, unmount } = renderHook(() => useTrainingRoutines());
            act(() => result.current.setRoutineName('Current routine'));
            const raw = readDeviceValueStrict('draft_routine', owner);
            expect(JSON.parse(raw!)).toMatchObject({
                __logbookWorkoutRecoveryDraft: 1, owner, name: 'draft_routine',
                consentRevision: 3, data: { name: 'Current routine' },
            });
            localStorage.setItem(marker, '5');
            await act(async () => {
                expect(await result.current.handleSave()).toBe(false);
            });
            expect(dispatch).not.toHaveBeenCalled();
            expect(readDeviceValueStrict('draft_routine', owner)).toBe(raw);
            expect(localStorage.getItem(deviceKey('draft_routine', owner))).toBeNull();
            expect(localStorage.getItem(protectedDeviceKey('draft_routine', owner))).toMatch(/^tlb-sealed:v1:/);
            unmount();
        } finally {
            useAppStore.setState({ dispatchDomainOperation: originalDispatch });
            useDialogStore.setState({ showAlert: originalAlert });
        }
    });

    it('prevents an already mounted exercise editor from committing old values after another tab advances consent', async () => {
        const owner = storageOwner();
        const marker = `logbook:v2:${owner}:health-consent-generation`;
        localStorage.setItem(marker, '3');
        const dispatch = vi.fn(async () => ({ ok: true as const, status: 'synced' as const }));
        const originalDispatch = useAppStore.getState().dispatchDomainOperation;
        const originalAlert = useDialogStore.getState().showAlert;
        useAppStore.setState({ dispatchDomainOperation: dispatch });
        useDialogStore.setState({ showAlert: vi.fn(async () => {}) });
        try {
            const { result, unmount } = renderHook(() => useTrainingExercises());
            act(() => result.current.setExName('Current exercise'));
            const raw = readDeviceValueStrict('draft_exercise', owner);
            expect(JSON.parse(raw!)).toMatchObject({
                __logbookWorkoutRecoveryDraft: 1, owner, name: 'draft_exercise',
                consentRevision: 3, data: { name: 'Current exercise' },
            });
            localStorage.setItem(marker, '5');
            await act(async () => {
                expect(await result.current.handleSaveExercise()).toBe(false);
            });
            expect(dispatch).not.toHaveBeenCalled();
            expect(readDeviceValueStrict('draft_exercise', owner)).toBe(raw);
            expect(localStorage.getItem(deviceKey('draft_exercise', owner))).toBeNull();
            expect(localStorage.getItem(protectedDeviceKey('draft_exercise', owner))).toMatch(/^tlb-sealed:v1:/);
            unmount();
        } finally {
            useAppStore.setState({ dispatchDomainOperation: originalDispatch });
            useDialogStore.setState({ showAlert: originalAlert });
        }
    });

});
