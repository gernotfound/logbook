import { describe, expect, it, vi } from 'vitest';
import { claimSource, uid, owner, principal, firstPartySession } from './kindeOwnerBootstrapFixture';
import { get } from 'idb-keyval';
import { createCloudKeyHttpFixture } from '../../cloudflare/cloud-key-http-fixture.mjs';
import { prepareKindeCandidateOwner } from '../../../src/lib/sync/kindeCandidateOwnerBootstrap';
import { deliverKindeCandidateJournal } from '../../../src/lib/sync/kindeCandidateJournalBridge';
import { withKindeCandidateRightsCheckpoint } from '../../../src/lib/auth/kindeCandidateRightsCheckpoint';
import { prepareKindeCandidateRightsJson, requestKindeCandidateRightsJsonDownload } from '../../../src/lib/auth/kindeCandidateRightsExport';
import { prepareKindeCandidatePreWithdrawalJson, requestKindeCandidatePreWithdrawalJsonDownload } from '../../../src/lib/auth/kindeCandidatePreWithdrawalExport';
import { protectedDeviceKey } from '../../../src/lib/sync/deviceStorageKeys';
import { sealLocalText } from '../../../src/lib/sync/secureArchiveCipher';
import { readLocal } from '../../../src/lib/sync/localArchiveBootstrap';
import { commitDomainOperations } from '../../../src/lib/sync/localDomainCommit';
import { isVaultUnlocked, lockAllVaults, requireUnlockedLocalKey, unlockVaultForOwner } from '../../../src/lib/sync/secureArchiveSession';

