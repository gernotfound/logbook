// Candidate trusted consent endpoint. No public deployment until real Auth,
// rights-only export and the durable erasure-job executor are integrated.
import { strictlyEmptyPost } from '../http/strict-empty-post.mjs';
import {
  armIndependentHealthWithdrawal, enrollIndependentOwner,
  recordVerifiedHealthWithdrawal, recordVerifiedInitialConsent, requireIndependentOwnerFence,
} from '../recovery/independent-owner-fence.mjs';

const INTERNAL = 'https://auth-gate.internal/__internal/authorize';
const MAX_BODY_BYTES = 2048;
const HASH = /^[a-f0-9]{64}$/;
const VERSION = /^[A-Za-z0-9._-]{1,32}$/;

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

async function trustedClaims(request, env, route) {
  if (!env.AUTH_GATE || typeof env.AUTH_GATE.fetch !== 'function') return null;
  const headers = new Headers({
    origin: env.API_ORIGIN,
    'x-original-method': 'POST',
    'x-original-route': route,
    cookie: request.headers.get('cookie') ?? '',
    'x-csrf-token': request.headers.get('x-csrf-token') ?? '',
  });
  const result = await env.AUTH_GATE.fetch(new Request(INTERNAL, { method: 'POST', headers }));
  if (!result.ok) return { errorStatus: result.status === 429 ? 429 : result.status === 401 ? 401 : result.status === 403 ? 403 : 503 };
  const claims = await result.json();
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)
    || claims.authenticated !== true || claims.rateGatePassed !== true
    || typeof claims.uid !== 'string' || claims.uid.length < 1 || claims.uid.length > 128
    || claims.uid.includes('/') || claims.uid.trim() !== claims.uid
    || !Number.isSafeInteger(claims.fenceEpoch) || claims.fenceEpoch < 1
    || !Number.isSafeInteger(claims.healthConsentRevision) || claims.healthConsentRevision < 0
    || !HASH.test(claims.sessionHash ?? '') || typeof claims.emailVerified !== 'boolean'
    || typeof claims.csrfVerified !== 'boolean') return null;
  return claims;
}

