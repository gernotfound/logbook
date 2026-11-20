import { describe, expect, it, vi } from 'vitest';
import { claimSource, uid, owner, principal, cookie, legal, server, start, firstPartySession } from './kindeOwnerBootstrapFixture';
import { get } from 'idb-keyval';
import { createCloudKeyHttpFixture } from '../../cloudflare/cloud-key-http-fixture.mjs';
import { prepareKindeCandidateOwner } from '../../../src/lib/sync/kindeCandidateOwnerBootstrap';
import { KindeCandidateBoundaryError } from '../../../src/lib/auth/kindeCandidateClient';
import type { CloudReplicaClaimRequest } from '../../../src/lib/sync/cloudReplicaTransport';
import { readLocal } from '../../../src/lib/sync/localArchiveBootstrap';
import { isVaultUnlocked, lockAllVaults, readVaultControl, unlockVaultForOwner, vaultControlKey } from '../../../src/lib/sync/secureArchiveSession';

describe('Kinde synthetic owner: trusted provisioning and claim reconciliation', () => {
    it('creates only owner-scoped ciphertext after trusted consent, then invokes the durable claim bridge', async () => {
        const send = server();
        const result = await start(send);
        expect(result).toEqual({ kind: 'candidate-observed', checkpointRevision: 0,
            replicaOutcome: 'reconciliation-required' });
        expect(claimSource.claim).toHaveBeenCalledWith({
            expected: principal, stillCurrent: expect.any(Function),
            send, browserCookies: cookie,
        });
        expect(isVaultUnlocked(owner)).toBe(false);
        await unlockVaultForOwner(owner);
        const data = await readLocal(owner);
        expect(data?.owner).toBe(owner);
        expect(data?.consentRevision).toBe(1);
        expect(data?.data.legalConsent).toEqual(legal);
        expect(data?.replica).toBeNull();
        expect(data?.pending).toEqual([]);
        const sealed = await get<string>('logbook:v2:' + owner);
        expect(sealed).toMatch(/^tlb-sealed:v1:/);
        expect(sealed).not.toContain(legal.acceptedAt);
        expect(readVaultControl(owner)?.phase).toBe('active');
        expect(localStorage.getItem(vaultControlKey('guest'))).toBeNull();
    });

    it('preactivation preparation closes its own vault after verified D1 readback', async () => {
        const realClaim = await vi.importActual<typeof import('../../../src/lib/sync/kindeCandidateReplicaClaimBridge')>(
            '../../../src/lib/sync/kindeCandidateReplicaClaimBridge',
        );
        claimSource.claim.mockImplementation(realClaim.claimKindeCandidateReplica);
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const session = firstPartySession(fixture, (_path, _init, response) => response);
            await expect(prepareKindeCandidateOwner({
                ...session, expected: principal, retainDeviceVault: false, drainPendingJournal: true,
            })).resolves.toMatchObject({
                kind: 'candidate-observed', replicaOutcome: 'adopted', journalOutcome: 'idle',
            });
            expect(isVaultUnlocked(owner)).toBe(false);
            expect(fixture.count('sync_replicas', uid)).toBe(1);
            expect(fixture.count('sync_documents', uid)).toBe(0);
            const sealed = await get<string>('logbook:v2:' + owner);
            expect(sealed).toMatch(/^tlb-sealed:v1:/);
            await unlockVaultForOwner(owner);
            expect(await readLocal(owner)).toMatchObject({
                owner, consentRevision: 1, pending: [],
                data: { legalConsent: expect.objectContaining({ hasAcceptedHealthData: true }) },
            });
        } finally {
            fixture.close();
        }
    });

    it('never provisions a key without trusted email and account consent', async () => {
        for (const mode of ['unregistered', 'withdrawn', 'unverified'] as const) {
            const send = server(mode);
            await expect(start(send)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(send).toHaveBeenCalled();
            expect(readVaultControl(owner)).toBeNull();
            expect(await get('logbook:v2:' + owner)).toBeUndefined();
        }
        expect(claimSource.claim).not.toHaveBeenCalled();
    });

    it('refuses a local guest, pending withdrawal or mismatched consent generation before any network I/O', async () => {
        const checks = [
            ['logbook_is_guest', 'true'],
            ['logbook_is_guest', 'invalid'],
            [`logbook:v2:${owner}:health-consent-withdrawal`, 'pending:1'],
            [`logbook:v2:${owner}:health-consent-generation`, '2'],
            [`logbook:v2:${owner}:account-deletion`, 'pending'],
        ];
        for (const [key, value] of checks) {
            localStorage.setItem(key, value);
            const send = server();
            await expect(start(send)).rejects.toBeInstanceOf(KindeCandidateBoundaryError);
            expect(send).not.toHaveBeenCalled();
            expect(readVaultControl(owner)).toBeNull();
            localStorage.removeItem(key);
        }
    });

    it('preserves the same provisioned vault after unavailable cloud scan; retry hydrates without a reset', async () => {
        await expect(start(server('scan-error'))).rejects.toThrow();
        const previous = readVaultControl(owner);
        expect(previous?.phase).toBe('active');
        expect(isVaultUnlocked(owner)).toBe(false);
        expect(await get('logbook:v2:' + owner)).toBeUndefined();
        expect(claimSource.claim).not.toHaveBeenCalled();
        await expect(start(server())).resolves.toMatchObject({ kind: 'candidate-observed' });
        expect(readVaultControl(owner)).toEqual(previous);
        expect(isVaultUnlocked(owner)).toBe(false);
        await unlockVaultForOwner(owner);
        expect(await readLocal(owner)).toMatchObject({ owner, consentRevision: 1 });
    });

    it('resumes the exact encrypted replica claim after a committed response is lost and the vault is reopened', async () => {
        const realClaim = await vi.importActual<typeof import('../../../src/lib/sync/kindeCandidateReplicaClaimBridge')>(
            '../../../src/lib/sync/kindeCandidateReplicaClaimBridge',
        );
        claimSource.claim.mockImplementation(realClaim.claimKindeCandidateReplica);
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const requests: CloudReplicaClaimRequest[] = [];
            let scanCount = 0;
            const { send, browserCookies } = firstPartySession(fixture, async (path, init, response) => {
                if (path === '/v1/sync/replica/claim') {
                    expect(response.status).toBe(200);
                    const claimed = JSON.parse(String(init?.body)) as CloudReplicaClaimRequest;
                    expect((await readLocal(owner))?.cloudflareReplicaClaim).toEqual(claimed);
                    requests.push(claimed);
                    if (requests.length === 1) throw new TypeError('HTTP response lost after D1 commit');
                    // An ambiguous conflict must not overwrite the staged request.
                    if (requests.length === 2) return Response.json({ error: 'conflict' }, { status: 409 });
                }
                if (path === '/v1/sync/scan') scanCount += 1;
                return response;
            });

            await expect(start(send, browserCookies)).rejects.toThrow();
            expect(requests).toHaveLength(1);
            expect(fixture.count('sync_replicas', uid)).toBe(1);
            const staged = requests[0];
            const controlBefore = readVaultControl(owner);
            expect(isVaultUnlocked(owner)).toBe(false);
            await unlockVaultForOwner(owner);
            expect(await readLocal(owner)).toMatchObject({ cloudflareReplicaClaim: staged, pending: [], replica: null });
            const sealed = await get<string>('logbook:v2:' + owner);
            expect(sealed).toMatch(/^tlb-sealed:v1:/);
            expect(sealed).not.toContain(staged.mutationId);

            lockAllVaults();
            const scansBeforeRetry = scanCount;
            await expect(start(send, browserCookies)).resolves.toEqual({
                kind: 'candidate-observed', checkpointRevision: null, replicaOutcome: 'reconciliation-required',
            });
            expect(isVaultUnlocked(owner)).toBe(false);
            expect(scanCount).toBe(scansBeforeRetry);
            expect(await get('logbook:v2:' + owner)).toBe(sealed);
            await expect(start(send, browserCookies)).resolves.toEqual({
                kind: 'candidate-observed', checkpointRevision: 1, replicaOutcome: 'adopted',
            });
            expect(requests).toEqual([staged, staged, staged]);
            expect(fixture.count('sync_replicas', uid)).toBe(1);
            expect(readVaultControl(owner)).toEqual(controlBefore);
            const recovered = await readLocal(owner);
            expect(isVaultUnlocked(owner)).toBe(true);
            expect(recovered?.cloudflareReplicaClaim).toBeUndefined();
            expect(recovered?.replica?.replicaId).toBe(staged.candidateReplicaId);
            expect(recovered?.pending).toEqual([]);
            expect(recovered?.data.legalConsent?.acceptedAt).toBeTruthy();
        } finally {
            fixture.close();
        }
    });
});
