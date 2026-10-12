import { RequestAuthError, verifyRecoveryRegistrationRequester } from '../server/accountDeletion/httpAuth.js';
import { accountDeletionCorsHeaders, requireAccountDeletionOrigin } from '../server/accountDeletion/cors.js';
import {
  readHealthConsentState,
  recordHealthConsentWithdrawal,
  recordHealthConsentReacceptance,
  validateExplicitAcceptance,
  HealthConsentRevisionConflictError,
} from '../server/healthConsent/withdrawal.js';

export const maxDuration = 30;
const HEADERS = 'authorization, content-type, x-firebase-appcheck';

function json(body: unknown, status: number, origin: string | null): Response {
  return Response.json(body, { status, headers: { ...accountDeletionCorsHeaders(origin, HEADERS), 'cache-control': 'no-store' } });
}

function errorResponse(error: unknown, origin: string | null): Response {
  if (error instanceof RequestAuthError) return json({ error: error.message }, error.status, origin);
  if (error instanceof HealthConsentRevisionConflictError) return json({ error: error.message }, 409, origin);
  if (error instanceof ConsentInputError) return json({ error: error.message }, 400, origin);
  console.error('[health-consent] trusted endpoint failure', { kind: error instanceof Error ? error.name : 'unknown' });
  return json({ error: 'Stato del consenso non disponibile. Accesso ai dati fitness sospeso.' }, 503, origin);
}

class ConsentInputError extends Error {}

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
    const { uid } = await verifyRecoveryRegistrationRequester(request);
    return json(await readHealthConsentState(uid), 200, origin);
  } catch (error) { return errorResponse(error, origin); }
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  try {
    requireAccountDeletionOrigin(request);
    const { uid } = await verifyRecoveryRegistrationRequester(request);
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      body = parsed as Record<string, unknown>;
    } catch { throw new ConsentInputError('Richiesta di consenso non valida.'); }

    if (body.action === 'withdraw') {
      if (typeof body.expectedRevision !== 'number' || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) {
        throw new ConsentInputError('Revisione consenso mancante o non valida.');
      }
      return json(await recordHealthConsentWithdrawal(uid, body.expectedRevision), 200, origin);
    }
    if (body.action === 'reaccept') {
      try { validateExplicitAcceptance(body.acceptance); }
      catch { throw new ConsentInputError('È richiesta una nuova accettazione esplicita dei documenti correnti.'); }
      if (typeof body.expectedRevision !== 'number' || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1) {
        throw new ConsentInputError('Revisione della revoca mancante o non valida.');
      }
      return json(await recordHealthConsentReacceptance(uid, body.acceptance, body.expectedRevision), 200, origin);
    }
    throw new ConsentInputError('Azione non valida.');
  } catch (error) { return errorResponse(error, origin); }
}
