import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

// Data-at-rest primitive, intentionally independent from the owner's lifecycle.
// The caller MUST verify an unlocked owner session before passing in the data key.
// Unlike Web Crypto's async encrypt(), this AEAD is synchronous so it is safe
// inside idb-keyval.update() and before a device-critical localStorage.setItem().
export const SEALED_LOCAL_PREFIX = 'tlb-sealed:v1:' as const;
const KEY_BYTES = 32;
const NONCE_BYTES = 24;
const MAX_PLAINTEXT_BYTES = 32 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export class LocalCiphertextError extends Error {
    readonly code = 'invalid-local-ciphertext';
    constructor(message = 'Archivio locale cifrato non valido. I dati originali sono conservati per il recupero.') {
        super(message);
        this.name = 'LocalCiphertextError';
    }
}

const assertIdentity = (owner: string, key: string) => {
    if (!owner || !key || owner.length > 512 || key.length > 512) {
        throw new Error('Identità archivio cifrato non valida');
    }
};

const authenticatedContext = (owner: string, storageKey: string): Uint8Array =>
    encoder.encode(JSON.stringify(['thelogbook', 'local-storage', 1, owner, storageKey]));

function base64url(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 16384) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function unbase64url(value: string): Uint8Array {
    if (!value || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
        throw new LocalCiphertextError();
    }
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    let decoded: string;
    try {
        decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    } catch {
        throw new LocalCiphertextError();
    }
    const out = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) out[i] = decoded.charCodeAt(i);
    if (base64url(out) !== value) throw new LocalCiphertextError();
    return out;
}

export function sealLocalText(key: Uint8Array, owner: string, storageKey: string, value: string): string {
    assertIdentity(owner, storageKey);
    if (key.length !== KEY_BYTES) throw new Error('Chiave archivio non valida');
    const plaintext = encoder.encode(value);
    if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error('Record locale troppo grande');
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
    const ciphertext = xchacha20poly1305(key, nonce, authenticatedContext(owner, storageKey)).encrypt(plaintext);
    return SEALED_LOCAL_PREFIX + base64url(nonce) + '.' + base64url(ciphertext);
}

export function openLocalText(key: Uint8Array, owner: string, storageKey: string, stored: string): string {
    assertIdentity(owner, storageKey);
    if (key.length !== KEY_BYTES) throw new Error('Chiave archivio non valida');
    if (!stored.startsWith(SEALED_LOCAL_PREFIX)) throw new LocalCiphertextError();
    const content = stored.slice(SEALED_LOCAL_PREFIX.length);
    const tokens = content.split('.');
    if (tokens.length !== 2 || tokens[1].length > (MAX_PLAINTEXT_BYTES + 16) * 2) {
        throw new LocalCiphertextError();
    }
    const nonce = unbase64url(tokens[0]);
    const ciphertext = unbase64url(tokens[1]);
    if (nonce.length !== NONCE_BYTES || ciphertext.length < 16 || ciphertext.length > MAX_PLAINTEXT_BYTES + 16) {
        throw new LocalCiphertextError();
    }
    try {
        const plain = xchacha20poly1305(key, nonce, authenticatedContext(owner, storageKey)).decrypt(ciphertext);
        return decoder.decode(plain);
    } catch {
        throw new LocalCiphertextError();
    }
}

export function sealLocalJson(key: Uint8Array, owner: string, storageKey: string, value: unknown): string {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('Impossibile serializzare il record locale');
    return sealLocalText(key, owner, storageKey, serialized);
}

export function openLocalJson(key: Uint8Array, owner: string, storageKey: string, value: string): unknown {
    try {
        return JSON.parse(openLocalText(key, owner, storageKey, value)) as unknown;
    } catch (error) {
        if (error instanceof LocalCiphertextError) throw error;
        throw new LocalCiphertextError();
    }
}
