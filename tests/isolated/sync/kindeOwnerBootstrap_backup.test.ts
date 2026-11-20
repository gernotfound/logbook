import { describe, expect, it, vi } from 'vitest';
import { catalogSource, catalog, claimSource, uid, owner, principal, firstPartySession } from './kindeOwnerBootstrapFixture';
import { createCloudKeyHttpFixture } from '../../cloudflare/cloud-key-http-fixture.mjs';
import { prepareKindeCandidateOwner } from '../../../src/lib/sync/kindeCandidateOwnerBootstrap';
import { deliverKindeCandidateJournal } from '../../../src/lib/sync/kindeCandidateJournalBridge';
import { prepareKindeCandidatePreWithdrawalJson } from '../../../src/lib/auth/kindeCandidatePreWithdrawalExport';
import { prepareKindeCandidatePortableBackupJson, requestKindeCandidatePortableBackupDownload } from '../../../src/lib/auth/kindeCandidatePortableBackup';
import { decodeImport, prepareImport } from '../../../src/lib/backup';
import { UserDataSchema } from '../../../src/lib/schema';
import { updateArchiveRecord } from '../../../src/lib/sync/secureArchiveRepository';
import { protectedDeviceKey } from '../../../src/lib/sync/deviceStorageKeys';
import { sealLocalText } from '../../../src/lib/sync/secureArchiveCipher';
import { readLocal } from '../../../src/lib/sync/localArchiveBootstrap';
import { commitDomainOperations } from '../../../src/lib/sync/localDomainCommit';
import { requireUnlockedLocalKey } from '../../../src/lib/sync/secureArchiveSession';

