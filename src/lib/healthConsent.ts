import type { User } from 'firebase/auth';
import { auth, ensureAppCheck } from './firebase';
import { getLimitedUseAppCheckToken } from './appCheck';
import { readBrowserValueStrict, removeBrowserValue, writeBrowserValue } from './sync/browserStorage';

export type HealthConsentStatus = 'checking' | 'active' | 'withdrawn' | 'pending' | 'reaccepting' | 'recovery-required' | 'stale-request' | 'error';
type ServerStatus = { status: 'active' | 'withdrawn'; revision: number; acceptedAt?: string };
const API = (import.meta.env.VITE_ACCOUNT_DELETION_API_ORIGIN || 'https://logbook-gnf.vercel.app').replace(/\/$/, '');
const entries = new Map<string, HealthConsentStatus>();
const listeners = new Set<() => void>();
const verifiedReacceptance = new Map<string, string>();
const verifiedRevisions = new Map<string, number>();
let guestAcceptanceInProgress = false;
const guestMarker = 'logbook:v2:guest:health-consent-withdrawal';
const reacceptMarker = (revision: number) => `reaccepting:${revision}`;
const parseReacceptRevision = (saved: string | null): number | null => {
  if (!saved?.startsWith('reaccepting:')) return null;
  const revision = saved.slice('reaccepting:'.length);
  if (!/^[1-9]\d*$/.test(revision)) return null;
  const parsed = Number(revision);
  return Number.isSafeInteger(parsed) ? parsed : null;
};
const pendingMarker = (revision: number) => `pending:${revision}`;
const parsePendingRevision = (saved: string | null): number | null => {
  if (!saved?.startsWith('pending:')) return null;
  const revision = saved.slice('pending:'.length);
  if (!/^(0|[1-9]\d*)$/.test(revision)) return null;
  const parsed = Number(revision);
  return Number.isSafeInteger(parsed) ? parsed : null;
};
const marker = (uid: string) => `logbook:v2:user:${uid}:health-consent-withdrawal`;
const generationMarker = (uid: string) => `logbook:v2:user:${uid}:health-consent-generation`;
function notify() { for (const listener of listeners) listener(); }
export function beginHealthConsentVerification(uid: string): void {
  verifiedRevisions.delete(uid);
  setStatus(uid, 'checking');
}

