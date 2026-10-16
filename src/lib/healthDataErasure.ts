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
  const idToken = await user.getIdToken();
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
