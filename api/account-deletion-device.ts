import { RequestAuthError, verifyDeletionRequester, verifyStatusAppCheck } from '../server/accountDeletion/httpAuth.js';
import { readDeletionStatusForUid } from '../server/accountDeletion/jobStore.js';
import {
  DeletionRecoveryInputError,
  registerDeletionRecoveryDevice,
  verifyDeletionRecoveryDevice,
} from '../server/accountDeletion/deviceRecovery.js';
import { accountDeletionCorsHeaders, requireAccountDeletionOrigin } from '../server/accountDeletion/cors.js';

export const maxDuration = 30;
const ALLOWED_HEADERS = 'authorization, content-type, x-firebase-appcheck, x-account-deletion-uid, x-account-deletion-device';

function json(body: unknown, status: number, origin: string | null): Response {
  return Response.json(body, { status, headers: accountDeletionCorsHeaders(origin, ALLOWED_HEADERS) });
}

function errorResponse(error: unknown, origin: string | null): Response {
  if (error instanceof RequestAuthError) return json({ error: error.message }, error.status, origin);
  if (error instanceof DeletionRecoveryInputError) return json({ error: error.message }, 400, origin);
  const kind = error instanceof Error ? error.name : 'UnknownError';
  console.error('[account-deletion-device] backend failure', { kind });
  return json({ error: 'Servizio recovery temporaneamente non disponibile.' }, 500, origin);
}

export async function OPTIONS(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  try {
    requireAccountDeletionOrigin(request);
    return new Response(null, { status: 204, headers: accountDeletionCorsHeaders(origin, ALLOWED_HEADERS) });
  } catch (error) {
    return errorResponse(error, origin);
  }
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  try {
    requireAccountDeletionOrigin(request);
    const { uid } = await verifyDeletionRequester(request);
    const body = await request.json() as { deviceToken?: unknown };
    await registerDeletionRecoveryDevice(uid, body.deviceToken);
    return json({ registered: true }, 200, origin);
  } catch (error) {
    return errorResponse(error, origin);
  }
}

export async function GET(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  try {
    requireAccountDeletionOrigin(request);
    await verifyStatusAppCheck(request);
    const uid = request.headers.get('x-account-deletion-uid');
    const token = request.headers.get('x-account-deletion-device');
    if (!await verifyDeletionRecoveryDevice(uid, token)) {
      return json({ error: 'Recovery non autorizzato.' }, 404, origin);
    }
    const status = await readDeletionStatusForUid(uid);
    return status ? json(status, 200, origin) : json({ status: 'none' }, 200, origin);
  } catch (error) {
    return errorResponse(error, origin);
  }
}
