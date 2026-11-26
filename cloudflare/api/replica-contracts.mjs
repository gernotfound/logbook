import { z } from 'zod';
import { MAX_CANDIDATE_DOCUMENT_BYTES, candidateApiRoutePolicy } from '../api-route-policy.mjs';

const MAX_DOCUMENT_BYTES = MAX_CANDIDATE_DOCUMENT_BYTES;
// Handler ownership is separate from route exposure and body budgets. The
// public manifest cannot silently route a specialized consent/key endpoint
// into the replica handler's catch-all commit branch.
const REPLICA_HANDLER_ROUTES = [
  '/v1/account/activity', '/v1/sync/control', '/v1/sync/read',
  '/v1/sync/scan', '/v1/rights/scan', '/v1/sync/receipt',
  '/v1/sync/replica/claim', '/v1/sync/replica/retire',
  '/v1/sync/replica/status', '/v1/sync/replica/cancel',
  '/v1/sync/commit', '/v1/sync/commit/status',
];
const BODY_LIMIT_BYTES = new Map(REPLICA_HANDLER_ROUTES.map(path => {
  const bytes = candidateApiRoutePolicy(path)?.maxBodyBytes;
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new TypeError('unbounded-replica-route');
  return [path, bytes];
}));
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
const retireInput = z.strictObject({ ...mutationBase, replica,
  confirmation: z.strictObject({ lastSeq: safeInt, checkpointAtMs: safeInt.min(1),
    leaseUntilMs: safeInt.min(1) }).optional(),
});
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
  emailVerified: z.boolean(),
  healthConsentRevision: safeInt.min(1),
  fenceEpoch: safeInt.min(1),
  csrfVerified: z.boolean(),
  rateGatePassed: z.literal(true),
  sessionHash: z.string().regex(/^[a-f0-9]{64}$/),
});

// Activity is identity-only; do not weaken the existing fitness claims schema.
const activityAuthClaims = authClaims.extend({ healthConsentRevision: safeInt });

class BadInput extends Error {
  constructor(code, status) { super(code); this.status = status; }
}
function uniquePaths(paths) { return paths.length === new Set(paths).size; }
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

export { BODY_LIMIT_BYTES, BadInput, id, claimInput, retireInput, readInput, pageInput, commitInput, commitStatusInput, authClaims, activityAuthClaims, uniquePaths, validateSealedBatch };
