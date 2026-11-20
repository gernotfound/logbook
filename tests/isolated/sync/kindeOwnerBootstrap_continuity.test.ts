import { describe, expect, it, vi } from 'vitest';
import { bootstrapMocks, uid, owner, principal, cookie, server, start, firstPartySession } from './kindeOwnerBootstrapFixture';
import { clear, get } from 'idb-keyval';
import { issueVerifiedSession } from '../../../cloudflare/auth/session-issuer.mjs';
import { createCloudKeyHttpFixture } from '../../cloudflare/cloud-key-http-fixture.mjs';
import { prepareKindeCandidateOwner } from '../../../src/lib/sync/kindeCandidateOwnerBootstrap';
import { deliverKindeCandidateJournal } from '../../../src/lib/sync/kindeCandidateJournalBridge';
import { readLocal } from '../../../src/lib/sync/localArchiveBootstrap';
import { commitDomainOperations } from '../../../src/lib/sync/localDomainCommit';
import { isVaultUnlocked, lockAllVaults, readVaultControl, unlockVaultForOwner } from '../../../src/lib/sync/secureArchiveSession';

const claimSource = bootstrapMocks.claimSource;

describe('Kinde synthetic owner: second device and concurrent session recovery', () => {
    it('does not claim complete journal delivery when a second edit arrives after remote commit', async () => {
        const realClaim = await vi.importActual<typeof import('../../../src/lib/sync/kindeCandidateReplicaClaimBridge')>(
            '../../../src/lib/sync/kindeCandidateReplicaClaimBridge',
        );
        claimSource.claim.mockImplementation(realClaim.claimKindeCandidateReplica);
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            let commits = 0;
            let later: Awaited<ReturnType<typeof commitDomainOperations>> | undefined;
            const session = firstPartySession(fixture, async (path, _init, response) => {
                if (path === '/v1/sync/commit') {
                    expect(response.status).toBe(200);
                    commits += 1;
                    if (commits === 1) {
                        const current = (await readLocal(owner))!.data;
                        later = await commitDomainOperations(
                            owner, { type: 'profile.patch', patch: { height: '187' } }, current,
                        );
                    }
                }
                return response;
            });
            await expect(prepareKindeCandidateOwner({ ...session, expected: principal }))
                .resolves.toMatchObject({ replicaOutcome: 'adopted' });
            const baseline = (await readLocal(owner))!.data;
            await commitDomainOperations(
                owner, { type: 'profile.patch', patch: { height: '186' } }, baseline,
            );
            lockAllVaults();

            await expect(prepareKindeCandidateOwner({
                ...session, expected: principal, drainPendingJournal: true,
                retainDeviceVault: false,
            })).resolves.toMatchObject({
                kind: 'journal-pending', journalOutcome: 'acknowledged', pendingCount: 1,
            });
            expect(isVaultUnlocked(owner)).toBe(false);
            expect(commits).toBe(1);
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            await unlockVaultForOwner(owner);
            const remaining = await readLocal(owner);
            expect(remaining?.pending).toEqual(later?.operations);
            expect(remaining?.baseline.profile?.height).toBe('186');
            expect(remaining?.data.profile?.height).toBe('187');
            expect(remaining?.data.legalConsent).toEqual(baseline.legalConsent);
            expect(remaining?.baseline.legalConsent).toEqual(baseline.legalConsent);
            lockAllVaults();

            await expect(prepareKindeCandidateOwner({
                ...session, expected: principal, drainPendingJournal: true,
                retainDeviceVault: false,
            })).resolves.toMatchObject({
                kind: 'candidate-observed', journalOutcome: 'acknowledged',
                journalDrained: true,
            });
            expect(isVaultUnlocked(owner)).toBe(false);
            expect(commits).toBe(2);
            expect(fixture.count('sync_receipts', uid)).toBe(2);
            await unlockVaultForOwner(owner);
            const complete = await readLocal(owner);
            expect(complete?.pending).toEqual([]);
            expect(complete?.baseline.profile?.height).toBe('187');
        } finally {
            fixture.close();
        }
    });

    it('opens a remote encrypted first save on another independent device vault and session', async () => {
        const realClaim = await vi.importActual<typeof import('../../../src/lib/sync/kindeCandidateReplicaClaimBridge')>(
            '../../../src/lib/sync/kindeCandidateReplicaClaimBridge',
        );
        claimSource.claim.mockImplementation(realClaim.claimKindeCandidateReplica);
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const firstSession = firstPartySession(fixture, (_path, _init, response) => response);
            await expect(prepareKindeCandidateOwner({ ...firstSession, expected: principal }))
                .resolves.toMatchObject({ replicaOutcome: 'adopted' });
            const source = await readLocal(owner);
            const firstReplica = source?.replica;
            const firstVault = readVaultControl(owner);
            await commitDomainOperations(owner, {
                type: 'profile.patch', patch: { height: '186' },
            }, source!.data);
            await expect(deliverKindeCandidateJournal(firstSession)).resolves.toBe('acknowledged');
            expect(fixture.count('sync_documents', uid)).toBe(1);
            expect(fixture.count('sync_receipts', uid)).toBe(1);

            // Independent browser profile: no local key, envelope, identity
            // hint or pending operation survives, while the D1 cloud remains.
            lockAllVaults();
            localStorage.clear();
            await clear();
            const issued = await issueVerifiedSession(fixture.db, uid);
            const cookies = issued.setCookies.map((value: string) => value.split(';')[0]).join('; ');
            const csrf = issued.setCookies[1].split(';')[0].split('=')[1];
            fixture.sessions.set(uid, { cookies, csrf });
            const secondSession = firstPartySession(fixture, (_path, _init, response) => response);
            await expect(prepareKindeCandidateOwner({ ...secondSession, expected: principal }))
                .resolves.toMatchObject({ replicaOutcome: 'adopted' });
            const downloaded = await readLocal(owner);
            expect(downloaded?.data.profile?.height).toBe('186');
            expect(downloaded?.baseline.profile?.height).toBe('186');
            expect(downloaded?.pending).toEqual([]);
            expect(downloaded?.replica?.replicaId).not.toBe(firstReplica?.replicaId);
            expect(readVaultControl(owner)?.wrappedKey).not.toEqual(firstVault?.wrappedKey);
            expect(fixture.count('sync_documents', uid)).toBe(1);
            expect(fixture.count('sync_receipts', uid)).toBe(1);
        } finally {
            fixture.close();
        }
    });

    it('closes its vault after a lost first-save response and reconciles without a second commit', async () => {
        const realClaim = await vi.importActual<typeof import('../../../src/lib/sync/kindeCandidateReplicaClaimBridge')>(
            '../../../src/lib/sync/kindeCandidateReplicaClaimBridge',
        );
        claimSource.claim.mockImplementation(realClaim.claimKindeCandidateReplica);
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            let commits = 0;
            let loseResponse = true;
            let receiptUnavailable = false;
            const session = firstPartySession(fixture, (path, _init, response) => {
                if (path === '/v1/sync/commit') {
                    expect(response.status).toBe(200);
                    commits += 1;
                    if (loseResponse) {
                        loseResponse = false;
                        // The initial receipt lookup must reach D1 before
                        // failure injection: only the post-commit reply is lost.
                        receiptUnavailable = true;
                        throw new TypeError('D1 committed; HTTP response lost');
                    }
                }
                if (path === '/v1/sync/receipt' && receiptUnavailable) {
                    return Response.json({ error: 'unavailable' }, {
                        status: 503, headers: { 'Cache-Control': 'no-store' },
                    });
                }
                return response;
            });
            await expect(prepareKindeCandidateOwner({ ...session, expected: principal }))
                .resolves.toMatchObject({ replicaOutcome: 'adopted' });
            const baseline = (await readLocal(owner))!.data;
            const edit = await commitDomainOperations(
                owner, { type: 'profile.patch', patch: { height: '185' } }, baseline,
            );

            lockAllVaults();
            await expect(prepareKindeCandidateOwner({
                ...session, expected: principal, drainPendingJournal: true,
            })).rejects.toThrow();
            expect(isVaultUnlocked(owner)).toBe(false);
            expect(commits).toBe(1);
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            await unlockVaultForOwner(owner);
            const preserved = await readLocal(owner);
            expect(preserved?.cloudflareDelivery).toBeDefined();
            expect(preserved?.pending).toEqual(edit.operations);
            const ciphertext = await get<string>('logbook:v2:' + owner);
            expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
            lockAllVaults();

            receiptUnavailable = false;
            await expect(prepareKindeCandidateOwner({
                ...session, expected: principal, drainPendingJournal: true,
            })).resolves.toMatchObject({
                kind: 'candidate-observed', replicaOutcome: 'already-active',
                journalOutcome: 'idle',
            });
            expect(commits).toBe(1);
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            expect((await readLocal(owner))?.cloudflareDelivery).toBeUndefined();
            expect((await readLocal(owner))?.pending).toEqual([]);
            expect((await readLocal(owner))?.baseline.profile?.height).toBe('185');
        } finally {
            fixture.close();
        }
    });

    it('a delayed scan from a replaced session cannot lock a newer grant for the same owner', async () => {
        let liveCookie = cookie();
        let finishScan!: () => void;
        const paused = new Promise<void>(resolve => { finishScan = resolve; });
        const respond = server();
        const send = vi.fn<typeof fetch>(async (path, init) => {
            if (path === '/v1/sync/scan') await paused;
            return respond(path, init);
        });
        const obsolete = start(send, () => liveCookie);
        const rejected = expect(obsolete).rejects.toThrow();
        try {
            await vi.waitFor(() => expect(send).toHaveBeenCalledWith('/v1/sync/scan', expect.anything()));
            expect(isVaultUnlocked(owner)).toBe(true);
            liveCookie = '__Host-logbook_csrf=' + 'B'.repeat(42) + 'A';
            const newer = await unlockVaultForOwner(owner);
            finishScan();
            await rejected;
            expect(newer.isCurrent()).toBe(true);
            expect(await get('logbook:v2:' + owner)).toBeUndefined();
            expect(claimSource.claim).not.toHaveBeenCalled();
        } finally {
            finishScan();
            await obsolete.catch(() => {});
        }
    });
});
