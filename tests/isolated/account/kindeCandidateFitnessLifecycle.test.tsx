import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KindeCandidateBoundaryError } from '../../../src/lib/auth/kindeCandidateClient';
import { authenticatedIdentitySource } from '../../../src/lib/sync/authenticatedIdentitySource';
import { createDefaultNutritionPlanning } from '../../../src/lib/nutritionDefaults';
import type { KindeCandidateFitnessRealm, KindeCandidateFitnessSnapshot } from '../../../src/lib/auth/kindeCandidateFitnessRealm';
import type { useKindeAccountSession } from '../../../src/contexts/auth/useKindeAccountSession';

vi.mock('../../../src/lib/auth/kindeCandidateFitnessRealm', () => ({
    openKindeCandidateFitnessRealm: vi.fn(),
}));

import { openKindeCandidateFitnessRealm } from '../../../src/lib/auth/kindeCandidateFitnessRealm';
import { useKindeCandidateFitnessLifecycle } from '../../../src/contexts/auth/useKindeCandidateFitnessLifecycle';
import { useKindeCandidateProfile } from '../../../src/hooks/profile/useKindeCandidateProfile';
import { KindeCandidateNutritionPlanning } from '../../../src/components/Nutrition/KindeCandidateNutritionPlanning';
import { KindeCandidateJournalStatus } from '../../../src/components/UI/KindeCandidateJournalStatus';
import { releaseLegacyTestIdentityReader } from '../../setup';

const uid = 'k_' + 'U'.repeat(43);
const owner = 'user:' + uid;
const principal = { uid, fenceEpoch: 1, healthConsentRevision: 1, emailVerified: true };
const snapshot: KindeCandidateFitnessSnapshot = {
    owner,
    principal: { uid, fenceEpoch: 1, healthConsentRevision: 1 },
    data: { profile: { height: '180' } } as KindeCandidateFitnessSnapshot['data'],
};
const confirmed = (generation = 1) => ({
    view: { phase: 'consent-confirmed', generation, principal },
}) as unknown as ReturnType<typeof useKindeAccountSession>;
const signedOut = () => ({
    view: { phase: 'signed-out', generation: 2 },
}) as unknown as ReturnType<typeof useKindeAccountSession>;

function mockRealm() {
    const mock = {
        isCurrent: vi.fn(() => true),
        snapshot: vi.fn(() => snapshot),
        refresh: vi.fn(async () => snapshot),
        submit: vi.fn(async () => ({ kind: 'cloud-acknowledged' as const, operations: 1 })),
        openRoutineDraft: vi.fn<KindeCandidateFitnessRealm['openRoutineDraft']>(),
        saveRoutineDraft: vi.fn<KindeCandidateFitnessRealm['saveRoutineDraft']>(),
        openExerciseDraft: vi.fn<KindeCandidateFitnessRealm['openExerciseDraft']>(),
        saveExerciseDraft: vi.fn<KindeCandidateFitnessRealm['saveExerciseDraft']>(),
        openMeasurementDraft: vi.fn<KindeCandidateFitnessRealm['openMeasurementDraft']>(),
        saveMeasurementDraft: vi.fn<KindeCandidateFitnessRealm['saveMeasurementDraft']>(),
        openSleepDraft: vi.fn<KindeCandidateFitnessRealm['openSleepDraft']>(),
        saveSleepDraft: vi.fn<KindeCandidateFitnessRealm['saveSleepDraft']>(),
        close: vi.fn(),
    };
    return mock;
}

