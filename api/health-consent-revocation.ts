import { RequestAuthError, verifyHealthConsentRevocationRequester } from '../server/accountDeletion/httpAuth.js';
import { accountDeletionCorsHeaders, requireAccountDeletionOrigin } from '../server/accountDeletion/cors.js';
import { recordHealthConsentRevocation, RevocationAccountDeletingError } from '../server/healthConsent/revocation.js';
import { processHealthErasure } from '../server/healthConsent/erasure.js';

export const maxDuration = 30;
const ALLOWED_HEADERS = 'authorization, x-firebase-appcheck';

function respond(body: unknown, status: number, origin: string | null): Response {
  return Response.json(body, {
    status,
    headers: accountDeletionCorsHeaders(origin, ALLOWED_HEADERS),
  });
}

function failure(error: unknown, origin: string | null): Response {
  if (error instanceof RequestAuthError) return respond({ error: error.message }, error.status, origin);
  if (error instanceof RevocationAccountDeletingError) return respond({ error: error.message }, 409, origin);
  console.error('[health-consent-revocation] backend failure', {
    kind: error instanceof Error ? error.name : 'UnknownError',
  });
  return respond({ error: 'Impossibile registrare la revoca sul server. Riprova.' }, 500, origin);
}

export async function OPTIONS(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  try {
    requireAccountDeletionOrigin(request);
    return new Response(null, {
      status: 204,
      headers: accountDeletionCorsHeaders(origin, ALLOWED_HEADERS),
    });
  } catch (error) {
    return failure(error, origin);
  }
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  try {
    requireAccountDeletionOrigin(request);
    const { uid } = await verifyHealthConsentRevocationRequester(request);
    await recordHealthConsentRevocation(uid);
    // Revocation is durable immediately. Erasure is separately idempotent and
    // resumable via the daily cron; never claim erasure complete on a timeout.
    let erasure: 'pending' | 'complete' = 'pending';
    try {
      const outcome = await processHealthErasure(uid, Date.now() + 4_000);
      if (outcome === 'complete') erasure = 'complete';
    } catch (error) {
      console.error('[health-consent-revocation] erasure scheduled for retry', {
        kind: error instanceof Error ? error.name : 'UnknownError',
      });
    }
    return respond({ revoked: true, erasure }, 200, origin);
  } catch (error) {
    return failure(error, origin);
  }
}
