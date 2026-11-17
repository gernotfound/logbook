import { verifyRecoveryRegistrationRequester, RequestAuthError } from '../server/accountDeletion/httpAuth.js';
import { accountDeletionCorsHeaders, requireAccountDeletionOrigin } from '../server/accountDeletion/cors.js';
import { AccountDeletionAlreadyScheduledError, recordAccountActivity } from '../server/accountInactivity.js';

const ALLOWED_HEADERS = 'authorization, x-firebase-appcheck';
const cors = (origin: string | null) => accountDeletionCorsHeaders(origin, ALLOWED_HEADERS);

export async function OPTIONS(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  try {
    requireAccountDeletionOrigin(request);
    return new Response(null, { status: 204, headers: cors(origin) });
  } catch (error) {
    const status = error instanceof RequestAuthError ? error.status : 500;
    return Response.json({ error: 'Origin non autorizzata.' }, { status, headers: cors(origin) });
  }
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  try {
    requireAccountDeletionOrigin(request);
    // Both feature switches default off. Never collect activity metadata until
    // the privacy policy and the account deletion flow have been approved.
    if (process.env.ACCOUNT_INACTIVITY_TRACKING_ENABLED !== 'true') {
      return Response.json({ error: 'Registrazione attività non disponibile.' }, { status: 503, headers: cors(origin) });
    }
    // Token UID and consumable App Check are independently verified on the server.
    // No timestamp, UID, body or business data is accepted from the client.
    const { uid } = await verifyRecoveryRegistrationRequester(request);
    await recordAccountActivity(uid);
    return new Response(null, { status: 204, headers: { ...cors(origin), 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof RequestAuthError) {
      return Response.json({ error: error.message }, { status: error.status, headers: cors(origin) });
    }
    if (error instanceof AccountDeletionAlreadyScheduledError) {
      return Response.json({ error: 'Account in cancellazione.' }, { status: 409, headers: cors(origin) });
    }
    console.error('[account-activity] record failed', {
      kind: error instanceof Error ? error.name : typeof error,
    });
    return Response.json({ error: 'Impossibile registrare l’attività. Riprova online.' }, { status: 503, headers: cors(origin) });
  }
}
