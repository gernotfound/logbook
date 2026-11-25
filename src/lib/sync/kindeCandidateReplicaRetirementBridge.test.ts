import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEGAL_VERSIONS } from '../legalVersions';
import { KindeCandidateBoundaryError } from '../auth/kindeCandidateClient';
import { recoverKindeCandidateReplicaRetirement, retireKindeCandidateReplica } from './kindeCandidateReplicaRetirementBridge';

const adapters = vi.hoisted(() => ({
    provision: vi.fn(), unlock: vi.fn(), hydrate: vi.fn(), readLocal: vi.fn(),
    inspect: vi.fn(), stage: vi.fn(), resume: vi.fn(), transport: vi.fn(),
}));
vi.mock('../firebase', () => { throw Error('Candidate retirement must not load Firebase'); });
vi.mock('./secureArchiveMigration', () => ({ createAndMigrateVault: adapters.provision }));
vi.mock('./secureArchiveSession', () => ({ unlockVaultForOwner: adapters.unlock }));
vi.mock('./kindeCandidateArchiveHydration', () => ({ hydrateKindeCandidateArchive: adapters.hydrate }));
vi.mock('./localArchiveBootstrap', () => ({ readLocal: adapters.readLocal }));
vi.mock('./kindeCandidateReplicaRegistry', () => ({ inspectKindeCandidateReplicaRegistry: adapters.inspect }));
vi.mock('./cloudReplicaRetirementRecovery', () => ({
    stageCloudflareReplicaRetirement: adapters.stage,
    resumeCloudflareReplicaRetirement: adapters.resume,
}));
vi.mock('./cloudReplicaTransport', async importOriginal => ({
    ...(await importOriginal<typeof import('./cloudReplicaTransport')>()),
    createCloudflareReplicaTransport: adapters.transport,
}));

const UID = 'k_' + 'A'.repeat(43);
const OTHER = 'k_' + 'B'.repeat(43);
const CSRF = 'A'.repeat(43);
const NEXT_CSRF = 'B'.repeat(43);
const expected = { uid: UID, fenceEpoch: 1, healthConsentRevision: 1 };
const legal = { hasAcceptedTerms: true, hasAcceptedHealthData: true,
    acceptedAt: '2026-11-15T00:00:00.000Z',
    privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms };
const witness = { slot: 's04', replicaId: 'remote-device-identity', generation: 2,
    lastSeq: 14, checkpointAtMs: 1_790_000_000_000, leaseUntilMs: 1_800_000_000_000 };
const control = { uid: UID, fenceEpoch: 1, consentRevision: 1, revision: 10,
    replicas: { s04: { ...witness, status: 'active', checkpointClock: { s04: 14 } } } };
const baseline = () => ({ data: { legalConsent: legal }, consentRevision: 1,
    replica: null, revision: 1, pending: [] });
const grant = { isCurrent: () => true, release: vi.fn() };
function response(body: unknown) {
    return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
function server(onRequest?: (path: string) => void): typeof fetch {
    return vi.fn<typeof fetch>().mockImplementation(async (path) => {
        const url = String(path);
        onRequest?.(url);
        if (url === '/api/auth/session') return response({ authenticated: true, emailVerified: true, ...expected });
        if (url === '/v1/consent/status') return response({ uid: UID, status: 'active', revision: 1,
            fenceEpoch: 1, acceptedAt: legal.acceptedAt, observedAtMs: Date.parse(legal.acceptedAt),
            privacyVersion: legal.privacyVersion, termsVersion: legal.termsVersion });
        throw Error('Unexpected request ' + url);
    });
}
const cookie = () => '__Host-logbook_csrf=' + CSRF;
const retire = (send: typeof fetch, browserCookies = cookie) => retireKindeCandidateReplica({
    expected, witness, stillCurrent: () => true, send, browserCookies,
});

beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    adapters.provision.mockResolvedValue(grant);
    adapters.unlock.mockResolvedValue(grant);
    adapters.readLocal.mockResolvedValue(baseline());
    adapters.inspect.mockResolvedValue({ kind: 'replica-registry-observed', control });
    adapters.transport.mockReturnValue({ control: vi.fn() });
    adapters.resume.mockResolvedValue('retired');
});
afterEach(() => vi.restoreAllMocks());

