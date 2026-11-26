import { describe, expect, it } from 'vitest';
import { prepareCloudflareCommit } from '../../../src/lib/sync/cloudReplicaCommit';
import { sealCloudDocument, openCloudDocument } from '../../../src/lib/sync/cloudDocumentCipher';
import { prepareEncryptedDocumentChanges } from '../../../src/lib/sync/cloudMergeEngine';
import type { CloudReplicaControlSnapshot, CloudReplicaSnapshot } from '../../../src/lib/sync/cloudReplicaTransport';
import type { SemanticOperation, SyncMeta } from '../../../src/lib/sync/semanticProjection/contracts';

const owner = 'synthetic-parity-owner';
const key = new Uint8Array(32).fill(19);
const replica = { slot: 's00', replicaId: 'synthetic-parity-device', generation: 1 } as const;
const initialMeta: SyncMeta = {
    protocolVersion: 3, clock: {}, fields: {},
    writer: { ...replica, seq: 0, consentRevision: 1 },
};
const root = sealCloudDocument(key, owner, '', { profile: { height: '170' } }, initialMeta);
const control: CloudReplicaControlSnapshot = {
    revision: 4, fenceEpoch: 8, consentRevision: 1,
    replicas: { s00: { ...replica, status: 'active', lastSeq: 0,
        checkpointClock: {}, checkpointAtMs: Date.now(), leaseUntilMs: Date.now() + 86400000 } },
};
const snapshot: CloudReplicaSnapshot = {
    revision: 4, fenceEpoch: 8, consentRevision: 1,
    documents: [
        { path: '', revision: 4, document: root },
        { path: 'nutrition_months/2026-11', revision: null, document: null },
    ],
};
const operations: SemanticOperation[] = [
    { docPath: '', path: ['profile', 'height'], value: '171', isDelete: false,
        actorId: 's00', seq: 1, clock: { s00: 1 } },
    { docPath: 'nutrition_months/2026-11', path: ['2026-11-03'], isDelete: true,
        actorId: 's00', seq: 2, clock: { s00: 2 } },
];

describe('CF-01 ADR-4: provider adapters preserve one semantic and AEAD boundary', () => {
    it('gives the D1 synthetic adapter the same authenticated business and causal result as the shared writer engine', () => {
        const candidate = prepareCloudflareCommit(
            owner, operations, snapshot, control, replica, 'syntheticBatch00001', key, () => true,
        );
        const baseline = prepareEncryptedDocumentChanges(
            owner, operations, new Map([['', root]]), {},
            { ...replica, seq: 2, consentRevision: 1 }, key,
        );

        expect(candidate.outcome.documents).toEqual(baseline.documents);
        expect(candidate.outcome.syncMeta).toEqual(baseline.syncMeta);
        expect(candidate.batch.documents.map(entry => entry.path)).toEqual(['', 'nutrition_months/2026-11']);
        expect(candidate.batch.expectedRevision).toBe(snapshot.revision);
        expect(candidate.batch.expectedFenceEpoch).toBe(snapshot.fenceEpoch);
        expect(candidate.batch.lastSeq).toBe(2);
        for (const { path, document } of candidate.batch.documents) {
            const decoded = openCloudDocument(key, owner, path, document);
            expect(decoded.business).toEqual(baseline.documents.get(path));
            expect(decoded.sync).toEqual(baseline.syncMeta[path]);
        }
        // The adapter may change AEAD nonces; ciphertext equality is not a semantic contract.
        expect(JSON.stringify(candidate.batch.documents)).not.toContain('"height":"171"');
    });
});
