import { RequestAuthError, verifyDeletionRequester, verifyStatusAppCheck } from '../server/accountDeletion/httpAuth.js';
import {
  createOrRefreshDeletionJob,
  readAuthorizedDeletionJob,
  readDeletionStatus,
  validateReceipt,
  validateUid,
} from '../server/accountDeletion/jobStore.js';
import {
  ACCOUNT_DELETION_INTERACTIVE_BUDGET_MS,
  ACCOUNT_DELETION_INTERACTIVE_SAFETY_BUFFER_MS,
} from '../server/accountDeletion/budget.js';
import { processAccountDeletion, progressAndReadStatus } from '../server/accountDeletion/runner.js';
import { accountDeletionCorsHeaders, requireAccountDeletionOrigin } from '../server/accountDeletion/cors.js';

export const maxDuration = 300;

const INTERACTIVE_RUN_OPTIONS = {
  safetyBufferMs: ACCOUNT_DELETION_INTERACTIVE_SAFETY_BUFFER_MS,
} as const;
const ALLOWED_HEADERS = 'authorization, content-type, x-firebase-appcheck, x-account-deletion-uid, x-account-deletion-receipt';

function json(body: unknown, init: ResponseInit = {}, origin: string | null = null): Response {
  return Response.json(body, {
    ...init,
    headers: { ...accountDeletionCorsHeaders(origin, ALLOWED_HEADERS), ...(init.headers || {}) },
  });
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
    requireAccountDeletionOrigin(request);
    const { uid } = await verifyDeletionRequester(request);
    const body = await requestBody(request);
    const receiptToken = validatedInput(() => validateReceipt(body.receiptToken));

    await createOrRefreshDeletionJob(uid, receiptToken);
    await processAccountDeletion(
      uid,
      Date.now() + ACCOUNT_DELETION_INTERACTIVE_BUDGET_MS,
      INTERACTIVE_RUN_OPTIONS,
    );
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
    requireAccountDeletionOrigin(request);
    await verifyStatusAppCheck(request);
    const uid = validatedInput(() => validateUid(request.headers.get('x-account-deletion-uid')));
    const receiptToken = validatedInput(() => validateReceipt(request.headers.get('x-account-deletion-receipt')));

    const authorized = await readAuthorizedDeletionJob(uid, receiptToken);
    if (!authorized) return json({ error: 'Cancellazione non trovata.' }, { status: 404 }, origin);

    const status = await progressAndReadStatus(
      uid,
      receiptToken,
      Date.now() + ACCOUNT_DELETION_INTERACTIVE_BUDGET_MS,
      INTERACTIVE_RUN_OPTIONS,
    );
    if (!status) return json({ error: 'Cancellazione non trovata.' }, { status: 404 }, origin);
    return json(status, { status: 200 }, origin);
  } catch (error) {
    return errorResponse(error, origin);
  }
}
