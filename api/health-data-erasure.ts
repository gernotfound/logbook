import { RequestAuthError, verifyDeletionRequester, verifyRecoveryRegistrationRequester } from '../server/accountDeletion/httpAuth.js';
import { accountDeletionCorsHeaders, requireAccountDeletionOrigin } from '../server/accountDeletion/cors.js';
import {
  createHealthDataErasureJob, processHealthDataErasure, readHealthDataErasureStatus,
  HealthDataErasureConflict,
} from '../server/healthConsent/erasure.js';

export const maxDuration = 300;
const HEADERS = 'authorization, content-type, x-firebase-appcheck';
const cors = (origin: string | null) => ({
  ...accountDeletionCorsHeaders(origin, HEADERS), 'cache-control': 'no-store',
});

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
    // Recent Firebase Auth and consumed limited-use App Check required.
    // The UID always comes from the verified ID token.
    const { uid } = await verifyDeletionRequester(request);
    await createHealthDataErasureJob(uid);
    await processHealthDataErasure(uid, Date.now() + 5_000);
    const result = await readHealthDataErasureStatus(uid);
    if (!result) throw new Error('Job non reperibile dopo creazione.');
    return Response.json(result, { status: result.complete ? 200 : 202, headers: cors(origin) });
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
    return Response.json(result, { status: result?.complete ? 200 : 202, headers: cors(origin) });
  } catch (error) { return errorResponse(error, origin); }
}
