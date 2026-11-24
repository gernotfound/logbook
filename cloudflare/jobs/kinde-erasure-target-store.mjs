import { D1_NOW_MS } from '../sql/d1-time.mjs';
import { KINDE_ERASURE_TARGET_FORMAT } from './kinde-erasure-target.mjs';

const UID = /^k_[A-Za-z0-9_-]{43}$/;
const ACTIVE_FENCE = `
  p.uid = ? AND p.auth_epoch = ? AND p.status = 'active'
  AND p.verified_at_ms > 0 AND p.verified_at_ms <= ${D1_NOW_MS}
`;

const SELECT_TARGET = `
  SELECT t.uid, t.format_version AS version, t.key_id AS keyId, t.iv, t.ciphertext
  FROM kinde_erasure_targets t JOIN auth_principals p ON p.uid = t.uid
  WHERE ${ACTIVE_FENCE}
`;

const INSERT_TARGET = `
  INSERT INTO kinde_erasure_targets (uid, format_version, key_id, iv, ciphertext)
  SELECT p.uid, ?, ?, ?, ? FROM auth_principals p
  WHERE ${ACTIVE_FENCE}
    AND NOT EXISTS (SELECT 1 FROM kinde_erasure_targets t WHERE t.uid = p.uid)
`;

/**
 * Candidate storage boundary for the trusted OAuth callback. Only an OIDC
 * proof already verified for this owner may supply the subject. No access
 * token, email, credential or plaintext subject is bound to the database.
 *
 * @param {ReturnType<typeof import('./kinde-erasure-target.mjs').createKindeErasureTargetCodec>} codec
 */
export function createKindeErasureTargetWriter(codec) {
  /**
   * @param {{ withSession: (policy: 'first-primary') => any }} db
   * @param {{ uid: string, subject: string, authEpoch: number }} owner
   */
  return async function ensureTarget(db, { uid, subject, authEpoch }) {
    try {
      if (!UID.test(uid) || !Number.isSafeInteger(authEpoch) || authEpoch < 1) throw new Error();

      let row = await db.withSession('first-primary').prepare(SELECT_TARGET).bind(uid, authEpoch).first();
      if (!row) {
        const target = await codec.seal({ uid, subject });
        try {
          await db.withSession('first-primary').prepare(INSERT_TARGET)
            .bind(target.version, target.keyId, target.iv, target.ciphertext, uid, authEpoch).run();
        } catch {
          // A lost or concurrent write has no useful acknowledgement. A new
          // primary session must still prove the exact owner and subject.
        }
        row = await db.withSession('first-primary').prepare(SELECT_TARGET).bind(uid, authEpoch).first();
      }
      if (!row || await codec.open(uid, {
        format: KINDE_ERASURE_TARGET_FORMAT,
        version: row.version,
        keyId: row.keyId,
        uid: row.uid,
        iv: row.iv,
        ciphertext: row.ciphertext,
      }) !== subject) throw new Error();
    } catch {
      throw new Error('kinde-erasure-target-storage-unavailable');
    }
  };
}
