import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEGAL_VERSIONS } from '../legalVersions';
import { KindeCandidateBoundaryError } from '../auth/kindeCandidateClient';
import { claimKindeCandidateReplica } from './kindeCandidateReplicaClaimBridge';
import type { AuthenticatedCloudflareCheckpoint } from './cloudReplicaCheckpoint';
import type { CloudReplicaControlSnapshot } from './cloudReplicaTransport';
import type { LocalEnvelope } from './localRepository';

const adapters = vi.hoisted(() => ({
    readLocal: vi.fn(), unlocked: vi.fn(), cloudKey: vi.fn(),
    transport: vi.fn(), control: vi.fn(), scan: vi.fn(),
    verifyCheckpoint: vi.fn(), stage: vi.fn(), resume: vi.fn(),
}));

vi.mock('../firebase', () => {
    throw Error('A Kinde candidate claim must never initialize Firebase');
});
vi.mock('./localRepository', () => ({ readLocal: adapters.readLocal }));
vi.mock('./secureArchiveSession', () => ({ requireUnlockedLocalKey: adapters.unlocked }));
vi.mock('./cloudflareAccountKeyCandidate', () =>
    ({ acquireCloudflareAccountKeyCandidate: adapters.cloudKey }));
vi.mock('./cloudReplicaTransport', async importOriginal => ({
    ...(await importOriginal<typeof import('./cloudReplicaTransport')>()),
    createCloudflareReplicaTransport: adapters.transport,
}));
vi.mock('./cloudReplicaCheckpoint', () =>
    ({ readAuthenticatedCloudflareCheckpoint: adapters.verifyCheckpoint }));
vi.mock('./cloudReplicaClaimRecovery', () => ({
    stageCloudflareReplicaClaim: adapters.stage,
    resumeCloudflareReplicaClaim: adapters.resume,
}));

const UID = 'k_' + 'A'.repeat(43);
const OTHER = 'k_' + 'B'.repeat(43);
const CSRF = 'A'.repeat(43);
const NEXT_CSRF = 'A'.repeat(42) + 'Q';
const original = { uid: UID, fenceEpoch: 1, healthConsentRevision: 1 };
const receipt = { hasAcceptedTerms: true, hasAcceptedHealthData: true,
    acceptedAt: '2026-11-15T00:00:00.000Z',
    privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms };
const baseline = () => ({
    data: { legalConsent: receipt }, consentRevision: 1, replica: null,
    pending: [], revision: 1,
}) as unknown as LocalEnvelope;
const control: CloudReplicaControlSnapshot = {
    uid: UID, revision: 0, fenceEpoch: 1, consentRevision: 1, replicas: {},
};
const checkpoint: AuthenticatedCloudflareCheckpoint = {
    revision: 0, fenceEpoch: 1, consentRevision: 1, documents: new Map(),
};
const response = (body: unknown) => Response.json(body, {
    headers: { 'Cache-Control': 'no-store' },
});

function server(options: { consent?: () => Record<string, unknown>; session?: () => Record<string, unknown> } = {}) {
    const send = vi.fn<typeof fetch>().mockImplementation(async (path) => {
        if (path === '/api/auth/session') return response(options.session?.() ?? {
            authenticated: true, emailVerified: true, ...original,
        });
        if (path === '/v1/consent/status') return response(options.consent?.() ?? {
            uid: UID, status: 'active', revision: 1, fenceEpoch: 1,
            acceptedAt: receipt.acceptedAt, privacyVersion: receipt.privacyVersion,
            termsVersion: receipt.termsVersion,
        });
        throw new Error('Unexpected request: ' + String(path));
    });
    return send;
}
const cookie = () => '__Host-logbook_csrf=' + CSRF;
const claim = (send: typeof fetch, cookies = cookie, stillCurrent = () => true) =>
    claimKindeCandidateReplica({
        expected: original, stillCurrent, send, browserCookies: cookies,
    });

beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    const deviceKey = new Uint8Array(32).fill(7);
    adapters.unlocked.mockReturnValue(deviceKey);
    adapters.readLocal.mockResolvedValue(baseline());
    adapters.transport.mockReturnValue({ control: adapters.control, scanAll: adapters.scan });
    adapters.control.mockImplementation(async () => structuredClone(control));
    adapters.scan.mockResolvedValue({ documents: [] });
    adapters.verifyCheckpoint.mockImplementation(async (scan: () => Promise<unknown>) => {
        await scan();
        return checkpoint;
    });
    adapters.cloudKey.mockResolvedValue(new Uint8Array(32).fill(9));
    adapters.stage.mockResolvedValue({ mutationId: 'synthetic-staged' });
    adapters.resume.mockResolvedValue('adopted');
});
afterEach(() => vi.restoreAllMocks());

