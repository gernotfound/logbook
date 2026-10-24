import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const KEY_SIZE = 32;
const NONCE_SIZE = 12;
const TAG_SIZE = 16;
const ENVELOPE_FORMAT = 'thelogbook-wrapped-account-key' as const;
const ENVELOPE_VERSION = 1 as const;
const WRAPPING_KEY_VERSION = 1 as const;

/**
 * The free-tier trusted backend holds a separate, randomly-generated secret
 * in its production environment. It is NEVER generated automatically,
 * derived from Firebase identities/passwords, logged or exposed to clients.
 * Losing this secret makes all ADKs protected by it irrecoverable.
 */
export class AccountKeyUnavailableError extends Error {
  constructor() {
    super('Servizio di protezione delle chiavi account non disponibile.');
    this.name = 'AccountKeyUnavailableError';
  }
}

function exactBase64(value: unknown, length: number): Buffer {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new AccountKeyUnavailableError();
  }
  const raw = Buffer.from(value, 'base64');
  if (raw.length !== length || raw.toString('base64') !== value) {
    throw new AccountKeyUnavailableError();
  }
  return raw;
}

function wrappingKey(): Buffer {
  // Explicitly versioned: never silently rotate or replace the master secret.
  // An unavailable old version must fail closed, not create a new ADK.
  return exactBase64(process.env.CLOUD_ACCOUNT_KEK_V1, KEY_SIZE);
}

function associatedData(uid: string): Buffer {
  if (typeof uid !== 'string' || !uid || uid.length > 128 || uid.includes('/')) {
    throw new AccountKeyUnavailableError();
  }
  return Buffer.from('thelogbook:server-wrapped-adk:v1:owner:' + uid, 'utf8');
}

export type WrappedAccountDataKey = {
  format: typeof ENVELOPE_FORMAT;
  version: typeof ENVELOPE_VERSION;
  keyVersion: typeof WRAPPING_KEY_VERSION;
  uid: string;
  iv: string;
  ciphertext: string;
  tag: string;
};

/** Encrypt only the random 32-byte ADK, never fitness/business documents. */
export async function wrapAccountDataKey(uid: string, dataKey: Buffer): Promise<WrappedAccountDataKey> {
  if (!Buffer.isBuffer(dataKey) || dataKey.length !== KEY_SIZE) throw new AccountKeyUnavailableError();
  const aad = associatedData(uid);
  const secret = wrappingKey();
  try {
    const iv = randomBytes(NONCE_SIZE);
    const cipher = createCipheriv('aes-256-gcm', secret, iv, { authTagLength: TAG_SIZE });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    return {
      format: ENVELOPE_FORMAT, version: ENVELOPE_VERSION,
      keyVersion: WRAPPING_KEY_VERSION, uid,
      iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    };
  } catch {
    throw new AccountKeyUnavailableError();
  } finally {
    secret.fill(0);
  }
}

/** Corruption, wrong owner, wrong master key and unknown versions fail closed. */
export async function unwrapAccountDataKey(uid: string, wrapped: unknown): Promise<Buffer> {
  const aad = associatedData(uid);
  if (!wrapped || typeof wrapped !== 'object' || Array.isArray(wrapped)
    || Object.getPrototypeOf(wrapped) !== Object.prototype) throw new AccountKeyUnavailableError();
  const record = wrapped as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'ciphertext,format,iv,keyVersion,tag,uid,version'
    || record.format !== ENVELOPE_FORMAT || record.version !== ENVELOPE_VERSION
    || record.keyVersion !== WRAPPING_KEY_VERSION || record.uid !== uid) {
    throw new AccountKeyUnavailableError();
  }
  const iv = exactBase64(record.iv, NONCE_SIZE);
  const ciphertext = exactBase64(record.ciphertext, KEY_SIZE);
  const tag = exactBase64(record.tag, TAG_SIZE);
  const secret = wrappingKey();
  try {
    const decipher = createDecipheriv('aes-256-gcm', secret, iv, { authTagLength: TAG_SIZE });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    const result = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (result.length !== KEY_SIZE) throw new AccountKeyUnavailableError();
    return result;
  } catch {
    throw new AccountKeyUnavailableError();
  } finally {
    secret.fill(0);
  }
}
