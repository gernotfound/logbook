// Candidate-only encrypted replica API. There is intentionally no public fixture,
// secret-header login, test backdoor or fallback identity when AUTH_GATE is absent.
import { z } from 'zod';
import { commitEncryptedBatch, readAccessState, readDocumentPage, readReceipt, readReplicaControl, readSnapshot } from './d1-document-store.mjs';
import {
  mutationResponse, prepareReplicaClaim, prepareReplicaRetirement, readPublicCheckpointClock,
  readReplicaMutationReceipt, writeReplicaMutation,
} from './replica-maintenance.mjs';

const MAX_DOCUMENT_BYTES = 950000;
// One causal batch can legitimately contain eight separately encrypted docs.
// The transport body cap must not be smaller than its own eight-document contract.
const MAX_BODY_BYTES = 8 * MAX_DOCUMENT_BYTES + 8192;
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
const authClaims = z.strictObject({
  uid: z.string().min(1).max(128).refine(s => !s.includes('/') && s.trim() === s),
  authenticated: z.literal(true),
  emailVerified: z.literal(true),
  healthConsentRevision: safeInt.min(1),
  fenceEpoch: safeInt.min(1),
  csrfVerified: z.boolean(),
  rateGatePassed: z.literal(true),
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

async function jsonBounded(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    throw new BadInput('unsupported-media-type', 415);
  }
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
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
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
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
      || !Number.isSafeInteger(sealed._sync.clock[w.slot]) || sealed._sync.clock[w.slot] < 1) {
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
  const validRoutes = new Set(['/v1/sync/read', '/v1/sync/scan', '/v1/sync/control', '/v1/sync/replica/claim', '/v1/sync/replica/retire', '/v1/sync/commit', '/v1/sync/receipt']);
  if (!validRoutes.has(route)) return reply({ error: 'not-found' }, 404);
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
    route === '/v1/sync/commit' || route === '/v1/sync/replica/claim' || route === '/v1/sync/replica/retire');
  const uid = claims.uid;
  const consentRevision = claims.healthConsentRevision;
  const fenceEpoch = claims.fenceEpoch;
  if (route === '/v1/sync/receipt') {
    const body = await jsonBounded(request);
    const batchId = z.strictObject({ batchId: id }).safeParse(body);
    if (!batchId.success) throw new BadInput('invalid-input', 400);
    const state = await readAccessState(env.DB, uid);
    if (state?.status !== 'active' || state?.consent_revision !== consentRevision
      || state?.fence_epoch !== fenceEpoch
      || state?.revision === undefined) throw new BadInput('access-revoked', 403);
    const receipt = await readReceipt(env.DB, uid, consentRevision, fenceEpoch, batchId.data.batchId);
    return reply({ receipt: receipt ? { requestHash: receipt.request_hash, revision: receipt.committed_revision,
      lastSeq: receipt.last_seq, consentRevision: receipt.consent_revision,
      replica: { slot: receipt.slot, replicaId: receipt.replica_id, generation: receipt.generation } } : null });
  }
  const raw = await jsonBounded(request);
  if (route === '/v1/sync/control') {
    if (!z.strictObject({}).safeParse(raw).success) throw new BadInput('invalid-input', 400);
    const control = await readReplicaControl(env.DB, uid, consentRevision, fenceEpoch);
    if (!control) throw new BadInput('access-revoked', 403);
    return reply(control);
  }
  if (route === '/v1/sync/replica/claim' || route === '/v1/sync/replica/retire') {
    const isClaim = route === '/v1/sync/replica/claim';
    const parsed = (isClaim ? claimInput : retireInput).safeParse(raw);
    if (!parsed.success) throw new BadInput('invalid-input', 400);
    const input = parsed.data;
    if (input.consentRevision !== consentRevision) throw new BadInput('access-revoked', 403);
    if (input.expectedFenceEpoch !== fenceEpoch) throw new BadInput('replica-fenced-or-conflict', 409);
    const hash = await payloadHash(input);
    const existing = await readReplicaMutationReceipt(env.DB, uid, consentRevision, fenceEpoch, input.mutationId);
    if (existing) {
      if (existing.request_hash !== hash) throw new BadInput('mutation-id-conflict', 409);
      return reply(mutationResponse(input.mutationId, existing, true));
    }
    const control = await readReplicaControl(env.DB, uid, consentRevision, fenceEpoch);
    if (!control) throw new BadInput('access-revoked', 403);
    if (control.revision !== input.expectedRevision) throw new BadInput('replica-fenced-or-conflict', 409);
    let selected;
    if (isClaim) {
      // Public Protocol 3 clocks in AEAD-associated metadata provide a bounded
      // server-side cross-check; the client must separately AEAD-open a full
      // account scan before checkpoint adoption.
      const cloudClock = await readPublicCheckpointClock(env.DB, uid);
      if (canonical(cloudClock) !== canonical(input.checkpointClock)) {
        throw new BadInput('checkpoint-changed', 409);
      }
      selected = prepareReplicaClaim(control, cloudClock,
        input.candidateReplicaId, input.currentReplica);
    } else {
      selected = prepareReplicaRetirement(control, input.replica);
    }
    if (!selected) throw new BadInput('replica-fenced-or-conflict', 409);
    const mutation = {
      ...selected, mutationId: input.mutationId, hash,
      expectedRevision: input.expectedRevision, fenceEpoch, consentRevision,
    };
    try {
      const stored = await writeReplicaMutation(env.DB, uid, mutation);
      return reply(mutationResponse(input.mutationId, stored, false));
    } catch (error) {
      const saved = await readReplicaMutationReceipt(env.DB, uid,
        consentRevision, fenceEpoch, input.mutationId);
      if (saved) {
        if (saved.request_hash !== hash) throw new BadInput('mutation-id-conflict', 409);
        return reply(mutationResponse(input.mutationId, saved, true));
      }
      const state = await readAccessState(env.DB, uid);
      if (state?.status !== 'active' || state.consent_revision !== consentRevision
        || state.fence_epoch !== fenceEpoch) throw new BadInput('access-revoked', 403);
      if (state.revision !== input.expectedRevision
        || /replica-control-fenced|UNIQUE constraint|replica-regression/i.test(String(error?.message))) {
        throw new BadInput('replica-fenced-or-conflict', 409);
      }
      throw error;
    }
  }
  if (route === '/v1/sync/scan') {
    const parsed = pageInput.safeParse(raw);
    if (!parsed.success) throw new BadInput('invalid-input', 400);
    const page = await readDocumentPage(env.DB, uid, consentRevision, fenceEpoch,
      parsed.data.after, parsed.data.expectedRevision);
    if (page.kind === 'access-revoked') throw new BadInput('access-revoked', 403);
    if (page.kind === 'snapshot-changed') throw new BadInput('snapshot-changed', 409);
    const { kind: _kind, ...data } = page;
    return reply(data);
  }
  if (route === '/v1/sync/read') {
    const parsed = readInput.safeParse(raw);
    if (!parsed.success || !uniquePaths(parsed.data.paths)) throw new BadInput('invalid-input', 400);
    const snapshot = await readSnapshot(env.DB, uid, consentRevision, fenceEpoch, parsed.data.paths);
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
  const existing = await readReceipt(env.DB, uid, consentRevision, fenceEpoch, input.batchId);
  if (existing) {
    if (existing.request_hash !== hash) throw new BadInput('batch-id-conflict', 409);
    return reply({ batchId: input.batchId, revision: existing.committed_revision, lastSeq: existing.last_seq, replayed: true });
  }
  try {
    const result = await commitEncryptedBatch(env.DB, uid, fenceEpoch, input, hash);
    return reply({ ...result, replayed: false });
  } catch (error) {
    // Lost response is not evidence of no commit. Check the persisted receipt.
    const receipt = await readReceipt(env.DB, uid, consentRevision, fenceEpoch, input.batchId);
    if (receipt) {
      if (receipt.request_hash !== hash) throw new BadInput('batch-id-conflict', 409);
      return reply({ batchId: input.batchId, revision: receipt.committed_revision, lastSeq: receipt.last_seq, replayed: true });
    }
    const state = await readAccessState(env.DB, uid);
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
    try { return await handler(request, env); }
    catch (error) {
      if (error instanceof BadInput) return reply({ error: error.message }, error.status);
      // No exception message, health plaintext, SQL statement or identity in API response.
      return reply({ error: 'cloud-unavailable' }, 503);
    }
  },
};
