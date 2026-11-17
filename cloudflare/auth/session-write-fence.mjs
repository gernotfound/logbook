import { D1_NOW_MS } from '../sql/d1-time.mjs';

// Authorization must be rechecked in the SQL transaction accessing protected
// data. The private gate may have seen a session/consent that was later revoked.
// This mirrors the current revision-1 consent gate; future consent revisions
// must update both predicates together before enabling cloud sync.
export const activeSessionPredicateSql = `EXISTS (
  SELECT 1 FROM auth_sessions t
  JOIN auth_principals p ON p.uid = t.uid
  JOIN sync_subjects s ON s.uid = p.uid
  JOIN health_consent_acceptances c ON c.uid = s.uid
  WHERE t.token_hash = ? AND t.uid = ? AND t.auth_epoch = ?
    AND t.revoked_at_ms IS NULL AND p.status = 'active'
    AND p.auth_epoch = t.auth_epoch AND p.verified_at_ms IS NOT NULL
    AND s.status = 'active' AND s.fence_epoch = p.auth_epoch
    AND s.consent_revision = 1 AND c.consent_revision = s.consent_revision
    AND c.over_18_confirmed = 1
    AND c.accepted_at_ms > 0
    AND c.accepted_at_ms <= ${D1_NOW_MS}
    AND p.verified_at_ms <= ${D1_NOW_MS}
    AND t.issued_at_ms <= ${D1_NOW_MS}
    AND t.idle_expires_at_ms > ${D1_NOW_MS}
    AND t.absolute_expires_at_ms > ${D1_NOW_MS}
)`;

// An expired/revoked session yields an invalid hash, violating its CHECK and
// rolling back the full D1 write batch. No new migration or silent no-op.
export const sessionFencedRequestHashSql = `CASE WHEN ${activeSessionPredicateSql} THEN ? ELSE '' END`;

// Only the private AUTH_GATE service may supply a session hash, never JSON.
export function activeSessionArgs(sessionHash, uid, fenceEpoch) {
  if (typeof sessionHash !== 'string' || !/^[a-f0-9]{64}$/.test(sessionHash)
    || typeof uid !== 'string' || !uid || uid.length > 128
    || uid.trim() !== uid || uid.includes('/')
    || !Number.isSafeInteger(fenceEpoch) || fenceEpoch < 1) {
    throw new TypeError('invalid-session-fence');
  }
  return [sessionHash, uid, fenceEpoch];
}

export function sessionFencedHashArgs(sessionHash, uid, fenceEpoch, requestHash) {
  const args = activeSessionArgs(sessionHash, uid, fenceEpoch);
  if (typeof requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(requestHash)) {
    throw new TypeError('invalid-request-hash');
  }
  return [...args, requestHash];
}
