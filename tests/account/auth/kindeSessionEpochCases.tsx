import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { KindeSessionContext } from './kinde_session_runtime_boundary.test';

export function registerKindeSessionEpochCases(ctx: KindeSessionContext): void {
    const { readyPrincipal, verified, readKindeCandidateIdentity, authenticatedIdentitySource, KindeCandidateBoundaryError, prepareKindeCandidateOwner, useKindeAccountSession } = ctx;

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
            ctx.setCsrf('B'.repeat(42) + 'A');
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
}