async function readConsent(db, claims, { forWithdrawal = false } = {}) {
  if (typeof db.withSession !== 'function') throw new Error('missing-primary-session');
  // The identity read must also be session-current after the private gate:
  // revocation can happen between the two Workers' D1 reads.
  const now = Date.now();
  const row = await db.withSession('first-primary').prepare(`
    SELECT p.uid AS uid, s.status, s.consent_revision, s.fence_epoch, state.revision AS sync_revision,
      a.privacy_version, a.terms_version, a.accepted_at_ms, a.over_18_confirmed,
      s.erased_before_revision,
      EXISTS (
        SELECT 1 FROM health_erasure_finalizations f
        JOIN health_erasure_jobs j
          ON j.uid = f.uid AND j.consent_revision = f.consent_revision
        WHERE f.uid = s.uid
          AND f.erased_before_revision = s.erased_before_revision
          AND f.erased_before_revision = s.consent_revision
          AND f.fence_epoch + 1 = s.fence_epoch
          AND j.status = 'complete'
          AND j.completed_at_ms = f.completed_at_ms
          AND j.erased_before_revision = f.erased_before_revision
          AND j.key_disposition = f.key_disposition
      ) AS erasure_proven
    FROM auth_principals p
    JOIN auth_sessions t ON t.uid = p.uid
    LEFT JOIN sync_subjects s ON s.uid = p.uid
    LEFT JOIN sync_state state ON state.uid = s.uid
    LEFT JOIN health_consent_acceptances a ON a.uid = p.uid
    WHERE p.uid = ? AND p.status = 'active' AND p.auth_epoch = ?
      AND t.token_hash = ? AND t.auth_epoch = p.auth_epoch
      AND t.revoked_at_ms IS NULL
      AND t.issued_at_ms <= ? AND t.idle_expires_at_ms > ?
      AND t.absolute_expires_at_ms > ?
  `).bind(claims.uid, claims.fenceEpoch, claims.sessionHash, now, now, now).first();
  if (!row || row.uid !== claims.uid) throw new Error('identity-changed');
  if (row.status === null) {
    if (row.privacy_version !== null || row.consent_revision !== null || row.fence_epoch !== null) {
      throw new Error('invalid-consent-state');
    }
    return { uid: row.uid, status: 'unregistered', revision: 0, fenceEpoch: claims.fenceEpoch };
  }
  if (!['active', 'withdrawn', 'deleting', 'deleted'].includes(row.status)
    || !Number.isSafeInteger(row.consent_revision) || row.consent_revision < 1
    || !Number.isSafeInteger(row.fence_epoch) || row.fence_epoch < 1
    || (row.status === 'withdrawn' && row.consent_revision > 1
      && (row.erased_before_revision !== row.consent_revision || row.erasure_proven !== 1))
    || (row.fence_epoch > claims.fenceEpoch && !(
      // Terminal erasure advances the subject, not the Auth principal.
      // Permit a rights/status read one epoch ahead only with the immutable
      // SQL completion proof; this never authorizes the active fitness gate.
      row.status === 'withdrawn'
      && row.fence_epoch === claims.fenceEpoch + 1
      && row.erased_before_revision === row.consent_revision
      && row.erasure_proven === 1
    ))
    || (row.status === 'active' && !forWithdrawal && row.fence_epoch !== claims.fenceEpoch)) {
    throw new Error('invalid-consent-state');
  }
  if (row.status === 'active' && (row.consent_revision !== 1 || row.erased_before_revision !== 0
    || !Number.isSafeInteger(row.sync_revision)
    || row.sync_revision < 0 || row.privacy_version === null
    || !VERSION.test(row.privacy_version) || !VERSION.test(row.terms_version)
    || !Number.isSafeInteger(row.accepted_at_ms) || row.accepted_at_ms < 1
    || !Number.isFinite(new Date(row.accepted_at_ms).getTime())
    || row.accepted_at_ms > now
    || row.over_18_confirmed !== 1)) {
    // An active account missing an authenticated acceptance is not writable.
    throw new Error('missing-consent-proof');
  }
  return {
    uid: row.uid, status: row.status, revision: row.consent_revision, fenceEpoch: row.fence_epoch,
    ...(row.status === 'active' ? {
      acceptedAt: new Date(row.accepted_at_ms).toISOString(),
      privacyVersion: row.privacy_version,
      termsVersion: row.terms_version,
    } : {}),
  };
}

function independentDb(env) {
  if (!env.RECOVERY_DB || env.RECOVERY_DB === env.DB
    || typeof env.RECOVERY_DB.withSession !== 'function') {
    throw new Error('missing-independent-registry');
  }
  return env.RECOVERY_DB;
}

function sameLegalVersions(result, env) {
  return result.privacyVersion === env.CONSENT_PRIVACY_VERSION
    && result.termsVersion === env.CONSENT_TERMS_VERSION;
}

function activeSubject(result) {
  return {
    uid: result.uid, status: 'active', consentRevision: result.revision,
    fenceEpoch: result.fenceEpoch, erasedBeforeRevision: 0,
  };
}

async function confirmActiveConsent(env, claims, result) {
  const recovery = independentDb(env);
  const subject = activeSubject(result);
  try {
    await requireIndependentOwnerFence(recovery, subject, 'fitness');
  } catch (error) {
    // Only a current, verified request with CSRF can reconcile the existing
    // acceptance. Never enroll a missing floor from an application snapshot.
    if (!claims.emailVerified || !claims.csrfVerified || !sameLegalVersions(result, env)) throw error;
    await recordVerifiedInitialConsent(env.DB, recovery, result.uid, { requireOpen: true });
  }
  const readback = await readConsent(env.DB, claims);
  if (readback.status !== 'active' || readback.revision !== result.revision
    || readback.fenceEpoch !== result.fenceEpoch || readback.acceptedAt !== result.acceptedAt
    || readback.privacyVersion !== result.privacyVersion || readback.termsVersion !== result.termsVersion) {
    throw new Error('ambiguous-consent');
  }
  await requireIndependentOwnerFence(recovery, subject, 'fitness');
  return readback;
}

