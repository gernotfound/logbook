import { requireIndependentOwnerFence } from './independent-owner-fence.mjs';

// The registry is independent of the application's Time Travel timeline.
// Both primary reads are necessary: neither trusted AuthGate claims nor the
// independent registry alone can authorize fitness or a replayed sync ACK.
export class RuntimeSyncFenceUnavailableError extends Error {
  constructor() {
    super('independent-sync-fence-unavailable');
    this.name = 'RuntimeSyncFenceUnavailableError';
  }
}
export class RuntimeSyncAccessRevokedError extends Error {
  constructor() {
    super('independent-sync-access-revoked');
    this.name = 'RuntimeSyncAccessRevokedError';
  }
}

const HASH = /^[a-f0-9]{64}$/;
const VERSION = /^[A-Za-z0-9._-]{1,32}$/;
function validClaims(claims, env) {
  return claims && typeof claims.uid === 'string'
    && claims.uid.length >= 1 && claims.uid.length <= 128
    && claims.uid.trim() === claims.uid && !claims.uid.includes('/')
    && Number.isSafeInteger(claims.fenceEpoch) && claims.fenceEpoch >= 1
    && Number.isSafeInteger(claims.healthConsentRevision)
    && claims.healthConsentRevision >= 1
    && HASH.test(claims.sessionHash ?? '')
    && VERSION.test(env?.CONSENT_PRIVACY_VERSION ?? '')
    && VERSION.test(env?.CONSENT_TERMS_VERSION ?? '');
}

/**
 * Required for every encrypted-sync route, including receipt/replay queries.
 * Call before any write/read and again before returning a successful HTTP
 * response. A lost ACK after a committed D1 write stays ambiguous and must
 * not be reported as cloud success while an independent withdrawal is armed.
 *
 * No cross-D1 snapshot exists: the primary DB can still change between
 * proofs. Coordinating withdrawal MUST arm the independent deny before
 * mutating the main D1, and all clients must preserve durable local journals.
 */
export async function requireCurrentIndependentSyncFence(env, claims) {
  if (!validClaims(claims, env)
    || !env.DB || !env.RECOVERY_DB || env.DB === env.RECOVERY_DB
    || typeof env.DB.withSession !== 'function'
    || typeof env.RECOVERY_DB.withSession !== 'function') {
    throw new RuntimeSyncFenceUnavailableError();
  }
  let row;
  const now = Date.now();
  try {
    row = await env.DB.withSession('first-primary').prepare(`
      SELECT s.uid, s.status, s.consent_revision, s.fence_epoch,
        s.erased_before_revision
      FROM sync_subjects s
      JOIN auth_principals p ON p.uid = s.uid
      JOIN auth_sessions t ON t.uid = s.uid
      JOIN health_consent_acceptances c ON c.uid = s.uid
      WHERE s.uid = ? AND p.status = 'active'
        AND p.auth_epoch = ? AND p.verified_at_ms > 0
        AND p.verified_at_ms <= ? AND s.status = 'active'
        AND s.fence_epoch = p.auth_epoch
        AND s.consent_revision = ? AND c.consent_revision = s.consent_revision
        AND c.over_18_confirmed = 1 AND c.accepted_at_ms > 0
        AND c.accepted_at_ms <= ?
        AND c.privacy_version = ? AND c.terms_version = ?
        AND t.token_hash = ? AND t.uid = p.uid
        AND t.auth_epoch = p.auth_epoch AND t.revoked_at_ms IS NULL
        AND t.issued_at_ms <= ? AND t.idle_expires_at_ms > ?
        AND t.absolute_expires_at_ms > ?
    `).bind(
      claims.uid, claims.fenceEpoch, now, claims.healthConsentRevision, now,
      env.CONSENT_PRIVACY_VERSION, env.CONSENT_TERMS_VERSION,
      claims.sessionHash, now, now, now,
    ).first();
  } catch {
    throw new RuntimeSyncFenceUnavailableError();
  }
  if (!row) throw new RuntimeSyncAccessRevokedError();
  try {
    await requireIndependentOwnerFence(env.RECOVERY_DB, {
      uid: row.uid, status: row.status,
      consentRevision: row.consent_revision, fenceEpoch: row.fence_epoch,
      erasedBeforeRevision: row.erased_before_revision,
    }, 'fitness');
  } catch {
    throw new RuntimeSyncFenceUnavailableError();
  }
  return true;
}
