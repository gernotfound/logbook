import { describe, expect, it } from 'vitest';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { parseSyncMeta } from '../../src/lib/sync/semanticProjection/metadata';
import { applySemanticOperations } from '../../src/lib/sync/semanticProjection/apply';
import type { SemanticOperation } from '../../src/lib/sync/semanticProjection/contracts';
import type { SyncMeta } from '../../src/lib/sync/semanticProjection/contracts';

/**
 * Issue #620: test-only, isolated feasibility spike. NOT a production cloud codec.
 * No Firebase/KMS/network/storage calls. Production vault and journal are untouched.
 * Proves that Sync Protocol 3's sensitive hidden candidates and guards cannot
 * safely be left in plaintext _sync.fields.
 */
const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();

type PublicSync = Pick<SyncMeta, 'protocolVersion' | 'clock' | 'writer'> & { fields: Record<string, never> };
type PrototypeEnvelope = {
    format: 'thelogbook-cloud-spike';
    version: 1;
    _schemaVersion: 1;
    _sync: PublicSync;
    nonce: Uint8Array;
    ciphertext: Uint8Array;
};
type PlainCloud = { business: Record<string, unknown>; sync: SyncMeta };

// Deep, key-order-independent authenticated serialization of public Firestore metadata.
function canonical(value: unknown): string {
    if (value === null || typeof value === 'string' || typeof value === 'boolean'
        || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        return '{' + Object.keys(value).sort().map(key =>
            JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
    }
    throw new Error('Unsupported cloud metadata');
}

function publicSync(sync: SyncMeta): PublicSync {
    return {
        protocolVersion: sync.protocolVersion,
        clock: structuredClone(sync.clock),
        ...(sync.writer ? { writer: structuredClone(sync.writer) } : {}),
        fields: {},
    };
}

function aad(uid: string, path: string, wrapper: PrototypeEnvelope): Uint8Array {
    if (!uid || uid.includes('/') || !(path === '' || /^(history_months|nutrition_months)\/\d{4}-\d{2}$/.test(path))) {
        throw new Error('Invalid cloud identity');
    }
    return encoder.encode(canonical([
        'thelogbook', 'cloud-document', wrapper.format, wrapper.version, uid, path,
        wrapper._schemaVersion, wrapper._sync,
    ]));
}

function seal(key: Uint8Array, uid: string, path: string, plain: PlainCloud): PrototypeEnvelope {
    if (key.length !== 32) throw new Error('Invalid cloud key');
    // Reuse the existing trusted causal parser. Every hidden candidate can carry
    // an arbitrary business value; leave NO fields outside the encrypted part.
    const sync = parseSyncMeta(plain.sync);
    const wrapper: PrototypeEnvelope = {
        format: 'thelogbook-cloud-spike',
        version: 1,
        _schemaVersion: 1,
        _sync: publicSync(sync),
        nonce: crypto.getRandomValues(new Uint8Array(24)),
        ciphertext: new Uint8Array(),
    };
    const privatePayload = { business: plain.business, fields: sync.fields };
    wrapper.ciphertext = xchacha20poly1305(key, wrapper.nonce, aad(uid, path, wrapper))
        .encrypt(encoder.encode(JSON.stringify(privatePayload)));
    return wrapper;
}

function open(key: Uint8Array, uid: string, path: string, wrapper: PrototypeEnvelope): PlainCloud {
    if (key.length !== 32 || wrapper.format !== 'thelogbook-cloud-spike' || wrapper.version !== 1
        || wrapper._schemaVersion !== 1 || !(wrapper.nonce instanceof Uint8Array)
        || wrapper.nonce.length !== 24 || !(wrapper.ciphertext instanceof Uint8Array)
        || wrapper.ciphertext.length < 16 || !wrapper._sync || Object.keys(wrapper._sync.fields).length
        || wrapper._sync.protocolVersion !== 3) throw new Error('Invalid cloud envelope');
    try {
        const raw = xchacha20poly1305(key, wrapper.nonce, aad(uid, path, wrapper))
            .decrypt(wrapper.ciphertext);
        const payload: unknown = JSON.parse(decoder.decode(raw));
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
        const data = payload as { business?: unknown; fields?: unknown };
        if (!data.business || typeof data.business !== 'object' || Array.isArray(data.business)
            || !data.fields || typeof data.fields !== 'object' || Array.isArray(data.fields)) throw new Error();
        const sync = parseSyncMeta({ ...wrapper._sync, fields: data.fields });
        return { business: data.business as Record<string, unknown>, sync };
    } catch {
        throw new Error('Cloud ciphertext authentication or structure failed');
    }
}

const newKey = () => crypto.getRandomValues(new Uint8Array(32));
const privateDocument = (): PlainCloud => ({
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

describe('issue 620 test-only cloud encryption feasibility', () => {
    it('hides business AND causal candidates/guards, preserving exact sync parser semantics', () => {
        const input = privateDocument();
        const sealed = seal(newKey(), 'owner-a', '', input);
        const stored = JSON.stringify(sealed);
        for (const secret of ['private medical notes', 'hidden food', 'secret conflict value',
            'hidden guard value', 'private conflict guard', 'profile/notes']) {
            expect(stored).not.toContain(secret);
        }
        expect(sealed._sync.fields).toEqual({});
        // The old format placed these values inside _sync.fields, even with business separately encrypted.
        expect(JSON.stringify(input.sync.fields)).toContain('secret conflict value');
    });

    it('round-trips business and full Sync Protocol 3 metadata and uses distinct nonces', () => {
        const key = newKey();
        const original = privateDocument();
        const first = seal(key, 'owner-a', 'history_months/2026-10', original);
        const second = seal(key, 'owner-a', 'history_months/2026-10', original);
        expect(first.nonce).not.toEqual(second.nonce);
        expect(first.ciphertext).not.toEqual(second.ciphertext);
        expect(open(key, 'owner-a', 'history_months/2026-10', first)).toEqual(original);
    });

    it('preserves semantic conflict resolution when the complete causal metadata is restored', () => {
        const key = newKey();
        const plain = privateDocument();
        const recovered = open(key, 'owner-a', '', seal(key, 'owner-a', '', plain));
        const operation: SemanticOperation = {
            docPath: '',
            path: ['profile', 'notes'],
            value: 'new concurrent private value',
            isDelete: false,
            actorId: 's01',
            seq: 2,
            clock: { s00: 1, s01: 2 },
        };
        const merge = (value: PlainCloud) => applySemanticOperations(
            new Map([['', value.business]]),
            [operation],
            { '': value.sync },
        );
        expect(merge(recovered)).toEqual(merge(plain));
        expect(recovered.sync.fields['profile/notes'].candidates?.[0].value)
            .toEqual({ notes: 'secret conflict value' });
    });

    it('rejects wrong account/path/key and any change to authenticated public causal metadata', () => {
        const key = newKey();
        const sealed = seal(key, 'owner-a', '', privateDocument());
        expect(() => open(key, 'owner-b', '', sealed)).toThrow();
        expect(() => open(key, 'owner-a', 'history_months/2026-10', sealed)).toThrow();
        expect(() => open(newKey(), 'owner-a', '', sealed)).toThrow();
        expect(() => open(key, 'owner-a', '', {
            ...sealed, _sync: { ...sealed._sync, clock: { s00: 3, s01: 1 } },
        })).toThrow();
        expect(() => open(key, 'owner-a', '', {
            ...sealed, _sync: { ...sealed._sync, writer: { ...sealed._sync.writer!, seq: 3 } },
        })).toThrow();
    });

    it('rejects corrupted ciphertext, nonce, unknown formats and injected public fields', () => {
        const key = newKey();
        const sealed = seal(key, 'owner-a', '', privateDocument());
        const tampered = Uint8Array.from(sealed.ciphertext);
        tampered[0] ^= 1;
        expect(() => open(key, 'owner-a', '', { ...sealed, ciphertext: tampered })).toThrow();
        expect(() => open(key, 'owner-a', '', { ...sealed, nonce: new Uint8Array(24) })).toThrow();
        expect(() => open(key, 'owner-a', '', { ...sealed, version: 2 as 1 })).toThrow();
        expect(() => open(key, 'owner-a', '', {
            ...sealed, _sync: { ...sealed._sync, fields: { 'profile/notes': 'plaintext' as never } },
        })).toThrow();
    });

    it('accepts reordered public keys because AAD is canonical, not naive JSON.stringify', () => {
        const key = newKey();
        const original = privateDocument();
        const sealed = seal(key, 'owner-a', '', original);
        const reordered = { ...sealed, _sync: {
            fields: {},
            writer: { seq: 2, generation: 1, replicaId: 'device-a', slot: 's00' },
            clock: { s01: 1, s00: 2 },
            protocolVersion: 3 as const,
        } };
        expect(open(key, 'owner-a', '', reordered)).toEqual(original);
    });
});
