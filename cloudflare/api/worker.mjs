// Candidate-only encrypted replica API. There is intentionally no public fixture,
// secret-header login, test backdoor or fallback identity when AUTH_GATE is absent.
import { z } from 'zod';
import { BODY_LIMIT_BYTES, BadInput, id, claimInput, retireInput, readInput, pageInput, commitInput, commitStatusInput, authClaims, activityAuthClaims, uniquePaths, validateSealedBatch } from './replica-contracts.mjs';
import {
  requireCurrentIndependentSyncFence, RuntimeSyncAccessRevokedError,
} from '../recovery/runtime-sync-fence.mjs';
import consentWorker from './consent-worker.mjs';
import logoutWorker from './logout-worker.mjs';
import cloudKeyWorker from './cloud-key-worker.mjs';
import { commitEncryptedBatch, readAccessState, readCloudKeyPrecondition, readCommitOutcome, readDocumentPage, readReceipt, readReplicaControl, readRightsAccessState, readRightsDocumentPage, readSnapshot } from './d1-document-store.mjs';
import { readOpenRecoveryGeneration, requireIndependentOwnerFence } from '../recovery/independent-owner-fence.mjs';
import { requireIndependentAccountAccess } from '../recovery/account-erasure-denials.mjs';
import { recordKindeForegroundActivity } from '../auth/kinde-foreground-activity.mjs';
import {
  mutationResponse, prepareReplicaClaim, prepareReplicaRetirement, readPublicCheckpointClock,
  readReplicaMutationReceipt, readReplicaMutationOutcome, fenceUncommittedReplicaMutation, writeReplicaMutation,
} from './replica-maintenance.mjs';

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

function checkJsonRequestHeaders(request, maxBytes) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    throw new BadInput('unsupported-media-type', 415);
  }
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    throw new BadInput('payload-too-large', 413);
  }
}

