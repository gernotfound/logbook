import { RequestAuthError, verifyRecoveryRegistrationRequester } from '../server/accountDeletion/httpAuth.js';
import { accountDeletionCorsHeaders, requireAccountDeletionOrigin } from '../server/accountDeletion/cors.js';
import { readWithdrawnHealthExportPage, type HealthExportCollection } from '../server/healthConsent/export.js';

export const maxDuration = 30;
const HEADERS = 'authorization, x-firebase-appcheck';
const CORS = (origin: string | null) => ({ ...accountDeletionCorsHeaders(origin, HEADERS), 'cache-control': 'no-store' });
const UNAVAILABLE = 'Esportazione completa temporaneamente non disponibile.';

export async function OPTIONS(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  try {
    requireAccountDeletionOrigin(request);
    return new Response(null, { status: 204, headers: CORS(origin) });
  } catch (error) {
    return Response.json({ error: error instanceof RequestAuthError ? error.message : UNAVAILABLE }, { status: error instanceof RequestAuthError ? error.status : 503, headers: CORS(origin) });
  }
}

export async function GET(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  try {
    requireAccountDeletionOrigin(request);
    // Deliberate rights/recovery exception: a non-revoked identity may export
    // only its own data after confirmed withdrawal, even if email verification
    // cannot currently be renewed. Never accept a client-selected UID.
    const params = new URL(request.url).searchParams;
    const collections = params.getAll('collection');
    const cursors = params.getAll('after');
    const name = collections[0];
    const after = cursors[0] ?? null;
    // Only one unambiguous section/cursor may select privileged health data.
    // Validate before consuming a limited-use App Check token or reading Firestore.
    if ([...params.keys()].some(key => key !== 'collection' && key !== 'after')
      || collections.length !== 1 || cursors.length > 1
      || (name !== 'root' && name !== 'history_months' && name !== 'nutrition_months' && name !== 'checkpoint')
      || (after !== null && (name === 'root' || name === 'checkpoint' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(after)))) {
      return Response.json({ error: 'Parametri esportazione non validi.' }, { status: 400, headers: CORS(origin) });
    }
    const { uid } = await verifyRecoveryRegistrationRequester(request);
    const page = await readWithdrawnHealthExportPage(uid, name as HealthExportCollection, after);
    return Response.json(page, { status: 200, headers: CORS(origin) });
  } catch (error) {
    if (error instanceof RequestAuthError) return Response.json({ error: error.message }, { status: error.status, headers: CORS(origin) });
    console.error('[health-consent-export] restricted export failed', { kind: error instanceof Error ? error.name : 'unknown' });
    return Response.json({ error: UNAVAILABLE }, { status: 503, headers: CORS(origin) });
  }
}
