import { describe, expect, it, vi } from 'vitest';
import { get } from 'idb-keyval';
import { bootstrapMocks, uid, owner, principal, firstPartySession } from './kindeOwnerBootstrapFixture';
import { createCloudKeyHttpFixture } from '../../cloudflare/cloud-key-http-fixture.mjs';
import { prepareKindeCandidateOwner } from '../../../src/lib/sync/kindeCandidateOwnerBootstrap';
import { deliverKindeCandidateJournal } from '../../../src/lib/sync/kindeCandidateJournalBridge';
import { prepareKindeCandidateRetiredReplicaEvidenceJson } from '../../../src/lib/auth/kindeCandidateRetiredReplicaEvidence';
import { commitDomainOperations } from '../../../src/lib/sync/localDomainCommit';
import { readLocal } from '../../../src/lib/sync/localArchiveBootstrap';
import { isVaultUnlocked, unlockVaultForOwner } from '../../../src/lib/sync/secureArchiveSession';

const claimSource = bootstrapMocks.claimSource;

async function setup() {
    const claim = await vi.importActual<typeof import('../../../src/lib/sync/kindeCandidateReplicaClaimBridge')>(
        '../../../src/lib/sync/kindeCandidateReplicaClaimBridge',
    );
    claimSource.claim.mockImplementation(claim.claimKindeCandidateReplica);
    const fixture = await createCloudKeyHttpFixture([uid]);
    await fixture.consent(uid);
    const paths: string[] = [];
    const session = firstPartySession(fixture, (path, _init, response) => {
        paths.push(path);
        return response;
    });
    await expect(prepareKindeCandidateOwner({ ...session, expected: principal }))
        .resolves.toMatchObject({ replicaOutcome: 'adopted' });
    const initial = (await readLocal(owner))!.data;
    await commitDomainOperations(owner, { type: 'profile.patch', patch: { height: '182' } }, initial);
    await expect(deliverKindeCandidateJournal(session)).resolves.toBe('acknowledged');
    const committed = (await readLocal(owner))!.data;
    await commitDomainOperations(owner, { type: 'profile.patch', patch: { height: '193' } }, committed);
    return { fixture, paths, session };
}

