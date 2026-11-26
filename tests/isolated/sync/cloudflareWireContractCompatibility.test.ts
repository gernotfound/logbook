import { describe, expect, it } from 'vitest';
import { commitInput, validateSealedBatch } from '../../../cloudflare/api/replica-contracts.mjs';
import {
    CURRENT_BACKUP_SCHEMA, CURRENT_DATA_SCHEMA, CURRENT_LOCAL_ENVELOPE,
    CURRENT_SYNC_PROTOCOL, FutureVersionError, LegacyVersionError,
    normalizeBackupRecord, normalizeLocalEnvelopeRecord,
} from '../../../src/lib/schemaEvolution';
import { CloudCiphertextError, openCloudDocument, sealCloudDocument } from '../../../src/lib/sync/cloudDocumentCipher';
import type { SyncMeta } from '../../../src/lib/sync/semanticProjection/contracts';

const owner = 'k_' + 'a'.repeat(43);
const accountKey = new Uint8Array(32).fill(37);
const replica = { slot: 's00', replicaId: 'synthetic-version-device', generation: 1 } as const;
const sync: SyncMeta = {
    protocolVersion: CURRENT_SYNC_PROTOCOL,
    clock: { s00: 1 }, fields: {},
    writer: { ...replica, seq: 1, consentRevision: 1 },
};

function wireBatch() {
    const document = sealCloudDocument(accountKey, owner, '', { profile: { height: '177' } }, sync);
    return {
        batchId: 'batch000000009999', expectedRevision: 0, expectedFenceEpoch: 5,
        consentRevision: 1, replica, lastSeq: 1, documents: [{ path: '', document }],
    };
}

describe('CF-01 ADR-3: real browser codec → trusted Worker DTO compatibility', () => {
    it('accepts the current AEAD wire format without exposing business data or client-only replica fields', () => {
        const batch = wireBatch();
        const parsed = commitInput.parse(batch);
        expect(() => validateSealedBatch(parsed)).not.toThrow();
        expect(batch.documents[0].document._schemaVersion).toBe(CURRENT_DATA_SCHEMA);
        expect(batch.documents[0].document._sync.protocolVersion).toBe(CURRENT_SYNC_PROTOCOL);
        expect(JSON.stringify(parsed)).not.toContain('"height"');
        expect(openCloudDocument(accountKey, owner, '', parsed.documents[0].document).business)
            .toEqual({ profile: { height: '177' } });
    });

    it('rejects a future or unsupported cloud wire version on both production boundaries', () => {
        const batch = wireBatch();
        for (const document of [
            { ...batch.documents[0].document, _schemaVersion: CURRENT_DATA_SCHEMA + 1 },
            { ...batch.documents[0].document, _sync: {
                ...batch.documents[0].document._sync, protocolVersion: CURRENT_SYNC_PROTOCOL + 1,
            } },
            { ...batch.documents[0].document, _sealed: {
                ...batch.documents[0].document._sealed, version: 2,
            } },
        ]) {
            expect(commitInput.safeParse({ ...batch, documents: [{ path: '', document }] }).success)
                .toBe(false);
            expect(() => openCloudDocument(accountKey, owner, '', document))
                .toThrow(CloudCiphertextError);
        }
    });

    it('never accepts extra device metadata or plaintext in the strict server DTO', () => {
        const batch = wireBatch();
        expect(commitInput.safeParse({ ...batch, replica: {
            ...replica, leaseUntilMs: Date.now(),
        } }).success).toBe(false);
        expect(commitInput.safeParse({ ...batch, documents: [{
            path: '', document: { ...batch.documents[0].document, profile: { height: '177' } },
        }] }).success).toBe(false);
        expect(commitInput.safeParse({ ...batch, documents: [{
            path: '', document: { ...batch.documents[0].document, _sync: {
                ...batch.documents[0].document._sync, fields: { 'profile/height': 'plaintext' },
            } },
        }] }).success).toBe(false);
    });

    it('keeps the local envelope and backup dimensions independent of the cloud DTO', () => {
        const fields = { dataSchemaVersion: CURRENT_DATA_SCHEMA, syncProtocolVersion: CURRENT_SYNC_PROTOCOL };
        expect(normalizeLocalEnvelopeRecord({ version: CURRENT_LOCAL_ENVELOPE, ...fields }))
            .toMatchObject({ version: CURRENT_LOCAL_ENVELOPE, ...fields });
        expect(normalizeBackupRecord({ version: CURRENT_BACKUP_SCHEMA, ...fields }))
            .toMatchObject({ version: CURRENT_BACKUP_SCHEMA, ...fields });
        expect(() => normalizeLocalEnvelopeRecord({ version: CURRENT_LOCAL_ENVELOPE + 1, ...fields }))
            .toThrow(FutureVersionError);
        expect(() => normalizeBackupRecord({ version: CURRENT_BACKUP_SCHEMA + 1, ...fields }))
            .toThrow(FutureVersionError);
        expect(() => normalizeBackupRecord({ version: CURRENT_BACKUP_SCHEMA - 1, ...fields }))
            .toThrow(LegacyVersionError);
        expect(() => normalizeLocalEnvelopeRecord({ version: CURRENT_LOCAL_ENVELOPE, ...fields,
            syncProtocolVersion: CURRENT_SYNC_PROTOCOL + 1 })).toThrow(FutureVersionError);
        expect(() => normalizeBackupRecord({ version: CURRENT_BACKUP_SCHEMA, ...fields,
            dataSchemaVersion: CURRENT_DATA_SCHEMA + 1 })).toThrow(FutureVersionError);
    });
});
