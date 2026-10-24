import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { CURRENT_DATA_SCHEMA, CURRENT_SYNC_PROTOCOL } from '../schemaEvolution';
import { checkDocSize } from '../checkDocSize';
import { parseSyncMeta } from './semanticProjection/metadata';
import type { SyncMeta } from './semanticProjection/contracts';
import type { DocumentData } from './documentProjection';

/**
 * Versioned, self-authenticating cloud DOCUMENT envelope.
 *
 * This module has no Firestore, Auth, KMS, IndexedDB or PWA lifecycle effects.
 * It MUST NOT be wired to live cloud reads/writes before authenticated account
 * key provisioning, Rules, backup/erasure and cutover gates are ready together.
 */
const CLOUD_CIPHER_FORMAT = 'thelogbook-cloud-document' as const;
const CLOUD_CIPHER_VERSION = 1 as const;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });
const KEY_SIZE = 32;
const NONCE_SIZE = 24;
const AUTH_TAG_SIZE = 16;
const MAX_CIPHERTEXT_SIZE = 1024 * 1024;
const MONTH_PATH = /^(history_months|nutrition_months)\/\d{4}-(0[1-9]|1[0-2])$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export class CloudCiphertextError extends Error {
    readonly code = 'invalid-cloud-ciphertext';
    constructor() {
        super('Documento cloud cifrato non valido: dati locali e operazioni pendenti conservati.');
        this.name = 'CloudCiphertextError';
    }
}

type PublicCloudSync = Omit<SyncMeta, 'fields'> & { fields: Record<string, never> };

export type SealedCloudDocument = {
    _schemaVersion: typeof CURRENT_DATA_SCHEMA;
    _sync: PublicCloudSync;
    _sealed: {
        format: typeof CLOUD_CIPHER_FORMAT;
        version: typeof CLOUD_CIPHER_VERSION;
        nonce: string;
        ciphertext: string;
    };
};

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}

