import { deriveKindeOwnerId, validKindeIssuer, validKindeSubject } from '../auth/kinde-owner-id.mjs';

export const KINDE_ERASURE_TARGET_FORMAT = 'thelogbook-kinde-erasure-target';
const UID = /^k_[A-Za-z0-9_-]{43}$/;
const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const encoder = new TextEncoder();

class KindeErasureTargetError extends Error {
  constructor() { super('kinde-erasure-target-unavailable'); }
}

/** @param {Uint8Array} bytes */
const base64 = (bytes) => btoa(String.fromCharCode(...bytes));

/** @param {unknown} raw @param {number} min @param {number} max */
function parseBytes(raw, min, max) {
  if (typeof raw !== 'string' || raw.length > Math.ceil(max / 3) * 4 || !BASE64.test(raw)) {
    throw new KindeErasureTargetError();
  }
  const bytes = Uint8Array.from(atob(raw), char => char.charCodeAt(0));
  if (bytes.length < min || bytes.length > max || base64(bytes) !== raw) throw new KindeErasureTargetError();
  return bytes;
}

/**
 * Local candidate format for a provider deletion reference.
 * Seal only identity from a trusted login callback, after deriving the owner.
 * A future runner must prove terminal application erasure before opening it.
 * This codec does not enroll identities, store records or call the provider.
 * @param {{issuer: string, keyId: string, key: CryptoKey}} options
 */
export function createKindeErasureTargetCodec({ issuer, keyId, key }) {
  if (!validKindeIssuer(issuer) || typeof keyId !== 'string' || !KEY_ID.test(keyId) || key?.type !== 'secret'
    || key.extractable || key.algorithm.name !== 'AES-GCM'
    || /** @type {AesKeyAlgorithm} */ (key.algorithm).length !== 256) {
    throw new KindeErasureTargetError();
  }
  /** @param {string} uid @param {Uint8Array<ArrayBuffer>} iv */
  function parameters(uid, iv) {
    if (!UID.test(uid)) throw new KindeErasureTargetError();
    const additionalData = encoder.encode(JSON.stringify([KINDE_ERASURE_TARGET_FORMAT, 1, issuer, keyId, uid]));
    return { name: 'AES-GCM', iv, tagLength: 128, additionalData };
  }

  return {
    /** @param {{uid: string, subject: string}} identity */
    async seal({ uid, subject }) {
      if (!validKindeSubject(subject) || await deriveKindeOwnerId(issuer, subject) !== uid) {
        throw new KindeErasureTargetError();
      }
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const bytes = encoder.encode(subject);
      try {
        const sealed = new Uint8Array(await crypto.subtle.encrypt(parameters(uid, iv), key, bytes));
        return { format: KINDE_ERASURE_TARGET_FORMAT, version: 1, keyId, uid, iv: base64(iv), ciphertext: base64(sealed) };
      } catch { throw new KindeErasureTargetError(); }
      finally { bytes.fill(0); }
    },
    /** @param {string} uid @param {unknown} record */
    async open(uid, record) {
      let plaintext;
      try {
        const stored = /** @type {{format?: string, version?: number, keyId?: string, uid?: string, iv?: string, ciphertext?: string}} */ (record);
        if (!stored || typeof stored !== 'object' || Object.getPrototypeOf(stored) !== Object.prototype
          || Object.keys(stored).sort().join(',') !== 'ciphertext,format,iv,keyId,uid,version'
          || stored.uid !== uid || stored.format !== KINDE_ERASURE_TARGET_FORMAT
          || stored.version !== 1 || stored.keyId !== keyId) {
          throw new KindeErasureTargetError();
        }
        const iv = parseBytes(stored.iv, 12, 12);
        const sealed = parseBytes(stored.ciphertext, 20, 144);
        plaintext = new Uint8Array(await crypto.subtle.decrypt(parameters(uid, iv), key, sealed));
        const subject = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
        if (!validKindeSubject(subject) || await deriveKindeOwnerId(issuer, subject) !== uid) {
          throw new KindeErasureTargetError();
        }
        return subject;
      } catch { throw new KindeErasureTargetError(); }
      finally { plaintext?.fill(0); }
    },
  };
}
