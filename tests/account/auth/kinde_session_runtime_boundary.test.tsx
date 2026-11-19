import { act, fireEvent, render, renderHook, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('../../../src/lib/db/guestLocalPurge', () => ({ purgeGuestLocalData: vi.fn(async () => {}) }));
vi.mock('../../../src/lib/sync/kindeCandidateOwnerBootstrap', () => ({
    prepareKindeCandidateOwner: vi.fn(),
}));
vi.mock('../../../src/lib/auth/kindeCandidateIdentity', () => ({
    readKindeCandidateIdentity: vi.fn(),
}));
vi.mock('../../../src/lib/auth/kindeCandidateClient', async importOriginal => ({
    ...await importOriginal<typeof import('../../../src/lib/auth/kindeCandidateClient')>(),
    readKindeCandidateAccess: vi.fn(),
    revokeKindeCandidateSession: vi.fn(async () => {}),
    submitKindeHostedSignIn: vi.fn(),
}));

import { GuestOnlyAuthProvider } from '../../../src/contexts/GuestOnlyAuthProvider';
import { KindeAccountSessionProvider } from '../../../src/contexts/auth/KindeAccountSessionProvider';
import { useKindeAccountSession } from '../../../src/contexts/auth/useKindeAccountSession';
import { useSharedKindeAccountSession } from '../../../src/contexts/auth/kindeAccountSessionContext';
import { KindeAccountEntry } from '../../../src/components/UI/KindeAccountEntry';
import { readKindeCandidateIdentity } from '../../../src/lib/auth/kindeCandidateIdentity';
import { KindeCandidateBoundaryError, readKindeCandidateAccess, revokeKindeCandidateSession, submitKindeHostedSignIn } from '../../../src/lib/auth/kindeCandidateClient';
import { prepareKindeCandidateOwner } from '../../../src/lib/sync/kindeCandidateOwnerBootstrap';
import { authenticatedIdentitySource } from '../../../src/lib/sync/authenticatedIdentitySource';
import { activateGuestSession, GUEST_SESSION_KEY } from '../../../src/lib/sync/session';
import { useAuth } from '../../../src/hooks/useAuth';
import { releaseLegacyTestIdentityReader } from '../../setup';

const uid = 'k_' + 'A'.repeat(43);
const readyPrincipal = { uid, fenceEpoch: 1, healthConsentRevision: 1, emailVerified: true };
const verified = {
    kind: 'email-verified' as const,
    principal: { uid, fenceEpoch: 1, healthConsentRevision: 0, emailVerified: true },
};
let csrf = 'A'.repeat(43);
const host = ({ children }: { children: ReactNode }) => (
    <GuestOnlyAuthProvider>
        <KindeAccountSessionProvider>{children}</KindeAccountSessionProvider>
    </GuestOnlyAuthProvider>
);

function Observer() {
    const session = useSharedKindeAccountSession();
    const { currentUser, isGuest } = useAuth();
    return <output data-testid="kinde-presence">{[
        session?.view.phase ?? 'missing', currentUser ? 'fitness-account' : 'fitness-blocked',
        isGuest ? 'local-guest' : 'not-guest',
    ].join('|')}</output>;
}

beforeEach(() => {
    releaseLegacyTestIdentityReader();
    localStorage.clear();
    csrf = 'A'.repeat(43);
    vi.spyOn(document, 'cookie', 'get').mockImplementation(() => '__Host-logbook_csrf=' + csrf);
    vi.mocked(readKindeCandidateIdentity).mockResolvedValue({ kind: 'signed-out' });
    vi.mocked(readKindeCandidateAccess).mockReset();
    vi.mocked(revokeKindeCandidateSession).mockResolvedValue();
    vi.mocked(prepareKindeCandidateOwner).mockReset();
    vi.mocked(prepareKindeCandidateOwner).mockResolvedValue({
        kind: 'candidate-observed', checkpointRevision: 1, replicaOutcome: 'already-active',
    });
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.resetAllMocks();
});

describe('React Kinde session boundary never promotes identity into fitness', () => {
    it('does not start candidate preparation from the mounted public provider', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue({
            kind: 'email-verified', principal: readyPrincipal,
        });
        const { result } = renderHook(() => useSharedKindeAccountSession(), { wrapper: host });
        await waitFor(() => expect(result.current?.view.phase).toBe('identity-verified'));
        await act(async () => {
            await expect(result.current!.prepareCandidateArchive())
                .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        });
        expect(prepareKindeCandidateOwner).not.toHaveBeenCalled();
        expect(readKindeCandidateAccess).not.toHaveBeenCalled();
        expect(authenticatedIdentitySource.hasReader()).toBe(false);
    });

    it('hands an explicitly enabled candidate the observed session, without promoting fitness', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue({
            kind: 'email-verified', principal: readyPrincipal,
        });
        const { result } = renderHook(() => useKindeAccountSession({
            guestArchivePresent: false, identityOnly: true, candidatePreparationEnabled: true,
        }));
        await waitFor(() => expect(result.current.view.phase).toBe('identity-verified'));
        await act(async () => {
            await expect(result.current.prepareCandidateArchive({
                drainPendingJournal: true,
            })).resolves.toMatchObject({
                kind: 'candidate-observed', replicaOutcome: 'already-active',
            });
        });
        expect(prepareKindeCandidateOwner).toHaveBeenCalledTimes(1);
        const args = vi.mocked(prepareKindeCandidateOwner).mock.calls[0][0];
        expect(args).toMatchObject({
            expected: { uid, fenceEpoch: 1, healthConsentRevision: 1 },
            drainPendingJournal: true, retainDeviceVault: false,
        });
        expect(args.stillCurrent()).toBe(true);
        expect(args).not.toHaveProperty('send');
        expect(args).not.toHaveProperty('browserCookies');
        expect(readKindeCandidateAccess).not.toHaveBeenCalled();
        expect(authenticatedIdentitySource.hasReader()).toBe(false);
    });

    it('refuses to start before verified consent or for an unverified email', async () => {
        for (const identity of [
            verified,
            { kind: 'email-unverified' as const,
                principal: { ...readyPrincipal, emailVerified: false } },
        ]) {
            vi.mocked(readKindeCandidateIdentity).mockResolvedValue(identity);
            const { result, unmount } = renderHook(() => useKindeAccountSession({
                guestArchivePresent: false, identityOnly: true, candidatePreparationEnabled: true,
            }));
            await waitFor(() => expect(result.current.view.phase).toBe(
                identity.kind === 'email-unverified' ? 'email-unverified' : 'identity-verified',
            ));
            await act(async () => {
                await expect(result.current.prepareCandidateArchive())
                    .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            });
            unmount();
        }
        expect(prepareKindeCandidateOwner).not.toHaveBeenCalled();
    });

    it('does not attempt candidate preparation while a local guest is active', async () => {
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'guest-candidate-blocked');
        activateGuestSession('guest-candidate-blocked');
        const { result } = renderHook(() => useKindeAccountSession({
            guestArchivePresent: true, identityOnly: true, candidatePreparationEnabled: true,
        }));
        await waitFor(() => expect(result.current.view.phase).toBe('guest-blocked'));
        await act(async () => {
            await expect(result.current.prepareCandidateArchive())
                .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        });
        expect(readKindeCandidateIdentity).not.toHaveBeenCalled();
        expect(prepareKindeCandidateOwner).not.toHaveBeenCalled();
    });

    it('rejects a superseded candidate result when its CSRF witness changes mid-flight', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue({
            kind: 'email-verified', principal: readyPrincipal,
        });
        let release!: () => void;
        const delayed = new Promise<void>(resolve => { release = resolve; });
        vi.mocked(prepareKindeCandidateOwner).mockImplementation(async ({ stillCurrent }) => {
            expect(stillCurrent()).toBe(true);
            await delayed;
            return { kind: 'candidate-observed', checkpointRevision: 1,
                replicaOutcome: 'already-active' };
        });
        const { result } = renderHook(() => useKindeAccountSession({
            guestArchivePresent: false, identityOnly: true, candidatePreparationEnabled: true,
        }));
        await waitFor(() => expect(result.current.view.phase).toBe('identity-verified'));
        let attempt!: ReturnType<typeof result.current.prepareCandidateArchive>;
        act(() => { attempt = result.current.prepareCandidateArchive(); });
        const rejected = expect(attempt).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        try {
            await waitFor(() => expect(prepareKindeCandidateOwner).toHaveBeenCalledTimes(1));
            csrf = 'B'.repeat(42) + 'A';
            await act(async () => { release(); await rejected; });
            expect(authenticatedIdentitySource.readUid()).toBeNull();
        } finally {
            release();
            await attempt.catch(() => {});
        }
    });

    it('serializes candidate starts and rejects a result after unmount', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue({
            kind: 'email-verified', principal: readyPrincipal,
        });
        let release!: () => void;
        const delayed = new Promise<void>(resolve => { release = resolve; });
        vi.mocked(prepareKindeCandidateOwner).mockImplementation(async () => {
            await delayed;
            return { kind: 'candidate-observed', checkpointRevision: 1,
                replicaOutcome: 'already-active' };
        });
        const { result, unmount } = renderHook(() => useKindeAccountSession({
            guestArchivePresent: false, identityOnly: true, candidatePreparationEnabled: true,
        }));
        await waitFor(() => expect(result.current.view.phase).toBe('identity-verified'));
        let first!: ReturnType<typeof result.current.prepareCandidateArchive>;
        act(() => { first = result.current.prepareCandidateArchive(); });
        const failed = expect(first).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        try {
            await waitFor(() => expect(prepareKindeCandidateOwner).toHaveBeenCalledTimes(1));
            await act(async () => {
                await expect(result.current.prepareCandidateArchive())
                    .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            });
            expect(prepareKindeCandidateOwner).toHaveBeenCalledTimes(1);
            unmount();
            release();
            await failed;
            expect(authenticatedIdentitySource.readUid()).toBeNull();
        } finally {
            release();
            await first.catch(() => {});
        }
    });

    it('reuses one live session observation between the runtime and the account entry', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValue(verified);
        render(<><Observer /><KindeAccountEntry identityOnly /></>, { wrapper: host });
        await screen.findByText(/Sessione Kinde verificata/);
        expect(screen.getByTestId('kinde-presence').textContent)
            .toBe('identity-verified|fitness-blocked|not-guest');
        expect(readKindeCandidateIdentity).toHaveBeenCalledTimes(1);
        expect(readKindeCandidateAccess).not.toHaveBeenCalled();
        expect(authenticatedIdentitySource.hasReader()).toBe(false);
        expect(authenticatedIdentitySource.readUid()).toBeNull();
        expect(submitKindeHostedSignIn).not.toHaveBeenCalled();
    });

    it('invalidates the shared identity on a replacement cookie without installing an account owner', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValueOnce(verified)
            .mockResolvedValue({ kind: 'signed-out' });
        render(<><Observer /><KindeAccountEntry identityOnly /></>, { wrapper: host });
        await screen.findByText(/Sessione Kinde verificata/);
        csrf = 'B'.repeat(42) + 'A';
        await act(async () => { window.dispatchEvent(new Event('focus')); });
        await screen.findByRole('button', { name: 'Accedi o registrati' });
        expect(screen.getByTestId('kinde-presence').textContent)
            .toBe('signed-out|fitness-blocked|not-guest');
        expect(readKindeCandidateIdentity).toHaveBeenCalledTimes(2);
        expect(authenticatedIdentitySource.readUid()).toBeNull();
    });

    it('keeps the guest archive local and performs no Kinde request while the guest is active', async () => {
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'guest-runtime-session');
        activateGuestSession('guest-runtime-session');
        render(<Observer />, { wrapper: host });
        await waitFor(() => expect(screen.getByTestId('kinde-presence').textContent)
            .toBe('guest-blocked|fitness-blocked|local-guest'));
        expect(readKindeCandidateIdentity).not.toHaveBeenCalled();
        expect(readKindeCandidateAccess).not.toHaveBeenCalled();
        expect(authenticatedIdentitySource.readUid()).toBeNull();
    });

    it('uses one session revocation and then publishes only signed-out, never a fitness user', async () => {
        vi.mocked(readKindeCandidateIdentity).mockResolvedValueOnce(verified)
            .mockResolvedValue({ kind: 'signed-out' });
        render(<><Observer /><KindeAccountEntry identityOnly /></>, { wrapper: host });
        await screen.findByText(/Sessione Kinde verificata/);
        fireEvent.click(screen.getByRole('button', { name: 'Termina sessione TheLogBook' }));
        await screen.findByRole('button', { name: 'Accedi o registrati' });
        expect(revokeKindeCandidateSession).toHaveBeenCalledTimes(1);
        expect(readKindeCandidateIdentity).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId('kinde-presence').textContent)
            .toBe('signed-out|fitness-blocked|not-guest');
    });
});
