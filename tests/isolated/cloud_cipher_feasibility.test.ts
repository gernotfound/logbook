import { describe, expect, it } from 'vitest';
import { applySemanticOperations } from '../../src/lib/sync/semanticProjection/apply';
import { parseSyncMeta } from '../../src/lib/sync/semanticProjection/metadata';
import type { SemanticOperation, SyncMeta } from '../../src/lib/sync/semanticProjection/contracts';
import {
    CloudCiphertextError, openCloudDocument, sealCloudDocument,
} from '../../src/lib/sync/cloudDocumentCipher';

/**
 * Issue #620. Tests the isolated production-boundary CODEC on synthetic data;
 * does not enable the format in the runtime or make a cloud/KMS call.
 */
const key = () => crypto.getRandomValues(new Uint8Array(32));
const privateDocument = (): { business: Record<string, unknown>; sync: SyncMeta } => ({
    business: { profile: { notes: 'private medical notes 💪' }, customFoods: [{ name: 'hidden food' }] },
    sync: {
        protocolVersion: 3,
        clock: { s00: 2, s01: 1 },
        writer: { slot: 's00', replicaId: 'device-a', generation: 1, seq: 2 },
        fields: {
            'profile/notes': {
                actorId: 's00', seq: 2, clock: { s00: 2 },
                guard: { path: ['profile', 'notes'], equals: 'hidden guard value' },
                candidates: [{
                    actorId: 's01', seq: 1, clock: { s01: 1 },
                    value: { notes: 'secret conflict value' },
                    guard: { path: ['profile', 'notes'], equals: 'private conflict guard' },
                }],
            },
        },
    },
});