describe('Kinde candidate: retired replica evidence without recovery', () => {
    it('keeps both conflicting business versions and the original sealed journal without cloud writes', async () => {
        const { fixture, paths, session } = await setup();
        try {
            fixture.sqlite.prepare("UPDATE sync_replicas SET status='retired' WHERE uid=?").run(uid);
            const sealedBefore = await get('logbook:v2:' + owner);
            const journalBefore = (await readLocal(owner))!.pending;
            const keyCount = fixture.count('cloud_account_keys', uid);
            const issuedCount = fixture.count('cloud_key_issuance', uid);
            const receiptCount = fixture.count('sync_receipts', uid);
            const start = paths.length;
            const exported = await prepareKindeCandidateRetiredReplicaEvidenceJson({
                ...session, expected: principal,
            });
            const evidence = JSON.parse(exported.json) as {
                format: string; coverage: { restorableBackup: boolean; atomicAcrossSources: boolean };
                retiredReplica: { pendingOperationCount: number; reasonAtObservation: string };
                cloud: { documents: Array<{ business: { profile: { height: string } } }> };
                device: { envelope: { data: { profile: { height: string } }; pending: unknown[] } };
            };
            expect(evidence.format).toBe('thelogbook-retired-replica-evidence');
            expect(evidence.coverage).toMatchObject({ restorableBackup: false, atomicAcrossSources: false });
            expect(evidence.retiredReplica).toMatchObject({
                pendingOperationCount: journalBefore.length, reasonAtObservation: 'retired',
            });
            expect(evidence.cloud.documents[0].business.profile.height).toBe('182');
            expect(evidence.device.envelope.data.profile.height).toBe('193');
            expect(evidence.device.envelope.pending).toEqual(journalBefore);
            expect(exported.filename).toMatch(/^thelogbook_replica_ritirata_\d{4}-\d{2}-\d{2}\.json$/);
            expect(paths.slice(start)).toContain('/v1/cloud-key/recovery-inspect');
            expect(paths.slice(start)).toContain('/v1/sync/scan');
            expect(paths.slice(start).filter(path => path === '/v1/sync/control')).toHaveLength(2);
            expect(paths.slice(start)).not.toContain('/v1/cloud-key/sync');
            expect(paths.slice(start).every(path => !/claim|commit|retire|receipt/.test(path))).toBe(true);
            expect(fixture.count('cloud_account_keys', uid)).toBe(keyCount);
            expect(fixture.count('cloud_key_issuance', uid)).toBe(issuedCount);
            expect(fixture.count('sync_receipts', uid)).toBe(receiptCount);
            expect(await get('logbook:v2:' + owner)).toEqual(sealedBefore);
            expect(isVaultUnlocked(owner)).toBe(false);
        } finally { fixture.close(); }
    });

    it('refuses an active original replica before reading the cloud key or scan', async () => {
        const { fixture, paths, session } = await setup();
        try {
            const start = paths.length;
            const sealedBefore = await get('logbook:v2:' + owner);
            await expect(prepareKindeCandidateRetiredReplicaEvidenceJson({
                ...session, expected: principal,
            })).rejects.toThrow();
            expect(paths.slice(start)).not.toContain('/v1/cloud-key/recovery-inspect');
            expect(paths.slice(start)).not.toContain('/v1/sync/scan');
            expect(await get('logbook:v2:' + owner)).toEqual(sealedBefore);
            expect(isVaultUnlocked(owner)).toBe(false);
        } finally { fixture.close(); }
    });

    it('fails closed when another tab edits during the AEAD scan', async () => {
        const { fixture } = await setup();
        try {
            fixture.sqlite.prepare("UPDATE sync_replicas SET status='retired' WHERE uid=?").run(uid);
            const session = firstPartySession(fixture, async (path, _init, response) => {
                if (path === '/v1/sync/scan') {
                    const latest = (await readLocal(owner))!.data;
                    await commitDomainOperations(owner, {
                        type: 'profile.patch', patch: { height: '194' },
                    }, latest);
                }
                return response;
            });
            await expect(prepareKindeCandidateRetiredReplicaEvidenceJson({
                ...session, expected: principal,
            })).rejects.toThrow();
            expect(isVaultUnlocked(owner)).toBe(false);
            const grant = await unlockVaultForOwner(owner);
            try { expect((await readLocal(owner))?.pending).toHaveLength(2); }
            finally { grant.release(); }
        } finally { fixture.close(); }
    });

    it('does not provision a missing cloud key or create a partial evidence file', async () => {
        const { fixture } = await setup();
        try {
            fixture.sqlite.prepare("UPDATE sync_replicas SET status='retired' WHERE uid=?").run(uid);
            const paths: string[] = [];
            const before = await get('logbook:v2:' + owner);
            const keyCount = fixture.count('cloud_account_keys', uid);
            const session = firstPartySession(fixture, (path, _init, response) => {
                paths.push(path);
                return path === '/v1/cloud-key/recovery-inspect'
                    ? Response.json({ error: 'cloud-key-not-issued' }, { status: 404 }) : response;
            });
            await expect(prepareKindeCandidateRetiredReplicaEvidenceJson({
                ...session, expected: principal,
            })).rejects.toThrow();
            expect(paths).toContain('/v1/cloud-key/recovery-inspect');
            expect(paths).not.toContain('/v1/cloud-key/sync');
            expect(paths).not.toContain('/v1/sync/scan');
            expect(fixture.count('cloud_account_keys', uid)).toBe(keyCount);
            expect(await get('logbook:v2:' + owner)).toEqual(before);
            expect(isVaultUnlocked(owner)).toBe(false);
        } finally { fixture.close(); }
    });

    it('rejects unauthenticated cloud ciphertext instead of exporting a cloud version', async () => {
        const { fixture } = await setup();
        try {
            fixture.sqlite.prepare("UPDATE sync_replicas SET status='retired' WHERE uid=?").run(uid);
            const session = firstPartySession(fixture, async (path, _init, response) => {
                if (path !== '/v1/sync/scan') return response;
                const page = await response.json() as {
                    documents: Array<{ document: { _sealed: { ciphertext: string } } }>;
                };
                const sealed = page.documents[0]?.document._sealed;
                if (!sealed) throw Error('Synthetic cloud ciphertext missing');
                sealed.ciphertext = (sealed.ciphertext[0] === 'A' ? 'B' : 'A')
                    + sealed.ciphertext.slice(1);
                return Response.json(page, { headers: { 'Cache-Control': 'no-store' } });
            });
            await expect(prepareKindeCandidateRetiredReplicaEvidenceJson({
                ...session, expected: principal,
            })).rejects.toThrow();
            expect(isVaultUnlocked(owner)).toBe(false);
        } finally { fixture.close(); }
    });
});
