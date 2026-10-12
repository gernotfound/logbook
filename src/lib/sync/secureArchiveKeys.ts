import { get, update } from 'idb-keyval';

// Keys are anchored to an owner-scoped, non-extractable Web Crypto key stored
// in this device's IndexedDB. Firebase Auth gates the account owner before
// application bootstrap; Firebase tokens, API keys and UIDs are NOT KDF secrets.
// This protects ciphertext without the local device-key store; copying the
// complete browser profile or compromising same-origin JavaScript can still
// provide decryption access. It is NOT end-to-end encryption.
const VERSION = 2 as const;
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const encoder = new TextEncoder();

export type LocalKeyVault = {
    format: 'thelogbook-local-device-vault';
    version: typeof VERSION;
    owner: string;
    nonce: string;
    wrappedDek: string;
};

export class LocalUnlockError extends Error {
    readonly code = 'local-archive-unlock-failed';
    constructor() {
        super('Chiave locale del dispositivo non disponibile o archivio non leggibile. Nessun dato è stato cancellato.');
        this.name = 'LocalUnlockError';
    }
}

export function deviceVaultKeyId(owner: string): string {
    if (!owner || owner.length > 512 || (owner !== 'guest' && !/^user:[^:]+$/.test(owner))) {
        throw new LocalUnlockError();
    }
    return 'logbook:v2:' + owner + ':device-vault-key';
}

const toHex = (b: Uint8Array): string =>
    Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

function fromHex(s: string, expected: number): Uint8Array {
    if (typeof s !== 'string' || s.length !== expected * 2 || !/^[0-9a-f]+$/i.test(s)) throw new LocalUnlockError();
    const bytes = new Uint8Array(expected);
    for (let i = 0; i < expected; i++) bytes[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
    return bytes;
}

const context = (owner: string) => encoder.encode(
    JSON.stringify(['thelogbook', 'local-dek', 'device', VERSION, owner, deviceVaultKeyId(owner)]),
);

function isSecureDeviceKey(value: unknown): value is CryptoKey {
    if (!value || typeof value !== 'object') return false;
    const key = value as Partial<CryptoKey>;
    const algo = key.algorithm as AesKeyAlgorithm | undefined;
    return key.type === 'secret' && key.extractable === false
        && algo?.name === 'AES-GCM' && algo.length === 256
        && key.usages?.includes('encrypt') === true && key.usages.includes('decrypt');
}

async function requireDeviceKey(owner: string): Promise<CryptoKey> {
    let candidate: unknown;
    try { candidate = await get<unknown>(deviceVaultKeyId(owner)); }
    catch { throw new LocalUnlockError(); }
    if (!isSecureDeviceKey(candidate)) throw new LocalUnlockError();
    return candidate;
}

/**
 * Serialized by secureArchiveMigration's exclusive Web Lock. A prior orphan
 * device key may be reused after a crash BEFORE control metadata was saved;
 * it is never silently recreated while an active/migrating control exists.
 */
async function establishDeviceKey(owner: string): Promise<CryptoKey> {
    const newKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    );
    if (!isSecureDeviceKey(newKey)) throw new LocalUnlockError();
    let saved: unknown;
    try {
        await update<unknown>(deviceVaultKeyId(owner), previous => {
            saved = previous === undefined ? newKey : previous;
            if (!isSecureDeviceKey(saved)) throw new LocalUnlockError();
            return saved;
        });
        return await requireDeviceKey(owner);
    } catch { throw new LocalUnlockError(); }
}

function validateVault(vault: LocalKeyVault, owner: string): void {
    deviceVaultKeyId(owner);
    if (!vault || vault.format !== 'thelogbook-local-device-vault'
        || vault.version !== VERSION || vault.owner !== owner) throw new LocalUnlockError();
    fromHex(vault.nonce, NONCE_BYTES);
    fromHex(vault.wrappedDek, KEY_BYTES + TAG_BYTES);
}

export async function createLocalKeyVault(owner: string): Promise<{ vault: LocalKeyVault; dataKey: Uint8Array }> {
    deviceVaultKeyId(owner);
    const key = await establishDeviceKey(owner);
    const dek = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
    try {
        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: new Uint8Array(nonce), additionalData: new Uint8Array(context(owner)) },
            key, new Uint8Array(dek),
        );
        return {
            vault: {
                format: 'thelogbook-local-device-vault', version: VERSION,
                owner, nonce: toHex(nonce), wrappedDek: toHex(new Uint8Array(ciphertext)),
            },
            dataKey: dek,
        };
    } catch {
        dek.fill(0);
        throw new LocalUnlockError();
    }
}

/** Rehydrates a DEK automatically on the SAME browser/profile, even offline. */
export async function unlockLocalKeyVault(vault: LocalKeyVault, owner: string): Promise<Uint8Array> {
    validateVault(vault, owner);
    const key = await requireDeviceKey(owner);
    try {
        const plaintext = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM', iv: new Uint8Array(fromHex(vault.nonce, NONCE_BYTES)),
                additionalData: new Uint8Array(context(owner)),
            },
            key, new Uint8Array(fromHex(vault.wrappedDek, KEY_BYTES + TAG_BYTES)),
        );
        const dek = new Uint8Array(plaintext);
        if (dek.length !== KEY_BYTES) throw new LocalUnlockError();
        return dek;
    } catch { throw new LocalUnlockError(); }
}
