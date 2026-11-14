// Candidate-only encrypted replica API. There is intentionally no public fixture,
// secret-header login, test backdoor or fallback identity when AUTH_GATE is absent.
import { z } from 'zod';
import consentWorker from './consent-worker.mjs';
import logoutWorker from './logout-worker.mjs';
import { commitEncryptedBatch, readAccessState, readCommitOutcome, readDocumentPage, readReceipt, readReplicaControl, readSnapshot } from './d1-document-store.mjs';
import {
  mutationResponse, prepareReplicaClaim, prepareReplicaRetirement, readPublicCheckpointClock,
  readReplicaMutationReceipt, readReplicaMutationOutcome, writeReplicaMutation,
} from './replica-maintenance.mjs';

const MAX_DOCUMENT_BYTES = 950000;
// One causal batch can legitimately contain eight separately encrypted docs.
// The transport body cap must not be smaller than its own eight-document contract.
const MAX_BODY_BYTES = 8 * MAX_DOCUMENT_BYTES + 8192;
// Small control/receipt/membership requests must not inherit the multi-document
// commit budget: parsing megabytes of otherwise valid JSON wastes Workers CPU.
// These ceilings include JSON whitespace and are above the strict schemas' maxima.
const BODY_LIMIT_BYTES = new Map([
  ['/v1/sync/control', 128],
  ['/v1/sync/read', 512],
  ['/v1/sync/scan', 256],
  ['/v1/sync/receipt', 256],
  ['/v1/sync/replica/claim', 4096],
  ['/v1/sync/replica/retire', 4096],
  ['/v1/sync/replica/status', 4096],
  ['/v1/sync/commit', MAX_BODY_BYTES],
  ['/v1/sync/commit/status', 512],
]);
const SLOT = /^s(?:0[0-9]|1[0-5])$/;
const PATH = /^(?:(?:history_months|nutrition_months)\/[0-9]{4}-(?:0[1-9]|1[0-2]))?$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const safeInt = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const slot = z.string().regex(SLOT);
const replica = z.strictObject({
  slot,
  replicaId: z.string().min(1).max(128).refine(s => s.trim() === s),
  generation: safeInt.min(1),
});
const writer = replica.extend({ seq: safeInt.min(1), consentRevision: safeInt.min(1) });
const document = z.strictObject({
  _schemaVersion: z.literal(1),
  _sync: z.strictObject({
    protocolVersion: z.literal(3),
    clock: z.record(slot, safeInt),
    writer,
    fields: z.strictObject({}),
  }),
  _sealed: z.strictObject({
    format: z.literal('thelogbook-cloud-document'),
    version: z.literal(1),
    nonce: z.string().length(32).regex(BASE64URL),
    ciphertext: z.string().min(22).max(MAX_DOCUMENT_BYTES).regex(BASE64URL),
  }),
});
const documentPath = z.string().max(32).regex(PATH);
const id = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
const mutationBase = {
  mutationId: id, expectedRevision: safeInt,
  expectedFenceEpoch: safeInt.min(1), consentRevision: safeInt.min(1),
};
const claimInput = z.strictObject({
  ...mutationBase, candidateReplicaId: z.string().min(1).max(128).refine(s => s.trim() === s),
  currentReplica: replica.nullable(), checkpointClock: z.record(slot, safeInt),
});
const retireInput = z.strictObject({ ...mutationBase, replica });
const readInput = z.strictObject({ paths: z.array(documentPath).min(1).max(8) });
const pageInput = z.strictObject({ after: documentPath.nullable(), expectedRevision: safeInt.nullable() })
  .refine(value => (value.after === null) === (value.expectedRevision === null));
