import { RequestAuthError, verifyAuthenticatedRequester, verifyDeletionRequester, verifyStatusAppCheck } from './httpAuth.js';
import {
  createOrRefreshDeletionJob,
  readAuthorizedDeletionJob,
  readDeletionStatus,
  readDeletionStatusWithRecoveryCredential,
  registerDeletionRecoveryCredential,
  validateReceipt,
  validateRecoveryCredential,
  validateUid,
} from './jobStore.js';
import { processAccountDeletion, progressAndReadStatus } from './runner.js';

export const ACCOUNT_DELETION_POST_BUDGET_MS = 275_000;
export const ACCOUNT_DELETION_GET_PROGRESS_BUDGET_MS = 20_000;

class RequestInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestInputError';
  }
}
function validatedInput<T>(read: () => T): T {
  try { return read(); }
  catch (error) {
    throw new RequestInputError(error instanceof Error ? error.message : 'Richiesta di cancellazione non valida.');
  }
}
function errorResponse(error: unknown): Response {
  if (error instanceof RequestAuthError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof RequestInputError) return Response.json({ error: error.message }, { status: 400 });
  const kind = error instanceof Error ? error.name : 'UnknownError';
  console.error('[account-deletion] backend failure', { kind });
  return Response.json(
    { error: 'Servizio di cancellazione temporaneamente non disponibile. La copia locale è stata conservata.' },
    { status: 500 },
  );
}
async function requestBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function handleAccountDeletionPut(request: Request): Promise<Response> {
  try {
    const { uid } = await verifyAuthenticatedRequester(request);
    const body = await requestBody(request);
    const recoveryCredential = validatedInput(() => validateRecoveryCredential(body.recoveryCredential));
    await registerDeletionRecoveryCredential(uid, recoveryCredential);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleAccountDeletionPost(request: Request): Promise<Response> {
  try {
    const { uid } = await verifyDeletionRequester(request);
    const body = await requestBody(request);
    const receiptToken = validatedInput(() => validateReceipt(body.receiptToken));
    await createOrRefreshDeletionJob(uid, receiptToken);
    await processAccountDeletion(uid, Date.now() + ACCOUNT_DELETION_POST_BUDGET_MS);
    const status = await readDeletionStatus(uid, receiptToken);
    if (!status) return Response.json({ error: 'Job di cancellazione non disponibile.' }, { status: 500 });
    return Response.json(status, { status: status.status === 'complete' ? 200 : 202 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleAccountDeletionGet(request: Request): Promise<Response> {
  try {
    await verifyStatusAppCheck(request);
    const uid = validatedInput(() => validateUid(request.headers.get('x-account-deletion-uid')));
    const receiptHeader = request.headers.get('x-account-deletion-receipt');
    const recoveryHeader = request.headers.get('x-account-deletion-recovery');
    if (Boolean(receiptHeader) === Boolean(recoveryHeader)) {
      throw new RequestInputError('Fornire una sola credenziale di recovery.');
    }

    if (recoveryHeader) {
      const recoveryCredential = validatedInput(() => validateRecoveryCredential(recoveryHeader));
      const status = await readDeletionStatusWithRecoveryCredential(uid, recoveryCredential);
      if (!status) return Response.json({ error: 'Cancellazione non trovata.' }, { status: 404 });
      return Response.json(status, { status: 200 });
    }

    const receiptToken = validatedInput(() => validateReceipt(receiptHeader));
    const authorized = await readAuthorizedDeletionJob(uid, receiptToken);
    if (!authorized) return Response.json({ error: 'Cancellazione non trovata.' }, { status: 404 });
    const status = await progressAndReadStatus(uid, receiptToken, Date.now() + ACCOUNT_DELETION_GET_PROGRESS_BUDGET_MS);
    if (!status) return Response.json({ error: 'Cancellazione non trovata.' }, { status: 404 });
    return Response.json(status, { status: 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
