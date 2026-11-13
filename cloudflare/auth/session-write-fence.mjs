// Session checks must occur in the SQL transaction accessing protected
// data: an earlier AUTH_GATE check cannot prevent a subsequent logout race.
export const activeSessionPredicateSql = `EXISTS (
  SELECT 1 FROM auth_sessions t
  JOIN auth_principals p ON p.uid = t.uid
  WHERE t.token_hash = ? AND t.uid = ? AND t.auth_epoch = ?
    AND t.revoked_at_ms IS NULL AND p.status = 'active'
    AND p.auth_epoch = t.auth_epoch AND p.verified_at_ms IS NOT NULL
    AND p.verified_at_ms <= CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
    AND t.issued_at_ms <= CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
    AND t.idle_expires_at_ms > CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
    AND t.absolute_expires_at_ms > CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
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
