import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';
import { UserDataSchema } from '../src/lib/schema';
import type { WorkoutSession, UserData } from '../src/types';
import { deviceKey, writeDeviceValue } from '../src/lib/sync/deviceStorage';
import { useTrainingHistory } from '../src/hooks/useTrainingHistory';
import { restoreSessionAfterHistoryEdit } from '../src/hooks/workout/historyEditorContext';
import { useWorkoutSetMutations } from '../src/hooks/workout/useWorkoutSetMutations';
import { captureSession } from '../src/lib/sync/session';
import { getInitialLocalWorkout } from '../src/store/slices/createWorkoutSlice';
import { readWorkoutTimerSnapshot } from '../src/lib/utils/timer';
import PreSessionCheckIn from '../src/components/Training/PreSessionCheckIn';
import TrainingSession from '../src/components/Training/TrainingSession';
import WorkoutTimer from '../src/components/Training/WorkoutTimer';
import { useWorkoutSession } from '../src/hooks/useWorkoutSession';
import { commitDomainOperations, initializeLocal, readLocal } from '../src/lib/sync/localRepository';
import { localStorageMock, renderWithProviders } from './setup';

function workout(id: string, started = false): WorkoutSession {
    return {
        id, date: '2026-10-09', routineName: 'Workout',
        ...(started ? { globalStartTime: Date.now() - 60_000 } : {}),
        exercises: [{ id: 'se1', exId: 'bench', name: 'Panca',
            sets: [{ id: 's1', reps: '8', kg: '50' }] }],
    };
}
function userData(data: Partial<UserData>): UserData {
    return UserDataSchema.parse(data) as unknown as UserData;
}

