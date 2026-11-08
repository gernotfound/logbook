import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';
import { UserDataSchema } from '../src/lib/schema';
import type { WorkoutSession, UserData } from '../src/types';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict, writeDeviceValue } from '../src/lib/sync/deviceStorage';
import { useTrainingHistory } from '../src/hooks/useTrainingHistory';
import { restoreSessionAfterHistoryEdit } from '../src/hooks/workout/historyEditorContext';
import { useWorkoutSetMutations } from '../src/hooks/workout/useWorkoutSetMutations';
import { captureSession, invalidateSession } from '../src/lib/sync/session';
import { draftRegistry } from '../src/lib/utils/draftRegistry';
import { getInitialLocalWorkout } from '../src/store/slices/createWorkoutSlice';
import { persistPlainWorkoutSnapshot } from '../src/lib/sync/workoutDeviceIntent';
import { readWorkoutTimerSnapshot, writeWorkoutTimerSnapshot } from '../src/lib/utils/timer';
import { readWorkoutRecoveryDraft, writeWorkoutRecoveryDraft } from '../src/lib/sync/workoutRecoveryDraft';
import PreSessionCheckIn from '../src/components/Training/PreSessionCheckIn';
import TrainingSession from '../src/components/Training/TrainingSession';
import { isCurrentExerciseMutationTarget } from '../src/components/Training/session/exerciseMutationTarget';
import WorkoutTimer from '../src/components/Training/WorkoutTimer';
import { useWorkoutSession } from '../src/hooks/useWorkoutSession';
import { commitDomainOperations, initializeLocal, readLocal } from '../src/lib/sync/localRepository';
import { localStorageMock, renderWithProviders } from './setup';
import { prepareUnlockedTestArchive } from './secureVaultFixture';
import { AuthContext, defaultAuthContext } from '../src/contexts/AuthContextDef';
import { auth } from '../src/lib/firebase';

const renderOwnedWorkoutSession = () => render(
    <AuthContext.Provider value={{ ...defaultAuthContext, currentUser: auth.currentUser, isGuest: false }}>
        <TrainingSession />
    </AuthContext.Provider>,
);

function workout(id: string, started = false): WorkoutSession & { id: string } {
    return {
        id, date: '2026-10-09', routineName: 'Workout',
        ...(started ? { globalStartTime: Date.now() - 60_000 } : {}),
        exercises: [{ id: 'se1', exId: 'bench', sessionNote: '',
            sets: [{ id: 's1', reps: '8', kg: '50' }] }],
    };
}
function userData(data: Partial<UserData>): UserData {
    return UserDataSchema.parse(data) as unknown as UserData;
}

// These recovery cases simulate device copies written by the current account
// writer, not unsupported account snapshots from the pre-launch PWA.
function seedCurrentDeviceWorkout(owner: string, snapshot: WorkoutSession): void {
    const marker = `logbook:v2:${owner}:health-consent-generation`;
    if (owner.startsWith('user:') && localStorage.getItem(marker) === null) {
        localStorage.setItem(marker, '1');
    }
    persistPlainWorkoutSnapshot(snapshot, owner);
}

function advanceConsentAfterGuardRead(marker: string, next: string) {
    const prior = localStorageMock.getItem.getMockImplementation();
    if (!prior) throw new Error('Storage test implementation missing');
    let advanced = false;
    localStorageMock.getItem.mockImplementation((key: string) => {
        const value = prior(key);
        if (key === marker && !advanced) {
            advanced = true;
            // Simulate another tab publishing consent immediately after our guard read.
            localStorage.setItem(marker, next);
        }
        return value;
    });
    return {
        advanced: () => advanced,
        restore: () => localStorageMock.getItem.mockImplementation(prior),
    };
}

