import { RequestAuthError, verifyDeletionRequester, verifyStatusAppCheck } from '../server/accountDeletion/httpAuth.js';
import {
  createOrRefreshDeletionJob,
  readAuthorizedDeletionJob,
  readDeletionStatus,
  validateReceipt,
  validateUid,
} from '../server/accountDeletion/jobStore.js';
import { processAccountDeletion, progressAndReadStatus } from '../server/accountDeletion/runner.js';

export const maxDuration = 300;

const POST_BUDGET_MS = 275_000;
const GET_PROGRESS_BUDGET_MS = 20_000;
const ALLOWED_ORIGIN = process.env.PUBLIC_APP_ORIGIN || 'https://thelogbook.web.app';

function corsHeaders(origin: string | null): HeadersInit {
  return origin === ALLOWED_ORIGIN ? {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, x-firebase-appcheck, x-account-deletion-uid, x-account-deletion-receipt',
    'access-control-max-age': '600',
    'vary': 'Origin',
  } : { 'vary': 'Origin' };
}

function json(body: unknown, init: ResponseInit = {}, origin: string | null = null): Response {
  return Response.json(body, { ...init, headers: { ...corsHeaders(origin), ...(init.headers || {}) } });
}

function requireAllowedOrigin(request: Request): string {
  const origin = request.headers.get('origin');
  if (origin !== ALLOWED_ORIGIN) throw new RequestAuthError('Origin non autorizzata.', 403);
  return origin;
}

export async function OPTIONS(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  if (origin !== ALLOWED_ORIGIN) return json({ error: 'Origin non autorizzata.' }, { status: 403 }, origin);
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

class RequestInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestInputError';
  }
}

function validatedInput<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    throw new RequestInputError(error instanceof Error ? error.message : 'Richiesta di cancellazione non valida.');
  }
}

function errorResponse(error: unknown, origin: string | null = null): Response {
  if (error instanceof RequestAuthError) {
    return json({ error: error.message }, { status: error.status }, origin);
  }
  if (error instanceof RequestInputError) {
    return json({ error: error.message }, { status: 400 }, origin);
  }
  const kind = error instanceof Error ? error.name : 'UnknownError';
  console.error('[account-deletion] backend failure', { kind });
  return json({ error: 'Servizio di cancellazione temporaneamente non disponibile. La copia locale è stata conservata.' }, { status: 500 }, origin);
}

async function requestBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  try {
    requireAllowedOrigin(request);
    const { uid } = await verifyDeletionRequester(request);
    const body = await requestBody(request);
    const receiptToken = validatedInput(() => validateReceipt(body.receiptToken));

    await createOrRefreshDeletionJob(uid, receiptToken);
    await processAccountDeletion(uid, Date.now() + POST_BUDGET_MS);
    const status = await readDeletionStatus(uid, receiptToken);
    if (!status) return json({ error: 'Job di cancellazione non disponibile.' }, { status: 500 }, origin);
    return json(status, { status: status.status === 'complete' ? 200 : 202 }, origin);
  } catch (error) {
    return errorResponse(error, origin);
  }
}

export async function GET(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  try {
    requireAllowedOrigin(request);
    await verifyStatusAppCheck(request);
    const uid = validatedInput(() => validateUid(request.headers.get('x-account-deletion-uid')));
    const receiptToken = validatedInput(() => validateReceipt(request.headers.get('x-account-deletion-receipt')));

    const authorized = await readAuthorizedDeletionJob(uid, receiptToken);
    if (!authorized) return json({ error: 'Cancellazione non trovata.' }, { status: 404 }, origin);

    const status = await progressAndReadStatus(uid, receiptToken, Date.now() + GET_PROGRESS_BUDGET_MS);
    if (!status) return json({ error: 'Cancellazione non trovata.' }, { status: 404 }, origin);
    return json(status, { status: 200 }, origin);
  } catch (error) {
    return errorResponse(error, origin);
  }
}
