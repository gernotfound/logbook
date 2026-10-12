// The local data-encryption key (DEK) is never persisted unwrapped. Wrapping and
// passphrase stretching are asynchronous because they occur at explicit unlock,
// never inside a synchronous IndexedDB update or device-critical localStorage save.

const VAULT_VERSION = 1 as const;
const PBKDF2_ITERATIONS = 600_000 as const;
const MAX_PBKDF2_ITERATIONS = 2_000_000;
const KEY_BYTES = 32;
const SALT_BYTES = 32;
const NONCE_BYTES = 12;
const encoder = new TextEncoder();

export type LocalKeyVault = {
    format: 'thelogbook-local-vault';
    version: typeof VAULT_VERSION;
    owner: string;
    kdf: { id: 'pbkdf2-sha256'; iterations: number; salt: string };
    passphrase: { nonce: string; wrappedDek: string };
    recovery: { nonce: string; wrappedDek: string };
};

export class LocalUnlockError extends Error {
    readonly code = 'local-archive-unlock-failed';
    constructor() {
        super('Impossibile sbloccare l’archivio protetto. I dati locali sono stati conservati.');
        this.name = 'LocalUnlockError';
    }
}

function hex(bytes: Uint8Array): string {
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function parseHex(input: string, length: number): Uint8Array {
    if (input.length !== length * 2 || !/^[0-9a-f]+$/i.test(input)) throw new LocalUnlockError();
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) out[i] = Number.parseInt(input.slice(i * 2, i * 2 + 2), 16);
    return out;
}

function aad(owner: string, purpose: 'passphrase' | 'recovery'): Uint8Array {
    return encoder.encode(JSON.stringify(['thelogbook', 'local-dek', VAULT_VERSION, owner, purpose]));
}

function validateVault(value: LocalKeyVault, owner: string): LocalKeyVault {
    if (!value || value.format !== 'thelogbook-local-vault' || value.version !== VAULT_VERSION
        || typeof owner !== 'string' || !owner || owner.length > 512 || value.owner !== owner
        || value.kdf?.id !== 'pbkdf2-sha256'
        || !Number.isInteger(value.kdf.iterations) || value.kdf.iterations < PBKDF2_ITERATIONS
        || value.kdf.iterations > MAX_PBKDF2_ITERATIONS
    ) throw new LocalUnlockError();
    parseHex(value.kdf.salt, SALT_BYTES);
    parseHex(value.passphrase?.nonce ?? '', NONCE_BYTES);
    parseHex(value.passphrase?.wrappedDek ?? '', KEY_BYTES + 16);
    parseHex(value.recovery?.nonce ?? '', NONCE_BYTES);
    parseHex(value.recovery?.wrappedDek ?? '', KEY_BYTES + 16);
    return value;
}

async function keyFromPassphrase(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
    const input = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations },
        input, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    );
}

async function recoveryAesKey(code: Uint8Array): Promise<CryptoKey> {
    return crypto.subtle.importKey('raw', new Uint8Array(code), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function wrapDek(key: CryptoKey, dek: Uint8Array, owner: string, purpose: 'passphrase' | 'recovery') {
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce, additionalData: aad(owner, purpose) },
        key, new Uint8Array(dek),
    );
    return { nonce: hex(nonce), wrappedDek: hex(new Uint8Array(encrypted)) };
}

async function unwrapDek(key: CryptoKey, value: { nonce: string; wrappedDek: string }, owner: string, purpose: 'passphrase' | 'recovery'): Promise<Uint8Array> {
    try {
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: parseHex(value.nonce, NONCE_BYTES), additionalData: aad(owner, purpose) },
            key, parseHex(value.wrappedDek, KEY_BYTES + 16),
        );
        const plain = new Uint8Array(decrypted);
        if (plain.length !== KEY_BYTES) throw new LocalUnlockError();
        return plain;
    } catch {
        throw new LocalUnlockError();
    }
}

export async function createLocalKeyVault(owner: string, passphrase: string): Promise<{ vault: LocalKeyVault; dataKey: Uint8Array; recoveryCode: string }> {
    if (!owner || owner.length > 512 || passphrase.length < 16 || passphrase.length > 1024) {
        throw new Error('Scegli una passphrase di almeno 16 caratteri per proteggere il dispositivo.');
    }
    const dek = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const recovery = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
    const passwordKey = await keyFromPassphrase(passphrase, salt, PBKDF2_ITERATIONS);
    const vault: LocalKeyVault = {
        format: 'thelogbook-local-vault', version: VAULT_VERSION, owner,
        kdf: { id: 'pbkdf2-sha256', iterations: PBKDF2_ITERATIONS, salt: hex(salt) },
        passphrase: await wrapDek(passwordKey, dek, owner, 'passphrase'),
        recovery: await wrapDek(await recoveryAesKey(recovery), dek, owner, 'recovery'),
    };
    return { vault, dataKey: dek, recoveryCode: hex(recovery) };
}

export async function unlockLocalKeyVault(vault: LocalKeyVault, owner: string, passphrase: string): Promise<Uint8Array> {
    validateVault(vault, owner);
    try {
        const key = await keyFromPassphrase(passphrase, parseHex(vault.kdf.salt, SALT_BYTES), vault.kdf.iterations);
        return await unwrapDek(key, vault.passphrase, owner, 'passphrase');
    } catch { throw new LocalUnlockError(); }
}

export async function recoverLocalKeyVault(vault: LocalKeyVault, owner: string, recoveryCode: string): Promise<Uint8Array> {
    validateVault(vault, owner);
    try {
        const key = await recoveryAesKey(parseHex(recoveryCode.trim(), KEY_BYTES));
        return await unwrapDek(key, vault.recovery, owner, 'recovery');
    } catch { throw new LocalUnlockError(); }
}

export async function rewrapLocalPassphrase(vault: LocalKeyVault, owner: string, dataKey: Uint8Array, nextPassphrase: string): Promise<LocalKeyVault> {
    validateVault(vault, owner);
    if (dataKey.length !== KEY_BYTES || nextPassphrase.length < 16 || nextPassphrase.length > 1024) throw new Error('Passphrase o chiave non valida.');
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    return {
        ...vault,
        kdf: { id: 'pbkdf2-sha256', iterations: PBKDF2_ITERATIONS, salt: hex(salt) },
        passphrase: await wrapDek(await keyFromPassphrase(nextPassphrase, salt, PBKDF2_ITERATIONS), dataKey, owner, 'passphrase'),
    };
}
