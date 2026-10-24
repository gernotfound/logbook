import { adminGoogleCloudAccessToken } from '../accountDeletion/firebaseAdmin.js';

const KEY_NAME_RE = /^projects\/[a-z][a-z0-9-]{3,61}\/[lL]ocations\/[a-z0-9-]+\/keyRings\/[A-Za-z0-9_-]+\/cryptoKeys\/[A-Za-z0-9_-]+$/;
const ENCRYPT_TIMEOUT_MS = 8000;

export class AccountKeyUnavailableError extends Error {
  constructor() {
    super('Servizio di protezione delle chiavi account non disponibile.');
    this.name = 'AccountKeyUnavailableError';
  }
}

/** No secrets, URLs supplied by clients or long-lived access tokens are accepted. */
function configuredKey(): string {
  const name = process.env.CLOUD_KMS_KEY_NAME;
  if (!name || !KEY_NAME_RE.test(name)) throw new AccountKeyUnavailableError();
  return name;
}

function strictBase64(value: unknown, maxBytes: number): Buffer {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(maxBytes / 3) * 4 + 4
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new AccountKeyUnavailableError();
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0 || bytes.length > maxBytes || bytes.toString('base64') !== value) {
    throw new AccountKeyUnavailableError();
  }
  return bytes;
}

function keyAAD(uid: string): string {
  if (!uid || uid.length > 128 || uid.includes('/')) throw new AccountKeyUnavailableError();
  return Buffer.from('thelogbook:cloud-adk:v1:' + uid).toString('base64');
}

async function callKms(
  keyName: string, action: 'encrypt' | 'decrypt', body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const accessToken = await adminGoogleCloudAccessToken();
    const result = await fetch('https://cloudkms.googleapis.com/v1/' + keyName + ':' + action, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + accessToken, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ENCRYPT_TIMEOUT_MS),
    });
    if (!result.ok) throw new AccountKeyUnavailableError();
    const payload: unknown = await result.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new AccountKeyUnavailableError();
    return payload as Record<string, unknown>;
  } catch {
    // Do not disclose Google tokens, KMS error responses or key material.
    throw new AccountKeyUnavailableError();
  }
}

/** Wrap only the random account data key, never fitness data. */
export async function wrapAccountDataKey(uid: string, dataKey: Buffer): Promise<{
  format: 'thelogbook-wrapped-account-key';
  version: 1;
  uid: string;
  kmsKeyName: string;
  ciphertext: string;
}> {
  if (!Buffer.isBuffer(dataKey) || dataKey.length !== 32) throw new AccountKeyUnavailableError();
  const kmsKeyName = configuredKey();
  const result = await callKms(kmsKeyName, 'encrypt', {
    plaintext: dataKey.toString('base64'),
    additionalAuthenticatedData: keyAAD(uid),
  });
  strictBase64(result.ciphertext, 8192);
  // KMS reports the exact key VERSION used; never accept a different key.
  if (typeof result.name !== 'string' || !result.name.startsWith(kmsKeyName + '/cryptoKeyVersions/')) {
    throw new AccountKeyUnavailableError();
  }
  return { format: 'thelogbook-wrapped-account-key', version: 1, uid,
    kmsKeyName, ciphertext: result.ciphertext as string };
}

/** Bad or missing KMS responses cannot cause regeneration of a key. */
export async function unwrapAccountDataKey(uid: string, wrapped: unknown): Promise<Buffer> {
  const configured = configuredKey();
  if (!wrapped || typeof wrapped !== 'object' || Array.isArray(wrapped)) throw new AccountKeyUnavailableError();
  const record = wrapped as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'ciphertext,format,kmsKeyName,uid,version'
      || record.format !== 'thelogbook-wrapped-account-key' || record.version !== 1
      || record.uid !== uid || record.kmsKeyName !== configured) throw new AccountKeyUnavailableError();
  strictBase64(record.ciphertext, 8192);
  const result = await callKms(configured, 'decrypt', {
    ciphertext: record.ciphertext,
    additionalAuthenticatedData: keyAAD(uid),
  });
  const dataKey = strictBase64(result.plaintext, 32);
  if (dataKey.length !== 32) throw new AccountKeyUnavailableError();
  return dataKey;
}
