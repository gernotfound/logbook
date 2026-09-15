import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminAppCheck, adminAuth } from './firebaseAdmin';

const MAX_AUTH_AGE_SECONDS = 5 * 60;
const MAX_CLOCK_SKEW_SECONDS = 60;

export class RequestAuthError extends Error {
  constructor(message: string, public readonly status: 401 | 403 = 401) {
    super(message);
    this.name = 'RequestAuthError';
  }
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get('authorization') ?? '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new RequestAuthError('Token di autenticazione mancante.');
  return match[1];
}

function appCheckToken(request: Request): string {
  const token = request.headers.get('x-firebase-appcheck');
  if (!token) throw new RequestAuthError('Verifica App Check mancante.', 403);
  return token;
}

export async function verifyDeletionRequester(request: Request): Promise<{ uid: string }> {
  const idToken = bearerToken(request);
  const appToken = appCheckToken(request);

  let decoded: DecodedIdToken;
  try {
    decoded = await adminAuth().verifyIdToken(idToken, true);
  } catch {
    throw new RequestAuthError('Sessione non valida o revocata. Effettua nuovamente il login.');
  }

  try {
    await adminAppCheck().verifyToken(appToken);
  } catch {
    throw new RequestAuthError('Verifica App Check non valida.', 403);
  }

  const now = Math.floor(Date.now() / 1000);
  const authenticatedAt = Number(decoded.auth_time);
  if (!Number.isFinite(authenticatedAt)
    || authenticatedAt > now + MAX_CLOCK_SKEW_SECONDS
    || now - authenticatedAt > MAX_AUTH_AGE_SECONDS) {
    throw new RequestAuthError('Autenticazione troppo vecchia. Effettua nuovamente il login.');
  }

  return { uid: decoded.uid };
}

export async function verifyStatusAppCheck(request: Request): Promise<void> {
  try {
    await adminAppCheck().verifyToken(appCheckToken(request));
  } catch (error) {
    if (error instanceof RequestAuthError) throw error;
    throw new RequestAuthError('Verifica App Check non valida.', 403);
  }
}
