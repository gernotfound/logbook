import {
  CloudKeyUnavailableError, wrapCloudAccountDataKey, unwrapCloudAccountDataKey,
} from './cloud-key-crypto.mjs';

const HASH = /^[a-f0-9]{64}$/;
const LEGAL = /^[A-Za-z0-9._-]{1,32}$/;
const NOW = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";

// Read the live session and consent at the same D1 primary that stores the
// wrapped ADK. The private AuthGate is necessary but not sufficient: a logout
// or withdrawal may have committed since it returned its trusted claims.
const IDENTITY_SQL = `
  FROM auth_sessions t
  JOIN auth_principals p ON p.uid = t.uid
  JOIN sync_subjects s ON s.uid = p.uid
  JOIN health_consent_acceptances c ON c.uid = s.uid
  LEFT JOIN cloud_account_keys k ON k.uid = s.uid
  LEFT JOIN cloud_key_issuance i ON i.uid = k.uid AND i.consent_revision = k.consent_revision
  WHERE p.uid = ? AND p.status = 'active' AND p.auth_epoch = ?
    AND p.verified_at_ms IS NOT NULL
    AND p.verified_at_ms > 0 AND p.verified_at_ms <= ${NOW}
    AND t.token_hash = ? AND t.uid = p.uid AND t.auth_epoch = p.auth_epoch
    AND t.revoked_at_ms IS NULL
    AND t.issued_at_ms <= ${NOW}
    AND t.idle_expires_at_ms > ${NOW}
    AND t.absolute_expires_at_ms > ${NOW}
    AND c.over_18_confirmed = 1 AND c.accepted_at_ms > 0
    AND c.accepted_at_ms <= ${NOW}
    AND c.consent_revision = s.consent_revision
    AND s.consent_revision = ?
`;
const ACTIVE_SQL = `
  AND s.status = 'active' AND s.fence_epoch = p.auth_epoch
  AND c.privacy_version = ? AND c.terms_version = ?
  AND NOT EXISTS (SELECT 1 FROM health_erasure_jobs j
    WHERE j.uid = s.uid AND j.status != 'complete')
`;
const RIGHTS_SQL = `
  AND s.status = 'withdrawn' AND s.fence_epoch <= p.auth_epoch
  AND EXISTS (SELECT 1 FROM health_erasure_jobs j
    WHERE j.uid = s.uid AND j.consent_revision = s.consent_revision
      AND j.fence_epoch = s.fence_epoch
      AND j.status IN ('pending', 'processing'))
`;

function trustedClaims(claims, env, purpose) {
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)
    || claims.authenticated !== true || claims.emailVerified !== true
    || claims.rateGatePassed !== true || claims.csrfVerified !== true
    || typeof claims.uid !== 'string' || !claims.uid
    || claims.uid.length > 128 || claims.uid.trim() !== claims.uid
    || claims.uid.includes('/') || !HASH.test(claims.sessionHash ?? '')
    || !Number.isSafeInteger(claims.healthConsentRevision)
    || claims.healthConsentRevision < 1
    || !Number.isSafeInteger(claims.fenceEpoch) || claims.fenceEpoch < 1
    || (purpose !== 'sync' && purpose !== 'rights-export')
    || !env || typeof env.CLOUD_ACCOUNT_KEK_V1 !== 'string'
    || (purpose === 'sync' && (
      !LEGAL.test(env.CONSENT_PRIVACY_VERSION ?? '')
      || !LEGAL.test(env.CONSENT_TERMS_VERSION ?? '')
    ))) throw new CloudKeyUnavailableError();
  return [claims.uid, claims.fenceEpoch, claims.sessionHash, claims.healthConsentRevision,
    ...(purpose === 'sync' ? [env.CONSENT_PRIVACY_VERSION, env.CONSENT_TERMS_VERSION] : [])];
}
const READ_SQL = `SELECT k.uid AS key_uid, k.consent_revision AS key_consent_revision,
  k.format, k.version, k.key_version, k.iv, k.ciphertext, k.tag, k.issued_at_ms,
  i.issued_at_ms AS issuance_at_ms
  ${IDENTITY_SQL}`;
function keyEnvelope(row, uid, revision) {
  if (!row?.key_uid) return null;
  if (row.key_uid !== uid || row.key_consent_revision !== revision
    || !Number.isSafeInteger(row.issued_at_ms) || row.issued_at_ms < 1
    || row.issuance_at_ms !== row.issued_at_ms) {
    throw new CloudKeyUnavailableError();
  }
  return {
    uid, format: row.format, version: row.version, keyVersion: row.key_version,
    iv: row.iv, ciphertext: row.ciphertext, tag: row.tag,
  };
}
function sameKey(left, right) {
  return !!left && !!right && Object.keys(left).every(key => left[key] === right[key]);
}
async function readAuthorized(primary, args, purpose) {
  const sql = READ_SQL + (purpose === 'sync' ? ACTIVE_SQL : RIGHTS_SQL);
  const row = await primary.prepare(sql).bind(...args).first();
  if (!row) throw new CloudKeyUnavailableError();
  return keyEnvelope(row, args[0], args[3]);
}