async function boundedJson(request) {
  if (!request.body || request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') {
    throw new TypeError('invalid-body');
  }
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    throw new TypeError('invalid-body');
  }
  const chunks = [];
  let lengthRead = 0;
  const reader = request.body.getReader();
  let timeout;
  const deadline = new Promise(resolve => {
    timeout = setTimeout(() => resolve(null), 2000);
  });
  try {
    for (let count = 0; count < 32; count += 1) {
      const next = await Promise.race([reader.read(), deadline]);
      if (next === null) throw new TypeError('body-timeout');
      if (next.done) {
        const bytes = new Uint8Array(lengthRead);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      }
      if (next.value.length === 0) continue;
      lengthRead += next.value.length;
      if (lengthRead > MAX_BODY_BYTES) throw new TypeError('invalid-body');
      chunks.push(next.value);
    }
    throw new TypeError('invalid-body');
  } finally {
    clearTimeout(timeout);
    void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* pending read is fenced by timeout */ }
  }
}

function validWithdrawal(body) {
  return !!body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).sort().join(',') === 'action,confirmsErasure,expectedRevision'
    && body.action === 'withdraw' && body.expectedRevision === 1
    && body.confirmsErasure === true;
}

async function pendingWithdrawal(db, claims) {
  const now = Date.now();
  // A lost write response is not proof of a withdrawal. The primary must
  // attest this owner's still-current session, withdrawn generation AND job.
  const row = await db.withSession('first-primary').prepare(`
    SELECT j.status, j.requested_at_ms
    FROM health_erasure_jobs j
    JOIN sync_subjects s ON s.uid = j.uid
    JOIN auth_principals p ON p.uid = j.uid
    JOIN auth_sessions t ON t.uid = p.uid
    WHERE j.uid = ? AND j.consent_revision = ?
      AND j.fence_epoch <= ? AND j.status IN ('pending', 'processing')
      AND j.requested_at_ms > 0 AND j.requested_at_ms <= ?
      AND s.status = 'withdrawn'
      AND s.consent_revision = j.consent_revision
      AND s.fence_epoch = j.fence_epoch
      AND p.status = 'active' AND p.auth_epoch = ?
      AND t.token_hash = ? AND t.auth_epoch = p.auth_epoch
      AND t.revoked_at_ms IS NULL
      AND t.issued_at_ms <= ? AND t.idle_expires_at_ms > ?
      AND t.absolute_expires_at_ms > ?
  `).bind(
    claims.uid, claims.healthConsentRevision, claims.fenceEpoch, now,
    claims.fenceEpoch, claims.sessionHash, now, now, now,
  ).first();
  return row?.status === 'pending' || row?.status === 'processing' ? row.status : null;
}

async function withdrawConsent(db, claims, subjectFenceEpoch) {
  const now = Date.now();
  try {
    // The trusted session, principal, age/consent proof and active generation
    // are rechecked inside the INSERT. Its AFTER trigger atomically changes
    // sync_subjects.status to withdrawn: later D1 writes/readbacks fail closed.
    // A zero-row INSERT, DB error or lost ACK cannot assert erasure success.
    await db.prepare(`
      INSERT INTO health_erasure_jobs (
        uid, consent_revision, fence_epoch, requested_at_ms, status
      )
      SELECT s.uid, s.consent_revision, s.fence_epoch, ?, 'pending'
      FROM sync_subjects s
      JOIN auth_principals p ON p.uid = s.uid
      JOIN auth_sessions t ON t.uid = p.uid
      JOIN health_consent_acceptances c ON c.uid = s.uid
      WHERE s.uid = ? AND s.status = 'active'
        AND s.consent_revision = ? AND s.fence_epoch = ? AND s.erased_before_revision = 0
        AND c.consent_revision = s.consent_revision
        AND c.over_18_confirmed = 1
        AND c.accepted_at_ms > 0 AND c.accepted_at_ms <= ?
        AND p.status = 'active' AND p.auth_epoch = ?
        AND t.token_hash = ? AND t.auth_epoch = p.auth_epoch
        AND t.revoked_at_ms IS NULL
        AND t.issued_at_ms <= ? AND t.idle_expires_at_ms > ?
        AND t.absolute_expires_at_ms > ?
    `).bind(
      now, claims.uid, claims.healthConsentRevision, subjectFenceEpoch,
      now, claims.fenceEpoch, claims.sessionHash, now, now, now,
    ).run();
  } catch {
    // A timeout can occur AFTER the atomic insert/trigger committed. Only
    // the primary readback below can prove pending versus unknown.
  }
}

