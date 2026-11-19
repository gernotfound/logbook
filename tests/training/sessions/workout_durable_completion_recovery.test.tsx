import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, renderHook, screen } from '@testing-library/react';
import { useAppStore } from '../../../src/store/useAppStore';
import { useDialogStore } from '../../../src/store/useDialogStore';
import type { WorkoutSession } from '../../../src/types';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict, writeDeviceValue } from '../../../src/lib/sync/deviceStorage';
import { useTrainingHistory } from '../../../src/hooks/useTrainingHistory';
import { invalidateSession } from '../../../src/lib/sync/session';
import { getInitialLocalWorkout } from '../../../src/store/slices/createWorkoutSlice';
import { readWorkoutTimerSnapshot } from '../../../src/lib/utils/timer';
import { useWorkoutSession } from '../../../src/hooks/useWorkoutSession';
import { commitDomainOperations, initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { localStorageMock } from '../../setup';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { installWorkoutLifecycleFixture, owner, renderOwnedWorkoutSession, workout, userData, seedCurrentDeviceWorkout } from './workoutLifecycleFixture';

describe('Workout lifecycle durable recovery regressions', () => {
    installWorkoutLifecycleFixture();

    describe('Durable completion, recovery and historical edits', () => {
    it('retains a live workout, timer and final draft when completion commit is rejected', async () => {
        await prepareUnlockedTestArchive(owner);
        const pending = workout('finish-rejected', true);
        const initial = userData({ activeWorkout: pending });
        await initializeLocal(owner, initial);
        const snapshot = { version: 1, state: 'running', startTime: 1000, accumulated: 125 };
        writeDeviceValue('timer', JSON.stringify(snapshot), owner);
        const draftName = 'draft:post-session:' + pending.id;
        writeDeviceValue(draftName, JSON.stringify({ draft: { workoutId: pending.id } }), owner);
        useAppStore.setState({ userData: initial, dataOwner: owner, localWorkout: pending });
        const previousDispatch = useAppStore.getState().dispatchDomainOperation;
        useAppStore.setState({ dispatchDomainOperation: vi.fn(async () => ({
            ok: false as const, status: 'failed' as const, error: new Error('IndexedDB unavailable'),
        })) });
        try {
            const hook = renderHook(() => useWorkoutSession());
            await act(async () => { expect(await hook.result.current.endWorkout(false)).toBeNull(); });
            expect(useAppStore.getState().localWorkout?.id).toBe(pending.id);
            expect((await readLocal(owner))?.data.activeWorkout?.id).toBe(pending.id);
            expect((await readLocal(owner))?.data.history?.some(w => w.id === pending.id)).toBe(false);
            expect(readWorkoutTimerSnapshot(owner)).toEqual(snapshot);
            expect(readDeviceValueStrict(draftName, owner)).not.toBeNull();
        } finally {
            useAppStore.setState({ dispatchDomainOperation: previousDispatch });
        }
    });

    it('recovers a durable deletion when the post-commit device cleanup fails', async () => {
        await prepareUnlockedTestArchive(owner);
        const deleted = workout('deleted-on-device', true);
        const initial = userData({ activeWorkout: deleted });
        await initializeLocal(owner, initial);
        const key = protectedDeviceKey('workout', owner);
        seedCurrentDeviceWorkout(owner, deleted);
        useAppStore.setState({ userData: initial, localWorkout: deleted });
        vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValueOnce(true);
        vi.mocked(useDialogStore.getState().showAlert).mockResolvedValue();
        localStorageMock.removeItem.mockImplementationOnce(() => { throw new DOMException('blocked', 'SecurityError'); });

        const { result } = renderHook(() => useWorkoutSession());
        await act(async () => { expect(await result.current.deleteWorkout()).toBe(true); });

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
        await prepareUnlockedTestArchive(owner);
        const finished = workout('completed-on-device', true);
        const initial = userData({ activeWorkout: finished });
        await initializeLocal(owner, initial);
        const key = protectedDeviceKey('workout', owner);
        seedCurrentDeviceWorkout(owner, finished);
        useAppStore.setState({ userData: initial, localWorkout: finished });
        vi.mocked(useDialogStore.getState().showAlert).mockResolvedValue();
        localStorageMock.removeItem.mockImplementationOnce(() => { throw new DOMException('blocked', 'SecurityError'); });

        const { result } = renderHook(() => useWorkoutSession());
        await act(async () => { expect((await result.current.endWorkout(false))?.id).toBe(finished.id); });

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
        await prepareUnlockedTestArchive(owner);
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
        expect((durable.data.history ?? []).some(item => item.id === abandoned.id)).toBe(false);

        const key = protectedDeviceKey('workout', owner);
        // A concurrent tab can republish a stale device snapshot after B.
        seedCurrentDeviceWorkout(owner, abandoned);
        expect(getInitialLocalWorkout(owner, durable.data.activeWorkout,
            durable.data.history, durable.lastClosedWorkoutId, durable.closedWorkoutIds)).toBeNull();
        expect(localStorage.getItem(key)).toBeNull();
    });


    it('keeps a completed session retired when the historical month was not loaded', async () => {
        await prepareUnlockedTestArchive(owner);
        const previous = workout('older-completed', true);
        const stale = workout('newer-completed', true);
        const key = protectedDeviceKey('workout', owner);
        seedCurrentDeviceWorkout(owner, previous);
        expect(getInitialLocalWorkout(owner, null, [], stale.id, [previous.id, stale.id])).toBeNull();
        expect(localStorage.getItem(key)).toBeNull();

        // A separately provided old cloud fallback also cannot reopen a closed identity.
        expect(getInitialLocalWorkout(owner, previous, [], stale.id, [previous.id, stale.id])).toBeNull();
        expect(localStorage.getItem(key)).toBeNull();
    });

    it('recovers the same pending post-session answers after the screen is destroyed and remounted', async () => {
        await prepareUnlockedTestArchive(owner);
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
        const active = workout('post-reopen', true);
        useAppStore.setState({ userData: userData({ activeWorkout: active }), localWorkout: active });
        const key = protectedDeviceKey('draft:post-session:post-reopen', owner);

        const first = renderOwnedWorkoutSession();
        fireEvent.click(screen.getByRole('button', { name: 'Termina allenamento' }));
        fireEvent.click(screen.getByRole('button', { name: 'Umore: 5 su 5' }));
        const saved = localStorage.getItem(key);
        expect(saved).not.toBeNull();
        expect(localStorage.getItem(deviceKey('draft:post-session:post-reopen', owner))).toBeNull();
        expect(JSON.parse(readDeviceValueStrict('draft:post-session:post-reopen', owner)!).data.draft.mood).toBe('5');

        first.unmount();
        renderOwnedWorkoutSession();
        expect(screen.getByRole('heading', { name: 'Com’è andato l’allenamento?' })).toBeDefined();
        expect(screen.getByRole('button', { name: 'Umore: 5 su 5' }).getAttribute('aria-pressed')).toBe('true');
        expect(localStorage.getItem(key)).toBe(saved);
        expect(useAppStore.getState().localWorkout?.id).toBe(active.id);
    });

    it('blocks an unreadable post-session recovery without discarding its bytes', async () => {
        await prepareUnlockedTestArchive(owner);
        const active = workout('post-broken', true);
        const key = protectedDeviceKey('draft:post-session:post-broken', owner);
        writeDeviceValue('draft:post-session:post-broken', '{broken', owner);
        const sealed = localStorage.getItem(key);
        useAppStore.setState({ userData: userData({ activeWorkout: active }), localWorkout: active });
        renderOwnedWorkoutSession();
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(useAppStore.getState().syncHealth).toBe('failed');
        expect(readDeviceValueStrict('draft:post-session:post-broken', owner)).toBe('{broken');
        expect(localStorage.getItem(key)).toBe(sealed);
    });

    it('keeps post-session rating unchanged if its synchronous persistence fails', async () => {
        await prepareUnlockedTestArchive(owner);
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
        const active = workout('post-write', true);
        useAppStore.setState({ userData: userData({ activeWorkout: active }), localWorkout: active });
        renderOwnedWorkoutSession();
        fireEvent.click(screen.getByRole('button', { name: 'Termina allenamento' }));
        const key = protectedDeviceKey('draft:post-session:post-write', owner);
        const previous = localStorage.getItem(key);
        localStorageMock.setItem.mockImplementationOnce((written: string) => {
            if (written === key) throw new DOMException('full', 'QuotaExceededError');
        });
        fireEvent.click(screen.getByRole('button', { name: 'Umore: 5 su 5' }));
        expect(localStorage.getItem(key)).toBe(previous);
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(useAppStore.getState().syncHealth).toBe('failed');
        expect(screen.getByRole('heading', { name: 'Persistenza dell’allenamento non confermata' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Umore: 5 su 5' })).toBeNull();
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

    it('opens the current history version when the view passes an outdated item', async () => {
        await prepareUnlockedTestArchive(owner);
        if (owner.startsWith('user:')) localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
        const stale = { ...workout('stale-history-record', true), routineName: 'Prima versione' };
        const updated = { ...stale, routineName: 'Versione aggiornata' };
        useAppStore.setState({
            userData: userData({ history: [updated], activeWorkout: null }),
            localWorkout: null,
        });
        const { result } = renderHook(() => useWorkoutSession());
        await act(async () => {
            expect(await result.current.startEditHistoricalWorkout(stale)).toBe(true);
        });
        expect(useAppStore.getState().localWorkout).toMatchObject({
            id: stale.id, routineName: 'Versione aggiornata', isEditingHistory: true,
        });
        expect(stale.routineName).toBe('Prima versione');
    });

    it('refuses to open an editor when the history record changes during confirmation', async () => {
        await prepareUnlockedTestArchive(owner);
        if (owner.startsWith('user:')) localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
        const live = workout('live-while-history-changes', true);
        const stale = { ...workout('history-updated-during-confirmation', true), routineName: 'Prima versione' };
        useAppStore.setState({
            userData: userData({ history: [stale], activeWorkout: live }),
            localWorkout: live,
        });
        let confirm!: (choice: boolean) => void;
        vi.mocked(useDialogStore.getState().showConfirm).mockImplementationOnce(
            () => new Promise(resolve => { confirm = resolve; }),
        );
        const { result } = renderHook(() => useWorkoutSession());
        let opening!: Promise<boolean>;
        act(() => { opening = result.current.startEditHistoricalWorkout(stale); });
        act(() => {
            useAppStore.setState(state => ({
                userData: {
                    ...state.userData!,
                    history: (state.userData!.history ?? []).map(item => item.id === stale.id
                        ? { ...item, routineName: 'Versione aggiornata durante la conferma' }
                        : item),
                },
            }));
        });
        await act(async () => { confirm(true); expect(await opening).toBe(false); });
        expect(useAppStore.getState().localWorkout?.id).toBe(live.id);
        expect(useAppStore.getState().userData?.history?.find(item => item.id === stale.id)?.routineName)
            .toBe('Versione aggiornata durante la conferma');
        expect(readDeviceValueStrict('history-editor-context', owner)).toBeNull();
        expect(stale.routineName).toBe('Prima versione');
    });

    it('rejects invalid history duration before any durable history operation', async () => {
        const historical = workout('invalid-duration', true);
        const editor = {
            ...historical, isEditingHistory: true, originalHistoryId: historical.id,
            manualDurationStr: '00:90:00', globalDurationStr: '00:45:00',
        };
        const originalDispatch = useAppStore.getState().dispatchDomainOperation;
        const dispatch = vi.fn().mockResolvedValue({ ok: true, status: 'synced' });
        useAppStore.setState({
            userData: userData({ history: [historical] }),
            localWorkout: editor,
            dispatchDomainOperation: dispatch,
        });
        vi.mocked(useDialogStore.getState().showAlert).mockResolvedValue(undefined);
        try {
            const { result } = renderHook(() => useWorkoutSession());
            expect(result.current.manualDuration).toBe('00:90:00');
            let saved = true;
            await act(async () => { saved = await result.current.saveHistoryEdit(); });
            expect(saved).toBe(false);
            expect(dispatch).not.toHaveBeenCalled();
            expect(useDialogStore.getState().showAlert).toHaveBeenCalledWith(expect.stringContaining('Durata non valida'));
            expect(useAppStore.getState().localWorkout?.manualDurationStr).toBe('00:90:00');
        } finally {
            useAppStore.setState({ dispatchDomainOperation: originalDispatch });
        }
    });

    it('keeps edits made during a pending history commit and refuses a concurrent cancel', async () => {
        const historical = workout('history-edit-target', true);
        const editor: WorkoutSession & { id: string } = { ...historical, isEditingHistory: true, originalHistoryId: historical.id };
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

    it('does not show an obsolete rejected history commit alert after Auth A→B→A', async () => {
        const historical = workout('history-old-session', true);
        const editor: WorkoutSession & { id: string } = {
            ...historical, isEditingHistory: true, originalHistoryId: historical.id,
        };
        const previousDispatch = useAppStore.getState().dispatchDomainOperation;
        let complete!: (result: { ok: false; status: 'failed'; error: Error }) => void;
        const mockedDispatch = vi.fn(() => new Promise<{ ok: false; status: 'failed'; error: Error }>(
            resolve => { complete = resolve; },
        ));
        useAppStore.setState({
            userData: userData({ history: [historical] }), localWorkout: editor,
            dispatchDomainOperation: mockedDispatch,
        });
        const alert = vi.mocked(useDialogStore.getState().showAlert);
        alert.mockClear();
        try {
            const { result } = renderHook(() => useWorkoutSession());
            let saving!: Promise<boolean>;
            act(() => { saving = result.current.saveHistoryEdit(); });
            expect(mockedDispatch).toHaveBeenCalledOnce();
            act(() => { invalidateSession(); invalidateSession(); });
            await act(async () => {
                complete({ ok: false, status: 'failed', error: new Error('obsolete write rejection') });
                expect(await saving).toBe(false);
            });
            expect(alert).not.toHaveBeenCalled();
            expect(useAppStore.getState().localWorkout?.id).toBe(editor.id);
        } finally {
            useAppStore.setState({ dispatchDomainOperation: previousDispatch });
        }
    });

    it('serializes overlapping history saves across separately mounted workout hooks', async () => {
        const historical = workout('shared-history-save', true);
        const editor: WorkoutSession & { id: string } = {
            ...historical, isEditingHistory: true, originalHistoryId: historical.id,
        };
        const dispatch = useAppStore.getState().dispatchDomainOperation;
        useAppStore.setState({ userData: userData({ history: [historical] }), localWorkout: editor });
        let finish!: (result: { ok: true; status: 'synced' }) => void;
        const mockedDispatch = vi.fn(() => new Promise<{ ok: true; status: 'synced' }>(resolve => { finish = resolve; }));
        useAppStore.setState({ dispatchDomainOperation: mockedDispatch });
        try {
            const first = renderHook(() => useWorkoutSession());
            const second = renderHook(() => useWorkoutSession());
            let pending!: Promise<boolean>;
            act(() => { pending = first.result.current.saveHistoryEdit(); });
            expect(mockedDispatch).toHaveBeenCalledTimes(1);
            await act(async () => {
                expect(await second.result.current.saveHistoryEdit()).toBe(false);
                expect(await second.result.current.cancelHistoryEdit()).toBe(false);
            });
            expect(mockedDispatch).toHaveBeenCalledTimes(1);
            act(() => {
                useAppStore.setState({ localWorkout: { ...editor, routineName: 'Modifica concorrente' } });
            });
            await act(async () => { finish({ ok: true, status: 'synced' }); expect(await pending).toBe(false); });
            expect(useAppStore.getState().localWorkout?.routineName).toBe('Modifica concorrente');
            expect(useAppStore.getState().localWorkout?.isEditingHistory).toBe(true);

            // A completed attempt releases the owner-wide lock, not just the component state.
            let retry!: Promise<boolean>;
            act(() => { retry = second.result.current.saveHistoryEdit(); });
            expect(mockedDispatch).toHaveBeenCalledTimes(2);
            act(() => { useAppStore.setState({ localWorkout: { ...editor, routineName: 'Ancora modificato' } }); });
            await act(async () => { finish({ ok: true, status: 'synced' }); expect(await retry).toBe(false); });
        } finally {
            useAppStore.setState({ dispatchDomainOperation: dispatch });
        }
    });

    it('deleting a history item closes the editor and restores its suspended live workout', async () => {
        await prepareUnlockedTestArchive(owner);
        const historical = workout('history-to-delete', true);
        const suspended = workout('still-live', true);
        const editor: WorkoutSession & { id: string } = { ...historical, isEditingHistory: true, originalHistoryId: historical.id };
        if (owner.startsWith('user:')) {
            localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
        }
        await initializeLocal(owner, userData({ history: [historical], activeWorkout: suspended }));
        writeDeviceValue('history-editor-context', JSON.stringify({
            version: 1, editorId: historical.id,
            ...(owner.startsWith('user:') ? { consentRevision: 1 } : {}), suspended,
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
            expect(localStorage.getItem(protectedDeviceKey('history-editor-context', owner))).toBeNull();
        } finally {
            useAppStore.setState({ dispatchDomainOperation: originalDispatch });
        }
    });

    it('distinguishes a committed history deletion from a later recovery failure', async () => {
        await prepareUnlockedTestArchive(owner);
        const historical = workout('history-delete-then-recovery-fails', true);
        const editor: WorkoutSession & { id: string } = { ...historical, isEditingHistory: true, originalHistoryId: historical.id };
        const initial = userData({ history: [historical] });
        await initializeLocal(owner, initial);
        writeDeviceValue('history-editor-context', '{invalid-json', owner);
        useAppStore.setState({ userData: initial, localWorkout: editor });
        vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValueOnce(true);
        vi.mocked(useDialogStore.getState().showAlert).mockResolvedValue();
        const { result } = renderHook(() => useTrainingHistory());
        await act(async () => { await result.current.deleteWorkout(historical.id); });
        expect((await readLocal(owner))?.data.history?.some(item => item.id === historical.id)).toBe(false);
        expect(useDialogStore.getState().showAlert).toHaveBeenCalledWith(
            expect.stringContaining('Allenamento eliminato dallo storico, ma'),
        );
    });
    });
});
