import { describe, expect, it, vi } from 'vitest';
import { claimSource, uid, owner, principal, firstPartySession, server, start } from './kindeOwnerBootstrapFixture';
import { get } from 'idb-keyval';
import { createCloudKeyHttpFixture } from '../../cloudflare/cloud-key-http-fixture.mjs';
import { prepareKindeCandidateOwner } from '../../../src/lib/sync/kindeCandidateOwnerBootstrap';
import { KindeCandidateBoundaryError } from '../../../src/lib/auth/kindeCandidateClient';
import { acceptKindeCandidateInitialConsent } from '../../../src/lib/auth/kindeCandidateConsent';
import { deliverKindeCandidateJournal } from '../../../src/lib/sync/kindeCandidateJournalBridge';
import { readLocal } from '../../../src/lib/sync/localArchiveBootstrap';
import { commitDomainOperations } from '../../../src/lib/sync/localDomainCommit';
import { isVaultUnlocked, lockAllVaults, unlockVaultForOwner } from '../../../src/lib/sync/secureArchiveSession';

describe('Kinde synthetic owner: journal durability and lost-ACK recovery', () => {
    it('recovers the first committed journal after restart and keeps edits recorded after the lost receipt', async () => {
        const realClaim = await vi.importActual<typeof import('../../../src/lib/sync/kindeCandidateReplicaClaimBridge')>(
            '../../../src/lib/sync/kindeCandidateReplicaClaimBridge',
        );
        claimSource.claim.mockImplementation(realClaim.claimKindeCandidateReplica);
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            let receiptUnavailable = false;
            let commitCount = 0;
            let scans = 0;
            const session = firstPartySession(fixture, (path, _init, response) => {
                if (path === '/v1/sync/scan') scans += 1;
                if (path === '/v1/sync/commit') {
                    expect(response.status).toBe(200);
                    commitCount += 1;
                    throw new TypeError('HTTP response lost after journal commit');
                }
                if (path === '/v1/sync/receipt' && receiptUnavailable && commitCount > 0) {
                    return Response.json({ error: 'unavailable' }, {
                        status: 503, headers: { 'Cache-Control': 'no-store' },
                    });
                }
                return response;
            });
            await expect(acceptKindeCandidateInitialConsent({
                ...session, expectedOwner: principal,
                decision: { acceptedHealthData: true, acceptedTerms: true, confirmsOver18: true },
            })).resolves.toMatchObject({ kind: 'consent-confirmed', principal });
            const wrappingKey = fixture.env.CLOUD_ACCOUNT_KEK_V1;
            fixture.env.CLOUD_ACCOUNT_KEK_V1 = '';
            await expect(prepareKindeCandidateOwner({ ...session, expected: principal })).rejects.toThrow();
            expect(isVaultUnlocked(owner)).toBe(false);
            expect(fixture.count('cloud_account_keys', uid)).toBe(0);
            expect(fixture.count('sync_replicas', uid)).toBe(0);
            fixture.env.CLOUD_ACCOUNT_KEK_V1 = wrappingKey;
            await expect(prepareKindeCandidateOwner({ ...session, expected: principal }))
                .resolves.toMatchObject({ replicaOutcome: 'adopted' });
            const baseline = (await readLocal(owner))!.data;
            await commitDomainOperations(owner, { type: 'profile.patch', patch: { height: '181' } }, baseline);
            receiptUnavailable = true;
            await expect(deliverKindeCandidateJournal(session)).rejects.toThrow();
            expect(commitCount).toBe(1);
            expect(fixture.count('sync_documents', uid)).toBe(1);
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            const originalIntent = (await readLocal(owner))?.cloudflareDelivery;
            expect(originalIntent).toBeDefined();
            const later = await commitDomainOperations(owner, { type: 'profile.patch', patch: { height: '182' } }, baseline);
            const ciphertext = await get('logbook:v2:' + owner);
            const scansBeforeRestart = scans;

            lockAllVaults();
            await expect(prepareKindeCandidateOwner({ ...session, expected: principal })).rejects.toThrow();
            expect(scans).toBe(scansBeforeRestart);
            expect(await get('logbook:v2:' + owner)).toBe(ciphertext);
            expect(isVaultUnlocked(owner)).toBe(false);
            await unlockVaultForOwner(owner);
            expect((await readLocal(owner))?.cloudflareDelivery).toEqual(originalIntent);
            receiptUnavailable = false;

            await expect(prepareKindeCandidateOwner({ ...session, expected: principal })).resolves.toEqual({
                kind: 'candidate-observed', checkpointRevision: 2, replicaOutcome: 'already-active',
            });
            expect(commitCount).toBe(1);
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            const restored = await readLocal(owner);
            expect(restored?.cloudflareDelivery).toBeUndefined();
            expect(restored?.baseline.profile?.height).toBe('181');
            expect(restored?.data.profile?.height).toBe('182');
            expect(restored?.pending).toEqual(later.operations);
        } finally {
            fixture.close();
        }
    });

    it('does not hydrate if a new session replaces the CSRF cookie during vault recovery', async () => {
        let liveCookie = cookie();
        vi.stubGlobal('navigator', { locks: {
            request: async (_name: string, _options: unknown, callback: () => Promise<unknown>) => {
                const done = await callback();
                liveCookie = '__Host-logbook_csrf=' + 'B'.repeat(43);
                return done;
            },
        } });
        await expect(start(server(), () => liveCookie))
            .rejects.toBeInstanceOf(KindeCandidateBoundaryError);
        expect(isVaultUnlocked(owner)).toBe(false);
        expect(await get('logbook:v2:' + owner)).toBeUndefined();
        expect(claimSource.claim).not.toHaveBeenCalled();
    });

    it('keeps the exact durable batch if the vault is reopened before applying the D1 receipt', async () => {
        const realClaim = await vi.importActual<typeof import('../../../src/lib/sync/kindeCandidateReplicaClaimBridge')>(
            '../../../src/lib/sync/kindeCandidateReplicaClaimBridge',
        );
        claimSource.claim.mockImplementation(realClaim.claimKindeCandidateReplica);
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            let commits = 0;
            let interrupted = false;
            let staged: Awaited<ReturnType<typeof readLocal>>;
            const session = firstPartySession(fixture, async (path, _init, response) => {
                if (path === '/v1/sync/commit') {
                    expect(response.status).toBe(200);
                    commits += 1;
                }
                if (path === '/v1/sync/receipt' && commits === 1 && !interrupted) {
                    expect(response.status).toBe(200);
                    staged = await readLocal(owner);
                    expect(staged?.cloudflareDelivery).toBeDefined();
                    await unlockVaultForOwner(owner);
                    interrupted = true;
                }
                return response;
            });
            await expect(prepareKindeCandidateOwner({ ...session, expected: principal }))
                .resolves.toMatchObject({ replicaOutcome: 'adopted' });
            const baseline = (await readLocal(owner))!.data;
            const edit = await commitDomainOperations(owner, { type: 'profile.patch', patch: { height: '183' } }, baseline);

            await expect(deliverKindeCandidateJournal(session)).rejects.toThrow();
            expect(interrupted).toBe(true);
            expect(isVaultUnlocked(owner)).toBe(true);
            expect(await readLocal(owner)).toEqual(staged);
            expect((await readLocal(owner))?.pending).toEqual(edit.operations);
            expect(fixture.count('sync_receipts', uid)).toBe(1);

            await expect(deliverKindeCandidateJournal(session)).resolves.toBe('acknowledged');
            expect(commits).toBe(1);
            expect((await readLocal(owner))?.cloudflareDelivery).toBeUndefined();
            expect((await readLocal(owner))?.pending).toEqual([]);
            expect((await readLocal(owner))?.baseline.profile?.height).toBe('183');
        } finally {
            fixture.close();
        }
    });

    it('drains a persisted first edit after checking the replica and leaves an empty journal idle', async () => {
        const realClaim = await vi.importActual<typeof import('../../../src/lib/sync/kindeCandidateReplicaClaimBridge')>(
            '../../../src/lib/sync/kindeCandidateReplicaClaimBridge',
        );
        claimSource.claim.mockImplementation(realClaim.claimKindeCandidateReplica);
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            let commits = 0;
            const session = firstPartySession(fixture, (path, _init, response) => {
                if (path === '/v1/sync/commit') {
                    expect(response.status).toBe(200);
                    commits += 1;
                }
                return response;
            });
            await expect(prepareKindeCandidateOwner({ ...session, expected: principal }))
                .resolves.toMatchObject({ replicaOutcome: 'adopted' });
            const baseline = (await readLocal(owner))!.data;
            const edit = await commitDomainOperations(
                owner, { type: 'profile.patch', patch: { height: '184' } }, baseline,
            );
            expect((await readLocal(owner))?.pending).toEqual(edit.operations);
            expect(fixture.count('sync_receipts', uid)).toBe(0);

            lockAllVaults();
            await expect(prepareKindeCandidateOwner({
                ...session, expected: principal, drainPendingJournal: true,
            })).resolves.toMatchObject({
                kind: 'candidate-observed', replicaOutcome: 'already-active',
                journalOutcome: 'acknowledged',
            });
            expect(isVaultUnlocked(owner)).toBe(true);
            expect(commits).toBe(1);
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            expect((await readLocal(owner))?.pending).toEqual([]);
            expect((await readLocal(owner))?.baseline.profile?.height).toBe('184');
            expect((await readLocal(owner))?.data.legalConsent).toEqual(baseline.legalConsent);
            expect((await readLocal(owner))?.baseline.legalConsent).toEqual(baseline.legalConsent);
            const ciphertext = await get<string>('logbook:v2:' + owner);
            expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
            expect(ciphertext).not.toContain('"height":"184"');

            lockAllVaults();
            await expect(prepareKindeCandidateOwner({
                ...session, expected: principal, drainPendingJournal: true,
            })).resolves.toMatchObject({
                kind: 'candidate-observed', replicaOutcome: 'already-active',
                journalOutcome: 'idle',
            });
            expect(commits).toBe(1);
            expect(fixture.count('sync_receipts', uid)).toBe(1);
        } finally {
            fixture.close();
        }
    });
});
