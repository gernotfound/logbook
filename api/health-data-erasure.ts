import { RequestAuthError, verifyDeletionRequester, verifyRecoveryRegistrationRequester } from '../server/accountDeletion/httpAuth.js';
import { accountDeletionCorsHeaders, requireAccountDeletionOrigin } from '../server/accountDeletion/cors.js';
import {
  createHealthDataErasureJob, processHealthDataErasure, readHealthDataErasureStatus,
  HealthDataErasureConflict,
} from '../server/healthConsent/erasure.js';

export const maxDuration = 300;
const HEADERS = 'authorization, content-type, x-firebase-appcheck';

// This destructive endpoint accepts no client payload or operation selector.
// Empty request streams are valid, but incomplete streams cannot enqueue work.
async function inspectEmptyPostBody(request: Request): Promise<'empty' | 'payload' | 'incomplete'> {
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 0)) return 'payload';
  if (!request.body) return 'empty';

  const reader = request.body.getReader();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>(resolve => {
    timeout = setTimeout(() => resolve(null), 2_000);
  });
  try {
    for (let emptyChunks = 0; emptyChunks < 16; emptyChunks++) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part === null) return 'incomplete';
      if (part.done) return 'empty';
      if (part.value.byteLength > 0) return 'payload';
    }
    return 'incomplete';
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
const cors = (origin: string | null) => ({
  ...accountDeletionCorsHeaders(origin, HEADERS), 'cache-control': 'no-store',
});

function verifiedErasureResponse(
  status: NonNullable<Awaited<ReturnType<typeof readHealthDataErasureStatus>>>,
  origin: string | null,
): Response {
  // Every success response must distinguish a durable 'complete' job from
  // the live consent/key evidence authorizing local irreversible cleanup.
  if (status.complete && !status.localPurgeAuthorized) {
    throw new HealthDataErasureConflict('Completamento non attestato per il consenso corrente.');
  }
  return Response.json(status, { status: status.complete ? 200 : 202, headers: cors(origin) });
}

function errorResponse(error: unknown, origin: string | null): Response {
  if (error instanceof RequestAuthError) {
    return Response.json({ error: error.message }, { status: error.status, headers: cors(origin) });
  }
  if (error instanceof HealthDataErasureConflict) {
    return Response.json({ error: error.message }, { status: 409, headers: cors(origin) });
  }
  console.error('[health-data-erasure] operation failed', { kind: error instanceof Error ? error.name : typeof error });
  return Response.json({ error: 'Servizio cancellazione temporaneamente non disponibile. Nessuna cancellazione completa confermata.' },
    { status: 503, headers: cors(origin) });
}

export async function OPTIONS(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  try {
    requireAccountDeletionOrigin(request);
    return new Response(null, { status: 204, headers: cors(origin) });
  } catch (error) { return errorResponse(error, origin); }
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  try {
    requireAccountDeletionOrigin(request);
    if (new URL(request.url).search !== '') {
      return Response.json({ error: 'Parametri cancellazione non previsti.' }, { status: 400, headers: cors(origin) });
    }
    const body = await inspectEmptyPostBody(request);
    if (body === 'payload') {
      return Response.json({ error: 'La cancellazione non accetta dati da inviare.' }, { status: 400, headers: cors(origin) });
    }
    if (body === 'incomplete') {
      return Response.json({ error: 'Lettura della richiesta scaduta. Riprova.' }, { status: 408, headers: cors(origin) });
    }
    // Recent Firebase Auth and consumed limited-use App Check required.
    // The UID always comes from the verified ID token.
    const { uid } = await verifyDeletionRequester(request);
    await createHealthDataErasureJob(uid);
    await processHealthDataErasure(uid, Date.now() + 5_000);
    const result = await readHealthDataErasureStatus(uid);
    if (!result) throw new Error('Job non reperibile dopo creazione.');
    return verifiedErasureResponse(result, origin);
  } catch (error) { return errorResponse(error, origin); }
}

export async function GET(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  try {
    requireAccountDeletionOrigin(request);
    // Status/recovery does not require recent auth, but always authenticates
    // the owner and consumes a fresh App Check token.
    const { uid } = await verifyRecoveryRegistrationRequester(request);
    const before = await readHealthDataErasureStatus(uid);
    if (!before) return Response.json({ status: 'not-requested', complete: false }, { headers: cors(origin) });
    if (!before.complete && before.retryable !== false) {
      await processHealthDataErasure(uid, Date.now() + 5_000);
    }
    const result = await readHealthDataErasureStatus(uid);
    // Account deletion and reacceptance may advance the server record while
    // this GET waits for its bounded worker; null is not a valid pending receipt.
    if (!result) {
      throw new HealthDataErasureConflict('Stato cancellazione cambiato o completamento non attestato.');
    }
    return verifiedErasureResponse(result, origin);
  } catch (error) { return errorResponse(error, origin); }
}
