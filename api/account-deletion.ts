import { RequestAuthError, verifyDeletionRequester, verifyStatusAppCheck } from '../server/accountDeletion/httpAuth';
import {
  createOrRefreshDeletionJob,
  readAuthorizedDeletionJob,
  readDeletionStatus,
  validateReceipt,
  validateUid,
} from '../server/accountDeletion/jobStore';
import { processAccountDeletion, progressAndReadStatus } from '../server/accountDeletion/runner';

export const maxDuration = 300;

const POST_BUDGET_MS = 275_000;
const GET_PROGRESS_BUDGET_MS = 20_000;

function errorResponse(error: unknown): Response {
  if (error instanceof RequestAuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : 'Richiesta di cancellazione non valida.';
  return Response.json({ error: message }, { status: 400 });
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
  try {
    const { uid } = await verifyDeletionRequester(request);
    const body = await requestBody(request);
    const receiptToken = validateReceipt(body.receiptToken);

    await createOrRefreshDeletionJob(uid, receiptToken);
    await processAccountDeletion(uid, Date.now() + POST_BUDGET_MS);
    const status = await readDeletionStatus(uid, receiptToken);
    if (!status) return Response.json({ error: 'Job di cancellazione non disponibile.' }, { status: 500 });
    return Response.json(status, { status: status.status === 'complete' ? 200 : 202 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    await verifyStatusAppCheck(request);
    const uid = validateUid(request.headers.get('x-account-deletion-uid'));
    const receiptToken = validateReceipt(request.headers.get('x-account-deletion-receipt'));

    const authorized = await readAuthorizedDeletionJob(uid, receiptToken);
    if (!authorized) return Response.json({ error: 'Cancellazione non trovata.' }, { status: 404 });

    const status = await progressAndReadStatus(uid, receiptToken, Date.now() + GET_PROGRESS_BUDGET_MS);
    if (!status) return Response.json({ error: 'Cancellazione non trovata.' }, { status: 404 });
    return Response.json(status, { status: 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