async function jsonBounded(request, maxBytes) {
  checkJsonRequestHeaders(request, maxBytes);
  if (!request.body) throw new BadInput('invalid-json', 400);
  const reader = request.body.getReader();
  const parts = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BadInput('payload-too-large', 413);
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new BadInput('invalid-json', 400); }
}

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}
async function payloadHash(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

async function authorize(request, env, route, isMutation) {
  if (!env.AUTH_GATE || typeof env.AUTH_GATE.fetch !== 'function') {
    throw new BadInput('auth-unavailable', 503);
  }
  const headers = new Headers({
    'x-original-method': request.method,
    'x-original-route': route,
    'origin': request.headers.get('origin') ?? '',
    'cookie': request.headers.get('cookie') ?? '',
    'x-csrf-token': request.headers.get('x-csrf-token') ?? '',
  });
  let response;
  try {
    response = await env.AUTH_GATE.fetch(new Request('https://auth-gate.internal/__internal/authorize', { method: 'POST', headers }));
  } catch { throw new BadInput('auth-unavailable', 503); }
  if (response.status === 429) throw new BadInput('rate-limited', 429);
  if (response.status === 401 || response.status === 403) throw new BadInput('unauthorized', response.status);
  if (!response.ok) throw new BadInput('auth-unavailable', 503);
  let claims;
  try { claims = (route === '/v1/account/activity' ? activityAuthClaims : authClaims).parse(await response.json()); }
  catch { throw new BadInput('auth-unavailable', 503); }
  // Rights-only remains possible after losing email verification, but no
  // active-fitness route may inherit that weaker scope from the AuthGate.
  if (!claims.emailVerified && route !== '/v1/rights/scan' && route !== '/v1/account/activity') throw new BadInput('unauthorized', 403);
  if (isMutation && !claims.csrfVerified) throw new BadInput('csrf-required', 403);
  return claims;
}

async function handler(request, env) {
  const url = new URL(request.url);
  const route = url.pathname;
  const maxBodyBytes = BODY_LIMIT_BYTES.get(route);
  if (maxBodyBytes === undefined || url.search !== '') return reply({ error: 'not-found' }, 404);
  if (request.method !== 'POST') {
    return reply({ error: 'method-not-allowed' }, 405);
  }
  // Same-origin requests only; do not enable wildcard CORS or permissive previews.
  if (!env.API_ORIGIN || !/^https:\/\//.test(env.API_ORIGIN)
    || url.origin !== env.API_ORIGIN
    || request.headers.get('origin') !== env.API_ORIGIN
    || (request.headers.has('sec-fetch-site') && request.headers.get('sec-fetch-site') !== 'same-origin')) {
    return reply({ error: 'origin-rejected' }, 403);
  }
  if (route === '/v1/account/activity') {
    // No marker is created merely by deploying this private API or by
    // servicing login, refresh, sync or other background traffic.
    if (env.CF06_FOREGROUND_ACTIVITY_ENABLED !== 'enabled') return reply({ error: 'activity-unavailable' }, 503);
    if (!env.DB || !env.RECOVERY_DB || env.DB === env.RECOVERY_DB) return reply({ error: 'activity-unavailable' }, 503);
    checkJsonRequestHeaders(request, maxBodyBytes);
    const claims = await authorize(request, env, route, true);
    if (!z.strictObject({}).safeParse(await jsonBounded(request, maxBodyBytes)).success) {
      throw new BadInput('invalid-input', 400);
    }
    const generation = await readOpenRecoveryGeneration(env.RECOVERY_DB);
    await requireIndependentAccountAccess(env.RECOVERY_DB, claims.uid);
    await readOpenRecoveryGeneration(env.RECOVERY_DB, generation);
    const result = await recordKindeForegroundActivity(env.DB, claims);
    if (result.outcome === 'unauthorized') throw new BadInput('unauthorized', 403);
    if (result.outcome !== 'recorded' && result.outcome !== 'observed') throw new BadInput('activity-unavailable', 503);
    await requireIndependentAccountAccess(env.RECOVERY_DB, claims.uid);
    await readOpenRecoveryGeneration(env.RECOVERY_DB, generation);
    return reply({ outcome: result.outcome });
  }
  if (!env.DB || typeof env.DB.prepare !== 'function' || typeof env.DB.batch !== 'function') {
    return reply({ error: 'storage-unavailable' }, 503);
  }
  // Reject cheaply checkable malformed/declared-oversized bodies before
  // spending private AuthGate rate-limit, crypto or D1 read budget.
  // Streaming size checks still run after Auth on untrusted/chunked bodies.
  checkJsonRequestHeaders(request, maxBodyBytes);
  const claims = await authorize(request, env, route,
    route === '/v1/sync/commit' || route === '/v1/sync/commit/status' || route === '/v1/sync/replica/claim' || route === '/v1/sync/replica/retire' || route === '/v1/sync/replica/status'
    || route === '/v1/sync/replica/cancel' || route === '/v1/rights/scan');
  const uid = claims.uid;
  const consentRevision = claims.healthConsentRevision;
  const fenceEpoch = claims.fenceEpoch;
  // This private API is not operational without an independent D1. The
  // AuthGate's main-D1 proof is necessary but cannot survive its own restore.
  if (route !== '/v1/rights/scan') await requireCurrentIndependentSyncFence(env, claims);
  const guardedReply = async (body, status = 200) => {
    await requireCurrentIndependentSyncFence(env, claims);
    return reply(body, status);
  };
  if (route === '/v1/sync/receipt') {
    const body = await jsonBounded(request, maxBodyBytes);
    const batchId = z.strictObject({ batchId: id }).safeParse(body);
    if (!batchId.success) throw new BadInput('invalid-input', 400);
    const state = await readAccessState(env.DB, uid, fenceEpoch, claims.sessionHash);
    if (state?.status !== 'active' || state?.consent_revision !== consentRevision
      || state?.fence_epoch !== fenceEpoch
      || state?.revision === undefined) throw new BadInput('access-revoked', 403);
    const receipt = await readReceipt(env.DB, uid, consentRevision, fenceEpoch, batchId.data.batchId, claims.sessionHash);
    return guardedReply({ receipt: receipt ? { requestHash: receipt.request_hash, revision: receipt.committed_revision,
      lastSeq: receipt.last_seq, consentRevision: receipt.consent_revision,
      replica: { slot: receipt.slot, replicaId: receipt.replica_id, generation: receipt.generation } } : null });
  }
  const raw = await jsonBounded(request, maxBodyBytes);
  if (route === '/v1/rights/scan') {
    // A withdrawn account has NO fitness scope: only a still-pending erasure
    // job and the independent, open rights registry may release ciphertext.
    const parsed = pageInput.safeParse(raw);
    if (!parsed.success || !env.RECOVERY_DB || env.RECOVERY_DB === env.DB) {
      throw new BadInput('rights-unavailable', parsed.success ? 503 : 400);
    }
    const page = await readRightsDocumentPage(env.DB, uid, consentRevision, fenceEpoch,
      parsed.data.after, parsed.data.expectedRevision, claims.sessionHash);
    if (page.kind === 'access-revoked') throw new BadInput('access-revoked', 403);
    if (page.kind === 'snapshot-changed') throw new BadInput('snapshot-changed', 409);
    const prove = async subject => requireIndependentOwnerFence(env.RECOVERY_DB, {
      uid: subject.uid, status: subject.status,
      consentRevision: subject.consent_revision,
      fenceEpoch: subject.fence_epoch,
      erasedBeforeRevision: subject.erased_before_revision,
    }, 'rights');
    await prove(page.subject);
    // A finalizer or logout can win after the SQL page was collected. The
    // same original session, still-pending job and external cutoff must
    // remain readable just before replying; no stale page is success.
    const current = await readRightsAccessState(env.DB, uid, consentRevision,
      fenceEpoch, claims.sessionHash);
    if (!current || current.revision !== page.revision
      || current.fence_epoch !== page.fenceEpoch
      || current.consent_revision !== page.consentRevision) {
      throw new BadInput('access-revoked', 403);
    }
    await prove(current);
    const { kind: _kind, subject: _subject, ...data } = page;
    return reply(data);
  }
  if (route === '/v1/sync/commit/status') {
    // A conflict/timeout is ambiguous. The original CAS is impossible only
    // when one PRIMARY SQL snapshot sees an advanced revision and no receipt.
    const parsed = commitStatusInput.safeParse(raw);
    if (!parsed.success) throw new BadInput('invalid-input', 400);
    const input = parsed.data;
    if (input.consentRevision !== consentRevision
      || input.expectedFenceEpoch !== fenceEpoch) throw new BadInput('access-revoked', 403);
    const row = await readCommitOutcome(env.DB, uid, consentRevision, fenceEpoch,
      input.batchId, claims.sessionHash);
    if (!row || !Number.isSafeInteger(row.current_revision) || row.current_revision < 0) {
      throw new BadInput('access-revoked', 403);
    }
    if (row.existing_hash !== null) {
      if (row.existing_hash !== input.requestHash
        || row.existing_expected_revision !== input.expectedRevision
        || row.existing_consent_revision !== consentRevision
        || row.existing_fence_epoch !== fenceEpoch) {
        throw new BadInput('batch-id-conflict', 409);
      }
      // Historical commit status is NOT an ACK: the client still needs the
      // exact ciphertext-bound receipt before touching its local journal.
      return guardedReply({ outcome: 'committed', currentRevision: row.current_revision });
    }
    return guardedReply({
      outcome: row.current_revision > input.expectedRevision ? 'not-committed' : 'inconclusive',
      currentRevision: row.current_revision,
    });
  }
  if (route === '/v1/sync/control') {
    if (!z.strictObject({}).safeParse(raw).success) throw new BadInput('invalid-input', 400);
    const control = await readReplicaControl(env.DB, uid, consentRevision, fenceEpoch, claims.sessionHash);
    if (!control) throw new BadInput('access-revoked', 403);
    // Account A and B may share epoch and revision during an A→B→A race.
    // Bind the control snapshot to its server-verified session owner.
    return guardedReply({ uid, ...control });
  }
  if (route === '/v1/sync/replica/status' || route === '/v1/sync/replica/cancel') {
    // The two strict schemas are disjoint: a status lookup proves absence
    // for the exact original mutation body, never just a shared mutationId.
    const claim = claimInput.safeParse(raw);
    const retirement = claim.success ? null : retireInput.safeParse(raw);
    if (!claim.success && !retirement?.success) throw new BadInput('invalid-input', 400);
    const input = claim.success ? claim.data : retirement.data;
    if (input.consentRevision !== consentRevision
      || input.expectedFenceEpoch !== fenceEpoch) throw new BadInput('access-revoked', 403);
    // Only the primary can establish non-commit under a concurrent lost ACK.
    // This single SELECT prevents a receipt/revision time-of-check race.
    let row = await readReplicaMutationOutcome(env.DB, uid, consentRevision, fenceEpoch, input.mutationId, claims.sessionHash);
    if (!row) throw new BadInput('access-revoked', 403);
    if (route === '/v1/sync/replica/cancel' && row.existing_hash === null
      && row.current_revision === input.expectedRevision) {
      // A cancellation is a control revision fence, not a receipt or a data
      // mutation. The CAS and absent receipt are rechecked in the SQL write.
      await fenceUncommittedReplicaMutation(env.DB, uid, consentRevision, fenceEpoch, input, claims.sessionHash);
      row = await readReplicaMutationOutcome(env.DB, uid, consentRevision, fenceEpoch, input.mutationId, claims.sessionHash);
      if (!row) throw new BadInput('access-revoked', 403);
    }
    if (!Number.isSafeInteger(row.current_revision) || row.current_revision < 0) {
      throw new BadInput('cloud-unavailable', 503);
    }
    if (row.existing_hash !== null) {
      if (row.existing_hash !== await payloadHash(input)
        || row.existing_consent_revision !== consentRevision
        || row.existing_fence_epoch !== fenceEpoch
        || row.existing_expected_revision !== input.expectedRevision) {
        throw new BadInput('mutation-id-conflict', 409);
      }
      return guardedReply({ outcome: 'committed', currentRevision: row.current_revision });
    }
    return guardedReply({
      outcome: row.current_revision > input.expectedRevision ? 'not-committed' : 'inconclusive',
      currentRevision: row.current_revision,
    });
  }
  if (route === '/v1/sync/replica/claim' || route === '/v1/sync/replica/retire') {
    const isClaim = route === '/v1/sync/replica/claim';
    const claim = isClaim ? claimInput.safeParse(raw) : null;
    const retirement = isClaim ? null : retireInput.safeParse(raw);
    const input = claim?.success ? claim.data : retirement?.success ? retirement.data : null;
    if (!input) throw new BadInput('invalid-input', 400);
    if (input.consentRevision !== consentRevision) throw new BadInput('access-revoked', 403);
    if (input.expectedFenceEpoch !== fenceEpoch) throw new BadInput('replica-fenced-or-conflict', 409);
    const hash = await payloadHash(input);
    const existing = await readReplicaMutationReceipt(env.DB, uid, consentRevision, fenceEpoch, input.mutationId, claims.sessionHash);
    if (existing) {
      if (existing.request_hash !== hash) throw new BadInput('mutation-id-conflict', 409);
      return guardedReply(mutationResponse(input.mutationId, existing, true));
    }
    const control = await readReplicaControl(env.DB, uid, consentRevision, fenceEpoch, claims.sessionHash);
    if (!control) throw new BadInput('access-revoked', 403);
    if (control.revision !== input.expectedRevision) throw new BadInput('replica-fenced-or-conflict', 409);
    let selected;
    if (claim?.success) {
      // Public Protocol 3 clocks in AEAD-associated metadata provide a bounded
      // server-side cross-check; the client must separately AEAD-open a full
      // account scan before checkpoint adoption.
      const cloudClock = await readPublicCheckpointClock(env.DB, uid, fenceEpoch, claims.sessionHash);
      if (canonical(cloudClock) !== canonical(claim.data.checkpointClock)) {
        throw new BadInput('checkpoint-changed', 409);
      }
      selected = prepareReplicaClaim(control, cloudClock,
        claim.data.candidateReplicaId, claim.data.currentReplica);
    } else if (retirement?.success) {
      selected = prepareReplicaRetirement(control, retirement.data.replica, retirement.data.confirmation);
    } else {
      throw new BadInput('invalid-input', 400);
    }
    if (selected === 'capacity') throw new BadInput('replica-capacity', 409);
    if (!selected) throw new BadInput('replica-fenced-or-conflict', 409);
    const mutation = {
      ...selected, mutationId: input.mutationId, hash,
      expectedRevision: input.expectedRevision, fenceEpoch, consentRevision,
      sessionHash: claims.sessionHash,
    };
    try {
      const stored = await writeReplicaMutation(env.DB, uid, mutation);
      return guardedReply(mutationResponse(input.mutationId, stored, false));
    } catch (error) {
      const saved = await readReplicaMutationReceipt(env.DB, uid, consentRevision, fenceEpoch, input.mutationId, claims.sessionHash);
      if (saved) {
        if (saved.request_hash !== hash) throw new BadInput('mutation-id-conflict', 409);
        return guardedReply(mutationResponse(input.mutationId, saved, true));
      }
      const missingKey = isClaim && String(error?.message).includes('replica-cloud-key-required');
      const state = missingKey
        ? await readCloudKeyPrecondition(env.DB, uid, fenceEpoch, claims.sessionHash)
        : await readAccessState(env.DB, uid, fenceEpoch, claims.sessionHash);
      if (state?.status !== 'active' || state.consent_revision !== consentRevision
        || state.fence_epoch !== fenceEpoch) throw new BadInput('access-revoked', 403);
      if (state.revision !== input.expectedRevision
        || /replica-control-fenced|replica-id-reuse|UNIQUE constraint|replica-regression/i.test(String(error?.message))) {
        throw new BadInput('replica-fenced-or-conflict', 409);
      }
      if (isClaim && String(error?.message).includes('replica-capacity')) {
        throw new BadInput('replica-capacity', 409);
      }
      if (missingKey && state.revision === 0 && state.stored_keys === 0 && state.issued_keys === 0
        && state.documents === 0 && state.replicas === 0
        && state.receipts === 0 && state.mutations === 0 && state.erasures === 0) {
        throw new BadInput('cloud-key-required', 428);
      }
      throw error;
    }
  }
  if (route === '/v1/sync/scan') {
    const parsed = pageInput.safeParse(raw);
    if (!parsed.success) throw new BadInput('invalid-input', 400);
    const page = await readDocumentPage(env.DB, uid, consentRevision, fenceEpoch, parsed.data.after, parsed.data.expectedRevision, claims.sessionHash);
    if (page.kind === 'access-revoked') throw new BadInput('access-revoked', 403);
    if (page.kind === 'snapshot-changed') throw new BadInput('snapshot-changed', 409);
    const { kind: _kind, ...data } = page;
    return guardedReply(data);
  }
  if (route === '/v1/sync/read') {
    const parsed = readInput.safeParse(raw);
    if (!parsed.success || !uniquePaths(parsed.data.paths)) throw new BadInput('invalid-input', 400);
    const snapshot = await readSnapshot(env.DB, uid, consentRevision, fenceEpoch, parsed.data.paths, claims.sessionHash);
    if (!snapshot) throw new BadInput('access-revoked', 403);
    return guardedReply(snapshot);
  }
  const parsed = commitInput.safeParse(raw);
  if (!parsed.success) throw new BadInput('invalid-input', 400);
  const input = parsed.data;
  if (input.consentRevision !== consentRevision) throw new BadInput('access-revoked', 403);
  if (input.expectedFenceEpoch !== fenceEpoch) throw new BadInput('replica-fenced-or-conflict', 409);
  validateSealedBatch(input);
  const hash = await payloadHash(input);
  const existing = await readReceipt(env.DB, uid, consentRevision, fenceEpoch, input.batchId, claims.sessionHash);
  if (existing) {
    if (existing.request_hash !== hash) throw new BadInput('batch-id-conflict', 409);
    return guardedReply({ batchId: input.batchId, revision: existing.committed_revision, lastSeq: existing.last_seq, replayed: true });
  }
  try {
    const result = await commitEncryptedBatch(env.DB, uid, fenceEpoch, input, hash, claims.sessionHash);
    return guardedReply({ ...result, replayed: false });
  } catch (error) {
    // Lost response is not evidence of no commit. Check the persisted receipt.
    const receipt = await readReceipt(env.DB, uid, consentRevision, fenceEpoch, input.batchId, claims.sessionHash);
    if (receipt) {
      if (receipt.request_hash !== hash) throw new BadInput('batch-id-conflict', 409);
      return guardedReply({ batchId: input.batchId, revision: receipt.committed_revision, lastSeq: receipt.last_seq, replayed: true });
    }
    const state = await readAccessState(env.DB, uid, fenceEpoch, claims.sessionHash);
    if (state?.status !== 'active' || state?.consent_revision !== consentRevision
      || state?.fence_epoch !== fenceEpoch) {
      throw new BadInput('access-revoked', 403);
    }
    if (state.revision !== input.expectedRevision || /sync-fenced|UNIQUE constraint/i.test(String(error?.message))) {
      throw new BadInput('replica-fenced-or-conflict', 409);
    }
    throw error;
  }
}

export default {
  async fetch(request, env) {
    const route = new URL(request.url).pathname;
    if (route === '/v1/consent/status' || route === '/v1/consent/initial' || route === '/v1/consent/withdraw') {
      return consentWorker.fetch(request, env);
    }
    if (route === '/v1/auth/logout') return logoutWorker.fetch(request, env);
    if (route === '/v1/cloud-key/sync' || route === '/v1/cloud-key/rights-export') {
      return cloudKeyWorker.fetch(request, env);
    }
    try { return await handler(request, env); }
    catch (error) {
      if (error instanceof BadInput) return reply({ error: error.message }, error.status);
      if (error instanceof RuntimeSyncAccessRevokedError) return reply({ error: 'access-revoked' }, 403);
      // No exception message, health plaintext, SQL statement or identity in API response.
      return reply({ error: 'cloud-unavailable' }, 503);
    }
  },
};
