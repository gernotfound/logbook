import { get } from 'idb-keyval';
import { describe, expect, it, vi } from 'vitest';

const catalogSource = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: catalogSource.read }));

import { LEGAL_VERSIONS } from '../../../src/lib/legalVersions';
import { CURRENT_SYNC_PROTOCOL } from '../../../src/lib/schemaEvolution';
import { initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { projectDocuments } from '../../../src/lib/sync/documentProjection';
import type { SyncMeta } from '../../../src/lib/sync/semanticProjection';
import { sealCloudDocument } from '../../../src/lib/sync/cloudDocumentCipher';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { SEALED_LOCAL_PREFIX } from '../../../src/lib/sync/secureArchiveCipher';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';
import { hydrateKindeCandidateArchive } from '../../../src/lib/sync/kindeCandidateArchiveHydration';
import { accountKey, catalog, state, workout, installLocalCloudHydrationFixture } from './localCloudHydrationFixture';

installLocalCloudHydrationFixture(() => { catalogSource.read.mockReset().mockResolvedValue(catalog); });

describe('Kinde checkpoint to a device-owned archive', () => {
    const uid = 'k_' + 'A'.repeat(43);
    const kindeOwner = 'user:' + uid;
    const storageKey = 'logbook:v2:' + kindeOwner;
    const principal = { uid, fenceEpoch: 1, healthConsentRevision: 1 };
    const browserCookies = () => '__Host-logbook_csrf=' + 'A'.repeat(43);

    function server(beforeScan?: () => Promise<void>): typeof fetch {
        const meta: SyncMeta = { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: { s01: 1 }, fields: {},
            writer: { slot: 's01', replicaId: 'synthetic-kinde-device', generation: 1, seq: 1, consentRevision: 1 } };
        const snapshot = state('190', {}, [workout('cloud-history', '2026-01-01')]);
        const documents = [...projectDocuments(snapshot, catalog)].map(([path, doc]) => ({
            path, revision: 1, document: sealCloudDocument(accountKey, uid, path, doc, meta),
        }));
        return vi.fn<typeof fetch>().mockImplementation(async input => {
            const json = (body: unknown) => Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
            switch (input) {
                case '/api/auth/session': return json({ ...principal, authenticated: true, emailVerified: true });
                case '/v1/consent/status': return json({ uid, status: 'active', revision: 1, fenceEpoch: 1,
                    acceptedAt: '2026-11-16T00:00:00.000Z', privacyVersion: LEGAL_VERSIONS.privacy,
                    observedAtMs: Date.parse('2026-11-16T00:00:00.000Z'),
                    termsVersion: LEGAL_VERSIONS.terms });
                case '/v1/cloud-key/sync': return json({ format: 'thelogbook-account-data-key', version: 1,
                    uid, fenceEpoch: 1, consentRevision: 1, purpose: 'sync', key: btoa(String.fromCharCode(...accountKey)) });
                case '/v1/sync/scan':
                    await beforeScan?.();
                    return json({ revision: 1, fenceEpoch: 1, consentRevision: 1, complete: true,
                        nextAfter: null, documents });
                default: throw Error('Unexpected request');
            }
        });
    }

    it('stores an AEAD cloud baseline as ciphertext under the device vault and creates no receipt or replica', async () => {
        await createAndMigrateVault(kindeOwner);
        const result = await hydrateKindeCandidateArchive({ expected: principal, browserCookies,
            stillCurrent: () => true, send: server() });
        expect(result.checkpointRevision).toBe(1);
        expect(result.envelope).toMatchObject({ owner: kindeOwner, consentRevision: 1, replica: null,
            pending: [], completeMonths: ['2026-01'], data: { profile: { height: '190' }, history: [{ id: 'cloud-history' }] } });
        expect(result.envelope.cloudflareDelivery).toBeUndefined();
        const trustedLegal = {
            hasAcceptedHealthData: true, hasAcceptedTerms: true,
            acceptedAt: '2026-11-16T00:00:00.000Z',
            privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms,
        };
        // D1 may be empty or carry an obsolete encrypted root, but the
        // trusted consent row must seed the device-encrypted baseline.
        expect(result.envelope.data.legalConsent).toEqual(trustedLegal);
        expect(result.envelope.baseline.legalConsent).toEqual(trustedLegal);
        expect(result.envelope.pending).toEqual([]);
        expect(await readLocal(kindeOwner)).toEqual(result.envelope);
        const cipher = await get<string>(storageKey);
        expect(cipher?.startsWith(SEALED_LOCAL_PREFIX)).toBe(true);
        expect(cipher).not.toContain('cloud-history');
        expect(cipher).not.toContain('2026-11-16T00:00:00.000Z');
        expect(localStorage.getItem(storageKey + ':health-consent-generation')).toBeNull();
    });

    it('does not create a local archive from an outdated trusted legal receipt', async () => {
        await createAndMigrateVault(kindeOwner);
        const original = server();
        const send = vi.fn<typeof fetch>().mockImplementation(async (...args) => {
            const response = await original(...args);
            if (args[0] !== '/v1/consent/status') return response;
            return Response.json({
                uid, status: 'active', revision: 1, fenceEpoch: 1,
                acceptedAt: '2026-11-16T00:00:00.000Z',
                observedAtMs: Date.parse('2026-11-16T00:00:00.000Z'),
                privacyVersion: 'outdated', termsVersion: LEGAL_VERSIONS.terms,
            }, { headers: { 'Cache-Control': 'no-store' } });
        });
        await expect(hydrateKindeCandidateArchive({
            expected: principal, browserCookies, stillCurrent: () => true, send,
        })).rejects.toBeInstanceOf(Error);
        expect(vi.mocked(send).mock.calls.some(([route]) => route === '/v1/cloud-key/sync')).toBe(false);
        expect(await get(storageKey)).toBeUndefined();
    });

    it('never fetches cloud ciphertext when local account consent withdrawal is pending', async () => {
        await createAndMigrateVault(kindeOwner);
        localStorage.setItem(storageKey + ':health-consent-withdrawal', 'pending:1');
        const send = server();
        await expect(hydrateKindeCandidateArchive({
            expected: principal, browserCookies, stillCurrent: () => true, send,
        })).rejects.toThrow();
        expect(vi.mocked(send)).not.toHaveBeenCalled();
        expect(await get(storageKey)).toBeUndefined();
    });

    it('refuses a withdrawal that appears during the encrypted cloud scan', async () => {
        await createAndMigrateVault(kindeOwner);
        const send = server(async () => {
            localStorage.setItem(storageKey + ':health-consent-withdrawal', 'pending:1');
        });
        await expect(hydrateKindeCandidateArchive({
            expected: principal, browserCookies, stillCurrent: () => true, send,
        })).rejects.toThrow();
        expect(await get(storageKey)).toBeUndefined();
    });
    it('preserves a competing tab’s newly created archive if the revision changed during the scan', async () => {
        await createAndMigrateVault(kindeOwner);
        let competingCiphertext: unknown;
        const send = server(async () => {
            await initializeLocal(kindeOwner, state('180'));
            competingCiphertext = await get(storageKey);
        });
        await expect(hydrateKindeCandidateArchive({ expected: principal, browserCookies,
            stillCurrent: () => true, send })).rejects.toThrow(/Checkpoint locale modificato/);
        expect(competingCiphertext).toBeDefined();
        expect(await get(storageKey)).toBe(competingCiphertext);
    });

    it('invalidates hydration if the same vault is locked and unlocked again before commit', async () => {
        await createAndMigrateVault(kindeOwner);
        catalogSource.read.mockResolvedValueOnce(catalog).mockImplementationOnce(async () => {
            lockAllVaults();
            await createAndMigrateVault(kindeOwner);
            return catalog;
        });
        await expect(hydrateKindeCandidateArchive({ expected: principal, browserCookies,
            stillCurrent: () => true, send: server() })).rejects.toThrow(/Hydration locale invalidata/);
        expect(await get(storageKey)).toBeUndefined();
    });
});

