import { sendHealthDataErasure } from './healthDataErasureTransport';
import type { User } from 'firebase/auth';
import { auth, ensureAppCheck } from './firebase';
import { getLimitedUseAppCheckToken } from './appCheck';
import { captureSession, isCurrentSession } from './sync/session';

export type HealthDataErasureOutcome =
  | { status: 'complete'; complete: true }
  | { status: 'requested' | 'deleting' | 'verifying' | 'failed'; complete: false; retryable?: boolean; error?: string };

// Acquiring fresh credentials is separate from the owner/session guard:
// callers must revalidate the captured session before dispatching HTTP.
async function erasureRequestHeaders(user: User): Promise<{ authorization: string; 'x-firebase-appcheck': string }> {
  await ensureAppCheck();
  const token = await getLimitedUseAppCheckToken();
  if (!token) throw new Error('Verifica App Check non disponibile.');
  const idToken = await user.getIdToken(true);
  return { authorization: 'Bearer ' + idToken, 'x-firebase-appcheck': token };
}

export async function requestHealthDataErasure(user: User): Promise<HealthDataErasureOutcome> {
  const session = captureSession();
  if (session.owner !== 'user:' + user.uid || auth.currentUser?.uid !== user.uid) {
    throw new Error('Sessione diversa da quella che ha richiesto la cancellazione.');
  }
  const headers = await erasureRequestHeaders(user);
  if (!isCurrentSession(session) || auth.currentUser?.uid !== user.uid) {
    throw new Error('Sessione cambiata. Verifica se la cancellazione è già stata avviata.');
  }
  const result = await sendHealthDataErasure('POST', headers);
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
  const headers = await erasureRequestHeaders(user);
  if (!isCurrentSession(session) || auth.currentUser?.uid !== uid) {
    throw new Error('Sessione cambiata prima della pulizia locale.');
  }
  const value = await sendHealthDataErasure('GET', headers);
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