const commitInput = z.strictObject({
  batchId: id,
  expectedRevision: safeInt,
  expectedFenceEpoch: safeInt.min(1),
  consentRevision: safeInt.min(1),
  replica,
  lastSeq: safeInt.min(1),
  documents: z.array(z.strictObject({ path: documentPath, document })).min(1).max(8),
});
const commitStatusInput = z.strictObject({
  batchId: id, expectedRevision: safeInt, expectedFenceEpoch: safeInt.min(1),
  consentRevision: safeInt.min(1), requestHash: z.string().regex(/^[a-f0-9]{64}$/),
});
const authClaims = z.strictObject({
  uid: z.string().min(1).max(128).refine(s => !s.includes('/') && s.trim() === s),
  authenticated: z.literal(true),
  emailVerified: z.literal(true),
  healthConsentRevision: safeInt.min(1),
  fenceEpoch: safeInt.min(1),
  csrfVerified: z.boolean(),
  rateGatePassed: z.literal(true),
  sessionHash: z.string().regex(/^[a-f0-9]{64}$/),
});

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
class BadInput extends Error {
  constructor(code, status) { super(code); this.status = status; }
}
function uniquePaths(paths) { return paths.length === new Set(paths).size; }

async function jsonBounded(request, maxBytes) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    throw new BadInput('unsupported-media-type', 415);
  }
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    throw new BadInput('payload-too-large', 413);
  }
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
  try { claims = authClaims.parse(await response.json()); }
  catch { throw new BadInput('auth-unavailable', 503); }
  if (isMutation && !claims.csrfVerified) throw new BadInput('csrf-required', 403);
  return claims;
}