describe('cloud document cipher — isolated contract (#620)', () => {
    it('hides business AND causal candidates/guards while preserving Protocol 3 metadata', () => {
        const original = privateDocument();
        const sealed = sealCloudDocument(key(), 'owner-a', '', original.business, original.sync);
        const stored = JSON.stringify(sealed);
        for (const secret of ['private medical notes', 'hidden food', 'secret conflict value',
            'hidden guard value', 'private conflict guard', 'profile/notes']) {
            expect(stored).not.toContain(secret);
        }
        expect(sealed._sync.fields).toEqual({});
        expect(JSON.stringify(original.sync.fields)).toContain('secret conflict value');
        expect(parseSyncMeta(original.sync)).toEqual(original.sync);
    });

    it('round trips business + full Sync Protocol 3 and uses a fresh nonce', () => {
        const accountKey = key();
        const original = privateDocument();
        const first = sealCloudDocument(accountKey, 'owner-a', 'history_months/2026-10', original.business, original.sync);
        const second = sealCloudDocument(accountKey, 'owner-a', 'history_months/2026-10', original.business, original.sync);
        expect(first._sealed.nonce).not.toBe(second._sealed.nonce);
        expect(first._sealed.ciphertext).not.toBe(second._sealed.ciphertext);
        expect(openCloudDocument(accountKey, 'owner-a', 'history_months/2026-10', first))
            .toEqual({ business: original.business, sync: original.sync });
    });

    it('preserves real semantic conflict outcomes after rehydrating private metadata', () => {
        const accountKey = key();
        const plain = privateDocument();
        const recovered = openCloudDocument(accountKey, 'owner-a', '', sealCloudDocument(
            accountKey, 'owner-a', '', plain.business, plain.sync));
        const operation: SemanticOperation = {
            docPath: '', path: ['profile', 'notes'],
            value: 'new concurrent private value', isDelete: false,
            actorId: 's01', seq: 2, clock: { s00: 1, s01: 2 },
        };
        const merge = (value: typeof plain) => applySemanticOperations(
            new Map([['', value.business]]), [operation], { '': value.sync },
        );
        expect(merge(recovered)).toEqual(merge(plain));
        expect(recovered.sync.fields['profile/notes'].candidates?.[0].value)
            .toEqual({ notes: 'secret conflict value' });
    });

    it('rejects wrong owner/path/key and any mutation of public authenticated metadata', () => {
        const accountKey = key();
        const source = privateDocument();
        const sealed = sealCloudDocument(accountKey, 'owner-a', '', source.business, source.sync);
        expect(() => openCloudDocument(accountKey, 'owner-b', '', sealed)).toThrow(CloudCiphertextError);
        expect(() => openCloudDocument(accountKey, 'owner-a', 'history_months/2026-10', sealed)).toThrow(CloudCiphertextError);
        expect(() => openCloudDocument(key(), 'owner-a', '', sealed)).toThrow(CloudCiphertextError);
        expect(() => openCloudDocument(accountKey, 'owner-a', '', {
            ...sealed, _sync: { ...sealed._sync, clock: { s00: 3, s01: 1 } },
        })).toThrow(CloudCiphertextError);
        expect(() => openCloudDocument(accountKey, 'owner-a', '', {
            ...sealed, _sync: { ...sealed._sync, writer: { ...sealed._sync.writer!, seq: 3 } },
        })).toThrow(CloudCiphertextError);
    });

    it('rejects corrupt ciphertext, wrong nonce, unsupported format and injected private fields', () => {
        const accountKey = key();
        const original = privateDocument();
        const sealed = sealCloudDocument(accountKey, 'owner-a', '', original.business, original.sync);
        expect(() => openCloudDocument(accountKey, 'owner-a', '', {
            ...sealed, _sealed: { ...sealed._sealed, ciphertext: sealed._sealed.ciphertext.slice(0, -2) + 'AB' },
        })).toThrow(CloudCiphertextError);
        expect(() => openCloudDocument(accountKey, 'owner-a', '', {
            ...sealed, _sealed: { ...sealed._sealed, nonce: 'AAAA' },
        })).toThrow(CloudCiphertextError);
        expect(() => openCloudDocument(accountKey, 'owner-a', '', {
            ...sealed, _sealed: { ...sealed._sealed, version: 2 },
        })).toThrow(CloudCiphertextError);
        expect(() => openCloudDocument(accountKey, 'owner-a', '', {
            ...sealed, _sync: { ...sealed._sync, fields: { 'profile/notes': 'plaintext' } },
        })).toThrow(CloudCiphertextError);
        expect(() => openCloudDocument(accountKey, 'owner-a', '', {
            ...sealed, profile: { notes: 'forbidden plaintext' },
        })).toThrow(CloudCiphertextError);
    });

    it('accepts reordering of JSON object keys in public metadata without false authentication failure', () => {
        const accountKey = key();
        const original = privateDocument();
        const sealed = sealCloudDocument(accountKey, 'owner-a', '', original.business, original.sync);
        const reordered = { ...sealed, _sync: {
            fields: {},
            writer: { seq: 2, generation: 1, replicaId: 'device-a', slot: 's00' },
            clock: { s01: 1, s00: 2 },
            protocolVersion: 3 as const,
        } };
        expect(openCloudDocument(accountKey, 'owner-a', '', reordered))
            .toEqual({ business: original.business, sync: original.sync });
    });

    it('fails closed on unexpected payload shapes, malformed keys, and invalid sync candidates', () => {
        const original = privateDocument();
        const accountKey = key();
        expect(() => sealCloudDocument(new Uint8Array(3), 'owner-a', '', original.business, original.sync))
            .toThrow(CloudCiphertextError);
        expect(() => sealCloudDocument(accountKey, 'owner-a', 'nutrition_months/2026-00', original.business, original.sync))
            .toThrow(CloudCiphertextError);
        expect(() => sealCloudDocument(accountKey, 'owner-a', '', { _sync: {} }, original.sync))
            .toThrow(CloudCiphertextError);
        const malformed: SyncMeta = { ...original.sync, fields: {
            'profile/notes': { actorId: 's00', seq: 99, clock: { s00: 2 } },
        } };
        expect(() => sealCloudDocument(accountKey, 'owner-a', '', original.business, malformed))
            .toThrow(CloudCiphertextError);
        const sealed = sealCloudDocument(accountKey, 'owner-a', '', original.business, original.sync);
        expect(() => openCloudDocument(accountKey, 'owner-a', '', { ...sealed, _schemaVersion: 999 }))
            .toThrow(CloudCiphertextError);
        expect(() => openCloudDocument(accountKey, 'owner-a', '', { ...sealed, _sealed: null }))
            .toThrow(CloudCiphertextError);
    });
    it('rejects lossy or non-JSON data before encryption rather than silently dropping it', () => {
        const accountKey = key();
        const sync = privateDocument().sync;
        expect(() => sealCloudDocument(accountKey, 'owner-a', '', { workout: { load: undefined } }, sync))
            .toThrow(CloudCiphertextError);
        expect(() => sealCloudDocument(accountKey, 'owner-a', '', { workouts: [undefined] }, sync))
            .toThrow(CloudCiphertextError);
        expect(() => sealCloudDocument(accountKey, 'owner-a', '', { load: Number.NaN }, sync))
            .toThrow(CloudCiphertextError);
        expect(() => sealCloudDocument(accountKey, 'owner-a', '', { started: new Date() }, sync))
            .toThrow(CloudCiphertextError);
    });

    it('measures the ENCRYPTED Firestore document size, including base64 expansion', () => {
        const accountKey = key();
        const sync = privateDocument().sync;
        // Fits under 1 MiB of raw JSON, but its authenticated base64 envelope
        // exceeds the established 950 KB pre-write safety threshold.
        expect(() => sealCloudDocument(accountKey, 'owner-a', '', { notes: 'x'.repeat(800_000) }, sync))
            .toThrow(/limite di dimensione di sicurezza/);
    });

});