export function subscribeHealthConsent(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function readMarker(uid: string): string | null {
  return readBrowserValueStrict(marker(uid));
}
function setStatus(uid: string, status: HealthConsentStatus): void {
  entries.set(uid, status);
  notify();
}
export function currentHealthConsentStatus(uid: string | undefined): HealthConsentStatus {
  if (!uid) return 'active';
  try {
    if (entries.get(uid) === 'recovery-required') return 'recovery-required';
    if (entries.get(uid) === 'stale-request') return 'stale-request';
    const saved = readMarker(uid);
    if (parsePendingRevision(saved) !== null) return 'pending';
    if (saved === 'withdrawn') return saved;
    if (parseReacceptRevision(saved) !== null) return 'reaccepting';
    if (saved !== null) return 'error';
    // Test/recovery tooling can operate before AuthProvider begins verification.
    // AuthProvider synchronously fences the real session at each auth boundary.
    return entries.get(uid) ?? 'active';
  } catch {
    return 'error';
  }
}
export function getGuestHealthConsentStatus(): HealthConsentStatus {
  try {
    const value = readBrowserValueStrict(guestMarker);
    if (value === null) return 'active';
    if (value === 'withdrawn' || value === 'reaccepting') return value;
    return 'error';
  } catch {
    return 'error';
  }
}

export function withdrawGuestHealthConsent(): void {
  writeBrowserValue(guestMarker, 'withdrawn');
  guestAcceptanceInProgress = false;
  notify();
}

export function beginGuestHealthReacceptance(): void {
  const previousStatus = getGuestHealthConsentStatus();
  if (guestAcceptanceInProgress || (previousStatus !== 'withdrawn' && previousStatus !== 'reaccepting')) {
    throw new Error('Nessuna revoca ospite da aggiornare.');
  }
  // A crash after the local legal-consent write but before removing the marker
  // must remain recoverable through another EXPLICIT acceptance.

  writeBrowserValue(guestMarker, 'reaccepting');
  guestAcceptanceInProgress = true;
  notify();
}

export function completeGuestHealthReacceptance(success: boolean): void {
  if (!guestAcceptanceInProgress || getGuestHealthConsentStatus() !== 'reaccepting') {
    throw new Error('Nuovo consenso ospite non avviato.');
  }
  if (success) removeBrowserValue(guestMarker);
  else writeBrowserValue(guestMarker, 'withdrawn');
  guestAcceptanceInProgress = false;
  notify();
}

export function isHealthConsentWritable(owner: string): boolean {
  if (owner === 'guest') {
    const status = getGuestHealthConsentStatus();
    return status === 'active' || (status === 'reaccepting' && guestAcceptanceInProgress);
  }
  if (!owner.startsWith('user:')) return true;
  const uid = owner.slice(5);
  if (currentHealthConsentStatus(uid) !== 'active') return false;
  // A real authenticated session may not write on the default/unknown revision.
  // Node-only pure sync tests have no Firebase currentUser and use rev 0 fixtures.
  if (auth?.currentUser?.uid === uid && !verifiedRevisions.has(uid)) return false;
  try {
    const persisted = readBrowserValueStrict(generationMarker(uid));
    const verified = verifiedRevisions.get(uid) ?? 0;
    return (persisted === null && verified === 0) || persisted === String(verified);
  } catch { return false; }
}
export function getVerifiedHealthConsentRevision(uid: string): number {
  if (currentHealthConsentStatus(uid) !== 'active' || (auth?.currentUser?.uid === uid && !verifiedRevisions.has(uid))) {
    throw new Error('Consenso non verificato per questa sessione.');
  }
  return verifiedRevisions.get(uid) ?? 0;
}

export function requireHealthConsentWritable(owner: string): void {
  if (!isHealthConsentWritable(owner)) throw new Error('Accesso fitness sospeso per revoca del consenso o stato non verificato.');
}

async function serverRequest(user: User, method: 'GET' | 'POST', body?: unknown): Promise<ServerStatus> {
  await ensureAppCheck();
  const token = await getLimitedUseAppCheckToken();
  if (!token) throw new Error('App Check non disponibile.');
  const response = await fetch(API + '/api/health-consent', {
    method,
    cache: 'no-store',
    headers: {
      authorization: 'Bearer ' + await user.getIdToken(),
      'x-firebase-appcheck': token,
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('Verifica del consenso non disponibile (HTTP ' + response.status + ').');
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object') throw new Error('Risposta server non valida.');
  const state = result as Partial<ServerStatus>;
  if ((state.status !== 'active' && state.status !== 'withdrawn')
    || !Number.isSafeInteger(state.revision) || Number(state.revision) < 0) {
    throw new Error('Stato del consenso server non valido.');
  }
  return state as ServerStatus;
}

/** Read the live generation for a separate, user-confirmed pending-data recovery. */
export async function readActiveHealthConsentRevision(user: User): Promise<number> {
  const state = await serverRequest(user, 'GET');
  if (state.status !== 'active' || state.revision < 2) throw new Error('Un nuovo consenso attivo non è stato verificato.');
  return state.revision;
}

export async function refreshHealthConsent(user: User): Promise<HealthConsentStatus> {
  const uid = user.uid;
  const saved = readMarker(uid);
  // A delayed server check must not overwrite a newer local decision or
  // the consent generation published by another tab during network I/O.
  let observedGeneration = readBrowserValueStrict(generationMarker(uid));
  const isSameDecision = () => readMarker(uid) === saved
    && readBrowserValueStrict(generationMarker(uid)) === observedGeneration;
  // Every refresh fences in-flight writes; only a completed, active server
  // check may grant a new writable generation.
  verifiedRevisions.delete(uid);
  setStatus(uid, saved === null ? 'checking' : (parsePendingRevision(saved) !== null ? 'pending' : parseReacceptRevision(saved) !== null ? 'reaccepting' : saved as HealthConsentStatus));
  try {
    const state = await serverRequest(user, 'GET');
    if (!isSameDecision()) return currentHealthConsentStatus(uid);
    if (state.status === 'withdrawn') {
      writeBrowserValue(marker(uid), 'withdrawn');
      setStatus(uid, 'withdrawn');
      return 'withdrawn';
    }
    const pendingRevision = parsePendingRevision(saved);
    if (pendingRevision !== null) {
      // Never re-submit a stale withdrawal AFTER a newer explicit acceptance.
      // Such a request must be reconfirmed by the person, not replayed by focus/reload.
      if (pendingRevision !== state.revision) {
        setStatus(uid, 'stale-request');
        return 'stale-request';
      }
      const retry = await serverRequest(user, 'POST', { action: 'withdraw', expectedRevision: pendingRevision });
      if (!isSameDecision()) return currentHealthConsentStatus(uid);
      if (retry.status !== 'withdrawn') throw new Error('Revoca non registrata.');
      writeBrowserValue(marker(uid), 'withdrawn');
      setStatus(uid, 'withdrawn');
      return 'withdrawn';
    }
    if (saved === 'withdrawn' || (parseReacceptRevision(saved) !== null && !verifiedReacceptance.has(uid))) {
      // A different device must not silently undo this device's withdrawal.
      // Crash recovery requires the user to explicitly reaccept again.
      const suspended: HealthConsentStatus = saved === 'withdrawn' ? 'withdrawn' : 'reaccepting';
      setStatus(uid, suspended);
      return suspended;
    }
    // An older, unsent journal belongs to the previous consent generation.
    // Never silently relabel it as newly authorized or delete it.
    if (state.revision > 0) {
      // Publish the cross-tab fence BEFORE touching IndexedDB. Otherwise an
      // older tab could commit a new operation between the archive update and
      // the marker write, contaminating the new consent generation.
      writeBrowserValue(generationMarker(uid), String(state.revision));
      observedGeneration = String(state.revision);
      const { advanceLocalConsentRevisionIfClean } = await import('./sync/localRepository');
      const ready = await advanceLocalConsentRevisionIfClean('user:' + uid, state.revision);
      if (!isSameDecision()) return currentHealthConsentStatus(uid);
      if (!ready) {
        setStatus(uid, 'recovery-required');
        return 'recovery-required';
      }
    }
    verifiedRevisions.set(uid, state.revision);
    if (saved !== null) removeBrowserValue(marker(uid));
    setStatus(uid, 'active');
    return 'active';
  } catch {
    if (!isSameDecision()) return currentHealthConsentStatus(uid);
    setStatus(uid, saved === null ? 'error' : saved as HealthConsentStatus);
    return currentHealthConsentStatus(uid);
  }
}

export async function withdrawHealthConsent(user: User, freezeWriters?: () => void): Promise<void> {
  const uid = user.uid;
  const verified = verifiedRevisions.get(uid);
  if (verified === undefined) throw new Error('Verifica prima il consenso sul server.');
  writeBrowserValue(marker(uid), pendingMarker(verified));
  setStatus(uid, 'pending');
  // The durable local barrier precedes cancellation, network I/O and any
  // other async transition. An error must never silently undo the intent.
  freezeWriters?.();
  const server = await serverRequest(user, 'POST', { action: 'withdraw', expectedRevision: verified });
  if (server.status !== 'withdrawn') throw new Error('Revoca non registrata dal server.');
  // A successful POST may arrive after another device has reaccepted.
  // Preserve the original pending revision until a fresh read can detect it.
  const reconciled = await refreshHealthConsent(user);
  if (reconciled !== 'withdrawn' && reconciled !== 'stale-request') {
    throw new Error('Stato finale della revoca non ancora verificato.');
  }
}

/** A stale withdrawal is never replayed without a new explicit user decision. */
/**
 * A prior withdrawal cannot override an explicit reacceptance from another
 * device. The user may explicitly KEEP that newer acceptance instead. Never
 * use this path to discard a pending local journal.
 */
export async function retainNewerHealthConsent(user: User): Promise<HealthConsentStatus> {
  const uid = user.uid;
  if (currentHealthConsentStatus(uid) !== 'stale-request') throw new Error('Nessuna scelta recente da confermare.');
  const originalRevision = parsePendingRevision(readMarker(uid));
  if (originalRevision === null) throw new Error('Richiesta precedente non riconosciuta.');
  const live = await serverRequest(user, 'GET');
  if (live.status !== 'active' || live.revision <= originalRevision) {
    throw new Error('Il consenso server è cambiato; ripeti la verifica.');
  }
  writeBrowserValue(generationMarker(uid), String(live.revision));
  const { advanceLocalConsentRevisionIfClean } = await import('./sync/localRepository');
  const ready = await advanceLocalConsentRevisionIfClean('user:' + uid, live.revision);
  // The superseded request is cleared only after the live generation has
  // durably fenced old tabs. An old journal remains in IndexedDB in either case.
  removeBrowserValue(marker(uid));
  if (!ready) {
    setStatus(uid, 'recovery-required');
    return 'recovery-required';
  }
  verifiedRevisions.set(uid, live.revision);
  setStatus(uid, 'active');
  return 'active';
}

export async function reconfirmStaleHealthWithdrawal(user: User): Promise<void> {
  if (currentHealthConsentStatus(user.uid) !== 'stale-request') throw new Error('Nessuna revoca precedente da riconfermare.');
  const live = await serverRequest(user, 'GET');
  if (live.status !== 'active') {
    await refreshHealthConsent(user);
    return;
  }
  writeBrowserValue(marker(user.uid), pendingMarker(live.revision));
  setStatus(user.uid, 'pending');
  const state = await serverRequest(user, 'POST', { action: 'withdraw', expectedRevision: live.revision });
  if (state.status !== 'withdrawn') throw new Error('Revoca non confermata.');
  const reconciled = await refreshHealthConsent(user);
  if (reconciled !== 'withdrawn' && reconciled !== 'stale-request') {
    throw new Error('Stato finale della revoca non ancora verificato.');
  }
}

export async function reacceptHealthConsent(user: User, acceptance: {
  acceptedTerms: true; acceptedHealthData: true; privacyVersion: string; termsVersion: string;
}): Promise<string> {
  const uid = user.uid;
  const saved = readMarker(uid);
  const previousAttempt = parseReacceptRevision(saved);
  if (saved !== 'withdrawn' && previousAttempt === null) throw new Error('Revoca non confermata.');
  let expectedRevision = previousAttempt;
  if (expectedRevision === null) {
    const live = await serverRequest(user, 'GET');
    if (live.status !== 'withdrawn') throw new Error('La revoca non risulta attiva sul server.');
    expectedRevision = live.revision;
  }
  writeBrowserValue(marker(uid), reacceptMarker(expectedRevision));
  setStatus(uid, 'reaccepting');
  const result = await serverRequest(user, 'POST', { action: 'reaccept', acceptance, expectedRevision });
  if (result.status !== 'active' || typeof result.acceptedAt !== 'string') {
    throw new Error('Nuovo consenso non confermato dal server.');
  }
  verifiedReacceptance.set(uid, result.acceptedAt);
  return result.acceptedAt;
}

export function finishHealthConsentReacceptance(uid: string): void {
  if (currentHealthConsentStatus(uid) !== 'active' || !verifiedRevisions.has(uid)
    || !isHealthConsentWritable('user:' + uid)) {
    throw new Error('Nuovo consenso non verificato o dati pendenti da recuperare.');
  }
  verifiedReacceptance.delete(uid);
  window.dispatchEvent(new CustomEvent('logbook:health-consent-reactivated', { detail: { uid } }));
}

export function refreshHealthConsentFromStorage(): void {
  notify();
}
