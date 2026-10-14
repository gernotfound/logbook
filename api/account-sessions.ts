import { RequestAuthError, verifyDeletionRequester } from '../server/accountDeletion/httpAuth.js';
import { requireAccountDeletionOrigin, accountDeletionCorsHeaders } from '../server/accountDeletion/cors.js';
import { revokeAllUserSessions } from '../server/accountDeletion/sessionRevocation.js';

export const maxDuration = 30;
const HEADERS = 'authorization, x-firebase-appcheck';

function json(body: unknown, status: number, origin: string | null): Response {
  return Response.json(body, {
    status,
    headers: { ...accountDeletionCorsHeaders(origin, HEADERS), 'cache-control': 'no-store' },
  });
}

export async function OPTIONS(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  try {
    requireAccountDeletionOrigin(request);
    return new Response(null, {
      status: 204,
      headers: { ...accountDeletionCorsHeaders(origin, HEADERS), 'cache-control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof RequestAuthError) return json({ error: error.message }, error.status, origin);
    return json({ error: 'Richiesta non valida.' }, 403, origin);
  }
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  try {
    requireAccountDeletionOrigin(request);
    // Same fresh-auth, revocation-checked ID token + consumable App Check
    // boundary used for destructive account operations.
    const { uid } = await verifyDeletionRequester(request);
    await revokeAllUserSessions(uid);
    return json({ status: 'revoked' }, 200, origin);
  } catch (error) {
    if (error instanceof RequestAuthError) return json({ error: error.message }, error.status, origin);
    console.error('[account-sessions] revocation not confirmed', { kind: error instanceof Error ? error.name : 'UnknownError' });
    return json({ error: 'Revoca non confermata. Potrebbe essere stata eseguita; rieffettua l’accesso per verificare.' }, 503, origin);
  }
}