// No caller-supplied ADK, username or journal bytes are accepted. Every
// provision is a single conditional SQLite write; its trigger creates the
// permanent per-consent issuance marker in the SAME transaction. The readback
// is mandatory after an ambiguous response or a racing provisioner.
const PROVISION_SQL = `
  INSERT INTO cloud_account_keys(
    uid, consent_revision, format, version, key_version,
    iv, ciphertext, tag, issued_at_ms
  )
  SELECT s.uid, s.consent_revision, ?, 1, 1, ?, ?, ?, ${NOW}
  FROM sync_subjects s
  JOIN sync_state state ON state.uid = s.uid
  JOIN auth_principals p ON p.uid = s.uid
  JOIN auth_sessions t ON t.uid = p.uid
  JOIN health_consent_acceptances c ON c.uid = s.uid
  WHERE s.uid = ? AND s.status = 'active'
    AND s.consent_revision = ? AND s.fence_epoch = ?
    AND state.revision = 0
    AND p.status = 'active' AND p.auth_epoch = s.fence_epoch
    AND p.verified_at_ms > 0 AND p.verified_at_ms <= ${NOW}
    AND t.token_hash = ? AND t.auth_epoch = p.auth_epoch
    AND t.revoked_at_ms IS NULL AND t.issued_at_ms <= ${NOW}
    AND t.idle_expires_at_ms > ${NOW}
    AND t.absolute_expires_at_ms > ${NOW}
    AND c.consent_revision = s.consent_revision AND c.over_18_confirmed = 1
    AND c.accepted_at_ms > 0 AND c.accepted_at_ms <= ${NOW}
    AND c.privacy_version = ? AND c.terms_version = ?
    AND NOT EXISTS (SELECT 1 FROM health_erasure_jobs j
      WHERE j.uid = s.uid AND j.status != 'complete')
    AND NOT EXISTS (SELECT 1 FROM sync_documents d WHERE d.uid = s.uid)
    AND NOT EXISTS (SELECT 1 FROM sync_replicas r WHERE r.uid = s.uid)
    AND NOT EXISTS (SELECT 1 FROM sync_receipts r WHERE r.uid = s.uid)
    AND NOT EXISTS (SELECT 1 FROM sync_replica_mutations m WHERE m.uid = s.uid)
    AND NOT EXISTS (SELECT 1 FROM cloud_key_issuance i
      WHERE i.uid = s.uid AND i.consent_revision = s.consent_revision)
  ON CONFLICT(uid) DO NOTHING
  RETURNING uid
`;

/**
 * Candidate trusted-server boundary, NOT a public HTTP endpoint.
 * "rights-export" never provisions a missing ADK; a revoked consent can
 * authorize a still-existing key only while a live erasure job is pending.
 * Every successful result is checked AGAIN after asynchronous AES-GCM open.
 */
export async function releaseCloudAccountDataKey(db, env, claims, purpose = 'sync') {
  let candidate;
  try {
    const args = trustedClaims(claims, env, purpose);
    if (!db || typeof db.withSession !== 'function') throw new CloudKeyUnavailableError();
    const primary = db.withSession('first-primary');
    if (!primary || typeof primary.prepare !== 'function') throw new CloudKeyUnavailableError();

    let wrapped = await readAuthorized(primary, args, purpose);
    if (!wrapped && purpose === 'sync') {
      candidate = crypto.getRandomValues(new Uint8Array(32));
      const envelope = await wrapCloudAccountDataKey(claims.uid, candidate, env.CLOUD_ACCOUNT_KEK_V1);
      candidate.fill(0);
      candidate = undefined;

      // A lost/ambiguous D1 reply cannot establish a new key. Re-read from
      // the primary and unwrap ONLY the stored winner, never the candidate.
      try {
        await primary.prepare(PROVISION_SQL).bind(
          envelope.format, envelope.iv, envelope.ciphertext, envelope.tag,
          claims.uid, claims.healthConsentRevision, claims.fenceEpoch,
          claims.sessionHash, env.CONSENT_PRIVACY_VERSION, env.CONSENT_TERMS_VERSION,
        ).first();
      } catch {
        // The primary readback below may reconcile a committed insert.
      }
      wrapped = await readAuthorized(primary, args, purpose);
    }
    if (!wrapped) throw new CloudKeyUnavailableError();

    const adk = await unwrapCloudAccountDataKey(claims.uid, wrapped, env.CLOUD_ACCOUNT_KEK_V1);
    try {
      const latest = await readAuthorized(db.withSession('first-primary'), args, purpose);
      if (!sameKey(wrapped, latest)) throw new CloudKeyUnavailableError();
      return adk;
    } catch {
      adk.fill(0);
      throw new CloudKeyUnavailableError();
    }
  } catch {
    throw new CloudKeyUnavailableError();
  } finally {
    candidate?.fill(0);
  }
}
