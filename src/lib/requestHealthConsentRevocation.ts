import { auth, ensureAppCheck } from './firebase';
import { getLimitedUseAppCheckToken } from './appCheck';
import { captureSession, isCurrentSession, storageOwner } from './sync/session';
import { markHealthConsentRevocation, readHealthConsentRevocation } from './healthConsentRevocation';

const API = (import.meta.env.VITE_ACCOUNT_DELETION_API_ORIGIN || 'https://logbook-gnf.vercel.app').replace(/\/$/, '');

export async function requestHealthConsentRevocation(): Promise<void> {
  const session = captureSession();
  const owner = session.owner;
  if (owner === 'guest') {
    markHealthConsentRevocation(owner, 'confirmed');
    return;
  }
  const user = auth.currentUser;
  if (!user || owner !== 'user:' + user.uid || !isCurrentSession(session)) throw new Error('Sessione non autorizzata.');
  // Local cleanup invalidates the sync epoch on purpose. That must not cancel
  // the revocation request itself while this exact Firebase session and owner
  // remain active; real logout/account switching still aborts the request.
  const sameAuthenticatedOwner = () => auth.currentUser === user && storageOwner() === owner;
  // A confirmed withdrawal may still have an incomplete server erasure. The
  // endpoint is idempotent, so an explicit retry must reach the backend.
  if (readHealthConsentRevocation(owner) !== 'confirmed') {
    markHealthConsentRevocation(owner, 'pending');
  }

  const idToken = await user.getIdToken(true);
  if (!sameAuthenticatedOwner()) throw new Error('Sessione cambiata.');
  await ensureAppCheck();
  const appToken = await getLimitedUseAppCheckToken();
  if (!appToken || !sameAuthenticatedOwner()) throw new Error('Sessione o verifica del dispositivo non disponibile.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7500);
  try {
    const response = await fetch(API + '/api/health-consent-revocation', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + idToken, 'x-firebase-appcheck': appToken },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('Revoca ancora in attesa di conferma dal server.');
    const body = await response.json() as { revoked?: unknown };
    if (body.revoked !== true) throw new Error('Risposta del server non verificata.');
    if (!sameAuthenticatedOwner()) throw new Error('Sessione cambiata prima della conferma locale.');
    markHealthConsentRevocation(owner, 'confirmed');
  } finally {
    clearTimeout(timeout);
  }
}