describe('Workout lifecycle durable recovery regressions', () => {
    let owner: string;
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
        // A failed case must not leave one-shot dialog outcomes for later tests.
        vi.mocked(useDialogStore.getState().showConfirm).mockReset().mockResolvedValue(true);
        vi.mocked(useDialogStore.getState().showAlert).mockReset().mockResolvedValue(undefined);
        owner = captureSession().owner;
        useAppStore.setState({
            userData: userData({}), dataOwner: owner, localWorkout: null,
            localPersistenceBlocked: false, syncHealth: 'synced',
            syncPresentation: 'normal', syncing: false, saveError: null,
            compatibilityStatus: 'ok',
        });
    });
    afterEach(() => vi.restoreAllMocks());

    it('does not treat an optimistic started snapshot as a confirmed local commit', async () => {
        await prepareUnlockedTestArchive(owner);
        const prepared = workout('optimistic-start');
        const optimistic = { ...prepared, globalStartTime: Date.now() };
        const state = userData({ activeWorkout: prepared });
        await initializeLocal(owner, state);
        useAppStore.setState({ userData: state, localWorkout: optimistic });
        vi.mocked(useDialogStore.getState().showAlert).mockResolvedValue(undefined);

        const hook = renderHook(() => useWorkoutSession());
        await act(async () => {
            expect(await hook.result.current.confirmWorkoutStart()).toBe(false);
        });

        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect((await readLocal(owner))?.data.activeWorkout?.globalStartTime).toBeUndefined();
        expect(useDialogStore.getState().showAlert).toHaveBeenCalledWith(
            expect.stringContaining('Impossibile confermare il salvataggio dell’avvio'),
        );
    });

    it('recognizes a previously started workout only with matching durable identity and timestamp', async () => {
        await prepareUnlockedTestArchive(owner);
        const started = workout('durable-start', true);
        const state = userData({ activeWorkout: started });
        await initializeLocal(owner, state);
        useAppStore.setState({ userData: state, localWorkout: started });
        const hook = renderHook(() => useWorkoutSession());

        await act(async () => {
            expect(await hook.result.current.confirmWorkoutStart()).toBe(true);
        });
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        expect((await readLocal(owner))?.data.activeWorkout?.globalStartTime).toBe(started.globalStartTime);

        useAppStore.setState({ localPersistenceBlocked: true });
        await act(async () => {
            expect(await hook.result.current.confirmWorkoutStart()).toBe(false);
        });
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
    });

    it('serializes overlapping workout starts across mounted hooks and unlocks after failure', async () => {
        const prepared = workout('concurrent-start');
        useAppStore.setState({ userData: userData({ activeWorkout: prepared }), localWorkout: prepared });
        const originalFlush = useAppStore.getState().flushPendingSyncs;
        let releaseFirst!: () => void;
        const flush = vi.fn()
            .mockImplementationOnce(() => new Promise<void>(resolve => { releaseFirst = resolve; }))
            .mockResolvedValue(undefined);
        vi.mocked(useDialogStore.getState().showAlert).mockResolvedValue(undefined);
        useAppStore.setState({ flushPendingSyncs: flush });
        try {
            const first = renderHook(() => useWorkoutSession());
            const second = renderHook(() => useWorkoutSession());
            let inFlight!: Promise<boolean>;
            act(() => { inFlight = first.result.current.confirmWorkoutStart(); });
            expect(flush).toHaveBeenCalledOnce();

            await act(async () => {
                expect(await second.result.current.confirmWorkoutStart()).toBe(false);
            });
            expect(flush).toHaveBeenCalledOnce();

            await act(async () => {
                releaseFirst();
                // No locally committed preparation exists, so the first start must fail closed.
                expect(await inFlight).toBe(false);
            });
            expect(flush).toHaveBeenCalledOnce();

            await act(async () => {
                expect(await second.result.current.confirmWorkoutStart()).toBe(false);
            });
            expect(flush).toHaveBeenCalledTimes(2);
        } finally {
            useAppStore.setState({ flushPendingSyncs: originalFlush });
        }
    });

    it('resets the current exercise UI when a running workout is replaced without unmounting TrainingSession', async () => {
        await prepareUnlockedTestArchive(owner);
        const exercises: WorkoutSession['exercises'] = [
            { id: 'ex-one', exId: 'bench', sessionNote: '', sets: [] },
            { id: 'ex-two', exId: 'squat', sessionNote: '', sets: [] },
        ];
        const first = { ...workout('running-a', true), routineName: 'First workout', exercises };
        const next = { ...workout('running-b', true), routineName: 'Second workout', exercises };
        const library = [
            { id: 'bench', name: 'Panca', setsCount: 0, sets: [], muscles: [], secondaryMuscles: [] },
            { id: 'squat', name: 'Squat', setsCount: 0, sets: [], muscles: [], secondaryMuscles: [] },
        ];
        useAppStore.setState({
            userData: userData({ activeWorkout: first, library }), dataOwner: owner,
            localWorkout: first,
        });
        renderOwnedWorkoutSession();
        const progress = screen.getByRole('progressbar', { name: 'Avanzamento nella sequenza degli esercizi' });
        expect(progress.getAttribute('aria-valuenow')).toBe('0');
        fireEvent.click(screen.getByRole('button', { name: /squat/i }));
        expect(progress.getAttribute('aria-valuenow')).toBe('100');

        // Replacing a live workout must also reset state held above the keyed accordion tree.
        act(() => useAppStore.setState({
            userData: userData({ activeWorkout: next, library }),
            localWorkout: next,
        }));
        expect(screen.getByRole('heading', { name: 'Second workout' })).toBeTruthy();
        expect(screen.getByRole('progressbar', { name: 'Avanzamento nella sequenza degli esercizi' })
            .getAttribute('aria-valuenow')).toBe('0');
    });

    it('blocks pre-launch plaintext timer at vault readiness without deleting its only copy', async () => {
        const key = deviceKey('timer', owner);
        const original = '{bad-json';
        localStorage.setItem(key, original);
        renderWithProviders(<React.StrictMode><WorkoutTimer /></React.StrictMode>);
        // Unsupported plaintext is refused during authenticated vault readiness,
        // before React can hydrate it or treat it as a current timer snapshot.
        const dialog = await screen.findByRole('alertdialog', { name: 'Archivio locale temporaneamente non disponibile' });
        expect(dialog.textContent).toContain('I dati originali sono conservati');
        expect(localStorage.getItem(key)).toBe(original);
        expect(localStorage.getItem(protectedDeviceKey('timer', owner))).toBeNull();
    });

    it('quarantines legacy readiness of an erased consent epoch without beginning a new workout', async () => {
        const marker = `logbook:v2:${owner}:health-consent-generation`;
        const key = deviceKey('draft:pre-session:old-checkin', owner);
        const original = '{"energy":4,"stress":2}';
        localStorage.setItem(key, original);
        localStorage.setItem(marker, '3');
        const onStart = vi.fn(async () => true);
        render(<PreSessionCheckIn workoutId="old-checkin" onStart={onStart} onCancel={vi.fn(async () => true)} />);
        await waitFor(() => expect(useAppStore.getState().localPersistenceBlocked).toBe(true));
        expect(screen.getByRole('button', { name: 'Energia: 4 su 5' }).getAttribute('aria-pressed')).toBe('false');
        fireEvent.click(screen.getByRole('button', { name: 'Salta check-in e inizia' }));
        await waitFor(() => expect(onStart).not.toHaveBeenCalled());
        expect(localStorage.getItem(key)).toBe(original);
        expect(localStorage.getItem(protectedDeviceKey('draft:pre-session:old-checkin', owner))).toBeNull();
    });

    it('stamps current readiness and refuses a stale mounted form after another tab advances consent', async () => {
        await prepareUnlockedTestArchive(owner);
        const marker = `logbook:v2:${owner}:health-consent-generation`;
        const name = 'draft:pre-session:live-checkin';
        localStorage.setItem(marker, '3');
        const onStart = vi.fn(async () => true);
        render(<PreSessionCheckIn workoutId="live-checkin" onStart={onStart} onCancel={vi.fn(async () => true)} />);
        fireEvent.click(screen.getByRole('button', { name: 'Energia: 4 su 5' }));
        const raw = readDeviceValueStrict(name, owner);
        expect(JSON.parse(raw!)).toMatchObject({
            __logbookWorkoutRecoveryDraft: 1, owner, name, consentRevision: 3, data: { energy: 4 },
        });
        localStorage.setItem(marker, '5');
        fireEvent.click(screen.getByRole('button', { name: 'Salta check-in e inizia' }));
        await waitFor(() => expect(useAppStore.getState().localPersistenceBlocked).toBe(true));
        expect(onStart).not.toHaveBeenCalled();
        expect(readDeviceValueStrict(name, owner)).toBe(raw);
    });

    it('does not reseal an already persisted pre-session check-in during repeated update flushes', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
        const name = 'draft:pre-session:checkin-noop-flush';
        const onStart = vi.fn(async () => true);
        render(<PreSessionCheckIn workoutId="checkin-noop-flush" onStart={onStart} onCancel={vi.fn(async () => true)} />);
        fireEvent.click(screen.getByRole('button', { name: 'Energia: 3 su 5' }));
        const originalRaw = readDeviceValueStrict(name, owner);
        const sealed = localStorage.getItem(protectedDeviceKey(name, owner));
        expect(originalRaw).toContain('"energy":3');
        expect(sealed).toMatch(/^tlb-sealed:v1:/);
        act(() => draftRegistry.flushAll({ strict: true }));
        act(() => draftRegistry.flushAll({ strict: true }));
        expect(readDeviceValueStrict(name, owner)).toBe(originalRaw);
        expect(localStorage.getItem(protectedDeviceKey(name, owner))).toBe(sealed);
        expect(onStart).not.toHaveBeenCalled();
    });

    it('refuses no-input update capture when a mounted pre-session draft belongs to a revoked epoch', async () => {
        await prepareUnlockedTestArchive(owner);
        const marker = `logbook:v2:${owner}:health-consent-generation`;
        localStorage.setItem(marker, '3');
        const name = 'draft:pre-session:stale-flush';
        render(<PreSessionCheckIn workoutId="stale-flush"
            onStart={vi.fn(async () => true)} onCancel={vi.fn(async () => true)} />);
        fireEvent.click(screen.getByRole('button', { name: 'Energia: 4 su 5' }));
        const raw = readDeviceValueStrict(name, owner);
        localStorage.setItem(marker, '5');
        expect(() => draftRegistry.flushAll({ strict: true })).toThrow(AggregateError);
        expect(readDeviceValueStrict(name, owner)).toBe(raw);
    });

    it('does not relabel a pre-session answer if another tab advances consent after the session guard', async () => {
        await prepareUnlockedTestArchive(owner);
        const marker = `logbook:v2:${owner}:health-consent-generation`;
        const name = 'draft:pre-session:guard-interleave';
        localStorage.setItem(marker, '3');
        render(<PreSessionCheckIn workoutId="guard-interleave"
            onStart={vi.fn(async () => true)} onCancel={vi.fn(async () => true)} />);
        const interleave = advanceConsentAfterGuardRead(marker, '5');
        try {
            fireEvent.click(screen.getByRole('button', { name: 'Energia: 4 su 5' }));
            expect(interleave.advanced()).toBe(true);
        } finally {
            interleave.restore();
        }
        expect(readDeviceValueStrict(name, owner)).toBeNull();
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(screen.getByRole('button', { name: 'Energia: 4 su 5' }).getAttribute('aria-pressed')).toBe('false');
    });

    it('does not resurrect a legacy final workout rating after consent revocation and reacceptance', async () => {
        await prepareUnlockedTestArchive(owner);
        const current = workout('old-final-rating', true);
        const name = 'draft:post-session:' + current.id;
        const original = JSON.stringify({ pendingEndTime: 1500, draft: {
            workoutId: current.id, mood: '5', pump: '', fatigue: '', water: '', pains: [],
        } });
        writeDeviceValue(name, original, owner);
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
        useAppStore.setState({ userData: userData({ activeWorkout: current }), localWorkout: current });
        renderOwnedWorkoutSession();
        await waitFor(() => expect(useAppStore.getState().localPersistenceBlocked).toBe(true));
        expect(readDeviceValueStrict(name, owner)).toBe(original);
        expect(() => writeWorkoutRecoveryDraft(name, owner, null)).toThrow('senza provenienza');
        expect(readDeviceValueStrict(name, owner)).toBe(original);
    });

    it('preserves the newer check-in revision and refuses stale start and edits under the same account', async () => {
        await prepareUnlockedTestArchive(owner);
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
        const name = 'draft:pre-session:concurrent-checkin';
        const onStart = vi.fn(async () => true);
        render(<PreSessionCheckIn workoutId="concurrent-checkin" onStart={onStart} onCancel={vi.fn(async () => true)} />);
        fireEvent.click(screen.getByRole('button', { name: 'Energia: 4 su 5' }));
        const first = readDeviceValueStrict(name, owner);
        expect(first).not.toBeNull();
        writeWorkoutRecoveryDraft(name, owner, { energy: 5 }, '3');
        const newer = readDeviceValueStrict(name, owner);
        expect(newer).not.toBe(first);

        fireEvent.click(screen.getByRole('button', { name: 'Energia: 3 su 5' }));
        expect(readDeviceValueStrict(name, owner)).toBe(newer);
        expect(screen.getByRole('button', { name: 'Energia: 4 su 5' }).getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(screen.getByRole('button', { name: 'Salta check-in e inizia' }));
        await waitFor(() => expect(useAppStore.getState().localPersistenceBlocked).toBe(true));
        expect(onStart).not.toHaveBeenCalled();
        expect(readDeviceValueStrict(name, owner)).toBe(newer);
    });

    it('does not overwrite a newer final rating or complete with an obsolete editor', async () => {
        await prepareUnlockedTestArchive(owner);
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
        const active = workout('post-concurrent', true);
        const name = 'draft:post-session:' + active.id;
        useAppStore.setState({ userData: userData({ activeWorkout: active }), localWorkout: active });
        renderOwnedWorkoutSession();
        fireEvent.click(screen.getByRole('button', { name: 'Termina allenamento' }));
        fireEvent.click(screen.getByRole('button', { name: 'Umore: 5 su 5' }));
        const original = JSON.parse(readDeviceValueStrict(name, owner)!);
        writeWorkoutRecoveryDraft(name, owner, {
            ...original.data,
            draft: { ...original.data.draft, mood: '2' },
        }, '3');
        const newer = readDeviceValueStrict(name, owner);
        fireEvent.click(screen.getByRole('button', { name: 'Salva e termina' }));
        await waitFor(() => expect(useAppStore.getState().localPersistenceBlocked).toBe(true));
        expect(readDeviceValueStrict(name, owner)).toBe(newer);
        expect(useAppStore.getState().localWorkout?.id).toBe(active.id);
        expect(useAppStore.getState().userData?.history?.some(item => item.id === active.id)).not.toBe(true);
    });

    it('preserves the source consent epoch of the current final rating against stale mounted edits', async () => {
        await prepareUnlockedTestArchive(owner);
        const current = workout('fresh-final-rating', true);
        const name = 'draft:post-session:' + current.id;
        const marker = `logbook:v2:${owner}:health-consent-generation`;
        localStorage.setItem(marker, '3');
        useAppStore.setState({ userData: userData({ activeWorkout: current }), localWorkout: current });
        renderOwnedWorkoutSession();
        fireEvent.click(screen.getByRole('button', { name: 'Termina allenamento' }));
        fireEvent.click(screen.getByRole('button', { name: 'Umore: 5 su 5' }));
        const raw = readDeviceValueStrict(name, owner);
        expect(JSON.parse(raw!)).toMatchObject({
            __logbookWorkoutRecoveryDraft: 1, owner, name, consentRevision: 3,
            data: { draft: { mood: '5', workoutId: current.id } },
        });
        localStorage.setItem(marker, '5');
        fireEvent.click(screen.getByRole('button', { name: 'Umore: 4 su 5' }));
        expect(readDeviceValueStrict(name, owner)).toBe(raw);
    });

    it('does not relabel a final-session draft if consent changes between the guard and device write', async () => {
        await prepareUnlockedTestArchive(owner);
        const current = workout('post-session-guard-interleave', true);
        const name = 'draft:post-session:' + current.id;
        const marker = `logbook:v2:${owner}:health-consent-generation`;
        localStorage.setItem(marker, '3');
        useAppStore.setState({ userData: userData({ activeWorkout: current }), localWorkout: current });
        renderOwnedWorkoutSession();
        const interleave = advanceConsentAfterGuardRead(marker, '5');
        try {
            fireEvent.click(screen.getByRole('button', { name: 'Termina allenamento' }));
            expect(interleave.advanced()).toBe(true);
        } finally {
            interleave.restore();
        }
        expect(readDeviceValueStrict(name, owner)).toBeNull();
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(screen.queryByRole('heading', { name: 'Com’è andato l’allenamento?' })).toBeNull();
    });

    it('keeps corrupted owner metadata in an old workout draft rather than overwriting it', async () => {
        await prepareUnlockedTestArchive(owner);
        const name = 'draft:pre-session:tampered';
        const raw = JSON.stringify({
            __logbookWorkoutRecoveryDraft: 1, owner: 'user:other',
            name, consentRevision: 3, data: { energy: 2 },
        });
        writeDeviceValue(name, raw, owner);
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
        expect(() => readWorkoutRecoveryDraft(name, owner)).toThrow('Metadati');
        expect(() => writeWorkoutRecoveryDraft(name, owner, { energy: 5 })).toThrow('Metadati');
        expect(readDeviceValueStrict(name, owner)).toBe(raw);
    });

    it('keeps readiness UI and durable draft unchanged when a write fails', async () => {
        await prepareUnlockedTestArchive(owner);
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
        render(<PreSessionCheckIn workoutId="readiness-1" onStart={vi.fn(async () => true)}
            onCancel={vi.fn(async () => true)} />);
        fireEvent.click(screen.getByRole('button', { name: 'Energia: 4 su 5' }));
        expect(screen.getByRole('button', { name: 'Energia: 4 su 5' }).getAttribute('aria-pressed')).toBe('true');
        const key = protectedDeviceKey('draft:pre-session:readiness-1', owner);
        const previous = localStorage.getItem(key);
        localStorageMock.setItem.mockImplementationOnce((written: string) => {
            if (written === key) throw new DOMException('full', 'QuotaExceededError');
        });
        fireEvent.click(screen.getByRole('button', { name: 'Energia: 5 su 5' }));
        expect(screen.getByRole('button', { name: 'Energia: 4 su 5' }).getAttribute('aria-pressed')).toBe('true');
        expect(localStorage.getItem(key)).toBe(previous);
    });

    it('preserves readiness draft if deletion is declined', async () => {
        await prepareUnlockedTestArchive(owner);
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
        const cancel = vi.fn(async () => false);
        render(<PreSessionCheckIn workoutId="readiness-2" onStart={vi.fn(async () => true)} onCancel={cancel} />);
        fireEvent.click(screen.getByRole('button', { name: 'Voglia di allenarti: 3 su 5' }));
        const key = protectedDeviceKey('draft:pre-session:readiness-2', owner);
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
                    history: state.userData!.history.map(item => item.id === stale.id
                        ? { ...item, routineName: 'Versione aggiornata durante la conferma' }
                        : item),
                },
            }));
        });
        await act(async () => { confirm(true); expect(await opening).toBe(false); });
        expect(useAppStore.getState().localWorkout?.id).toBe(live.id);
        expect(useAppStore.getState().userData?.history.find(item => item.id === stale.id)?.routineName)
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