describe('Kinde synthetic owner: restorable portable backup evidence', () => {
    it('prepares importable Schema 3 with real D1 data, an unsent local edit and device drafts', async () => {
        const realClaim = await vi.importActual<typeof import('../../../src/lib/sync/kindeCandidateReplicaClaimBridge')>(
            '../../../src/lib/sync/kindeCandidateReplicaClaimBridge',
        );
        claimSource.claim.mockImplementation(realClaim.claimKindeCandidateReplica);
        const fixture = await createCloudKeyHttpFixture([uid]);
        try {
            await fixture.consent(uid);
            const seen: string[] = [];
            const session = firstPartySession(fixture, (path, _init, response) => {
                seen.push(path);
                return response;
            });
            await expect(prepareKindeCandidateOwner({ ...session, expected: principal }))
                .resolves.toMatchObject({ replicaOutcome: 'adopted' });
            const local = (await readLocal(owner))!.data;
            await commitDomainOperations(owner, { type: 'profile.patch', patch: { height: '182' } }, local);
            await expect(deliverKindeCandidateJournal(session)).resolves.toBe('acknowledged');
            const delivered = (await readLocal(owner))!.data;
            await commitDomainOperations(owner, { type: 'profile.patch', patch: { height: '193' } }, delivered);
            const witnessKey = protectedDeviceKey('draft:measurement:2026-11-19', owner);
            localStorage.setItem(witnessKey, sealLocalText(
                requireUnlockedLocalKey(owner), owner, witnessKey, '{"weight":"79"}',
            ));
            const start = seen.length;
            const prepared = await prepareKindeCandidatePortableBackupJson({ ...session, expected: principal });
            const backup = prepared.backup;
            expect(backup).toMatchObject({
                format: 'logbook-backup', type: 'backup', owner,
                coverage: { scope: 'cloud-and-device' },
                userData: { profile: { height: '193' } },
            });
            expect(backup.recovery).toMatchObject({
                envelope: { data: { profile: { height: '193' } }, pending: [expect.any(Object)] },
                device: { 'draft:measurement:2026-11-19': '{"weight":"79"}' },
                cloudDocuments: { '': { profile: { height: '182' } } },
            });
            const decoded = decodeImport(JSON.parse(prepared.json), owner);
            expect(decoded.data).toMatchObject({ profile: { height: '193' } });
            expect(decoded.deviceDrafts).toEqual([{ name: 'draft:measurement:2026-11-19', value: '{"weight":"79"}' }]);
            const baseline = UserDataSchema.parse({});
            const merged = prepareImport(baseline, decoded.data, 'restore', decoded.coverage);
            expect(merged.data.profile?.height).toBe('193');
            // Decode success alone is insufficient: the production restore
            // projection must reconstruct the entire archived business state.
            const cleanOwner = UserDataSchema.parse({
                legalConsent: backup.userData.legalConsent,
            });
            const restored = prepareImport(cleanOwner, decoded.data, 'restore', decoded.coverage);
            expect(restored.data).toEqual(backup.userData);
            // The account's CURRENT legal acceptance cannot be imported from
            // an old file, even when its owner and business are authentic.
            const renewedConsent = { ...backup.userData.legalConsent,
                acceptedAt: '2026-11-20T00:00:00.000Z' };
            const newOwnerState = UserDataSchema.parse({ legalConsent: renewedConsent });
            const withNewConsent = prepareImport(newOwnerState, decoded.data, 'restore', decoded.coverage);
            expect(withNewConsent.data.legalConsent).toEqual(renewedConsent);
            expect(withNewConsent.data.profile).toEqual(backup.userData.profile);
            expect(() => decodeImport(JSON.parse(prepared.json), 'user:' + 'k_' + 'B'.repeat(43)))
                .toThrow();
            expect(seen.slice(start)).toContain('/v1/sync/scan');
            expect(seen.slice(start)).not.toContain('/v1/sync/commit');
            expect(seen.slice(start)).not.toContain('/v1/rights/scan');

            const clicked = vi.fn();
            const link = { href: '', download: '', style: { visibility: '' },
                click: clicked, remove: vi.fn() };
            vi.stubGlobal('document', {
                createElement: vi.fn(() => link),
                body: { appendChild: vi.fn() },
            });
            const downloadUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:kinde-portable');
            vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
            await requestKindeCandidatePortableBackupDownload({ ...session, expected: principal });
            expect(clicked).toHaveBeenCalledOnce();
            expect(link.download).toMatch(/^thelogbook_backup_prima_revoca_/);
            expect(downloadUrl).toHaveBeenCalledOnce();

            const incompleteCloud = firstPartySession(fixture, async (path, _init, response) => {
                if (path !== '/v1/sync/scan') return response;
                const page = await response.clone().json() as Record<string, unknown>;
                return Response.json({ ...page, documents: [] }, {
                    status: response.status,
                    headers: { 'Cache-Control': 'no-store' },
                });
            });
            await expect(prepareKindeCandidatePortableBackupJson({
                ...incompleteCloud, expected: principal,
            })).rejects.toThrow();
            expect((await readLocal(owner))?.data.profile?.height).toBe('193');

            // A new local commit during the asynchronous catalog load cannot
            // slip past the earlier two-store snapshot and into a stale file.
            catalogSource.read.mockImplementationOnce(async () => {
                const current = (await readLocal(owner))!.data;
                await commitDomainOperations(owner, {
                    type: 'profile.patch', patch: { height: '194' },
                }, current);
                return catalog;
            });
            await expect(prepareKindeCandidatePortableBackupJson({
                ...session, expected: principal,
            })).rejects.toThrow();
            expect((await readLocal(owner))?.data.profile?.height).toBe('194');

            catalogSource.read.mockImplementationOnce(async () => {
                localStorage.setItem(witnessKey, sealLocalText(
                    requireUnlockedLocalKey(owner), owner, witnessKey, '{"weight":"80"}',
                ));
                return catalog;
            });
            await expect(prepareKindeCandidatePortableBackupJson({
                ...session, expected: principal,
            })).rejects.toThrow();

            // A held persistence fence must never become a full restorable
            // backup; the previous independent evidence remains exportable.
            await updateArchiveRecord<any>(owner, raw => ({
                ...raw, cloudIntegrityFence: 'synthetic-conflict',
            }));
            await expect(prepareKindeCandidatePortableBackupJson({
                ...session, expected: principal,
            })).rejects.toThrow();
            await expect(prepareKindeCandidatePreWithdrawalJson({
                ...session, expected: principal,
            })).resolves.toHaveProperty('json');

            // Revocation invalidates even a previously verified local vault.
            await fixture.withdraw(uid);
            await expect(prepareKindeCandidatePortableBackupJson({
                ...session, expected: principal,
            })).rejects.toThrow();
        } finally { fixture.close(); }
    });
});