function validateSealedBatch(input) {
  if (!uniquePaths(input.documents.map(item => item.path))) throw new BadInput('invalid-input', 400);
  for (const { document: sealed } of input.documents) {
    const w = sealed._sync.writer;
    if (w.slot !== input.replica.slot || w.replicaId !== input.replica.replicaId
      || w.generation !== input.replica.generation || w.seq !== input.lastSeq
      || w.consentRevision !== input.consentRevision
      // Writer.seq identifies the whole committed batch, while a particular
      // document may have been last touched by an earlier operation in it.
      // Require the actor's real causal dot, not a fabricated global frontier.
      || !Number.isSafeInteger(sealed._sync.clock[w.slot])
      || sealed._sync.clock[w.slot] < 1 || sealed._sync.clock[w.slot] > w.seq) {
      throw new BadInput('invalid-input', 400);
    }
    if (new TextEncoder().encode(JSON.stringify(sealed)).byteLength > MAX_DOCUMENT_BYTES) {
      throw new BadInput('payload-too-large', 413);
    }
  }
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
  if (!env.DB || typeof env.DB.prepare !== 'function' || typeof env.DB.batch !== 'function') {
    return reply({ error: 'storage-unavailable' }, 503);
  }
  const claims = await authorize(request, env, route,
    route === '/v1/sync/commit' || route === '/v1/sync/commit/status' || route === '/v1/sync/replica/claim' || route === '/v1/sync/replica/retire' || route === '/v1/sync/replica/status');
  const uid = claims.uid;
  const consentRevision = claims.healthConsentRevision;
  const fenceEpoch = claims.fenceEpoch;
  if (route === '/v1/sync/receipt') {
    const body = await jsonBounded(request, maxBodyBytes);
    const batchId = z.strictObject({ batchId: id }).safeParse(body);
    if (!batchId.success) throw new BadInput('invalid-input', 400);
    const state = await readAccessState(env.DB, uid, fenceEpoch, claims.sessionHash);
    if (state?.status !== 'active' || state?.consent_revision !== consentRevision
      || state?.fence_epoch !== fenceEpoch
      || state?.revision === undefined) throw new BadInput('access-revoked', 403);
    const receipt = await readReceipt(env.DB, uid, consentRevision, fenceEpoch, batchId.data.batchId, claims.sessionHash);
    return reply({ receipt: receipt ? { requestHash: receipt.request_hash, revision: receipt.committed_revision,
      lastSeq: receipt.last_seq, consentRevision: receipt.consent_revision,
      replica: { slot: receipt.slot, replicaId: receipt.replica_id, generation: receipt.generation } } : null });
  }
  const raw = await jsonBounded(request, maxBodyBytes);
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
      return reply({ outcome: 'committed', currentRevision: row.current_revision });
    }
    return reply({
      outcome: row.current_revision > input.expectedRevision ? 'not-committed' : 'inconclusive',
      currentRevision: row.current_revision,
    });
  }
  if (route === '/v1/sync/control') {
    if (!z.strictObject({}).safeParse(raw).success) throw new BadInput('invalid-input', 400);
    const control = await readReplicaControl(env.DB, uid, consentRevision, fenceEpoch, claims.sessionHash);
    if (!control) throw new BadInput('access-revoked', 403);
    return reply(control);
  }
  if (route === '/v1/sync/replica/status') {
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
    const row = await readReplicaMutationOutcome(env.DB, uid, consentRevision, fenceEpoch, input.mutationId, claims.sessionHash);
    if (!row) throw new BadInput('access-revoked', 403);
    if (row.existing_hash !== null) {
      if (row.existing_hash !== await payloadHash(input)
        || row.existing_consent_revision !== consentRevision
        || row.existing_fence_epoch !== fenceEpoch
        || row.existing_expected_revision !== input.expectedRevision) {
        throw new BadInput('mutation-id-conflict', 409);
      }
      return reply({ outcome: 'committed', currentRevision: row.current_revision });
    }
    return reply({
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
      return reply(mutationResponse(input.mutationId, existing, true));
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
      selected = prepareReplicaRetirement(control, retirement.data.replica);
    } else {
      throw new BadInput('invalid-input', 400);
    }
    if (!selected) throw new BadInput('replica-fenced-or-conflict', 409);
    const mutation = {
      ...selected, mutationId: input.mutationId, hash,
      expectedRevision: input.expectedRevision, fenceEpoch, consentRevision,
      sessionHash: claims.sessionHash,
    };
    try {
      const stored = await writeReplicaMutation(env.DB, uid, mutation);
      return reply(mutationResponse(input.mutationId, stored, false));
    } catch (error) {
      const saved = await readReplicaMutationReceipt(env.DB, uid, consentRevision, fenceEpoch, input.mutationId, claims.sessionHash);
      if (saved) {
        if (saved.request_hash !== hash) throw new BadInput('mutation-id-conflict', 409);
        return reply(mutationResponse(input.mutationId, saved, true));
      }
      const state = await readAccessState(env.DB, uid, fenceEpoch, claims.sessionHash);
      if (state?.status !== 'active' || state.consent_revision !== consentRevision
        || state.fence_epoch !== fenceEpoch) throw new BadInput('access-revoked', 403);
      if (state.revision !== input.expectedRevision
        || /replica-control-fenced|replica-id-reuse|UNIQUE constraint|replica-regression/i.test(String(error?.message))) {
        throw new BadInput('replica-fenced-or-conflict', 409);
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
    return reply(data);
  }
  if (route === '/v1/sync/read') {
    const parsed = readInput.safeParse(raw);
    if (!parsed.success || !uniquePaths(parsed.data.paths)) throw new BadInput('invalid-input', 400);
    const snapshot = await readSnapshot(env.DB, uid, consentRevision, fenceEpoch, parsed.data.paths, claims.sessionHash);
    if (!snapshot) throw new BadInput('access-revoked', 403);
    return reply(snapshot);
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
    return reply({ batchId: input.batchId, revision: existing.committed_revision, lastSeq: existing.last_seq, replayed: true });
  }
  try {
    const result = await commitEncryptedBatch(env.DB, uid, fenceEpoch, input, hash, claims.sessionHash);
    return reply({ ...result, replayed: false });
  } catch (error) {
    // Lost response is not evidence of no commit. Check the persisted receipt.
    const receipt = await readReceipt(env.DB, uid, consentRevision, fenceEpoch, input.batchId, claims.sessionHash);
    if (receipt) {
      if (receipt.request_hash !== hash) throw new BadInput('batch-id-conflict', 409);
      return reply({ batchId: input.batchId, revision: receipt.committed_revision, lastSeq: receipt.last_seq, replayed: true });
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
    try { return await handler(request, env); }
    catch (error) {
      if (error instanceof BadInput) return reply({ error: error.message }, error.status);
      // No exception message, health plaintext, SQL statement or identity in API response.
      return reply({ error: 'cloud-unavailable' }, 503);
    }
  },
};
