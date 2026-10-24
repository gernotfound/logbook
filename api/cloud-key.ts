import {
  RequestAuthError, requireVerifiedHealthConsentWrite, verifyHealthConsentRequester,
} from '../server/accountDeletion/httpAuth.js';
import {
  accountDeletionCorsHeaders, requireAccountDeletionOrigin,
} from '../server/accountDeletion/cors.js';
import {
  CloudKeyProvisioningConflictError, releaseAccountDataKey,
} from '../server/cloudKeys/accountDataKey.js';

export const maxDuration = 30;
const HEADERS = 'authorization, content-type, x-firebase-appcheck';

function json(body: unknown, status: number, origin: string | null): Response {
  return Response.json(body, {
    status,
    headers: {
      ...accountDeletionCorsHeaders(origin, HEADERS),
      'cache-control': 'no-store, max-age=0',
      pragma: 'no-cache',
      'x-content-type-options': 'nosniff',
    },
  });
}

function errorResponse(error: unknown, origin: string | null): Response {
  if (error instanceof RequestAuthError) return json({ error: error.message }, error.status, origin);
  if (error instanceof CloudKeyProvisioningConflictError) return json({ error: error.message }, 409, origin);
  // Neither upstream IAM errors nor key material should reach logs, errors or
  // monitoring. Offline local work remains independent of this endpoint.
  console.error('[cloud-key] trusted key service unavailable', {
    kind: error instanceof Error ? error.name : 'unknown',
  });
  return json({ error: 'Chiave cloud temporaneamente non disponibile. I dati locali sono conservati.' }, 503, origin);
}

export async function OPTIONS(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  try {
    requireAccountDeletionOrigin(request);
    return new Response(null, {
      status: 204, headers: accountDeletionCorsHeaders(origin, HEADERS),
    });
  } catch (error) { return errorResponse(error, origin); }
}

/** No uid/key in URL or request body. Caller identity comes from verified Firebase Auth only. */
export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  try {
    requireAccountDeletionOrigin(request);
    if (request.headers.has('content-length') && Number(request.headers.get('content-length')) > 0) {
      return json({ error: 'Questa operazione non accetta dati da inviare.' }, 400, origin);
    }
    const identity = await verifyHealthConsentRequester(request);
    requireVerifiedHealthConsentWrite(identity);
    const key = await releaseAccountDataKey(identity.uid);
    try {
      return json({ format: 'thelogbook-account-data-key', version: 1, key: key.toString('base64') }, 200, origin);
    } finally {
      key.fill(0);
    }
  } catch (error) { return errorResponse(error, origin); }
}