/** Canonical JSON used exclusively for authenticating public metadata. */
function canonical(value: unknown): string {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (record(value)) {
        return '{' + Object.keys(value).sort().map(key =>
            JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    }
    throw new CloudCiphertextError();
}

function assertIdentity(uid: string, path: string): void {
    if (!uid || uid.length > 128 || uid.includes('/') || !(path === '' || MONTH_PATH.test(path))) {
        throw new CloudCiphertextError();
    }
}

function base64url(value: Uint8Array): string {
    let binary = '';
    for (let index = 0; index < value.length; index += 16384) {
        binary += String.fromCharCode(...value.subarray(index, index + 16384));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unbase64url(value: unknown, maxSize: number): Uint8Array {
    if (typeof value !== 'string' || !value || !BASE64URL.test(value)
        || value.length % 4 === 1 || value.length > Math.ceil(maxSize / 3) * 4 + 4) {
        throw new CloudCiphertextError();
    }
    try {
        const encoded = value.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='));
        const bytes = Uint8Array.from(decoded, char => char.charCodeAt(0));
        if (bytes.length > maxSize || base64url(bytes) !== value) throw new CloudCiphertextError();
        return bytes;
    } catch {
        throw new CloudCiphertextError();
    }
}

function publicSync(sync: SyncMeta): PublicCloudSync {
    if (!sync.writer) throw new CloudCiphertextError();
    return { protocolVersion: sync.protocolVersion, clock: { ...sync.clock },
        writer: { ...sync.writer }, fields: {} };
}

function associatedData(uid: string, path: string, outer: Pick<SealedCloudDocument, '_schemaVersion' | '_sync'>): Uint8Array {
    assertIdentity(uid, path);
    // AAD binds the entire public sync control projection to this account/doc.
    return textEncoder.encode(canonical([
        CLOUD_CIPHER_FORMAT, CLOUD_CIPHER_VERSION, uid, path, outer._schemaVersion, outer._sync,
    ]));
}

function checkKey(key: Uint8Array): void {
    if (!(key instanceof Uint8Array) || key.length !== KEY_SIZE) throw new CloudCiphertextError();
}

/**
 * Input is already normalized and validated by the existing business boundary.
 * The *complete* field map, including hidden candidates and guard.equals, is
 * encrypted with business; Rules only inspect the safe public projection.
 */
export function sealCloudDocument(
    key: Uint8Array, uid: string, path: string, business: DocumentData, metadata: SyncMeta,
): SealedCloudDocument {
    checkKey(key);
    assertIdentity(uid, path);
    if (!record(business) || Object.hasOwn(business, '_sync') || Object.hasOwn(business, '_schemaVersion')
        || Object.hasOwn(business, '_sealed')) throw new CloudCiphertextError();
    let sync: SyncMeta;
    try { sync = parseSyncMeta(metadata); } catch { throw new CloudCiphertextError(); }
    const outer: SealedCloudDocument = {
        _schemaVersion: CURRENT_DATA_SCHEMA,
        _sync: publicSync(sync),
        _sealed: {
            format: CLOUD_CIPHER_FORMAT, version: CLOUD_CIPHER_VERSION,
            nonce: base64url(crypto.getRandomValues(new Uint8Array(NONCE_SIZE))),
            ciphertext: '',
        },
    };
    let payload: Uint8Array;
    try { payload = textEncoder.encode(canonical({ business, fields: sync.fields })); }
    catch { throw new CloudCiphertextError(); }
    if (payload.length + AUTH_TAG_SIZE > MAX_CIPHERTEXT_SIZE) throw new CloudCiphertextError();
    const nonce = unbase64url(outer._sealed.nonce, NONCE_SIZE);
    outer._sealed.ciphertext = base64url(xchacha20poly1305(key, nonce, associatedData(uid, path, outer)).encrypt(payload));
    // The actual Firestore envelope is larger than the plaintext after base64.
    // Reuse the existing conservative 950 KB limit, not the plaintext estimate.
    checkDocSize(outer, path || 'User Profile');
    return outer;
}

/** Verify every public field and the AEAD before exposing any business value. */
export function openCloudDocument(
    key: Uint8Array, uid: string, path: string, unknownDocument: unknown,
): { business: DocumentData; sync: SyncMeta } {
    checkKey(key);
    assertIdentity(uid, path);
    if (!record(unknownDocument)
        || Object.keys(unknownDocument).sort().join(',') !== '_schemaVersion,_sealed,_sync'
        || unknownDocument._schemaVersion !== CURRENT_DATA_SCHEMA
        || !record(unknownDocument._sync)
        || Object.keys(unknownDocument._sync).sort().join(',') !== 'clock,fields,protocolVersion,writer'
        || unknownDocument._sync.protocolVersion !== CURRENT_SYNC_PROTOCOL
        || !record(unknownDocument._sync.clock)
        || !record(unknownDocument._sync.fields)
        || Object.keys(unknownDocument._sync.fields).length !== 0
        || !record(unknownDocument._sync.writer)
        || !record(unknownDocument._sealed)
        || Object.keys(unknownDocument._sealed).sort().join(',') !== 'ciphertext,format,nonce,version'
        || unknownDocument._sealed.format !== CLOUD_CIPHER_FORMAT
        || unknownDocument._sealed.version !== CLOUD_CIPHER_VERSION) throw new CloudCiphertextError();

    try {
        const outer = unknownDocument as SealedCloudDocument;
        const nonce = unbase64url(outer._sealed.nonce, NONCE_SIZE);
        const ciphertext = unbase64url(outer._sealed.ciphertext, MAX_CIPHERTEXT_SIZE);
        if (nonce.length !== NONCE_SIZE || ciphertext.length < AUTH_TAG_SIZE) throw new CloudCiphertextError();

        // Never publish or parse a partial/unauthenticated snapshot.
        const authenticated = xchacha20poly1305(key, nonce, associatedData(uid, path, outer)).decrypt(ciphertext);
        const parsed: unknown = JSON.parse(textDecoder.decode(authenticated));
        if (!record(parsed) || Object.keys(parsed).sort().join(',') !== 'business,fields'
            || !record(parsed.business) || !record(parsed.fields)) throw new CloudCiphertextError();
        const sync = parseSyncMeta({ ...outer._sync, fields: parsed.fields });
        if (!sync.writer) throw new CloudCiphertextError();
        if (!record(parsed.business)
            || Object.hasOwn(parsed.business, '_sync')
            || Object.hasOwn(parsed.business, '_schemaVersion')
            || Object.hasOwn(parsed.business, '_sealed')) throw new CloudCiphertextError();
        return { business: parsed.business, sync };
    } catch {
        throw new CloudCiphertextError();
    }
}