describe('Workout lifecycle durable recovery regressions', () => {
    let owner: string;
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
        owner = captureSession().owner;
        useAppStore.setState({
            userData: userData({}), dataOwner: owner, localWorkout: null,
            localPersistenceBlocked: false, syncHealth: 'synced',
            syncPresentation: 'normal', syncing: false, saveError: null,
            compatibilityStatus: 'ok',
        });
    });
    afterEach(() => vi.restoreAllMocks());

    it('keeps unreadable timer storage intact and blocks controls after React mount', () => {
        const key = deviceKey('timer', owner);
        localStorage.setItem(key, '{bad-json');
        renderWithProviders(<React.StrictMode><WorkoutTimer /></React.StrictMode>);
        expect(localStorage.getItem(key)).toBe('{bad-json');
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(screen.getByRole('button', { name: 'Avvia recupero' }).hasAttribute('disabled')).toBe(true);
    });

    it('keeps readiness UI and durable draft unchanged when a write fails', () => {
        render(<PreSessionCheckIn workoutId="readiness-1" onStart={vi.fn(async () => true)}
            onCancel={vi.fn(async () => true)} />);
        fireEvent.click(screen.getByRole('button', { name: 'Energia: 4 su 5' }));
        expect(screen.getByRole('button', { name: 'Energia: 4 su 5' }).getAttribute('aria-pressed')).toBe('true');
        const key = deviceKey('draft:pre-session:readiness-1', owner);
        const previous = localStorage.getItem(key);
        localStorageMock.setItem.mockImplementationOnce((written: string) => {
            if (written === key) throw new DOMException('full', 'QuotaExceededError');
        });
        fireEvent.click(screen.getByRole('button', { name: 'Energia: 5 su 5' }));
        expect(screen.getByRole('button', { name: 'Energia: 4 su 5' }).getAttribute('aria-pressed')).toBe('true');
        expect(localStorage.getItem(key)).toBe(previous);
    });

    it('preserves readiness draft if deletion is declined', async () => {
        const cancel = vi.fn(async () => false);
        render(<PreSessionCheckIn workoutId="readiness-2" onStart={vi.fn(async () => true)} onCancel={cancel} />);
        fireEvent.click(screen.getByRole('button', { name: 'Voglia di allenarti: 3 su 5' }));
        const key = deviceKey('draft:pre-session:readiness-2', owner);
        const saved = localStorage.getItem(key);
        fireEvent.click(screen.getByRole('button', { name: 'Annulla allenamento' }));
        await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
        expect(localStorage.getItem(key)).toBe(saved);
    });

    it('returns false when workout deletion confirmation is declined', async () => {
        const pending = workout('keep');
        useAppStore.setState({ userData: userData({ activeWorkout: pending }), localWorkout: pending });
        vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValueOnce(false);
        const { result } = renderHook(() => useWorkoutSession());
        let deleted = true;
        await act(async () => { deleted = await result.current.deleteWorkout(); });
        expect(deleted).toBe(false);
        expect(useAppStore.getState().localWorkout?.id).toBe('keep');
    });


    it('never deletes a replacement workout when confirmation belongs to another session', async () => {
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
        const active = workout('active', true);
        const old = workout('historical', true);
        const initialTimer = { version: 1, state: 'running', startTime: 1000, accumulated: 0 };
        localStorage.setItem(deviceKey('timer', owner), JSON.stringify(initialTimer));
        localStorage.setItem(deviceKey('workout', owner), JSON.stringify(active));
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
        const active = workout('shadow', true);
        const old = workout('old-shadow', true);
        useAppStore.setState({ userData: userData({ activeWorkout: active, history: [old] }), localWorkout: null });
        const { result } = renderHook(() => useWorkoutSession());
        await act(async () => { expect(await result.current.startEditHistoricalWorkout(old)).toBe(true); });
        await act(async () => { expect(await result.current.cancelHistoryEdit()).toBe(true); });
        expect(useAppStore.getState().localWorkout?.id).toBe('shadow');
    });

    it('does not stop an active timer if switching to the historical editor fails', async () => {
        const active = workout('original', true);
        const old = workout('old', true);
        localStorage.setItem(deviceKey('timer', owner),
            JSON.stringify({ version: 1, state: 'running', startTime: 1000, accumulated: 0 }));
        useAppStore.setState({ userData: userData({ activeWorkout: active, history: [old] }), localWorkout: active });
        const key = deviceKey('workout', owner);
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
    });

    it('does not resurrect a completed session from a stale device snapshot', () => {
        const finished = workout('completed', true);
        localStorage.setItem(deviceKey('workout', owner), JSON.stringify(finished));
        expect(getInitialLocalWorkout(owner, null, [finished])).toBeNull();
        expect(localStorage.getItem(deviceKey('workout', owner))).toBeNull();
    });

    it('does not discard an unfinished device-only workout while history is unrelated', () => {
        const prepared = workout('prepared');
        localStorage.setItem(deviceKey('workout', owner), JSON.stringify(prepared));
        expect(getInitialLocalWorkout(owner, null, [workout('other', true)])?.id).toBe('prepared');
    });


    it('recovers a durable deletion when the post-commit device cleanup fails', async () => {
        const deleted = workout('deleted-on-device', true);
        const initial = userData({ activeWorkout: deleted });
        await initializeLocal(owner, initial);
        const key = deviceKey('workout', owner);
        localStorage.setItem(key, JSON.stringify(deleted));
        useAppStore.setState({ userData: initial, localWorkout: deleted });
        vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValueOnce(true);
        vi.mocked(useDialogStore.getState().showAlert).mockResolvedValue();
        localStorageMock.removeItem.mockImplementationOnce(() => { throw new DOMException('blocked', 'SecurityError'); });

        const { result } = renderHook(() => useWorkoutSession());
        await act(async () => { expect(await result.current.deleteWorkout()).toBe(false); });

        const durable = await readLocal(owner);
        expect(durable?.data.activeWorkout).toBeNull();
        expect(durable?.lastClosedWorkoutId).toBe(deleted.id);
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(localStorage.getItem(key)).not.toBeNull();

        // Cold-boot uses the same durable owner envelope; the stale snapshot is retired.
        expect(getInitialLocalWorkout(owner, durable?.data.activeWorkout, durable?.data.history,
            durable?.lastClosedWorkoutId)).toBeNull();
        expect(localStorage.getItem(key)).toBeNull();
    });

    it('recovers a completed workout after a successful commit but failed device cleanup', async () => {
        const finished = workout('completed-on-device', true);
        const initial = userData({ activeWorkout: finished });
        await initializeLocal(owner, initial);
        const key = deviceKey('workout', owner);
        localStorage.setItem(key, JSON.stringify(finished));
        useAppStore.setState({ userData: initial, localWorkout: finished });
        vi.mocked(useDialogStore.getState().showAlert).mockResolvedValue();
        localStorageMock.removeItem.mockImplementationOnce(() => { throw new DOMException('blocked', 'SecurityError'); });

        const { result } = renderHook(() => useWorkoutSession());
        await act(async () => { expect(await result.current.endWorkout(false)).toBeNull(); });

        const durable = await readLocal(owner);
        expect(durable?.data.history?.filter(item => item.id === finished.id)).toHaveLength(1);
        expect(durable?.lastClosedWorkoutId).toBe(finished.id);
        expect(localStorage.getItem(key)).not.toBeNull();
        expect(getInitialLocalWorkout(owner, durable?.data.activeWorkout, durable?.data.history,
            durable?.lastClosedWorkoutId)).toBeNull();
        expect(localStorage.getItem(key)).toBeNull();
        expect(useDialogStore.getState().showAlert).toHaveBeenCalledWith(expect.stringContaining('salvato nello storico'));
    });


    it('rejects an older tab snapshot even after a different workout closes later', async () => {
        const abandoned = workout('deleted-from-another-tab', true);
        const later = workout('subsequent-completion', true);
        const initial = userData({ activeWorkout: abandoned });
        await initializeLocal(owner, initial);
        await commitDomainOperations(owner, {
            type: 'active-workout.set', workout: null, deletedWorkoutId: abandoned.id,
        }, initial);
        const afterDelete = (await readLocal(owner))!.data;
        await commitDomainOperations(owner, { type: 'active-workout.set', workout: later }, afterDelete);
        const afterStart = (await readLocal(owner))!.data;
        await commitDomainOperations(owner, {
            type: 'workout.complete', workout: later,
            expectedActiveWorkoutId: later.id, activePains: [],
        }, afterStart);
        const durable = (await readLocal(owner))!;
        expect(durable.lastClosedWorkoutId).toBe(later.id);
        expect(durable.closedWorkoutIds).toContain(abandoned.id);
        expect(durable.data.history.some(item => item.id === abandoned.id)).toBe(false);

        const key = deviceKey('workout', owner);
        // A suspended old tab can re-write the original device snapshot after B.
        localStorage.setItem(key, JSON.stringify(abandoned));
        expect(getInitialLocalWorkout(owner, durable.data.activeWorkout,
            durable.data.history, durable.lastClosedWorkoutId, durable.closedWorkoutIds)).toBeNull();
        expect(localStorage.getItem(key)).toBeNull();
    });


    it('keeps a completed session retired when the historical month was not loaded', () => {
        const previous = workout('older-completed', true);
        const stale = workout('newer-completed', true);
        const key = deviceKey('workout', owner);
        localStorage.setItem(key, JSON.stringify(previous));
        expect(getInitialLocalWorkout(owner, null, [], stale.id, [previous.id, stale.id])).toBeNull();
        expect(localStorage.getItem(key)).toBeNull();

        // A separately provided old cloud fallback also cannot reopen a closed identity.
        expect(getInitialLocalWorkout(owner, previous, [], stale.id, [previous.id, stale.id])).toBeNull();
        expect(localStorage.getItem(key)).toBeNull();
    });

    it('keeps post-session rating unchanged if its synchronous persistence fails', () => {
        const active = workout('post-write', true);
        useAppStore.setState({ userData: userData({ activeWorkout: active }), localWorkout: active });
        render(<TrainingSession />);
        fireEvent.click(screen.getByRole('button', { name: 'Termina allenamento' }));
        const key = deviceKey('draft:post-session:post-write', owner);
        const previous = localStorage.getItem(key);
        localStorageMock.setItem.mockImplementationOnce((written: string) => {
            if (written === key) throw new DOMException('full', 'QuotaExceededError');
        });
        fireEvent.click(screen.getByRole('button', { name: 'Umore: 5 su 5' }));
        expect(screen.getByRole('button', { name: 'Umore: 5 su 5' }).getAttribute('aria-pressed')).toBe('false');
        expect(localStorage.getItem(key)).toBe(previous);
    });
    it('refuses to open a history editor after the live workout changes during confirmation', async () => {
        const oldLive = workout('live-before-confirmation', true);
        const replacement = workout('replacement-session', true);
        const previous = workout('history-item', true);
        useAppStore.setState({ userData: userData({ history: [previous], activeWorkout: oldLive }), localWorkout: oldLive });
        let confirm!: (choice: boolean) => void;
        vi.mocked(useDialogStore.getState().showConfirm).mockImplementationOnce(
            () => new Promise(resolve => { confirm = resolve; }),
        );
        const { result } = renderHook(() => useWorkoutSession());
        let editing!: Promise<boolean>;
        act(() => { editing = result.current.startEditHistoricalWorkout(previous); });
        act(() => { useAppStore.setState({ localWorkout: replacement }); });
        await act(async () => { confirm(true); expect(await editing).toBe(false); });
        expect(useAppStore.getState().localWorkout?.id).toBe(replacement.id);
        expect(localStorage.getItem(deviceKey('history-editor-context', owner))).toBeNull();
    });

    it('keeps edits made during a pending history commit and refuses a concurrent cancel', async () => {
        const historical = workout('history-edit-target', true);
        const editor: WorkoutSession = { ...historical, isEditingHistory: true, originalHistoryId: historical.id };
        const originalDispatch = useAppStore.getState().dispatchDomainOperation;
        useAppStore.setState({ userData: userData({ history: [historical] }), localWorkout: editor });
        let complete!: (result: { ok: true; status: 'synced' }) => void;
        const mockedDispatch = vi.fn(() => new Promise<{ ok: true; status: 'synced' }>(resolve => { complete = resolve; }));
        useAppStore.setState({ dispatchDomainOperation: mockedDispatch });
        try {
            const { result } = renderHook(() => useWorkoutSession());
            let saving!: Promise<boolean>;
            act(() => { saving = result.current.saveHistoryEdit(); });
            expect(mockedDispatch).toHaveBeenCalledOnce();
            await act(async () => { expect(await result.current.cancelHistoryEdit()).toBe(false); });
            act(() => { useAppStore.setState({ localWorkout: { ...editor, routineName: 'Modifica più recente' } }); });
            await act(async () => { complete({ ok: true, status: 'synced' }); expect(await saving).toBe(false); });
            expect(useAppStore.getState().localWorkout?.routineName).toBe('Modifica più recente');
            expect(useAppStore.getState().localWorkout?.isEditingHistory).toBe(true);
        } finally {
            useAppStore.setState({ dispatchDomainOperation: originalDispatch });
        }
    });

    it('deleting a history item closes the editor and restores its suspended live workout', async () => {
        const historical = workout('history-to-delete', true);
        const suspended = workout('still-live', true);
        const editor: WorkoutSession = { ...historical, isEditingHistory: true, originalHistoryId: historical.id };
        await initializeLocal(owner, userData({ history: [historical], activeWorkout: suspended }));
        writeDeviceValue('history-editor-context', JSON.stringify({
            version: 1, editorId: historical.id, suspended,
        }), owner);
        useAppStore.setState({ userData: userData({ history: [historical], activeWorkout: suspended }), localWorkout: editor });
        vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValueOnce(true);
        const originalDispatch = useAppStore.getState().dispatchDomainOperation;
        useAppStore.setState({ dispatchDomainOperation: vi.fn(async () => {
            useAppStore.setState({ userData: userData({ activeWorkout: suspended }) });
            return { ok: true, status: 'synced' } as const;
        }) });
        try {
            const { result } = renderHook(() => useTrainingHistory());
            await act(async () => { await result.current.deleteWorkout(historical.id); });
            expect(useAppStore.getState().localWorkout?.id).toBe(suspended.id);
            expect(localStorage.getItem(deviceKey('history-editor-context', owner))).toBeNull();
        } finally {
            useAppStore.setState({ dispatchDomainOperation: originalDispatch });
        }
    });

    it('reports a completed history deletion separately from a failed editor recovery', async () => {
        const historical = workout('history-delete-recovery-error', true);
        const editor: WorkoutSession = { ...historical, isEditingHistory: true, originalHistoryId: historical.id };
        useAppStore.setState({ userData: userData({ history: [historical] }), localWorkout: editor });
        writeDeviceValue('history-editor-context', JSON.stringify({
            version: 1, editorId: 'another-editor', suspended: null,
        }), owner);
        vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValueOnce(true);
        vi.mocked(useDialogStore.getState().showAlert).mockResolvedValue();
        const originalDispatch = useAppStore.getState().dispatchDomainOperation;
        useAppStore.setState({ dispatchDomainOperation: vi.fn(async () => {
            useAppStore.setState({ userData: userData({ history: [] }) });
            return { ok: true, status: 'synced' } as const;
        }) });
        try {
            const { result } = renderHook(() => useTrainingHistory());
            await act(async () => { await result.current.deleteWorkout(historical.id); });
            expect(useAppStore.getState().userData?.history).toEqual([]);
            expect(useAppStore.getState().localWorkout?.id).toBe(editor.id);
            expect(useDialogStore.getState().showAlert).toHaveBeenCalledWith(expect.stringContaining('Allenamento eliminato'));
        } finally {
            useAppStore.setState({ dispatchDomainOperation: originalDispatch });
        }
    });

    it('removes the confirmed exercise identity even if exercises are reordered in the dialog', async () => {
        const initial: WorkoutSession = { ...workout('exercise-race', true), exercises: [
            { id: 'first', exId: 'bench', sets: [{ id: 's1', kg: '40', reps: '8' }] },
            { id: 'second', exId: 'squat', sets: [{ id: 's2', kg: '60', reps: '5' }] },
        ] };
        useAppStore.setState({ localWorkout: initial });
        let confirm!: (decision: boolean) => void;
        const showConfirm = () => new Promise<boolean>(resolve => { confirm = resolve; });
        const update = (updater: (previous: WorkoutSession | null) => WorkoutSession | null) => {
            useAppStore.setState(state => ({ localWorkout: updater(state.localWorkout) }));
        };
        const { result } = renderHook(() => useWorkoutSetMutations({ setLocalWorkout: update, showConfirm }));
        let removal!: Promise<void>;
        act(() => { removal = result.current.removeActiveExercise(0); });
        act(() => { useAppStore.setState({ localWorkout: { ...initial, exercises: [...initial.exercises].reverse() } }); });
        await act(async () => { confirm(true); await removal; });
        expect(useAppStore.getState().localWorkout?.exercises.map(ex => ex.id)).toEqual(['second']);
    });

    it('drops an obsolete post-session draft when the displayed session identity changes', async () => {
        const first = workout('post-first', true);
        const next = workout('post-next', true);
        useAppStore.setState({ userData: userData({ activeWorkout: first }), localWorkout: first });
        render(<TrainingSession />);
        fireEvent.click(screen.getByRole('button', { name: 'Termina allenamento' }));
        expect(screen.getByText('Com’è andato l’allenamento?')).toBeDefined();
        act(() => { useAppStore.setState({ localWorkout: next, userData: userData({ activeWorkout: next }) }); });
        await waitFor(() => expect(screen.queryByText('Com’è andato l’allenamento?')).toBeNull());
        fireEvent.click(screen.getByRole('button', { name: 'Termina allenamento' }));
        await waitFor(() => expect(screen.getByText('Com’è andato l’allenamento?')).toBeDefined());
        expect(localStorage.getItem(deviceKey('draft:post-session:post-next', owner))).not.toBeNull();
    });

    it('does not reset the timer if the workout start never reaches IndexedDB', async () => {
        const pending = workout('start-should-fail');
        const initial = userData({ activeWorkout: pending });
        await initializeLocal(owner, initial);
        useAppStore.setState({ userData: initial, localWorkout: pending });
        const timerKey = deviceKey('timer', owner);
        const snapshot = { version: 1, state: 'running', startTime: 1000, accumulated: 250 };
        localStorage.setItem(timerKey, JSON.stringify(snapshot));
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

    it('does not resurrect a suspended workout durably deleted in another tab', async () => {
        const previous = workout('closed-in-other-tab', true);
        const editor: WorkoutSession = { ...workout('history-being-edited', true), isEditingHistory: true };
        const initial = userData({ activeWorkout: previous });
        await initializeLocal(owner, initial);
        writeDeviceValue('history-editor-context', JSON.stringify({
            version: 1, editorId: editor.id, suspended: previous,
        }), owner);
        await commitDomainOperations(owner, {
            type: 'active-workout.set', workout: null, deletedWorkoutId: previous.id,
        }, initial);
        useAppStore.setState({ userData: userData({}), localWorkout: editor });
        await act(async () => { await restoreSessionAfterHistoryEdit(editor.id); });
        expect(useAppStore.getState().localWorkout).toBeNull();
        expect(localStorage.getItem(deviceKey('history-editor-context', owner))).toBeNull();
    });

    it('preserves a suspended device workout with unsynced data over an unrelated durable active snapshot', async () => {
        const staleCloud = workout('old-cloud-snapshot', true);
        const suspended = workout('authoritative-device-session', true);
        const editor: WorkoutSession = { ...workout('edit-context', true), isEditingHistory: true };
        await initializeLocal(owner, userData({ activeWorkout: staleCloud }));
        writeDeviceValue('history-editor-context', JSON.stringify({
            version: 1, editorId: editor.id, suspended,
        }), owner);
        useAppStore.setState({ userData: userData({ activeWorkout: staleCloud }), localWorkout: editor });
        await act(async () => { await restoreSessionAfterHistoryEdit(editor.id); });
        expect(useAppStore.getState().localWorkout?.id).toBe(suspended.id);
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

});
