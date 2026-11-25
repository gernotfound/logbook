import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEGAL_VERSIONS } from '../legalVersions';
import { KindeCandidateBoundaryError } from '../auth/kindeCandidateClient';
import {
    cancelKindeCandidatePendingReplicaMutation, inspectKindeCandidatePendingReplicaMutation,
} from './kindeCandidateReplicaCancellationBridge';

const mocks = vi.hoisted(() => ({
    unlock: vi.fn(), readLocal: vi.fn(), cancel: vi.fn(), transport: vi.fn(),
}));
vi.mock('../firebase', () => { throw Error('Candidate cancellation must not load Firebase'); });
vi.mock('./secureArchiveSession', () => ({ unlockVaultForOwner: mocks.unlock }));
vi.mock('./localArchiveBootstrap', () => ({ readLocal: mocks.readLocal }));
vi.mock('./cloudReplicaMutationCancellation', () => ({ cancelCloudflareReplicaMutation: mocks.cancel }));
vi.mock('./cloudReplicaTransport', () => ({ createCloudflareReplicaTransport: mocks.transport }));

const UID = 'k_' + 'A'.repeat(43);
const OTHER = 'k_' + 'B'.repeat(43);
const CSRF = 'A'.repeat(43);
const expected = { uid: UID, fenceEpoch: 1, healthConsentRevision: 1 };
const legal = { hasAcceptedTerms: true, hasAcceptedHealthData: true,
    acceptedAt: '2026-11-15T00:00:00.000Z',
    privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms };
const claim = { mutationId: 'claim-unique', expectedFenceEpoch: 1, consentRevision: 1,
    currentReplica: null, expectedRevision: 7, candidateReplicaId: 'candidate-1', checkpointClock: {} };
const retirement = { mutationId: 'retire-unique', expectedFenceEpoch: 1, consentRevision: 1,
    expectedRevision: 7, replica: { slot: 's04', replicaId: 'replica-4', generation: 2 } };
const baseline = () => ({ data: { legalConsent: legal }, consentRevision: 1,
    cloudflareReplicaClaim: claim, cloudflareReplicaRetirement: undefined, cloudflareReplicaCancellation: undefined });
const grant = { isCurrent: () => true, release: vi.fn() };
const response = (data: unknown) => Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
const cookie = () => '__Host-logbook_csrf=' + CSRF;
function server(onRequest?: (url: string) => void): typeof fetch {
    return vi.fn<typeof fetch>().mockImplementation(async url => {
        onRequest?.(String(url));
        if (url === '/api/auth/session') return response({ authenticated: true, emailVerified: true, ...expected });
        if (url === '/v1/consent/status') return response({ uid: UID, status: 'active', revision: 1,
            fenceEpoch: 1, acceptedAt: legal.acceptedAt, observedAtMs: Date.parse(legal.acceptedAt),
            privacyVersion: legal.privacyVersion, termsVersion: legal.termsVersion });
        throw Error('Unexpected request: ' + url);
    });
}
const inspect = (send: typeof fetch, browserCookies = cookie) => inspectKindeCandidatePendingReplicaMutation({
    expected, stillCurrent: () => true, send, browserCookies,
});
const cancel = (send: typeof fetch, mutationId = claim.mutationId, browserCookies = cookie) =>
    cancelKindeCandidatePendingReplicaMutation({
        expected, mutationId, stillCurrent: () => true, send, browserCookies,
    });

beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    mocks.unlock.mockResolvedValue(grant);
    mocks.readLocal.mockResolvedValue(baseline());
    mocks.transport.mockReturnValue({ control: vi.fn() });
    mocks.cancel.mockResolvedValue('cancelled');
});
afterEach(() => vi.restoreAllMocks());