function validAcceptance(body, env) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).sort().join(',') !== 'acceptance,action,expectedRevision'
    || body.action !== 'accept-initial' || body.expectedRevision !== 0
    || !body.acceptance || typeof body.acceptance !== 'object'
    || Array.isArray(body.acceptance)
    || Object.keys(body.acceptance).sort().join(',')
      !== 'acceptedHealthData,acceptedTerms,confirmsOver18,privacyVersion,termsVersion'
    || body.acceptance.confirmsOver18 !== true
    || body.acceptance.acceptedTerms !== true
    || body.acceptance.acceptedHealthData !== true
    || body.acceptance.privacyVersion !== env.CONSENT_PRIVACY_VERSION
    || body.acceptance.termsVersion !== env.CONSENT_TERMS_VERSION) {
    return false;
  }
  return true;
}

async function acceptInitial(db, claims, env) {
  const now = Date.now();
  // The first INSERT is conditional on the still-active hashed session and
  // principal epoch, so a revocation between AuthGate and SQL cannot grant
  // first consent. Later statements fail if this INSERT inserted zero rows:
  // D1.batch rolls back all statements rather than accepting a phantom ACK.
  try {
    await db.batch([
      db.prepare(`
        INSERT INTO sync_subjects (uid,status,consent_revision,fence_epoch)
        SELECT p.uid,'active',1,p.auth_epoch
        FROM auth_principals p JOIN auth_sessions t ON t.uid = p.uid
        WHERE p.uid = ? AND p.status = 'active'
          AND p.verified_at_ms > 0 AND p.verified_at_ms <= ?
          AND p.auth_epoch = ? AND t.auth_epoch = p.auth_epoch
          AND t.token_hash = ? AND t.revoked_at_ms IS NULL
          AND t.issued_at_ms <= ? AND t.idle_expires_at_ms > ?
          AND t.absolute_expires_at_ms > ?
      `).bind(claims.uid, now, claims.fenceEpoch, claims.sessionHash, now, now, now),
      db.prepare('INSERT INTO sync_state (uid,revision) VALUES (?,0)').bind(claims.uid),
      db.prepare(`
        INSERT INTO health_consent_acceptances
          (uid,consent_revision,privacy_version,terms_version,accepted_at_ms,over_18_confirmed)
        VALUES (?,1,?,?,?,1)
      `).bind(claims.uid, env.CONSENT_PRIVACY_VERSION, env.CONSENT_TERMS_VERSION, now),
    ]);
  } catch {
    // A transaction with a lost write response may already be committed.
    // Reconcile only the immutable proof for this still-current session.
  }
  const result = await readConsent(db, claims);
  if (result.status !== 'active' || result.revision !== 1
    || result.fenceEpoch !== claims.fenceEpoch
    || !sameLegalVersions(result, env)) {
    throw new Error('ambiguous-consent');
  }
  return await confirmActiveConsent(env, claims, result);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const statusRoute = url.pathname === '/v1/consent/status';
      const acceptRoute = url.pathname === '/v1/consent/initial';
      const withdrawRoute = url.pathname === '/v1/consent/withdraw';
      if (request.method !== 'POST' || (!statusRoute && !acceptRoute && !withdrawRoute) || url.search !== '') {
        return json({ error: 'not-found' }, 404);
      }
      if (typeof env.API_ORIGIN !== 'string' || !/^https:\/\/[^/]+$/.test(env.API_ORIGIN)
        || url.origin !== env.API_ORIGIN || request.headers.get('origin') !== env.API_ORIGIN
        || (request.headers.has('sec-fetch-site')
          && request.headers.get('sec-fetch-site') !== 'same-origin')) {
        return json({ error: 'origin-rejected' }, 403);
      }
      if (!env.DB || typeof env.DB.prepare !== 'function' || !env.AUTH_GATE
        || (!withdrawRoute && (typeof env.CONSENT_PRIVACY_VERSION !== 'string'
          || typeof env.CONSENT_TERMS_VERSION !== 'string'
          || !VERSION.test(env.CONSENT_PRIVACY_VERSION)
          || !VERSION.test(env.CONSENT_TERMS_VERSION)))) {
        return json({ error: 'unavailable' }, 503);
      }
      // Reject malformed instructions before consuming a trusted rate-limit
      // slot or querying D1. This validation cannot establish identity.
      // A gateway-forwarded zero-byte browser POST can expose an empty stream.
      // Content-Length: 0 is never sufficient: drain actual bytes before Auth.
      if (statusRoute && !await strictlyEmptyPost(request)) {
        return json({ error: 'invalid-body' }, 400);
      }
      let body;
      if (acceptRoute || withdrawRoute) {
        try { body = await boundedJson(request); }
        catch { return json({ error: 'invalid-body' }, 400); }
        if (acceptRoute && !validAcceptance(body, env)) {
          return json({ error: 'invalid-acceptance' }, 400);
        }
        if (withdrawRoute && !validWithdrawal(body)) {
          return json({ error: 'invalid-withdrawal' }, 400);
        }
      }
      const claims = await trustedClaims(request, env, url.pathname);
      if (!claims) return json({ error: 'unavailable' }, 503);
      if (claims.errorStatus) return json({ error: 'unauthorized' }, claims.errorStatus);
      if (statusRoute) {
        const result = await readConsent(env.DB, claims);
        if (result.status === 'withdrawn' && result.revision > 1) {
          await requireIndependentOwnerFence(independentDb(env), {
            uid: result.uid, status: result.status, consentRevision: result.revision,
            fenceEpoch: result.fenceEpoch, erasedBeforeRevision: result.revision,
          }, 'terminal');
          const current = await readConsent(env.DB, claims);
          if (current.status !== result.status || current.revision !== result.revision
            || current.fenceEpoch !== result.fenceEpoch) throw new Error('unproven-terminal-status');
        }
        return json(result.status === 'active' ? await confirmActiveConsent(env, claims, result) : result);
      }
      if (!withdrawRoute && !claims.emailVerified) return json({ error: 'unauthorized' }, 403);
      if (!claims.csrfVerified) return json({ error: 'csrf-required' }, 403);
      if (withdrawRoute) {
        if (claims.healthConsentRevision !== 1) {
          return json({ error: 'consent-conflict' }, 409);
        }
        const state = await readConsent(env.DB, claims, { forWithdrawal: true });
        if (state.status === 'unregistered') return json({ error: 'consent-conflict' }, 409);
        const recovery = independentDb(env);
        if (state.status === 'active') {
          await armIndependentHealthWithdrawal(recovery, activeSubject(state));
          await withdrawConsent(env.DB, claims, state.fenceEpoch);
        }
        if (!await pendingWithdrawal(env.DB, claims)) throw new Error('unproven-withdrawal');
        await recordVerifiedHealthWithdrawal(env.DB, recovery, claims.uid);
        const deletionStatus = await pendingWithdrawal(env.DB, claims);
        if (!deletionStatus) throw new Error('unproven-withdrawal');
        return json({ status: 'withdrawn', revision: 1,
          fenceEpoch: claims.fenceEpoch, deletionStatus });
      }
      const current = await readConsent(env.DB, claims);
      if (current.status !== 'unregistered') return json({ error: 'consent-conflict' }, 409);
      await enrollIndependentOwner(independentDb(env), claims.uid, claims.fenceEpoch, { requireOpen: true });
      const result = await acceptInitial(env.DB, claims, env);
      return json(result);
    } catch {
      return json({ error: 'unavailable-or-conflict' }, 503);
    }
  },
};
