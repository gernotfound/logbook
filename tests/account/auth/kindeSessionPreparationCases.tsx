import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { KindeSessionContext } from './kinde_session_runtime_boundary.test';

export function registerKindeSessionPreparationCases(ctx: KindeSessionContext): void {
    const { uid, readyPrincipal, verified, host, readKindeCandidateIdentity, readKindeCandidateAccess, authenticatedIdentitySource, KindeCandidateBoundaryError, prepareKindeCandidateOwner, useKindeAccountSession, useSharedKindeAccountSession, activateGuestSession, GUEST_SESSION_KEY } = ctx;

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
}
