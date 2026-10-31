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
import { storageOwner } from '../src/lib/sync/session';

describe('restored owner-scoped drafts', () => {
    beforeEach(async () => {
        localStorage.clear();
        await prepareUnlockedTestArchive(storageOwner());
        useAppStore.setState({ localPersistenceBlocked: false, syncHealth: 'synced', saveError: null });
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
            expect(readDeviceValueStrict('draft_exercise', storageOwner())).toBe(draft);
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
            expect(readDeviceValueStrict('draft_routine', storageOwner())).toBe(draft);
            expect(remove).not.toHaveBeenCalledWith(protectedDeviceKey('draft_routine', storageOwner()));
            unmount();
        } finally {
            remove.mockRestore();
        }
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
