import type { User } from 'firebase/auth';
import { trustedBackendUrl } from './backendApi';
import { auth, ensureAppCheck } from './firebase';
import { getLimitedUseAppCheckToken } from './appCheck';
import { captureSessionForOwner, userOwner } from './sync/session';

// Legacy Firebase transport only. Consent decisions and local authorization
// remain in healthConsent.ts; the Kinde/D1 candidate uses its own boundary.
export type ServerStatus = { status: 'unregistered' | 'active' | 'withdrawn'; revision: number; acceptedAt?: string; privacyVersion?: string; termsVersion?: string; erasedBeforeRevision?: number };
export class ConsentTransportUnavailableError extends Error {
  constructor() { super('Connessione al servizio consensi non disponibile.'); }
}
class ConsentRevisionConflictError extends Error {
  constructor() { super('Una decisione sul consenso più recente richiede un nuovo controllo.'); }
}
export function isRetryableConsentTransportError(error: unknown): boolean {
  if (error instanceof ConsentTransportUnavailableError) return true;
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; retryable?: unknown };
  // Firebase can fail to acquire the App Check or Auth token before fetch
  // starts. These transient outages are not proof of server withdrawal.
  if (candidate.code === 'auth/network-request-failed') return true;
  return candidate.retryable === true
    && (candidate.code === 'app-check-unavailable'
      || candidate.code === 'app-check-limited-use-unavailable');
}

export async function requestFirebaseHealthConsent(user: User, method: 'GET' | 'POST', body?: unknown): Promise<ServerStatus> {
  // Credential acquisition may outlive the Firebase account that initiated it.
  // An old token must not submit a consent transition after a new login.
  const startingUid = auth.currentUser?.uid ?? null;
  if (startingUid !== null && startingUid !== user.uid) throw new Error('Sessione cambiata.');
  const originalEpoch = captureSessionForOwner(userOwner(user.uid)).epoch;
  const sameSession = () => (auth.currentUser?.uid ?? null) === startingUid
    && captureSessionForOwner(userOwner(user.uid)).epoch === originalEpoch;
  await ensureAppCheck();
  if (!sameSession()) throw new Error('Sessione cambiata.');
  const token = await getLimitedUseAppCheckToken();
  if (!sameSession()) throw new Error('Sessione cambiata.');
  if (!token) throw new Error('App Check non disponibile.');
  // Token acquisition is a separate auth gate: a Firebase token failure
  // must not be confused with a transient transport outage.
  const idToken = await user.getIdToken();
  if (!sameSession()) throw new Error('Sessione cambiata.');
  let response: Response;
  try {
    response = await fetch(trustedBackendUrl('/api/health-consent'), {
      method,
      cache: 'no-store',
      headers: {
        authorization: 'Bearer ' + idToken,
        'x-firebase-appcheck': token,
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    // A rejected transport request (unlike an explicit HTTP denial or invalid
    // App Check) cannot prove a remote withdrawal while disconnected.
    if (error instanceof TypeError || (error instanceof DOMException
      && (error.name === 'TimeoutError' || error.name === 'AbortError'))) {
      throw new ConsentTransportUnavailableError();
    }
    throw error;
  }
  if (!sameSession()) throw new Error('Sessione cambiata.');
  if (response.status === 409) throw new ConsentRevisionConflictError();
  if (!response.ok) throw new Error('Verifica del consenso non disponibile (HTTP ' + response.status + ').');
  const result: unknown = await response.json();
  if (!sameSession()) throw new Error('Sessione cambiata.');
  if (!result || typeof result !== 'object') throw new Error('Risposta server non valida.');
  const state = result as Partial<ServerStatus>;
  if ((state.status !== 'active' && state.status !== 'withdrawn' && state.status !== 'unregistered')
    || typeof state.revision !== 'number' || !Number.isSafeInteger(state.revision) || state.revision < 0
    || (state.status === 'unregistered' && state.revision !== 0)
    || (state.status !== 'unregistered' && state.revision < 1)
    || (state.erasedBeforeRevision !== undefined
      && (!Number.isSafeInteger(state.erasedBeforeRevision)
        || state.erasedBeforeRevision < 1
        || state.erasedBeforeRevision >= state.revision))) {
    throw new Error('Stato del consenso server non valido.');
  }
  // Server proof must be complete before ANY cached revision can authorize
  // fitness access, including when a client receives a malformed HTTP 200.
  if (method === 'GET' && state.status === 'active'
    && (typeof state.acceptedAt !== 'string' || !Number.isFinite(Date.parse(state.acceptedAt))
      || typeof state.privacyVersion !== 'string' || state.privacyVersion.length === 0
      || typeof state.termsVersion !== 'string' || state.termsVersion.length === 0)) {
    throw new Error('Prova del consenso server incompleta.');
  }
  return state as ServerStatus;
}

