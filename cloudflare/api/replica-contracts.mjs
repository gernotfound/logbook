import { z } from 'zod';

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
  ['/v1/rights/scan', 256],
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
  emailVerified: z.boolean(),
  healthConsentRevision: safeInt.min(1),
  fenceEpoch: safeInt.min(1),
  csrfVerified: z.boolean(),
  rateGatePassed: z.literal(true),
  sessionHash: z.string().regex(/^[a-f0-9]{64}$/),
});

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

export { BODY_LIMIT_BYTES, BadInput, id, claimInput, retireInput, readInput, pageInput, commitInput, commitStatusInput, authClaims, uniquePaths, validateSealedBatch };
