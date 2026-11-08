import { RequestAuthError, requireVerifiedHealthConsentWrite, verifyHealthConsentRequester } from '../server/accountDeletion/httpAuth.js';
import { accountDeletionCorsHeaders, requireAccountDeletionOrigin } from '../server/accountDeletion/cors.js';
import {
  readHealthConsentState,
  recordHealthConsentWithdrawal,
  recordHealthConsentReacceptance,
  recordInitialHealthConsentAcceptance,
  validateExplicitAcceptance,
  HealthConsentRevisionConflictError,
  type ExplicitConsentAcceptance,
} from '../server/healthConsent/withdrawal.js';
import { HealthDataErasureConflict, processHealthDataErasure } from '../server/healthConsent/erasure.js';

export const maxDuration = 30;
const HEADERS = 'authorization, content-type, x-firebase-appcheck';

function json(body: unknown, status: number, origin: string | null): Response {
  return Response.json(body, { status, headers: { ...accountDeletionCorsHeaders(origin, HEADERS), 'cache-control': 'no-store' } });
}

function errorResponse(error: unknown, origin: string | null): Response {
  if (error instanceof RequestAuthError) return json({ error: error.message }, error.status, origin);
  if (error instanceof HealthConsentRevisionConflictError || error instanceof HealthDataErasureConflict) {
    return json({ error: error.message }, 409, origin);
  }
  if (error instanceof ConsentInputError) return json({ error: error.message }, error.status, origin);
  console.error('[health-consent] trusted endpoint failure', { kind: error instanceof Error ? error.name : 'unknown' });
  return json({ error: 'Stato del consenso non disponibile. Accesso ai dati fitness sospeso.' }, 503, origin);
}

class ConsentInputError extends Error {
  constructor(message: string, readonly status: 400 | 408 | 413 = 400) { super(message); }
}

const MAX_CONSENT_BODY_BYTES = 8 * 1024;
const CONSENT_BODY_TIMEOUT_MS = 2_000;

// A consent POST is a small JSON instruction, not a bulk upload. Bound both
// memory and elapsed time: an unfinished stream must never block revocation
// indefinitely or consume the one-shot App Check token before validation.
async function readConsentBody(request: Request): Promise<Record<string, unknown>> {
  const length = request.headers.get('content-length');
  if (length !== null && !/^\d+$/.test(length)) throw new ConsentInputError('Lunghezza richiesta non valida.');
  if (length !== null && Number(length) > MAX_CONSENT_BODY_BYTES) {
    throw new ConsentInputError('Richiesta di consenso troppo grande.', 413);
  }
  if (!request.body) throw new ConsentInputError('Richiesta di consenso non valida.');

  const reader = request.body.getReader();
  const buffer = new Uint8Array(MAX_CONSENT_BODY_BYTES);
  let bytesRead = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>(resolve => {
    timeout = setTimeout(() => resolve(null), CONSENT_BODY_TIMEOUT_MS);
  });
  try {
    let emptyReads = 0;
    while (true) {
      const result = await Promise.race([reader.read(), deadline]);
      if (result === null) throw new ConsentInputError('Lettura della richiesta scaduta. Riprova.', 408);
      if (result.done) break;
      if (result.value.byteLength === 0) {
        // Prevent a stream of synchronous zero-length chunks from starving the deadline.
        if (++emptyReads >= 16) throw new ConsentInputError('Lettura della richiesta scaduta. Riprova.', 408);
        continue;
      }
      if (result.value.byteLength > MAX_CONSENT_BODY_BYTES - bytesRead) {
        throw new ConsentInputError('Richiesta di consenso troppo grande.', 413);
      }
      buffer.set(result.value, bytesRead);
      bytesRead += result.value.byteLength;
    }
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new ConsentInputError('Richiesta di consenso non valida.');
  }
}

function requireExplicitAcceptance(value: unknown, message: string): asserts value is ExplicitConsentAcceptance {
  try { validateExplicitAcceptance(value); }
  catch { throw new ConsentInputError(message); }
}

function requireRevision(value: unknown, minimum: number, message: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new ConsentInputError(message);
  }
  return value;
}

export async function OPTIONS(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  try {
    requireAccountDeletionOrigin(request);
    return new Response(null, { status: 204, headers: accountDeletionCorsHeaders(origin, HEADERS) });
  } catch (error) { return errorResponse(error, origin); }
}

export async function GET(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  try {
    requireAccountDeletionOrigin(request);
    const { uid } = await verifyHealthConsentRequester(request);
    return json(await readHealthConsentState(uid), 200, origin);
  } catch (error) { return errorResponse(error, origin); }
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  try {
    requireAccountDeletionOrigin(request);
    const body = await readConsentBody(request);
    const identity = await verifyHealthConsentRequester(request);
    const { uid } = identity;

    if (body.action === 'accept-initial') {
      requireVerifiedHealthConsentWrite(identity);
      requireExplicitAcceptance(body.acceptance, 'È richiesta la prima accettazione esplicita dei documenti correnti.');
      if (body.expectedRevision !== 0) throw new ConsentInputError('Revisione iniziale non valida.');
      return json(await recordInitialHealthConsentAcceptance(uid, body.acceptance), 200, origin);
    }
    if (body.action === 'withdraw') {
      const expectedRevision = requireRevision(body.expectedRevision, 0, 'Revisione consenso mancante o non valida.');
      const state = await recordHealthConsentWithdrawal(uid, expectedRevision);
      // The erasure job was durably enqueued in the same Firestore transaction.
      // Best-effort immediate progress must not turn a confirmed withdrawal into
      // an HTTP failure: the existing cron recovers unfinished work.
      try { await processHealthDataErasure(uid, Date.now() + 5_000); }
      catch (error) {
        console.error('[health-consent] erasure handoff failed', { kind: error instanceof Error ? error.name : 'unknown' });
      }
      return json(state, 200, origin);
    }
    if (body.action === 'reaccept') {
      requireVerifiedHealthConsentWrite(identity);
      requireExplicitAcceptance(body.acceptance, 'È richiesta una nuova accettazione esplicita dei documenti correnti.');
      const expectedRevision = requireRevision(body.expectedRevision, 1, 'Revisione della revoca mancante o non valida.');
      return json(await recordHealthConsentReacceptance(uid, body.acceptance, expectedRevision), 200, origin);
    }
    throw new ConsentInputError('Azione non valida.');
  } catch (error) { return errorResponse(error, origin); }
}