beforeEach(() => {
    releaseLegacyTestIdentityReader();
    localStorage.clear();
    vi.mocked(openKindeCandidateFitnessRealm).mockReset();
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('React candidate lifecycle: explicit owner access without promoting Kinde to Firebase Auth', () => {
    it('opens only after explicit verified consent and never installs a global owner reader', async () => {
        const fake = mockRealm();
        vi.mocked(openKindeCandidateFitnessRealm).mockResolvedValue(fake as KindeCandidateFitnessRealm);
        const session = confirmed();
        const { result } = renderHook(() => useKindeCandidateFitnessLifecycle({
            session, enabled: true,
        }));
        expect(result.current.state.phase).toBe('closed');
        expect(openKindeCandidateFitnessRealm).not.toHaveBeenCalled();
        await act(async () => { await result.current.open(); });
        expect(result.current.state).toMatchObject({
            phase: 'ready', snapshot: { owner, principal: snapshot.principal },
        });
        expect(vi.mocked(openKindeCandidateFitnessRealm).mock.calls[0][0]).toMatchObject({
            expected: snapshot.principal,
        });
        expect(authenticatedIdentitySource.hasReader()).toBe(false);
        expect(authenticatedIdentitySource.readUid()).toBeNull();
    });

    it('keeps public identity-only callers disabled even with a verified identity', async () => {
        const fake = mockRealm();
        vi.mocked(openKindeCandidateFitnessRealm).mockResolvedValue(fake as KindeCandidateFitnessRealm);
        const session = confirmed();
        const { result } = renderHook(() => useKindeCandidateFitnessLifecycle({
            session, enabled: false,
        }));
        await act(async () => {
            await expect(result.current.open()).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        });
        expect(openKindeCandidateFitnessRealm).not.toHaveBeenCalled();
        expect(result.current.state.phase).toBe('closed');
    });

    it('discards plaintext after a same-UID generation switch or signed-out view', async () => {
        const fake = mockRealm();
        vi.mocked(openKindeCandidateFitnessRealm).mockResolvedValue(fake as KindeCandidateFitnessRealm);
        const initialProps = { session: confirmed(1), enabled: true };
        const { result, rerender } = renderHook(
            ({ session, enabled }) => useKindeCandidateFitnessLifecycle({ session, enabled }),
            { initialProps },
        );
        await act(async () => { await result.current.open(); });
        expect(result.current.state.phase).toBe('ready');

        rerender({ session: confirmed(2), enabled: true });
        expect(fake.close).toHaveBeenCalledTimes(1);
        expect(result.current.state.phase).toBe('closed');
        rerender({ session: signedOut(), enabled: true });
        await act(async () => {
            await expect(result.current.open()).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        });
        expect(vi.mocked(openKindeCandidateFitnessRealm)).toHaveBeenCalledTimes(1);
        expect(authenticatedIdentitySource.readUid()).toBeNull();
    });

    it('refuses an old asynchronous open after unmount or a session replacement', async () => {
        const fake = mockRealm();
        let release!: (value: KindeCandidateFitnessRealm) => void;
        vi.mocked(openKindeCandidateFitnessRealm).mockImplementation(() =>
            new Promise(resolve => { release = resolve; }));
        const { result, rerender } = renderHook(
            ({ session }) => useKindeCandidateFitnessLifecycle({ session, enabled: true }),
            { initialProps: { session: confirmed() } },
        );
        let pending!: Promise<void>;
        act(() => { pending = result.current.open(); });
        expect(result.current.state.phase).toBe('opening');
        rerender({ session: signedOut() });
        await act(async () => {
            release(fake as KindeCandidateFitnessRealm);
            await expect(pending).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        });
        expect(fake.close).toHaveBeenCalledTimes(1);
        expect(result.current.state.phase).toBe('closed');
        expect(authenticatedIdentitySource.readUid()).toBeNull();
    });

    it('closes a late successful owner scope after React unmount instead of publishing plaintext', async () => {
        const fake = mockRealm();
        let release!: (value: KindeCandidateFitnessRealm) => void;
        vi.mocked(openKindeCandidateFitnessRealm).mockImplementation(() =>
            new Promise(resolve => { release = resolve; }));
        const session = confirmed();
        const { result, unmount } = renderHook(() => useKindeCandidateFitnessLifecycle({
            session, enabled: true,
        }));
        let pending!: Promise<void>;
        act(() => { pending = result.current.open(); });
        unmount();
        await act(async () => {
            release(fake as KindeCandidateFitnessRealm);
            await expect(pending).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        });
        expect(fake.close).toHaveBeenCalledTimes(1);
        expect(authenticatedIdentitySource.hasReader()).toBe(false);
    });

    it('clears the snapshot on focus/background and reports a pending write without presenting old data', async () => {
        const fake = mockRealm();
        fake.submit.mockResolvedValueOnce({ kind: 'local-pending', pendingCount: 1 } as never);
        fake.snapshot.mockReturnValueOnce(snapshot).mockReturnValueOnce(null as never);
        vi.mocked(openKindeCandidateFitnessRealm).mockResolvedValue(fake as KindeCandidateFitnessRealm);
        const session = confirmed();
        const { result } = renderHook(() => useKindeCandidateFitnessLifecycle({
            session, enabled: true,
        }));
        await act(async () => { await result.current.open(); });
        await act(async () => {
            await expect(result.current.submit({ type: 'profile.patch', patch: { height: '182' } }))
                .resolves.toMatchObject({ kind: 'local-pending' });
        });
        expect(result.current.state.phase).toBe('recheck-required');
        act(() => { window.dispatchEvent(new Event('focus')); });
        expect(fake.close).toHaveBeenCalledTimes(1);
        expect(result.current.state.phase).toBe('closed');
    });

    it('rechecks a pending ciphertext journal without dispatching the same intent twice', async () => {
        const fake = mockRealm();
        fake.submit.mockResolvedValueOnce({ kind: 'local-pending', pendingCount: 1 } as never);
        fake.snapshot.mockReturnValueOnce(snapshot).mockReturnValueOnce(null as never);
        vi.mocked(openKindeCandidateFitnessRealm).mockResolvedValue(fake as KindeCandidateFitnessRealm);
        const session = confirmed();
        const { result } = renderHook(() => useKindeCandidateFitnessLifecycle({ session, enabled: true }));
        await act(async () => { await result.current.open(); });
        await act(async () => {
            await expect(result.current.submit({ type: 'profile.patch', patch: { height: '181' } }))
                .resolves.toMatchObject({ kind: 'local-pending' });
        });
        expect(result.current.state.phase).toBe('recheck-required');
        expect(fake.submit).toHaveBeenCalledTimes(1);
        await act(async () => { await result.current.recheck(); });
        expect(result.current.state.phase).toBe('ready');
        expect(fake.refresh).toHaveBeenCalledTimes(1);
        expect(fake.submit).toHaveBeenCalledTimes(1);
        expect(openKindeCandidateFitnessRealm).toHaveBeenCalledTimes(1);
        expect(authenticatedIdentitySource.hasReader()).toBe(false);
    });

    it('keeps the ready offline view distinct from a fully reconciled journal', async () => {
        const fake = mockRealm();
        fake.submit.mockResolvedValueOnce({ kind: 'local-pending', pendingCount: 1 } as never);
        vi.mocked(openKindeCandidateFitnessRealm).mockResolvedValue(fake as KindeCandidateFitnessRealm);
        const session = confirmed();
        const { result } = renderHook(() => useKindeCandidateFitnessLifecycle({ session, enabled: true }));
        await act(async () => { await result.current.open(); });
        expect(result.current.state).toMatchObject({ phase: 'ready', hasPendingJournal: false });
        await act(async () => {
            await result.current.submit({ type: 'profile.patch', patch: { height: '181' } });
        });
        expect(result.current.state).toMatchObject({ phase: 'ready', hasPendingJournal: true });
    });

    it('closes a failed reconciliation and permits a fresh trusted realm opening', async () => {
        const fake = mockRealm();
        fake.submit.mockResolvedValueOnce({ kind: 'local-pending', pendingCount: 1 } as never);
        fake.snapshot.mockReturnValueOnce(snapshot).mockReturnValueOnce(null as never);
        fake.refresh.mockRejectedValueOnce(new Error('consent no longer trusted'));
        vi.mocked(openKindeCandidateFitnessRealm).mockResolvedValue(fake as KindeCandidateFitnessRealm);
        const session = confirmed();
        const { result } = renderHook(() => useKindeCandidateFitnessLifecycle({ session, enabled: true }));
        await act(async () => { await result.current.open(); });
        await act(async () => {
            await result.current.submit({ type: 'profile.patch', patch: { height: '185' } });
        });
        await act(async () => {
            await expect(result.current.recheck()).rejects.toThrow('consent no longer trusted');
        });
        expect(result.current.state.phase).toBe('unavailable');
        expect(fake.close).toHaveBeenCalledTimes(1);
        expect(fake.submit).toHaveBeenCalledTimes(1);
        await act(async () => { await result.current.open(); });
        expect(result.current.state.phase).toBe('ready');
        expect(openKindeCandidateFitnessRealm).toHaveBeenCalledTimes(2);
    });

    it('rejects a late journal recovery after the account session changes', async () => {
        const fake = mockRealm();
        fake.submit.mockResolvedValueOnce({ kind: 'local-pending', pendingCount: 1 } as never);
        fake.snapshot.mockReturnValueOnce(snapshot).mockReturnValueOnce(null as never);
        let finish!: () => void;
        fake.refresh.mockImplementationOnce(async () => {
            await new Promise<void>(resolve => { finish = resolve; });
            return snapshot;
        });
        vi.mocked(openKindeCandidateFitnessRealm).mockResolvedValue(fake as KindeCandidateFitnessRealm);
        const { result, rerender } = renderHook(
            ({ session }) => useKindeCandidateFitnessLifecycle({ session, enabled: true }),
            { initialProps: { session: confirmed(1) } },
        );
        await act(async () => { await result.current.open(); });
        await act(async () => {
            await result.current.submit({ type: 'profile.patch', patch: { height: '185' } });
        });
        let pending!: Promise<void>;
        act(() => { pending = result.current.recheck(); });
        rerender({ session: confirmed(2) });
        await act(async () => {
            finish();
            await expect(pending).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        });
        expect(result.current.state.phase).toBe('closed');
        expect(fake.submit).toHaveBeenCalledTimes(1);
        expect(fake.close).toHaveBeenCalledTimes(1);
        expect(authenticatedIdentitySource.readUid()).toBeNull();
    });

    it('hides a stale snapshot when the realm deadline expires without any browser event', async () => {
        vi.useFakeTimers();
        try {
            const fake = mockRealm();
            vi.mocked(openKindeCandidateFitnessRealm).mockResolvedValue(fake as KindeCandidateFitnessRealm);
            const session = confirmed();
            const { result } = renderHook(() => useKindeCandidateFitnessLifecycle({ session, enabled: true }));
            await act(async () => { await result.current.open(); });
            expect(result.current.state.phase).toBe('ready');
            fake.isCurrent.mockReturnValue(false);
            act(() => { vi.advanceTimersByTime(1000); });
            expect(result.current.state.phase).toBe('closed');
            expect(fake.close).toHaveBeenCalledTimes(1);
            expect(authenticatedIdentitySource.hasReader()).toBe(false);
        } finally { vi.useRealTimers(); }
    });

    it('checks the view permit immediately when the browser goes offline', async () => {
        const fake = mockRealm();
        vi.mocked(openKindeCandidateFitnessRealm).mockResolvedValue(fake as KindeCandidateFitnessRealm);
        const session = confirmed();
        const { result } = renderHook(() => useKindeCandidateFitnessLifecycle({ session, enabled: true }));
        await act(async () => { await result.current.open(); });
        expect(result.current.state.phase).toBe('ready');
        act(() => { window.dispatchEvent(new Event('offline')); });
        expect(result.current.state.phase).toBe('ready');
        expect(fake.close).not.toHaveBeenCalled();
        const witness = result.current.captureEditWitness();
        expect(witness?.isCurrent()).toBe(true);

        fake.isCurrent.mockReturnValue(false);
        act(() => { window.dispatchEvent(new Event('offline')); });

        expect(result.current.state.phase).toBe('closed');
        expect(result.current.captureEditWitness()).toBeNull();
        expect(witness?.isCurrent()).toBe(false);
        expect(fake.close).toHaveBeenCalledTimes(1);
    });

    it('removes plaintext before the document enters the back-forward cache', async () => {
        const fake = mockRealm();
        vi.mocked(openKindeCandidateFitnessRealm).mockResolvedValue(fake as KindeCandidateFitnessRealm);
        const session = confirmed();
        const { result } = renderHook(() => useKindeCandidateFitnessLifecycle({ session, enabled: true }));
        await act(async () => { await result.current.open(); });
        expect(result.current.state.phase).toBe('ready');
        const witness = result.current.captureEditWitness();
        expect(witness?.isCurrent()).toBe(true);

        act(() => {
            window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
            // The browser may freeze the document before a deferred render.
            expect(result.current.state.phase).toBe('closed');
            expect(witness?.isCurrent()).toBe(false);
        });

        expect(fake.close).toHaveBeenCalledTimes(1);
        expect(openKindeCandidateFitnessRealm).toHaveBeenCalledTimes(1);
    });

    it('routes the same biometric editor through the Kinde realm writer, never the legacy store', async () => {
        const fake = mockRealm();
        const edited = { ...snapshot, data: { ...snapshot.data, profile: { height: '191' } } };
        fake.snapshot.mockReturnValueOnce(snapshot).mockReturnValueOnce(edited);
        vi.mocked(openKindeCandidateFitnessRealm).mockResolvedValue(fake as KindeCandidateFitnessRealm);
        const session = confirmed();
        const { result } = renderHook(() => {
            const lifecycle = useKindeCandidateFitnessLifecycle({ session, enabled: true });
            const profile = useKindeCandidateProfile(lifecycle);
            return { lifecycle, profile };
        });
        expect(result.current.profile.height).toBe('');
        await act(async () => { await result.current.lifecycle.open(); });
        expect(result.current.profile.height).toBe('180');
        act(() => { result.current.profile.setHeight('191'); });
        await act(async () => { await result.current.profile.handleSaveProfile(); });
        expect(fake.submit).toHaveBeenCalledExactlyOnceWith({
            type: 'profile.patch',
            patch: { height: '191' },
        });
        expect(result.current.profile.height).toBe('191');
        expect(authenticatedIdentitySource.hasReader()).toBe(false);
    });

    it('keeps a locally durable Kinde edit distinct from cloud ACK until trusted reconciliation', async () => {
        const fake = mockRealm();
        fake.submit.mockResolvedValueOnce({ kind: 'local-pending', pendingCount: 1 } as never);
        const edited = { ...snapshot, data: { ...snapshot.data, profile: { height: '192' } } };
        fake.snapshot.mockReturnValueOnce(snapshot).mockReturnValueOnce(null as never)
            .mockReturnValueOnce(edited);
        vi.mocked(openKindeCandidateFitnessRealm).mockResolvedValue(fake as KindeCandidateFitnessRealm);
        const session = confirmed();
        const { result } = renderHook(() => {
            const lifecycle = useKindeCandidateFitnessLifecycle({ session, enabled: true });
            const profile = useKindeCandidateProfile(lifecycle);
            return { lifecycle, profile };
        });
        await act(async () => { await result.current.lifecycle.open(); });
        act(() => { result.current.profile.setHeight('192'); });
        await act(async () => { await result.current.profile.handleSaveProfile(); });
        expect(fake.submit).toHaveBeenCalledTimes(1);
        expect(result.current.lifecycle.state.phase).toBe('recheck-required');
        expect(result.current.profile.height).toBe('');
        await act(async () => { await result.current.lifecycle.recheck(); });
        expect(fake.refresh).toHaveBeenCalledTimes(1);
        expect(fake.submit).toHaveBeenCalledTimes(1);
        expect(result.current.profile.height).toBe('192');
    });

    it('does not send a biometric draft from an obsolete account observer', async () => {
        const fake = mockRealm();
        vi.mocked(openKindeCandidateFitnessRealm).mockResolvedValue(fake as KindeCandidateFitnessRealm);
        const { result, rerender } = renderHook(
            ({ session }) => {
                const lifecycle = useKindeCandidateFitnessLifecycle({ session, enabled: true });
                const profile = useKindeCandidateProfile(lifecycle);
                return { lifecycle, profile };
            },
            { initialProps: { session: confirmed(1) } },
        );
        await act(async () => { await result.current.lifecycle.open(); });
        act(() => { result.current.profile.setHeight('193'); });
        expect(result.current.profile.height).toBe('193');
        rerender({ session: confirmed(2) });
        expect(result.current.profile.height).toBe('');
        await act(async () => { await result.current.profile.handleSaveProfile(); });
        expect(fake.submit).not.toHaveBeenCalled();
        expect(fake.close).toHaveBeenCalledTimes(1);
        expect(authenticatedIdentitySource.readUid()).toBeNull();
    });

    it('edits and reconciles nutrition planning through the Kinde realm without a legacy writer', async () => {
        const fake = mockRealm();
        const withWeight = { ...snapshot, data: {
            ...snapshot.data,
            nutrition: { '2026-11-20': { date: '2026-11-20', weight: 78, kcal: 0, carbs: 0, pro: 0, fat: 0 } },
        } };
        const saved = { ...withWeight, data: { ...withWeight.data, nutritionPlanning: {
            ...createDefaultNutritionPlanning(), onDaysCount: 3, weight: 78, notes: 'Prova',
        } } };
        fake.snapshot.mockReturnValueOnce(withWeight).mockReturnValueOnce(null as never).mockReturnValueOnce(saved);
        fake.submit.mockResolvedValueOnce({ kind: 'local-pending', pendingCount: 1 } as never);
        vi.mocked(openKindeCandidateFitnessRealm).mockResolvedValue(fake as KindeCandidateFitnessRealm);
        function Candidate({ session }: { session: ReturnType<typeof useKindeAccountSession> }) {
            const realm = useKindeCandidateFitnessLifecycle({ session, enabled: true });
            return <>
                <button type="button" onClick={realm.open}>Apri account</button>
                {realm.state.phase === 'recheck-required' && (
                    <button type="button" onClick={realm.recheck}>Verifica salvataggio</button>
                )}
                <KindeCandidateJournalStatus state={realm.state} />
                {realm.state.phase === 'ready' && <KindeCandidateNutritionPlanning realm={realm} />}
            </>;
        }
        const { rerender } = render(<Candidate session={confirmed(1)} />);
        expect(screen.queryByRole('button', { name: 'Salva pianificazione' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Apri account' }));
        fireEvent.change(await screen.findByLabelText(/Giorni ON/), { target: { value: '3' } });
        fireEvent.change(screen.getByRole('textbox', { name: /Note/ }), { target: { value: 'Prova' } });
        fireEvent.click(screen.getByRole('button', { name: 'Salva pianificazione' }));

        await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Conferma cloud in attesa'));
        expect(fake.submit).toHaveBeenCalledExactlyOnceWith({
            type: 'nutrition-planning.replace',
            value: expect.objectContaining({ onDaysCount: 3, weight: 78, notes: 'Prova' }),
            origin: 'user-edited',
        });
        expect(screen.queryByRole('button', { name: 'Salva pianificazione' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Verifica salvataggio' }));
        expect(await screen.findByDisplayValue('Prova')).toBeDefined();
        expect(screen.queryByRole('status')).toBeNull();
        expect(fake.refresh).toHaveBeenCalledTimes(1);
        expect(fake.submit).toHaveBeenCalledTimes(1);
        rerender(<Candidate session={confirmed(2)} />);
        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.queryByRole('textbox', { name: /Note/ })).toBeNull();
        expect(authenticatedIdentitySource.hasReader()).toBe(false);
    });

    it('keeps planning locally pending when D1 has not acknowledged its journal', async () => {
        const pendingSubmit = vi.fn(async () => ({ kind: 'local-pending' as const, pendingCount: 1 }));
        const localSnapshot: KindeCandidateFitnessSnapshot = {
            ...snapshot,
            data: {
                ...snapshot.data,
                nutrition: { '2026-11-20': {
                    date: '2026-11-20', weight: 78, kcal: 0, carbs: 0, pro: 0, fat: 0,
                } },
            },
        };
        // Hold the verified realm open to inspect the editor's own receipt status.
        // The parent lifecycle independently covers its unmount/recheck transition.
        const realm = {
            state: { phase: 'ready', view: confirmed().view, snapshot: localSnapshot, hasPendingJournal: false },
            submit: pendingSubmit,
            captureEditWitness: () => ({ owner, isCurrent: () => true }),
        } as unknown as ReturnType<typeof useKindeCandidateFitnessLifecycle>;

        render(<KindeCandidateNutritionPlanning realm={realm} />);
        fireEvent.change(screen.getByRole('textbox', { name: /Note/ }), {
            target: { value: 'Solo sul dispositivo' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Salva pianificazione' }));

        expect(await screen.findByText('Pianificazione salvata sul dispositivo. Conferma cloud in attesa.')).toBeDefined();
        expect(pendingSubmit).toHaveBeenCalledExactlyOnceWith({
            type: 'nutrition-planning.replace',
            value: expect.objectContaining({ weight: 78, notes: 'Solo sul dispositivo' }),
            origin: 'user-edited',
        });
    });

    it('never publishes a stale view after a terminal D1 failure', async () => {
        const fake = mockRealm();
        fake.submit.mockRejectedValueOnce(new Error('D1 terminal refusal'));
        vi.mocked(openKindeCandidateFitnessRealm).mockResolvedValue(fake as KindeCandidateFitnessRealm);
        const session = confirmed();
        const { result } = renderHook(() => useKindeCandidateFitnessLifecycle({
            session, enabled: true,
        }));
        await act(async () => { await result.current.open(); });
        await act(async () => {
            await expect(result.current.submit({ type: 'profile.patch', patch: { height: '182' } }))
                .rejects.toThrow('D1 terminal refusal');
        });
        expect(result.current.state.phase).toBe('unavailable');
        expect(fake.close).toHaveBeenCalledTimes(1);
        await act(async () => { await result.current.open(); });
        expect(result.current.state.phase).toBe('ready');
        expect(openKindeCandidateFitnessRealm).toHaveBeenCalledTimes(2);
        expect(fake.submit).toHaveBeenCalledTimes(1);
        expect(authenticatedIdentitySource.hasReader()).toBe(false);
    });
});
