import { RequestAuthError, verifyRecoveryRegistrationRequester } from '../server/accountDeletion/httpAuth.js';
import { accountDeletionCorsHeaders, requireAccountDeletionOrigin } from '../server/accountDeletion/cors.js';
import { readWithdrawnHealthExportPage, type HealthExportCollection } from '../server/healthConsent/export.js';

export const maxDuration = 30;
const HEADERS = 'authorization, x-firebase-appcheck';
const CORS = (origin: string | null) => ({ ...accountDeletionCorsHeaders(origin, HEADERS), 'cache-control': 'no-store' });

export async function OPTIONS(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  try {
    requireAccountDeletionOrigin(request);
    return new Response(null, { status: 204, headers: CORS(origin) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Richiesta non autorizzata.' }, { status: error instanceof RequestAuthError ? error.status : 503, headers: CORS(origin) });
  }
}

export async function GET(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  try {
    requireAccountDeletionOrigin(request);
    const { uid } = await verifyRecoveryRegistrationRequester(request);
    const params = new URL(request.url).searchParams;
    const name = params.get('collection');
    const after = params.get('after');
    if ((name !== 'root' && name !== 'history_months' && name !== 'nutrition_months')
      || (after !== null && (name === 'root' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(after)))) {
      return Response.json({ error: 'Parametri esportazione non validi.' }, { status: 400, headers: CORS(origin) });
    }
    const page = await readWithdrawnHealthExportPage(uid, name as HealthExportCollection, after);
    return Response.json(page, { status: 200, headers: CORS(origin) });
  } catch (error) {
    if (error instanceof RequestAuthError) return Response.json({ error: error.message }, { status: error.status, headers: CORS(origin) });
    console.error('[health-consent-export] restricted export failed', { kind: error instanceof Error ? error.name : 'unknown' });
    return Response.json({ error: 'Esportazione completa temporaneamente non disponibile.' }, { status: 503, headers: CORS(origin) });
  }
}
