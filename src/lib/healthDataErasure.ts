import type { User } from 'firebase/auth';
import { auth, ensureAppCheck } from './firebase';
import { getLimitedUseAppCheckToken } from './appCheck';
import { captureSession, isCurrentSession } from './sync/session';

export type HealthDataErasureOutcome =
  | { status: 'complete'; complete: true }
  | { status: 'requested' | 'deleting' | 'verifying' | 'failed'; complete: false; retryable?: boolean; error?: string };

const API = (import.meta.env.VITE_ACCOUNT_DELETION_API_ORIGIN || 'https://logbook-gnf.vercel.app').replace(/\/$/, '');

export async function requestHealthDataErasure(user: User): Promise<HealthDataErasureOutcome> {
  const session = captureSession();
  if (session.owner !== 'user:' + user.uid || auth.currentUser?.uid !== user.uid) {
    throw new Error('Sessione diversa da quella che ha richiesto la cancellazione.');
  }
  await ensureAppCheck();
  const token = await getLimitedUseAppCheckToken();
  if (!token) throw new Error('Verifica App Check non disponibile.');
  // Force a fresh ID token so the server can enforce recent auth_time.
  const idToken = await user.getIdToken(true);
  if (!isCurrentSession(session) || auth.currentUser?.uid !== user.uid) {
    throw new Error('Sessione cambiata. Verifica se la cancellazione è già stata avviata.');
  }
  const response = await fetch(API + '/api/health-data-erasure', {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(12000),
    headers: { authorization: 'Bearer ' + idToken, 'x-firebase-appcheck': token },
  });
  const result: unknown = await response.json();
  if (!response.ok && response.status !== 202) {
    const message = result && typeof result === 'object' && typeof (result as { error?: unknown }).error === 'string'
      ? (result as { error: string }).error
      : 'Cancellazione non confermata dal servizio.';
    throw new Error(message);
  }
  if (!result || typeof result !== 'object') throw new Error('Stato cancellazione non verificabile.');
  const record = result as Partial<HealthDataErasureOutcome>;
  if (record.status === 'complete' && record.complete === true) return { status: 'complete', complete: true };
  if ((record.status === 'requested' || record.status === 'deleting' || record.status === 'verifying' || record.status === 'failed')
      && record.complete === false) {
    return { status: record.status, complete: false,
      ...(record.retryable !== undefined ? { retryable: record.retryable } : {}),
      ...(record.error !== undefined ? { error: record.error } : {}) };
  }
  throw new Error('Stato cancellazione ricevuto non valido.');
}

/**
 * Second, non-destructive trusted read required at the local purge boundary.
 * Old receipts are valid for status history, NOT for deleting a newer archive.
 */
export async function assertCurrentHealthDataErasureCompleted(uid: string): Promise<void> {
  const session = captureSession();
  const user = auth.currentUser;
  if (!user || user.uid !== uid || session.owner !== 'user:' + uid || !isCurrentSession(session)) {
    throw new Error('Proprietario della cancellazione dati non verificabile.');
  }
  await ensureAppCheck();
  const token = await getLimitedUseAppCheckToken();
  if (!token) throw new Error('Verifica App Check non disponibile.');
  const idToken = await user.getIdToken(true);
  if (!isCurrentSession(session) || auth.currentUser?.uid !== uid) {
    throw new Error('Sessione cambiata prima della pulizia locale.');
  }
  const response = await fetch(API + '/api/health-data-erasure', {
    method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(12000),
    headers: { authorization: 'Bearer ' + idToken, 'x-firebase-appcheck': token },
  });
  if (!response.ok) throw new Error('Non è stato possibile verificare la ricevuta della cancellazione cloud.');
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object'
    || (value as { status?: unknown }).status !== 'complete'
    || (value as { complete?: unknown }).complete !== true
    || (value as { localPurgeAuthorized?: unknown }).localPurgeAuthorized !== true) {
    throw new Error('La cancellazione cloud non è verificata per l’attuale consenso. I dati locali restano conservati.');
  }
  if (!isCurrentSession(session) || auth.currentUser?.uid !== uid) {
    throw new Error('Sessione cambiata prima della pulizia locale.');
  }
}