describe('candidate explicit retirement boundary (never public)', () => {
    it('pins the selected remote incarnation after consent, then stages before replay and releases the vault', async () => {
        await expect(retire(server())).resolves.toBe('retired');
        expect(adapters.provision).toHaveBeenCalledWith('user:' + UID, expect.any(Function));
        expect(adapters.hydrate).not.toHaveBeenCalled();
        expect(adapters.stage).toHaveBeenCalledWith('user:' + UID, control, witness,
            expect.any(Function), { lastSeq: 14, checkpointAtMs: witness.checkpointAtMs,
                leaseUntilMs: witness.leaseUntilMs });
        expect(adapters.resume).toHaveBeenCalledWith('user:' + UID, expect.any(Object), CSRF, expect.any(Function));
        expect(adapters.stage.mock.invocationCallOrder[0]).toBeLessThan(adapters.resume.mock.invocationCallOrder[0]);
        expect(grant.release).toHaveBeenCalledOnce();
    });

    it('can hydrate a sixth owner device without claiming a slot before the explicit retirement', async () => {
        adapters.readLocal.mockResolvedValueOnce(null).mockResolvedValueOnce(baseline());
        await expect(retire(server())).resolves.toBe('retired');
        expect(adapters.hydrate).toHaveBeenCalledWith({ expected, stillCurrent: expect.any(Function),
            send: expect.any(Function), browserCookies: cookie });
        expect(adapters.hydrate.mock.invocationCallOrder[0]).toBeLessThan(adapters.stage.mock.invocationCallOrder[0]);
        expect(adapters.unlock).not.toHaveBeenCalled();
    });

    it('rejects changed, foreign or ownerless witness without staging a mutation', async () => {
        for (const bad of [
            { ...control, uid: OTHER }, { ...control, uid: undefined },
            { ...control, replicas: { s04: { ...control.replicas.s04, lastSeq: 15 } } },
            { ...control, replicas: { s04: { ...control.replicas.s04, generation: 3 } } },
        ]) {
            adapters.inspect.mockResolvedValueOnce({ kind: 'replica-registry-observed', control: bad });
            await expect(retire(server())).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        }
        expect(adapters.stage).not.toHaveBeenCalled();
        expect(adapters.resume).not.toHaveBeenCalled();
        expect(grant.release).toHaveBeenCalledTimes(4);
    });

    it('rejects an inconsistent local legal consent, pending request and local withdrawal', async () => {
        for (const bad of [
            { ...baseline(), data: { legalConsent: null } },
            { ...baseline(), cloudflareReplicaRetirement: { mutationId: 'pending' } },
        ]) {
            adapters.readLocal.mockResolvedValueOnce(bad);
            await expect(retire(server())).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        }
        localStorage.setItem(`logbook:v2:user:${UID}:health-consent-withdrawal`, 'pending:1');
        const send = server();
        await expect(retire(send)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(vi.mocked(send)).not.toHaveBeenCalled();
        expect(adapters.stage).not.toHaveBeenCalled();
    });

    it('preserves a staged operation on lost response; never mints another in recovery', async () => {
        adapters.resume.mockRejectedValueOnce(new Error('lost reply')).mockResolvedValueOnce('retired');
        await expect(retire(server())).rejects.toThrow('lost reply');
        expect(grant.release).toHaveBeenCalledOnce();
        await expect(recoverKindeCandidateReplicaRetirement({ expected, stillCurrent: () => true,
            send: server(), browserCookies: cookie })).resolves.toBe('retired');
        expect(adapters.stage).toHaveBeenCalledOnce();
        expect(adapters.provision).toHaveBeenCalledOnce();
        expect(adapters.unlock).toHaveBeenCalledOnce();
        expect(adapters.hydrate).not.toHaveBeenCalled();
        expect(grant.release).toHaveBeenCalledTimes(2);
    });

    it('does not replay a retirement sealed under a superseded Auth epoch', async () => {
        adapters.readLocal.mockResolvedValueOnce({ ...baseline(),
            cloudflareReplicaRetirement: { mutationId: 'old-epoch-intent', expectedFenceEpoch: 2 } });
        await expect(recoverKindeCandidateReplicaRetirement({ expected, stillCurrent: () => true,
            send: server(), browserCookies: cookie })).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(adapters.resume).not.toHaveBeenCalled();
        expect(grant.release).toHaveBeenCalledOnce();
    });

    it('halts on a rotated CSRF cookie before the staged write or remote replay', async () => {
        let browserCookie = cookie();
        adapters.inspect.mockImplementationOnce(async () => {
            browserCookie = '__Host-logbook_csrf=' + NEXT_CSRF;
            return { kind: 'replica-registry-observed', control };
        });
        await expect(retire(server(), () => browserCookie)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(adapters.stage).not.toHaveBeenCalled();
        expect(adapters.resume).not.toHaveBeenCalled();
        expect(grant.release).toHaveBeenCalledOnce();
    });
});