describe('Kinde synthetic owner: verified rights, withdrawal and privacy export', () => {
    it('reads and AEAD-authenticates revoked ciphertext without reopening the fitness vault or replaying sync', async () => {
        const realClaim = await vi.importActual<typeof import('../../../src/lib/sync/kindeCandidateReplicaClaimBridge')>(
            '../../../src/lib/sync/kindeCandidateReplicaClaimBridge',
        );
        claimSource.claim.mockImplementation(realClaim.claimKindeCandidateReplica);
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const observed: string[] = [];
            const session = firstPartySession(fixture, (path, _init, response) => {
                observed.push(path); return response;
            });
            await expect(prepareKindeCandidateOwner({
                ...session, expected: principal, retainDeviceVault: false,
            })).resolves.toMatchObject({ replicaOutcome: 'adopted' });
            expect(isVaultUnlocked(owner)).toBe(false);
            await unlockVaultForOwner(owner);
            const baseline = (await readLocal(owner))!.data;
            await commitDomainOperations(owner, { type: 'profile.patch', patch: { height: '194' } }, baseline);
            await expect(deliverKindeCandidateJournal(session)).resolves.toBe('acknowledged');
            expect(fixture.count('sync_documents', uid)).toBe(1);
            lockAllVaults();
            expect(isVaultUnlocked(owner)).toBe(false);
            await fixture.withdraw(uid);
            const before = observed.length;
            const retrieved = await withKindeCandidateRightsCheckpoint({
                ...session, expected: { ...principal, healthConsentRevision: 1 as const },
                consumeCheckpoint: async (checkpoint, current) => {
                    expect(current()).toBe(true);
                    expect(checkpoint.consentRevision).toBe(1);
                    expect(checkpoint.documents.size).toBe(1);
                    return checkpoint.documents.get('')?.business;
                },
            });
            expect(retrieved).toMatchObject({ profile: { height: '194' } });
            const exported = await prepareKindeCandidateRightsJson({
                ...session, expected: { ...principal, healthConsentRevision: 1 as const },
            });
            const payload = JSON.parse(exported.json) as unknown;
            expect(exported.filename).toMatch(/^thelogbook_diritti_cloud_\d{4}-\d{2}-\d{2}\.json$/);
            expect(exported.documentCount).toBe(1);
            expect(payload).toMatchObject({
                format: 'thelogbook-cloud-rights-export',
                version: 1, type: 'rights-only', owner,
                cloud: { consentRevision: 1, fenceEpoch: 1 },
                coverage: {
                    scope: 'cloud-documents-still-readable',
                    completeness: 'not-proven-after-withdrawal',
                    includesDeviceData: false,
                    includesPendingJournal: false,
                    includesDeviceDrafts: false,
                    restorableBackup: false,
                },
                documents: [{ path: '', dataSchemaVersion: 1,
                    business: { profile: { height: '194' } } }],
            });
            const clicked = vi.fn();
            const removed = vi.fn();
            const appended = vi.fn();
            const link = { href: '', download: '', style: { visibility: '' },
                click: clicked, remove: removed };
            vi.stubGlobal('document', {
                createElement: vi.fn(() => link),
                body: { appendChild: appended },
            });
            const objectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rights-synthetic');
            vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
            await requestKindeCandidateRightsJsonDownload({
                ...session, expected: { ...principal, healthConsentRevision: 1 as const },
            });
            expect(objectUrl).toHaveBeenCalledTimes(1);
            expect(appended).toHaveBeenCalledWith(link);
            expect(clicked).toHaveBeenCalledTimes(1);
            expect(removed).toHaveBeenCalledTimes(1);
            expect(link.download).toMatch(/^thelogbook_diritti_cloud_\d{4}-\d{2}-\d{2}\.json$/);
            const corrupted = firstPartySession(fixture, async (path, _init, response) => {
                if (path !== '/v1/rights/scan') return response;
                const page = await response.json() as {
                    documents: Array<{ document: { _sealed: { ciphertext: string } } }>;
                };
                const sealed = page.documents[0]?.document._sealed;
                if (!sealed) throw Error('Synthetic rights document is missing');
                sealed.ciphertext = (sealed.ciphertext[0] === 'A' ? 'B' : 'A')
                    + sealed.ciphertext.slice(1);
                return Response.json(page, { headers: { 'Cache-Control': 'no-store' } });
            });
            await expect(requestKindeCandidateRightsJsonDownload({
                ...corrupted, expected: { ...principal, healthConsentRevision: 1 as const },
            })).rejects.toThrow();
            expect(objectUrl).toHaveBeenCalledTimes(1);
            expect(clicked).toHaveBeenCalledTimes(1);
            let current = true;
            const replaced = firstPartySession(fixture, (path, _init, response) => {
                if (path === '/v1/rights/scan') current = false;
                return response;
            });
            await expect(prepareKindeCandidateRightsJson({
                ...replaced, expected: { ...principal, healthConsentRevision: 1 as const },
                stillCurrent: () => current,
            })).rejects.toThrow();
            expect(isVaultUnlocked(owner)).toBe(false);
            expect(observed.slice(before).filter(path => path === '/v1/rights/scan')).toHaveLength(3);
            expect(observed.slice(before)).not.toContain('/v1/sync/scan');
            expect(observed.slice(before)).not.toContain('/v1/cloud-key/sync');
            expect(observed.slice(before)).not.toContain('/v1/sync/commit');
            expect(fixture.count('sync_receipts', uid)).toBe(1);
            expect(fixture.count('health_erasure_jobs', uid)).toBe(1);
            await expect(prepareKindeCandidateOwner({ ...session, expected: principal }))
                .rejects.toThrow();
        } finally { fixture.close(); }
    });

    it('exports separately verified cloud and durable device evidence before Kinde withdrawal', async () => {
        const actualClaim = await vi.importActual<typeof import('../../../src/lib/sync/kindeCandidateReplicaClaimBridge')>(
            '../../../src/lib/sync/kindeCandidateReplicaClaimBridge',
        );
        claimSource.claim.mockImplementation(actualClaim.claimKindeCandidateReplica);
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const paths: string[] = [];
            const session = firstPartySession(fixture, (path, _init, response) => {
                paths.push(path);
                return response;
            });
            await expect(prepareKindeCandidateOwner({ ...session, expected: principal }))
                .resolves.toMatchObject({ replicaOutcome: 'adopted' });
            expect(isVaultUnlocked(owner)).toBe(true);
            const initial = (await readLocal(owner))!.data;
            await commitDomainOperations(owner, {
                type: 'profile.patch', patch: { height: '182' },
            }, initial);
            await expect(deliverKindeCandidateJournal(session)).resolves.toBe('acknowledged');
            const committed = (await readLocal(owner))!.data;
            await commitDomainOperations(owner, {
                type: 'profile.patch', patch: { height: '193' },
            }, committed);
            const exportPathStart = paths.length;
            const draftKey = protectedDeviceKey('draft:measurement:2026-11-19', owner);
            const draftValue = '{"weight":"79"}';
            localStorage.setItem(draftKey, sealLocalText(
                requireUnlockedLocalKey(owner), owner, draftKey, draftValue,
            ));

            const result = await prepareKindeCandidatePreWithdrawalJson({ ...session, expected: principal });
            expect(result.cloudDocumentCount).toBe(1);
            expect(result.deviceWitnessCount).toBe(1);
            expect(result.pendingOperationCount).toBe(1);
            const decoded = JSON.parse(result.json) as {
                format: string; owner: string;
                coverage: { atomicAcrossSources: boolean; restorableBackup: boolean; containsPendingJournal: boolean };
                cloud: { revision: number; documents: Array<{path: string; business: { profile: { height: string } } }> };
                device: { envelope: { data: { profile: { height: string } }; pending: unknown[] };
                    recovery: Record<string, string> };
            };
            expect(decoded).toMatchObject({
                format: 'thelogbook-prewithdrawal-evidence', owner,
                coverage: { atomicAcrossSources: false, restorableBackup: false, containsPendingJournal: true },
                cloud: { documents: [{ path: '', business: { profile: { height: '182' } } }] },
            });
            expect(decoded.device.envelope.data.profile.height).toBe('193');
            expect(decoded.device.envelope.pending).toHaveLength(1);
            expect(decoded.device.recovery['draft:measurement:2026-11-19']).toBe(draftValue);
            expect(result.json).not.toContain('tlb-sealed:v1:');
            expect(paths.slice(exportPathStart)).not.toContain('/v1/rights/scan');
            expect(paths.slice(exportPathStart)).not.toContain('/v1/sync/commit');

            // A local edit between the initial IDB read and the cloud page
            // must invalidate the whole export, not silently omit that edit.
            const racingSession = firstPartySession(fixture, async (path, _init, response) => {
                if (path === '/v1/sync/scan') {
                    const baseline = (await readLocal(owner))!.data;
                    await commitDomainOperations(owner, {
                        type: 'profile.patch', patch: { height: '194' },
                    }, baseline);
                }
                return response;
            });
            await expect(prepareKindeCandidatePreWithdrawalJson({
                ...racingSession, expected: principal,
            })).rejects.toThrow();
            expect((await readLocal(owner))?.data.profile?.height).toBe('194');
            const racingWitness = firstPartySession(fixture, (path, _init, response) => {
                if (path === '/v1/sync/scan') {
                    localStorage.setItem(draftKey, sealLocalText(
                        requireUnlockedLocalKey(owner), owner, draftKey, '{"weight":"80"}',
                    ));
                }
                return response;
            });
            await expect(prepareKindeCandidatePreWithdrawalJson({
                ...racingWitness, expected: principal,
            })).rejects.toThrow();
            expect((await readLocal(owner))?.pending).toHaveLength(2);

            const clicked = vi.fn();
            const link = { href: '', download: '', style: { visibility: '' },
                click: clicked, remove: vi.fn() };
            vi.stubGlobal('document', {
                createElement: vi.fn(() => link),
                body: { appendChild: vi.fn() },
            });
            const url = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:prewithdrawal-test');
            vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
            await requestKindeCandidatePreWithdrawalJsonDownload({ ...session, expected: principal });
            expect(clicked).toHaveBeenCalledOnce();
            expect(url).toHaveBeenCalledOnce();

            await fixture.withdraw(uid);
            await expect(prepareKindeCandidatePreWithdrawalJson({
                ...session, expected: principal,
            })).rejects.toThrow();
            lockAllVaults();
            await expect(prepareKindeCandidatePreWithdrawalJson({
                ...session, expected: principal,
            })).rejects.toThrow();
        } finally { fixture.close(); }
    });
});