describe('candidate-only sealed replica cancellation boundary', () => {
    it('observes only the exact local claim, without staging, remote mutation or device provisioning', async () => {
        await expect(inspect(server())).resolves.toEqual({ kind: 'claim', mutationId: claim.mutationId,
            slot: null, generation: null, cancellationRequested: false });
        expect(mocks.cancel).not.toHaveBeenCalled();
        expect(mocks.transport).not.toHaveBeenCalled();
        expect(mocks.unlock).toHaveBeenCalledWith('user:' + UID, expect.any(Function));
        expect(grant.release).toHaveBeenCalledOnce();

        mocks.readLocal.mockResolvedValueOnce({ ...baseline(), cloudflareReplicaClaim: undefined,
            cloudflareReplicaRetirement: retirement, cloudflareReplicaCancellation: retirement.mutationId });
        await expect(inspect(server())).resolves.toEqual({ kind: 'retirement', mutationId: retirement.mutationId,
            slot: 's04', generation: 2, cancellationRequested: true });
        mocks.readLocal.mockResolvedValueOnce({ ...baseline(), cloudflareReplicaClaim: undefined });
        await expect(inspect(server())).resolves.toBeNull();
    });

    it('cancels only a previously inspected mutation ID after authorization, without ACK or replacement', async () => {
        const send = server();
        await expect(cancel(send)).resolves.toBe('cancelled');
        expect(mocks.cancel).toHaveBeenCalledWith('user:' + UID, claim.mutationId,
            expect.any(Object), CSRF, expect.any(Function));
        expect(vi.mocked(send).mock.calls.map(([url]) => url)).toEqual([
            '/api/auth/session', '/v1/consent/status', '/api/auth/session',
            '/api/auth/session', '/v1/consent/status', '/api/auth/session',
            '/api/auth/session', '/v1/consent/status', '/api/auth/session',
        ]);
        expect(grant.release).toHaveBeenCalledOnce();
        await expect(cancel(server(), 'stale-mutation')).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(mocks.cancel).toHaveBeenCalledTimes(1);
        mocks.readLocal.mockResolvedValueOnce({ ...baseline(), cloudflareReplicaClaim: undefined,
            cloudflareReplicaRetirement: retirement });
        await expect(cancel(server(), retirement.mutationId)).resolves.toBe('cancelled');
        expect(mocks.cancel).toHaveBeenLastCalledWith('user:' + UID, retirement.mutationId,
            expect.any(Object), CSRF, expect.any(Function));
    });

    it('preserves ambiguity of a lost response and never reports cancellation as committed', async () => {
        mocks.cancel.mockRejectedValueOnce(new Error('lost cancellation response'));
        await expect(cancel(server())).rejects.toThrow('lost cancellation response');
        expect(grant.release).toHaveBeenCalledOnce();
        mocks.cancel.mockResolvedValueOnce('reconciliation-required').mockResolvedValueOnce('committed');
        await expect(cancel(server())).resolves.toBe('reconciliation-required');
        await expect(cancel(server())).resolves.toBe('committed');
        expect(mocks.cancel).toHaveBeenCalledTimes(3);
    });

    it('rejects revoked consent, a foreign owner, stale epoch and tampered legal witness', async () => {
        for (const invalid of [
            { ...baseline(), cloudflareReplicaClaim: { ...claim, expectedFenceEpoch: 2 } },
            { ...baseline(), data: { legalConsent: { ...legal, privacyVersion: 'changed' } } },
            { ...baseline(), cloudIntegrityFence: true },
            { ...baseline(), cloudflareReplicaRetirement: retirement },
        ]) {
            mocks.readLocal.mockResolvedValueOnce(invalid);
            await expect(cancel(server())).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        }
        await expect(cancel(server(), claim.mutationId, cookie)).resolves.toBe('cancelled');
        const other = server();
        await expect(cancelKindeCandidatePendingReplicaMutation({
            expected: { ...expected, uid: OTHER }, mutationId: claim.mutationId,
            stillCurrent: () => true, send: other, browserCookies: cookie,
        })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(mocks.cancel).toHaveBeenCalledOnce();
    });

    it('rejects local withdrawal before reaching the server or opening the vault', async () => {
        localStorage.setItem(`logbook:v2:user:${UID}:health-consent-withdrawal`, 'pending:1');
        const send = server();
        await expect(cancel(send)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(send).not.toHaveBeenCalled();
        expect(mocks.unlock).not.toHaveBeenCalled();
        expect(mocks.cancel).not.toHaveBeenCalled();
    });

    it('fails closed when the guest flag or cookie changes while opening the vault', async () => {
        localStorage.setItem('logbook_is_guest', 'true');
        const send = server();
        await expect(cancel(send)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(send).not.toHaveBeenCalled();
        localStorage.clear();
        let cookies = cookie();
        mocks.readLocal.mockImplementationOnce(async () => {
            cookies = '__Host-logbook_csrf=' + 'B'.repeat(43);
            return baseline();
        });
        await expect(cancel(server(), claim.mutationId, () => cookies))
            .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(mocks.cancel).not.toHaveBeenCalled();
        expect(grant.release).toHaveBeenCalledOnce();
    });
});