describe('Kinde candidate membership orchestration (not mounted in the PWA)', () => {
    it('stages only after trusted consent, pinned owner controls and a complete AEAD check', async () => {
        const send = server();
        await expect(claim(send)).resolves.toBe('adopted');
        expect(adapters.control).toHaveBeenCalledTimes(2);
        expect(adapters.verifyCheckpoint).toHaveBeenCalledOnce();
        expect(adapters.stage).toHaveBeenCalledWith(
            'user:' + UID, checkpoint, control, expect.any(String), expect.any(Function),
        );
        expect(adapters.stage.mock.calls[0][3]).toMatch(/^[0-9a-f-]{36}$/);
        expect(adapters.resume).toHaveBeenCalledWith(
            'user:' + UID, expect.any(Uint8Array), expect.any(Object),
            CSRF, expect.any(Function),
        );
        expect(adapters.stage.mock.invocationCallOrder[0]).toBeLessThan(
            adapters.resume.mock.invocationCallOrder[0],
        );
        expect(adapters.cloudKey.mock.results[0].value).toBeInstanceOf(Promise);
        const key = await adapters.cloudKey.mock.results[0].value as Uint8Array;
        expect(key.every(byte => byte === 0)).toBe(true);
        expect(send.mock.calls.map(([path]) => path)).toEqual([
            '/api/auth/session', '/v1/consent/status', '/api/auth/session',
            '/api/auth/session', '/v1/consent/status', '/api/auth/session',
            '/api/auth/session', '/v1/consent/status', '/api/auth/session',
        ]);
    });

    it('recovers an already sealed claim without minting a new mutation or scanning', async () => {
        adapters.readLocal.mockResolvedValue({
            ...baseline(), cloudflareReplicaClaim: { mutationId: 'immutable-lost-response' },
        });
        adapters.resume.mockResolvedValue('retry-staged');
        await expect(claim(server())).resolves.toBe('retry-staged');
        expect(adapters.stage).not.toHaveBeenCalled();
        expect(adapters.verifyCheckpoint).not.toHaveBeenCalled();
        expect(adapters.scan).not.toHaveBeenCalled();
        expect(adapters.resume).toHaveBeenCalledOnce();
    });

    it('wipes the one-operation ADK after a network failure without staging another request', async () => {
        adapters.readLocal.mockResolvedValue({
            ...baseline(), cloudflareReplicaClaim: { mutationId: 'lost-ack' },
        });
        adapters.resume.mockRejectedValue(new Error('ambiguous claim response'));
        const key = new Uint8Array(32).fill(17);
        adapters.cloudKey.mockResolvedValue(key);
        await expect(claim(server())).rejects.toThrow('ambiguous claim response');
        expect(key.every(byte => byte === 0)).toBe(true);
        expect(adapters.stage).not.toHaveBeenCalled();
    });

    it('refuses ownerless, wrong-owner, wrong-epoch and wrong-consent controls before ADK or mutation', async () => {
        for (const bad of [
            { ...control, uid: undefined }, { ...control, uid: OTHER },
            { ...control, fenceEpoch: 2 }, { ...control, consentRevision: 2 },
        ]) {
            adapters.control.mockResolvedValueOnce(bad);
            await expect(claim(server())).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        }
        expect(adapters.cloudKey).not.toHaveBeenCalled();
        expect(adapters.stage).not.toHaveBeenCalled();
        expect(adapters.resume).not.toHaveBeenCalled();
    });

    it('does not request a key for a missing, different-consent or differently accepted owner archive', async () => {
        for (const local of [
            null,
            { ...baseline(), consentRevision: 2 },
            { ...baseline(), data: { legalConsent: null } },
            { ...baseline(), cloudIntegrityFence: 'unverified' },
            { ...baseline(), cloudflareDelivery: { mutationId: 'pending' } },
            { ...baseline(), cloudflareReplicaRetirement: { mutationId: 'pending' } },
        ]) {
            adapters.readLocal.mockResolvedValueOnce(local);
            await expect(claim(server())).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        }
        expect(adapters.control).not.toHaveBeenCalled();
        expect(adapters.cloudKey).not.toHaveBeenCalled();
        expect(adapters.stage).not.toHaveBeenCalled();
    });

    it('refuses a stale or changed legal receipt after an authenticated scan before persisting claim', async () => {
        let consentReads = 0;
        const send = server({ consent: () => {
            consentReads += 1;
            return { uid: UID, status: 'active', revision: 1, fenceEpoch: 1,
                privacyVersion: receipt.privacyVersion, termsVersion: receipt.termsVersion,
                acceptedAt: consentReads === 1
                    ? receipt.acceptedAt : '2026-11-16T00:00:00.000Z' };
        } });
        await expect(claim(send)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(adapters.stage).not.toHaveBeenCalled();
        expect(adapters.resume).not.toHaveBeenCalled();
        const key = await adapters.cloudKey.mock.results[0].value as Uint8Array;
        expect(key.every(byte => byte === 0)).toBe(true);
    });

    it('does not stage on AEAD scan failure, revision drift, or control change', async () => {
        adapters.verifyCheckpoint.mockRejectedValueOnce(new Error('ciphertext failed AEAD'));
        await expect(claim(server())).rejects.toThrow('AEAD');
        adapters.verifyCheckpoint.mockResolvedValueOnce({ ...checkpoint, revision: 1 });
        await expect(claim(server())).resolves.toBe('reconciliation-required');
        adapters.control.mockResolvedValueOnce(control).mockResolvedValueOnce({
            ...control, revision: 1,
        });
        await expect(claim(server())).resolves.toBe('reconciliation-required');
        expect(adapters.stage).not.toHaveBeenCalled();
        expect(adapters.resume).not.toHaveBeenCalled();
    });

    it('refuses a replaced browser session or device vault after network I/O, preserving the original claim', async () => {
        let currentCookie = cookie();
        const key = new Uint8Array(32).fill(29);
        adapters.cloudKey.mockResolvedValueOnce(key);
        adapters.verifyCheckpoint.mockImplementationOnce(async () => {
            currentCookie = '__Host-logbook_csrf=' + NEXT_CSRF;
            return checkpoint;
        });
        await expect(claim(server(), () => currentCookie))
            .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(key.every(byte => byte === 0)).toBe(true);
        expect(adapters.stage).not.toHaveBeenCalled();
        currentCookie = cookie();
        const nextKey = new Uint8Array(32).fill(30);
        adapters.cloudKey.mockResolvedValueOnce(nextKey);
        adapters.verifyCheckpoint.mockImplementationOnce(async () => {
            adapters.unlocked.mockReturnValue(new Uint8Array(32).fill(8));
            return checkpoint;
        });
        await expect(claim(server())).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(nextKey.every(byte => byte === 0)).toBe(true);
        expect(adapters.stage).not.toHaveBeenCalled();
    });

    it('never grants a new slot when an already active local replica is server-attested', async () => {
        const future = Date.now() + 86400000;
        const replica = { slot: 's01', replicaId: 'verified-local-slot',
            generation: 1, leaseUntilMs: future, checkpointAtMs: Date.now() };
        adapters.readLocal.mockResolvedValueOnce({ ...baseline(), replica });
        adapters.control.mockResolvedValueOnce({
            ...control, replicas: { s01: { ...replica, status: 'active',
                lastSeq: 0, checkpointClock: {} } },
        });
        await expect(claim(server())).resolves.toBe('already-active');
        expect(adapters.cloudKey).not.toHaveBeenCalled();
        expect(adapters.stage).not.toHaveBeenCalled();
        expect(adapters.resume).not.toHaveBeenCalled();
    });

    it('does not silently replace a stale or expired local replica', async () => {
        const replica = { slot: 's01', replicaId: 'old-slot', generation: 1,
            leaseUntilMs: Date.now() - 5000, checkpointAtMs: Date.now() - 10000 };
        adapters.readLocal.mockResolvedValueOnce({ ...baseline(), replica });
        await expect(claim(server())).resolves.toBe('reconciliation-required');
        expect(adapters.cloudKey).not.toHaveBeenCalled();
        expect(adapters.stage).not.toHaveBeenCalled();
    });

    it('fails closed on guest mode or invalid caller generation before any network request', async () => {
        localStorage.setItem('logbook_is_guest', 'true');
        const send = server();
        await expect(claim(send)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(send).not.toHaveBeenCalled();
        localStorage.clear();
        await expect(claim(send, cookie, () => false))
            .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(send).not.toHaveBeenCalled();
    });

    it('treats an apparently missing saved intent as reconciliation, never a successful claim', async () => {
        adapters.resume.mockResolvedValueOnce('idle');
        await expect(claim(server())).resolves.toBe('reconciliation-required');
        expect(adapters.stage).toHaveBeenCalledOnce();
    });
});
