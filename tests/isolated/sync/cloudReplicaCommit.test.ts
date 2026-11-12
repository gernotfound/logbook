import { describe, expect, it } from 'vitest';
import { CloudReplicaStaleSnapshotError, prepareCloudflareCommit } from '../../../src/lib/sync/cloudReplicaCommit';
import { openCloudDocument, sealCloudDocument } from '../../../src/lib/sync/cloudDocumentCipher';
import type { CloudReplicaSnapshot } from '../../../src/lib/sync/cloudReplicaTransport';
import type { SemanticOperation, SyncMeta } from '../../../src/lib/sync/semanticProjection/contracts';

const uid = 'synthetic-owner';
const key = new Uint8Array(32).fill(23);
const replica = { slot: 's00', replicaId: 'synthetic-device', generation: 1 };
const initial: SyncMeta = {
    protocolVersion: 3, clock: {}, fields: {},
    writer: { ...replica, seq: 0, consentRevision: 1 },
};
const base = sealCloudDocument(key, uid, '', { profile: { height: '170' } }, initial);
const snapshot: CloudReplicaSnapshot = {
    revision: 4, fenceEpoch: 7,
    documents: [{ path: '', revision: 4, document: base }],
};
const ops: SemanticOperation[] = [{
    docPath: '', path: ['profile', 'height'], value: '171',
    isDelete: false, actorId: 's00', seq: 1, clock: { s00: 1 },
}];

function stage(overrides: {
    checkpoint?: CloudReplicaSnapshot;
    operations?: SemanticOperation[];
    current?: () => boolean;
} = {}) {
    return prepareCloudflareCommit(
        uid, overrides.operations ?? ops, overrides.checkpoint ?? snapshot,
        replica, 0, {}, 1, 'batch000000000041', key, overrides.current ?? (() => true),
    );
}

describe('D1 encrypted commit candidate from the shared Protocol 3 engine', () => {
    it('stages authenticated AEAD ciphertext with exact revision, fence, replica and causal writer', () => {
        const { batch, outcome } = stage();
        expect(batch.expectedRevision).toBe(4);
        expect(batch.expectedFenceEpoch).toBe(7);
        expect(batch.lastSeq).toBe(1);
        expect(batch.documents).toHaveLength(1);
        const document = batch.documents[0].document;
        expect(document._sync.fields).toEqual({});
        expect(JSON.stringify(document)).not.toContain('"height":"171"');
        const opened = openCloudDocument(key, uid, '', document);
        expect(opened.business.profile).toEqual({ height: '171' });
        expect(opened.sync.fields['profile/height']).toMatchObject({
            actorId: 's00', seq: 1, clock: { s00: 1 },
        });
        expect(opened.sync.writer).toEqual({
            ...replica, seq: 1, consentRevision: 1,
        });
        expect(outcome.syncMeta['']).toEqual(opened.sync);
    });

    it('rejects incomplete or contradictory remote bases, without submitting a write', () => {
        for (const checkpoint of [
            { ...snapshot, documents: [] },
            { ...snapshot, revision: 0 },
            { ...snapshot, fenceEpoch: 0 },
            { ...snapshot, documents: [{ path: '', revision: null, document: base }] },
            { ...snapshot, documents: [{ path: 'history_months/2026-11', revision: 4, document: base }] },
        ]) {
            expect(() => stage({ checkpoint })).toThrow(CloudReplicaStaleSnapshotError);
        }
        expect(() => stage({ current: () => false })).toThrow(CloudReplicaStaleSnapshotError);
        expect(() => stage({ operations: [{ ...ops[0], actorId: 's01', clock: { s01: 1 } }] }))
            .toThrow(CloudReplicaStaleSnapshotError);
    });

    it('rejects a remote envelope whose AEAD was bound to another document or account', () => {
        const different = { ...snapshot, documents: [{
            path: '', revision: 4, document: sealCloudDocument(key, uid, 'nutrition_months/2026-11',
                { '2026-11-11': { weight: '70' } }, initial),
        }] };
        expect(() => stage({ checkpoint: different })).toThrow();
    });
});
