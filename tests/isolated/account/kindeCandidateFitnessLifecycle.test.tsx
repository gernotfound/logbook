import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KindeCandidateBoundaryError } from '../../../src/lib/auth/kindeCandidateClient';
import { authenticatedIdentitySource } from '../../../src/lib/sync/authenticatedIdentitySource';
import type { KindeCandidateFitnessRealm, KindeCandidateFitnessSnapshot } from '../../../src/lib/auth/kindeCandidateFitnessRealm';
import type { useKindeAccountSession } from '../../../src/contexts/auth/useKindeAccountSession';

vi.mock('../../../src/lib/auth/kindeCandidateFitnessRealm', () => ({
    openKindeCandidateFitnessRealm: vi.fn(),
}));

import { openKindeCandidateFitnessRealm } from '../../../src/lib/auth/kindeCandidateFitnessRealm';
import { useKindeCandidateFitnessLifecycle } from '../../../src/contexts/auth/useKindeCandidateFitnessLifecycle';
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
        expect(authenticatedIdentitySource.hasReader()).toBe(false);
    });
});
