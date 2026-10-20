import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useTrainingExercises } from '../src/hooks/useTrainingExercises';
import { useTrainingRoutines } from '../src/hooks/useTrainingRoutines';
import { deviceKey, readDeviceValueStrict } from '../src/lib/sync/deviceStorage';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';
import { storageOwner } from '../src/lib/sync/session';

describe('restored owner-scoped drafts', () => {
    beforeEach(() => {
        localStorage.clear();
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
        localStorage.setItem(key, draft);
        const remove = vi.spyOn(Storage.prototype, 'removeItem');
        try {
            const { result, unmount } = renderHook(() => useTrainingExercises());
            expect(result.current.exName).toBe('Draft exercise');
            expect(localStorage.getItem(key)).not.toBeNull();
            expect(remove).not.toHaveBeenCalledWith(key);
            unmount();
        } finally {
            remove.mockRestore();
        }
    });

    it('does not clear the routine draft before hydration is reflected in React state', () => {
        const key = deviceKey('draft_routine', storageOwner());
        const draft = JSON.stringify({ name: 'Draft routine', exercises: [] });
        localStorage.setItem(key, draft);
        const remove = vi.spyOn(Storage.prototype, 'removeItem');
        try {
            const { result, unmount } = renderHook(() => useTrainingRoutines());
            expect(result.current.routineName).toBe('Draft routine');
            expect(localStorage.getItem(key)).not.toBeNull();
            expect(remove).not.toHaveBeenCalledWith(key);
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
        localStorage.setItem(deviceKey('draft_exercise', owner), exercise);
        localStorage.setItem(deviceKey('draft_routine', owner), routine);
        localStorage.setItem(marker, '3');

        const ex = renderHook(() => useTrainingExercises());
        const rt = renderHook(() => useTrainingRoutines());
        expect(ex.result.current.exName).toBe('');
        expect(rt.result.current.routineName).toBe('');
        await waitFor(() => expect(useAppStore.getState().localPersistenceBlocked).toBe(true));
        expect(readDeviceValueStrict('draft_exercise', owner)).toBe(exercise);
        expect(readDeviceValueStrict('draft_routine', owner)).toBe(routine);
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
            unmount();
        } finally {
            useAppStore.setState({ dispatchDomainOperation: originalDispatch });
            useDialogStore.setState({ showAlert: originalAlert });
        }
    });

});
