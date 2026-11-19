import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useAppStore } from '../../../src/store/useAppStore';
import { useDialogStore } from '../../../src/store/useDialogStore';
import type { WorkoutSession } from '../../../src/types';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict, writeDeviceValue } from '../../../src/lib/sync/deviceStorage';
import { captureSession } from '../../../src/lib/sync/session';
import { draftRegistry } from '../../../src/lib/utils/draftRegistry';
import { readWorkoutRecoveryDraft, writeWorkoutRecoveryDraft } from '../../../src/lib/sync/workoutRecoveryDraft';
import PreSessionCheckIn from '../../../src/components/Training/PreSessionCheckIn';
import TrainingSession from '../../../src/components/Training/TrainingSession';
import WorkoutTimer from '../../../src/components/Training/WorkoutTimer';
import { useWorkoutSession } from '../../../src/hooks/useWorkoutSession';
import { initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { localStorageMock, renderWithProviders } from '../../setup';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { installWorkoutLifecycleFixture, owner, renderOwnedWorkoutSession, workout, userData, advanceConsentAfterGuardRead } from './workoutLifecycleFixture';

describe('Workout lifecycle durable recovery regressions', () => {
    installWorkoutLifecycleFixture();

    describe('Session readiness, consent and draft ownership', () => {
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
    });
});
