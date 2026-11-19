import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { useAppStore } from '../../../src/store/useAppStore';
import { useDialogStore } from '../../../src/store/useDialogStore';
import type { WorkoutSession } from '../../../src/types';
import { protectedDeviceKey, readDeviceValueStrict, writeDeviceValue } from '../../../src/lib/sync/deviceStorage';
import { restoreSessionAfterHistoryEdit } from '../../../src/hooks/workout/historyEditorContext';
import { useWorkoutSetMutations } from '../../../src/hooks/workout/useWorkoutSetMutations';
import { readWorkoutTimerSnapshot, writeWorkoutTimerSnapshot } from '../../../src/lib/utils/timer';
import { writeWorkoutRecoveryDraft } from '../../../src/lib/sync/workoutRecoveryDraft';
import { isCurrentExerciseMutationTarget } from '../../../src/components/Training/session/exerciseMutationTarget';
import { useWorkoutSession } from '../../../src/hooks/useWorkoutSession';
import { commitDomainOperations, initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { installWorkoutLifecycleFixture, owner, renderOwnedWorkoutSession, workout, userData } from './workoutLifecycleFixture';

describe('Workout lifecycle durable recovery regressions', () => {
    installWorkoutLifecycleFixture();

    describe('Exercise identity, deletion cleanup and concurrent starts', () => {
    it('removes the confirmed exercise identity even if exercises are reordered in the dialog', async () => {
        const initial: WorkoutSession = { ...workout('exercise-race', true), exercises: [
            { id: 'first', exId: 'bench', sessionNote: '', sets: [{ id: 's1', kg: '40', reps: '8' }] },
            { id: 'second', exId: 'squat', sessionNote: '', sets: [{ id: 's2', kg: '60', reps: '5' }] },
        ] };
        useAppStore.setState({ localWorkout: initial });
        let confirm!: (decision: boolean) => void;
        const showConfirm = () => new Promise<boolean>(resolve => { confirm = resolve; });
        const update = (updater: (previous: WorkoutSession | null) => WorkoutSession | null) => {
            useAppStore.setState(state => ({ localWorkout: updater(state.localWorkout) }));
        };
        const { result } = renderHook(() => useWorkoutSetMutations({ setLocalWorkout: update, showConfirm }));
        const closePanels = vi.fn();
        let removal!: Promise<void>;
        act(() => { removal = result.current.removeActiveExercise(0, closePanels); });
        act(() => { useAppStore.setState({ localWorkout: { ...initial, exercises: [...initial.exercises].reverse() } }); });
        await act(async () => { confirm(true); await removal; });
        expect(useAppStore.getState().localWorkout?.exercises.map(ex => ex.id)).toEqual(['second']);
        expect(closePanels).toHaveBeenCalledExactlyOnceWith(1);
    });

    it('drops an obsolete post-session draft when the displayed session identity changes', async () => {
        await prepareUnlockedTestArchive(owner);
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
        const first = workout('post-first', true);
        const next = workout('post-next', true);
        useAppStore.setState({ userData: userData({ activeWorkout: first }), localWorkout: first });
        renderOwnedWorkoutSession();
        fireEvent.click(screen.getByRole('button', { name: 'Termina allenamento' }));
        expect(screen.getByText('Com’è andato l’allenamento?')).toBeDefined();
        act(() => { useAppStore.setState({ localWorkout: next, userData: userData({ activeWorkout: next }) }); });
        await waitFor(() => expect(screen.queryByText('Com’è andato l’allenamento?')).toBeNull());
        fireEvent.click(screen.getByRole('button', { name: 'Termina allenamento' }));
        await waitFor(() => expect(screen.getByText('Com’è andato l’allenamento?')).toBeDefined());
        expect(localStorage.getItem(protectedDeviceKey('draft:post-session:post-next', owner))).not.toBeNull();
    });

    it('does not revive a stale final-rating screen when A returns after its draft was removed', async () => {
        await prepareUnlockedTestArchive(owner);
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
        const first = workout('post-return-a', true);
        const second = workout('post-return-b', true);
        const name = 'draft:post-session:' + first.id;
        useAppStore.setState({ userData: userData({ activeWorkout: first }), localWorkout: first });
        renderOwnedWorkoutSession();

        fireEvent.click(screen.getByRole('button', { name: 'Termina allenamento' }));
        fireEvent.click(screen.getByRole('button', { name: 'Umore: 5 su 5' }));
        const previous = readDeviceValueStrict(name, owner);
        expect(previous).not.toBeNull();

        act(() => {
            useAppStore.setState({ localWorkout: second, userData: userData({ activeWorkout: second }) });
        });
        expect(screen.queryByRole('heading', { name: 'Com’è andato l’allenamento?' })).toBeNull();

        // Another editor removed A's verified device draft while B was displayed.
        writeWorkoutRecoveryDraft(name, owner, null, '3', previous);
        act(() => {
            useAppStore.setState({ localWorkout: first, userData: userData({ activeWorkout: first }) });
        });

        expect(screen.queryByRole('heading', { name: 'Com’è andato l’allenamento?' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Termina allenamento' })).toBeTruthy();
        expect(readDeviceValueStrict(name, owner)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Termina allenamento' }));
        expect(screen.getByRole('heading', { name: 'Com’è andato l’allenamento?' })).toBeTruthy();
        expect(readDeviceValueStrict(name, owner)).not.toBeNull();
    });

    it('does not reset the timer if the workout start never reaches IndexedDB', async () => {
        await prepareUnlockedTestArchive(owner);
        const pending = workout('start-should-fail');
        const initial = userData({ activeWorkout: pending });
        await initializeLocal(owner, initial);
        useAppStore.setState({ userData: initial, localWorkout: pending });
        const snapshot = { version: 1, state: 'running', startTime: 1000, accumulated: 250 };
        writeDeviceValue('timer', JSON.stringify(snapshot), owner);
        const originalSetter = useAppStore.getState().setSyncedLocalWorkout;
        useAppStore.setState({ setSyncedLocalWorkout: vi.fn(async () => { throw new Error('IndexedDB unavailable'); }) });
        vi.mocked(useDialogStore.getState().showAlert).mockResolvedValue();
        try {
            const { result } = renderHook(() => useWorkoutSession());
            await act(async () => {
                expect(await result.current.confirmWorkoutStart()).toBe(false);
            });
            expect(readWorkoutTimerSnapshot(owner)).toEqual(snapshot);
            expect((await readLocal(owner))?.data.activeWorkout?.globalStartTime).toBeUndefined();
        } finally {
            useAppStore.setState({ setSyncedLocalWorkout: originalSetter });
        }
    });

    it('preserves an abandoned historical editor context under the current consent epoch', async () => {
        await prepareUnlockedTestArchive(owner);
        if (owner.startsWith('user:')) localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
        const historical = workout('history-new', true);
        const live = workout('workout-live', true);
        const existing = JSON.stringify({ version: 1, editorId: 'other-editor',
            ...(owner.startsWith('user:') ? { consentRevision: 1 } : {}),
            suspended: workout('unrestored-workout', true) });
        writeDeviceValue('history-editor-context', existing, owner);
        useAppStore.setState({ localWorkout: live, userData: userData({ history: [historical], activeWorkout: live }) });
        vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValueOnce(true);
        const { result } = renderHook(() => useWorkoutSession());
        await act(async () => { expect(await result.current.startEditHistoricalWorkout(historical)).toBe(false); });
        expect(readDeviceValueStrict('history-editor-context', owner)).toBe(existing);
        expect(useAppStore.getState().localWorkout?.id).toBe(live.id);
    });

    it('does not restore history without the previously persisted suspended-session context', async () => {
        await prepareUnlockedTestArchive(owner);
        const editor = { ...workout('history-unproved', true), isEditingHistory: true };
        useAppStore.setState({ localWorkout: editor, userData: userData({ activeWorkout: workout('unproved-shadow', true) }) });
        await expect(restoreSessionAfterHistoryEdit(editor.id)).rejects.toThrow('Contesto editor storico mancante');
        expect(useAppStore.getState().localWorkout?.id).toBe(editor.id);
    });

    it('preserves a concurrent replacement of the historical editor context during cleanup', async () => {
        await prepareUnlockedTestArchive(owner);
        if (owner.startsWith('user:')) localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
        const editor = { ...workout('old-history-editor', true), isEditingHistory: true };
        const suspended = workout('suspended-during-history', true);
        const initial = userData({ activeWorkout: suspended });
        await initializeLocal(owner, initial);
        const original = JSON.stringify({ version: 1, editorId: editor.id,
            ...(owner.startsWith('user:') ? { consentRevision: 1 } : {}), suspended });
        const newer = JSON.stringify({ version: 1, editorId: 'newer-editor',
            ...(owner.startsWith('user:') ? { consentRevision: 1 } : {}),
            suspended: workout('newer-suspended-workout', true) });
        writeDeviceValue('history-editor-context', original, owner);
        useAppStore.setState({ userData: initial, localWorkout: editor });
        const unsubscribe = useAppStore.subscribe((state, previous) => {
            if (previous.localWorkout?.isEditingHistory && state.localWorkout?.id === suspended.id) {
                writeDeviceValue('history-editor-context', newer, owner);
            }
        });
        try {
            await act(async () => { await restoreSessionAfterHistoryEdit(editor.id); });
            expect(readDeviceValueStrict('history-editor-context', owner)).toBe(newer);
            expect(useAppStore.getState().saveError).toMatch(/contesto editor/);
        } finally { unsubscribe(); }
    });

    it('does not resurrect a suspended workout durably deleted in another tab', async () => {
        await prepareUnlockedTestArchive(owner);
        const previous = workout('closed-in-other-tab', true);
        const editor: WorkoutSession & { id: string } = { ...workout('history-being-edited', true), isEditingHistory: true };
        const initial = userData({ activeWorkout: previous });
        if (owner.startsWith('user:')) {
            localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
        }
        await initializeLocal(owner, initial);
        writeDeviceValue('history-editor-context', JSON.stringify({
            version: 1, editorId: editor.id,
            ...(owner.startsWith('user:') ? { consentRevision: 1 } : {}), suspended: previous,
        }), owner);
        await commitDomainOperations(owner, {
            type: 'active-workout.set', workout: null, deletedWorkoutId: previous.id,
        }, initial);
        useAppStore.setState({ userData: userData({}), localWorkout: editor });
        await act(async () => { await restoreSessionAfterHistoryEdit(editor.id); });
        expect(useAppStore.getState().localWorkout).toBeNull();
        expect(localStorage.getItem(protectedDeviceKey('history-editor-context', owner))).toBeNull();
    });

    it('preserves a suspended device workout with unsynced data over an unrelated durable active snapshot', async () => {
        await prepareUnlockedTestArchive(owner);
        const staleCloud = workout('old-cloud-snapshot', true);
        const suspended = workout('authoritative-device-session', true);
        const editor: WorkoutSession & { id: string } = { ...workout('edit-context', true), isEditingHistory: true };
        if (owner.startsWith('user:')) {
            localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
        }
        await initializeLocal(owner, userData({ activeWorkout: staleCloud }));
        writeDeviceValue('history-editor-context', JSON.stringify({
            version: 1, editorId: editor.id,
            ...(owner.startsWith('user:') ? { consentRevision: 1 } : {}), suspended,
        }), owner);
        useAppStore.setState({ userData: userData({ activeWorkout: staleCloud }), localWorkout: editor });
        await act(async () => { await restoreSessionAfterHistoryEdit(editor.id); });
        expect(useAppStore.getState().localWorkout?.id).toBe(suspended.id);
    });

    it('rejects stale exercise callback targets after reordering duplicate set IDs', () => {
        const original = workout('captured-workout', true);
        const first = { ...original.exercises[0], id: 'first-instance', sets: [{ id: 'shared-set', kg: '60', reps: '8' }] };
        const second = { ...original.exercises[0], id: 'second-instance', sets: [{ id: 'shared-set', kg: '70', reps: '6' }] };
        const initial = { ...original, exercises: [first, second] };
        useAppStore.setState({ localWorkout: initial });
        expect(isCurrentExerciseMutationTarget(original.id, 0, first.id)).toBe(true);
        useAppStore.setState({ localWorkout: { ...initial, exercises: [second, first] } });
        expect(isCurrentExerciseMutationTarget(original.id, 0, first.id)).toBe(false);
        expect(isCurrentExerciseMutationTarget(original.id, 1, first.id)).toBe(true);
        expect(isCurrentExerciseMutationTarget(original.id, 0, second.id)).toBe(true);
        expect(isCurrentExerciseMutationTarget('replacement-workout', 0, second.id)).toBe(false);
    });

    it('never removes a different last set inserted while confirming deletion', async () => {
        const first = workout('set-race', true);
        useAppStore.setState({ localWorkout: first });
        let confirm!: (decision: boolean) => void;
        const showConfirm = () => new Promise<boolean>(resolve => { confirm = resolve; });
        const update = (updater: (previous: WorkoutSession | null) => WorkoutSession | null) => {
            useAppStore.setState(state => ({ localWorkout: updater(state.localWorkout) }));
        };
        const { result } = renderHook(() => useWorkoutSetMutations({ setLocalWorkout: update, showConfirm }));
        let removal!: Promise<void>;
        act(() => { removal = result.current.removeLastSet(0); });
        act(() => {
            useAppStore.setState({ localWorkout: { ...first, exercises: [
                { ...first.exercises[0], sets: [...first.exercises[0].sets, { id: 'new-set', kg: '60', reps: '6' }] },
            ] } });
        });
        await act(async () => { confirm(true); await removal; });
        expect(useAppStore.getState().localWorkout?.exercises[0].sets.map(set => set.id)).toEqual(['s1', 'new-set']);
    });


    it('starts offline through the real workout setter and preserves the owner-scoped pending journal', async () => {
        if (owner.startsWith('user:')) localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
        await prepareUnlockedTestArchive(owner);
        const prepared = workout('offline-real-adapter');
        const initial = userData({ activeWorkout: prepared });
        await initializeLocal(owner, initial);
        useAppStore.setState({ userData: initial, dataOwner: owner, localWorkout: prepared });
        writeWorkoutTimerSnapshot({ version: 1, state: 'running', startTime: 1000, accumulated: 125 }, owner);

        const previousOnline = Object.getOwnPropertyDescriptor(navigator, 'onLine');
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
        try {
            const { result } = renderHook(() => useWorkoutSession());
            await act(async () => { expect(await result.current.confirmWorkoutStart()).toBe(true); });
            const durable = await readLocal(owner);
            expect(durable?.data.activeWorkout?.id).toBe(prepared.id);
            expect(durable?.data.activeWorkout?.globalStartTime).toBeGreaterThan(0);
            expect(durable?.pending.length).toBeGreaterThan(0);
            expect(durable?.pending.some(operation => operation.path.includes('activeWorkout'))).toBe(true);
            expect(useAppStore.getState().localWorkout?.globalStartTime).toBe(durable?.data.activeWorkout?.globalStartTime);
            expect(readWorkoutTimerSnapshot(owner).state).toBe('stopped');
            expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        } finally {
            if (previousOnline) Object.defineProperty(navigator, 'onLine', previousOnline);
            else Reflect.deleteProperty(navigator, 'onLine');
        }
    });

    it('accepts a cloud-pending start only when the exact workout was durably committed', async () => {
        await prepareUnlockedTestArchive(owner);
        const prepared = workout('offline-start');
        const initial = userData({ activeWorkout: prepared });
        await initializeLocal(owner, initial);
        useAppStore.setState({ userData: initial, dataOwner: owner, localWorkout: prepared });
        const originalSetter = useAppStore.getState().setSyncedLocalWorkout;
        const localPending = vi.fn(async (input: Parameters<typeof originalSetter>[0]) => {
            const started = typeof input === 'function' ? input(useAppStore.getState().localWorkout) : input;
            if (!started) throw new Error('Workout atteso non disponibile.');
            await commitDomainOperations(owner, { type: 'active-workout.set', workout: started }, initial);
            useAppStore.setState({ localWorkout: started, userData: userData({ activeWorkout: started }) });
            return { ok: false as const, status: 'local-pending' as const, error: new Error('offline') };
        });
        useAppStore.setState({ setSyncedLocalWorkout: localPending });
        try {
            const { result } = renderHook(() => useWorkoutSession());
            await act(async () => { expect(await result.current.confirmWorkoutStart()).toBe(true); });
            expect((await readLocal(owner))?.data.activeWorkout?.globalStartTime).toBeGreaterThan(0);
            expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        } finally { useAppStore.setState({ setSyncedLocalWorkout: originalSetter }); }
    });

    it('rejects a cloud-pending start if the matching IndexedDB write never happened', async () => {
        await prepareUnlockedTestArchive(owner);
        const prepared = workout('unproven-start');
        const initial = userData({ activeWorkout: prepared });
        await initializeLocal(owner, initial);
        useAppStore.setState({ userData: initial, dataOwner: owner, localWorkout: prepared });
        const originalSetter = useAppStore.getState().setSyncedLocalWorkout;
        useAppStore.setState({ setSyncedLocalWorkout: vi.fn(async (_input: Parameters<typeof originalSetter>[0]) => ({ ok: false as const, status: 'local-pending' as const, error: new Error('offline') })) });
        vi.mocked(useDialogStore.getState().showAlert).mockResolvedValue();
        try {
            const { result } = renderHook(() => useWorkoutSession());
            await act(async () => { expect(await result.current.confirmWorkoutStart()).toBe(false); });
            expect((await readLocal(owner))?.data.activeWorkout?.globalStartTime).toBeUndefined();
        } finally { useAppStore.setState({ setSyncedLocalWorkout: originalSetter }); }
    });

    it('never starts or resets the timer when the prepared IndexedDB workout has a different identity', async () => {
        await prepareUnlockedTestArchive(owner);
        const visible = workout('prepared-visible');
        const durable = workout('prepared-different');
        const initial = userData({ activeWorkout: durable });
        await initializeLocal(owner, initial);
        useAppStore.setState({ userData: initial, dataOwner: owner, localWorkout: visible });
        const snapshot = { version: 1, state: 'running', startTime: 1000, accumulated: 250 };
        writeDeviceValue('timer', JSON.stringify(snapshot), owner);
        const originalSetter = useAppStore.getState().setSyncedLocalWorkout;
        const forbiddenSetter = vi.fn(originalSetter);
        useAppStore.setState({ setSyncedLocalWorkout: forbiddenSetter });
        try {
            const { result } = renderHook(() => useWorkoutSession());
            await act(async () => { expect(await result.current.confirmWorkoutStart()).toBe(false); });
            expect(forbiddenSetter).not.toHaveBeenCalled();
            expect(readWorkoutTimerSnapshot(owner)).toEqual(snapshot);
            expect((await readLocal(owner))?.data.activeWorkout?.id).toBe(durable.id);
            expect(useAppStore.getState().localWorkout?.globalStartTime).toBeUndefined();
        } finally {
            useAppStore.setState({ setSyncedLocalWorkout: originalSetter });
        }
    });

    it('cleans up the deleted workout final rating draft after confirming local deletion', async () => {
        await prepareUnlockedTestArchive(owner);
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
        const target = workout('delete-final-rating', true);
        const initial = userData({ activeWorkout: target });
        await initializeLocal(owner, initial);
        useAppStore.setState({ userData: initial, dataOwner: owner, localWorkout: target });
        writeWorkoutRecoveryDraft('draft:post-session:' + target.id, owner, { draft: { workoutId: target.id } });
        vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValueOnce(true);
        const { result } = renderHook(() => useWorkoutSession());
        await act(async () => { expect(await result.current.deleteWorkout()).toBe(true); });
        expect((await readLocal(owner))?.data.activeWorkout).toBeNull();
        expect(readDeviceValueStrict('draft:post-session:' + target.id, owner)).toBeNull();
    });


    it('preserves a final-session draft modified by another tab after durable workout deletion', async () => {
        await prepareUnlockedTestArchive(owner);
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
        const target = workout('delete-concurrent-final', true);
        const initial = userData({ activeWorkout: target });
        await initializeLocal(owner, initial);
        useAppStore.setState({ userData: initial, dataOwner: owner, localWorkout: target });
        const name = 'draft:post-session:' + target.id;
        const original = writeWorkoutRecoveryDraft(name, owner, { draft: { workoutId: target.id, mood: '3' } }, '3');
        const originalDispatch = useAppStore.getState().dispatchDomainOperation;
        let competingRaw: string | null = null;
        useAppStore.setState({ dispatchDomainOperation: async (...args) => {
            const response = await originalDispatch(...args);
            competingRaw = writeWorkoutRecoveryDraft(name, owner,
                { draft: { workoutId: target.id, mood: '4' } }, '3', original);
            return response;
        } });
        vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValueOnce(true);
        try {
            const { result } = renderHook(() => useWorkoutSession());
            await act(async () => { expect(await result.current.deleteWorkout()).toBe(true); });
            expect((await readLocal(owner))?.data.activeWorkout).toBeNull();
            expect(readDeviceValueStrict(name, owner)).toBe(competingRaw);
            expect(useAppStore.getState().saveError).toMatch(/copia locale/i);
        } finally {
            useAppStore.setState({ dispatchDomainOperation: originalDispatch });
        }
    });

    it('serializes a rapid start after its preparation without requiring an explicit UI flush', async () => {
        if (owner.startsWith('user:')) localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
        await prepareUnlockedTestArchive(owner);
        const initial = userData({ activeWorkout: null });
        await initializeLocal(owner, initial);
        useAppStore.setState({ userData: initial, dataOwner: owner, localWorkout: null });
        const { result } = renderHook(() => useWorkoutSession());
        await act(async () => { await result.current.startFreeWorkout(); });
        const prepared = useAppStore.getState().localWorkout;
        expect(prepared?.id).toBeTruthy();
        await act(async () => { expect(await result.current.confirmWorkoutStart()).toBe(true); });
        const durable = await readLocal(owner);
        expect(durable?.data.activeWorkout?.id).toBe(prepared?.id);
        expect(durable?.data.activeWorkout?.globalStartTime).toBeGreaterThan(0);
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        expect(useDialogStore.getState().showAlert).not.toHaveBeenCalled();
    });
    });
});
