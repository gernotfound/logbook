import { D1_NOW_MS } from '../sql/d1-time.mjs';

const STATE_TTL_MS = 300_000;
const HASH = /^[a-f0-9]{64}$/;
// Unpadded base64url of 32 bytes has two zero bits in its last character.
const TOKEN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const UID = /^k_[A-Za-z0-9_-]{43}$/;

// The identity-only session can remain valid if the email was unverified
// later. Reauthentication will still have to prove the same signed subject.
const ACTIVE_SESSION = `
  t.revoked_at_ms IS NULL AND p.status = 'active'
    AND t.auth_epoch = p.auth_epoch AND t.issued_at_ms <= ${D1_NOW_MS}
    AND t.idle_expires_at_ms > ${D1_NOW_MS} AND t.absolute_expires_at_ms > ${D1_NOW_MS}
`;

/**
 * Stage an attempt only from an authorized, CSRF-checked deletion start.
 * Browser proofs are already digested. Plaintext is limited to short-lived
 * server-only PKCE/nonce material, as in ordinary code exchange.
 */
export async function saveKindeDeletionAttempt(db, attempt) {
  const { uid, authEpoch, sessionHash, stateHash, browserHash, verifier, nonce } = attempt;
  if (!UID.test(uid) || !Number.isSafeInteger(authEpoch) || authEpoch < 1
    || ![sessionHash, stateHash, browserHash].every(value => typeof value === 'string' && HASH.test(value))
    || ![verifier, nonce].every(value => typeof value === 'string' && TOKEN.test(value))) {
    throw new TypeError('invalid-kinde-deletion-attempt');
  }
  const primary = db.withSession('first-primary');
  const pruned = await primary.prepare(`
    DELETE FROM kinde_deletion_oauth_attempts
    WHERE state_hash IN (
      SELECT state_hash FROM kinde_deletion_oauth_attempts
      WHERE expires_at_ms <= ${D1_NOW_MS} ORDER BY expires_at_ms LIMIT 16
    )
  `).run();
  if (pruned?.success !== true || !Number.isSafeInteger(pruned.meta?.changes)
    || pruned.meta.changes < 0 || pruned.meta.changes > 16) throw new Error('kinde-deletion-attempt-unavailable');
  const row = await primary.prepare(`
    INSERT INTO kinde_deletion_oauth_attempts
      (state_hash, browser_hash, session_hash, uid, auth_epoch, code_verifier, nonce, issued_at_ms, expires_at_ms)
    SELECT ?, ?, t.token_hash, t.uid, t.auth_epoch, ?, ?, ${D1_NOW_MS}, ${D1_NOW_MS} + ?
    FROM auth_sessions t JOIN auth_principals p ON p.uid = t.uid
    WHERE t.token_hash = ? AND t.uid = ? AND t.auth_epoch = ? AND ${ACTIVE_SESSION}
    RETURNING uid, auth_epoch
  `).bind(stateHash, browserHash, verifier, nonce, STATE_TTL_MS, sessionHash, uid, authEpoch).first();
  return row?.uid === uid && row.auth_epoch === authEpoch;
}

/**
 * The callback must derive its browser and session hashes from the cookies.
 * An ambiguous DELETE must bubble up. A replay must never exchange the code.
 */
export async function consumeKindeDeletionAttempt(db, { stateHash, browserHash, sessionHash }) {
  if (![stateHash, browserHash, sessionHash].every(value => typeof value === 'string' && HASH.test(value))) return null;
  const row = await db.withSession('first-primary').prepare(`
    DELETE FROM kinde_deletion_oauth_attempts
    WHERE state_hash = ? AND browser_hash = ? AND session_hash = ?
      AND issued_at_ms <= ${D1_NOW_MS} AND expires_at_ms > ${D1_NOW_MS}
      AND EXISTS (
        SELECT 1 FROM auth_sessions t JOIN auth_principals p ON p.uid = t.uid
        WHERE t.token_hash = kinde_deletion_oauth_attempts.session_hash
          AND t.uid = kinde_deletion_oauth_attempts.uid AND t.auth_epoch = kinde_deletion_oauth_attempts.auth_epoch
          AND ${ACTIVE_SESSION}
      )
    RETURNING uid, auth_epoch, code_verifier, nonce, issued_at_ms
  `).bind(stateHash, browserHash, sessionHash).first();
  if (!row || !UID.test(row.uid) || !Number.isSafeInteger(row.auth_epoch) || row.auth_epoch < 1
    || !TOKEN.test(row.code_verifier) || !TOKEN.test(row.nonce)
    || !Number.isSafeInteger(row.issued_at_ms) || row.issued_at_ms <= 0) return null;
  return {
    expectedUid: row.uid, authEpoch: row.auth_epoch, startedAtMs: row.issued_at_ms,
    verifier: row.code_verifier, nonce: row.nonce,
  };
}
