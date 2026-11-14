const FORMAT = 'thelogbook-wrapped-account-key';
const AAD_PREFIX = 'thelogbook:server-wrapped-adk:v1:owner:';
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const encoder = new TextEncoder();

export class CloudKeyUnavailableError extends Error {
  constructor() {
    super('cloud-account-key-unavailable');
    this.name = 'CloudKeyUnavailableError';
  }
}

function validUid(uid) {
  return typeof uid === 'string' && uid.length >= 1 && uid.length <= 128
    && uid.trim() === uid && !uid.includes('/');
}
function canonicalBase64(raw, length) {
  if (typeof raw !== 'string' || !BASE64.test(raw)) throw new CloudKeyUnavailableError();
  try {
    const bytes = Uint8Array.from(atob(raw), char => char.charCodeAt(0));
    if (bytes.length !== length || btoa(String.fromCharCode(...bytes)) !== raw) {
      throw new CloudKeyUnavailableError();
    }
    return bytes;
  } catch {
    throw new CloudKeyUnavailableError();
  }
}
function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}
function aad(uid) {
  if (!validUid(uid)) throw new CloudKeyUnavailableError();
  return encoder.encode(AAD_PREFIX + uid);
}
function validateEnvelope(uid, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || Object.getPrototypeOf(raw) !== Object.prototype
    || Object.keys(raw).sort().join(',') !== 'ciphertext,format,iv,keyVersion,tag,uid,version'
    || raw.uid !== uid || raw.format !== FORMAT || raw.version !== 1
    || raw.keyVersion !== 1) throw new CloudKeyUnavailableError();
  return {
    iv: canonicalBase64(raw.iv, 12),
    ciphertext: canonicalBase64(raw.ciphertext, 32),
    tag: canonicalBase64(raw.tag, 16),
  };
}
async function wrappingKey(secret) {
  const raw = canonicalBase64(secret, 32);
  try {
    return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false,
      ['encrypt', 'decrypt']);
  } finally {
    raw.fill(0);
  }
}

/** Workers WebCrypto equivalent of the existing AES-256-GCM wrapping contract. */
export async function wrapCloudAccountDataKey(uid, dataKey, secret) {
  if (!validUid(uid) || !(dataKey instanceof Uint8Array) || dataKey.length !== 32) {
    throw new CloudKeyUnavailableError();
  }
  try {
    const key = await wrappingKey(secret);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new Uint8Array(await crypto.subtle.encrypt({
      name: 'AES-GCM', iv, additionalData: aad(uid), tagLength: 128,
    }, key, Uint8Array.from(dataKey)));
    return {
      format: FORMAT, version: 1, keyVersion: 1, uid,
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(encoded.subarray(0, 32)),
      tag: bytesToBase64(encoded.subarray(32)),
    };
  } catch {
    throw new CloudKeyUnavailableError();
  }
}

/** Refuse owner swaps, unsupported versions, malformed base64 and any AEAD failure. */
export async function unwrapCloudAccountDataKey(uid, wrapped, secret) {
  const { iv, ciphertext, tag } = validateEnvelope(uid, wrapped);
  try {
    const key = await wrappingKey(secret);
    const combined = new Uint8Array(48);
    combined.set(ciphertext);
    combined.set(tag, 32);
    return new Uint8Array(await crypto.subtle.decrypt({
      name: 'AES-GCM', iv, additionalData: aad(uid), tagLength: 128,
    }, key, combined));
  } catch {
    throw new CloudKeyUnavailableError();
  } finally {
    ciphertext.fill(0);
    tag.fill(0);
    iv.fill(0);
  }
}
