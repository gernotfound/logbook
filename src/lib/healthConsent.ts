import type { User } from 'firebase/auth';
import type { UserData } from '../types';
import { LEGAL_VERSIONS } from './legalVersions';
import { auth, ensureAppCheck } from './firebase';
import { getLimitedUseAppCheckToken } from './appCheck';
import { readBrowserValueStrict, removeBrowserValue, writeBrowserValue } from './sync/browserStorage';

export type HealthConsentStatus = 'unregistered' | 'checking' | 'active' | 'withdrawn' | 'pending' | 'reaccepting' | 'recovery-required' | 'stale-request' | 'error';
type ServerStatus = { status: 'unregistered' | 'active' | 'withdrawn'; revision: number; acceptedAt?: string; privacyVersion?: string; termsVersion?: string };
const API = (import.meta.env.VITE_ACCOUNT_DELETION_API_ORIGIN || 'https://logbook-gnf.vercel.app').replace(/\/$/, '');
const entries = new Map<string, HealthConsentStatus>();
const listeners = new Set<() => void>();
const verifiedReacceptance = new Map<string, string>();
const serverConfirmedLegal = new Map<string, NonNullable<UserData['legalConsent']>>();
class ConsentTransportUnavailableError extends Error {
  constructor() { super('Connessione al servizio consensi non disponibile.'); }
}
const verifiedRevisions = new Map<string, number>();
// Offline access is local-only: a cached server approval must never authorize cloud I/O.
const onlineVerifiedRevisions = new Map<string, number>();
// Only the latest check may publish its result for an owner.
const verificationSerials = new Map<string, number>();
const invalidateConsentChecks = (uid: string) => {
  const next = (verificationSerials.get(uid) ?? 0) + 1;
  verificationSerials.set(uid, next);
  return next;
};
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
// A local reacceptance NEVER cancels the pending server withdrawal or authorizes
// Firestore. Its explicit legal versions travel with the durable local decision.
const offlineReacceptMarker = (revision: number) =>
  `offline-reaccepted:${revision}:${LEGAL_VERSIONS.privacy}:${LEGAL_VERSIONS.terms}`;
function parseOfflineReaccept(saved: string | null): { revision: number; privacyVersion: string; termsVersion: string } | null {
  const match = /^offline-reaccepted:([1-9]\d*):([0-9.]+):([0-9.]+)$/.exec(saved ?? '');
  if (!match) return null;
  const revision = Number(match[1]);
  return Number.isSafeInteger(revision)
    ? { revision, privacyVersion: match[2], termsVersion: match[3] } : null;
}
function matchesCurrentLegalVersions(intent: NonNullable<ReturnType<typeof parseOfflineReaccept>>): boolean {
  return intent.privacyVersion === LEGAL_VERSIONS.privacy && intent.termsVersion === LEGAL_VERSIONS.terms;
}
const parsePendingRevision = (saved: string | null): number | null => {
  if (!saved?.startsWith('pending:')) return null;
  const revision = saved.slice('pending:'.length);
  if (!/^(0|[1-9]\d*)$/.test(revision)) return null;
  const parsed = Number(revision);
  return Number.isSafeInteger(parsed) ? parsed : null;
};
const marker = (uid: string) => `logbook:v2:user:${uid}:health-consent-withdrawal`;
const generationMarker = (uid: string) => `logbook:v2:user:${uid}:health-consent-generation`;
const lastActiveMarker = (uid: string) => `logbook:v2:user:${uid}:health-consent-last-active`;
function readCachedActiveRevision(uid: string): number | null {
  const saved = readBrowserValueStrict(lastActiveMarker(uid));
  if (saved === null || !/^(0|[1-9]\d*)$/.test(saved)) return null;
  const revision = Number(saved);
  if (!Number.isSafeInteger(revision)) return null;
  const generation = readBrowserValueStrict(generationMarker(uid));
  return revision >= 1 && generation === String(revision) ? revision : null;
}
function notify() { for (const listener of listeners) listener(); }
export function beginHealthConsentVerification(uid: string): void {
  invalidateConsentChecks(uid);
  verifiedRevisions.delete(uid);
  onlineVerifiedRevisions.delete(uid);
  serverConfirmedLegal.delete(uid);
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
    const offline = parseOfflineReaccept(saved);
    if (offline !== null) {
      // A failed or conflicting trusted reconciliation must fence even local
      // access; the durable marker is not itself a server authorization.
      if (entries.get(uid) === 'error') return 'error';
      return matchesCurrentLegalVersions(offline)
        && readCachedActiveRevision(uid) === offline.revision
        && verifiedRevisions.get(uid) === offline.revision ? 'active' : 'checking';
    }
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
  if (auth?.currentUser?.uid === uid && (!verifiedRevisions.has(uid) || (verifiedRevisions.get(uid) ?? 0) < 1)) return false;
  try {
    const persisted = readBrowserValueStrict(generationMarker(uid));
    const verified = verifiedRevisions.get(uid) ?? 0;
    return verified === 0 ? auth?.currentUser?.uid !== uid && persisted === null : persisted === String(verified);
  } catch { return false; }
}
/** Cloud operations require a fresh server check in THIS online session. */
export function isHealthConsentCloudWritable(owner: string): boolean {
  if (!isHealthConsentWritable(owner)) return false;
  if (!owner.startsWith('user:')) return owner !== 'guest';
  const uid = owner.slice(5);
  if (auth?.currentUser?.uid !== uid || (typeof navigator !== 'undefined' && navigator.onLine === false)) return false;
  // The offline opt-in is local-only even when the network returns; the
  // server withdrawal and new acceptance must first reconcile in order.
  try { if (readMarker(uid) !== null) return false; } catch { return false; }
  return onlineVerifiedRevisions.get(uid) === verifiedRevisions.get(uid)
    && verifiedRevisions.has(uid);
}

/**
 * Only the current online, server-confirmed legal versions can populate the
 * already-explicitly-accepted legalConsent field without a second prompt.
 * An untrusted local marker or a cached offline revision cannot do this.
 */
export function isHealthConsentLocalOnly(uid: string): boolean {
  try { return parseOfflineReaccept(readMarker(uid)) !== null && currentHealthConsentStatus(uid) === 'active'; }
  catch { return false; }
}

export function getServerConfirmedLegalConsent(uid: string): NonNullable<UserData['legalConsent']> | null {
  if (!isHealthConsentCloudWritable('user:' + uid)) return null;
  return serverConfirmedLegal.get(uid) ?? null;
}

/** Keep local editing available when the network drops, but withdraw the
 * current session's permission to call cloud APIs until another server check. */
export function suspendHealthConsentCloudAccess(uid: string): void {
  onlineVerifiedRevisions.delete(uid);
}

export function getVerifiedHealthConsentRevision(uid: string): number {
  if (currentHealthConsentStatus(uid) !== 'active' || (auth?.currentUser?.uid === uid && !isHealthConsentCloudWritable('user:' + uid))) {
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
  // Token acquisition is a separate auth gate: a Firebase token failure
  // must not be confused with a transient transport outage.
  const idToken = await user.getIdToken();
  let response: Response;
  try {
    response = await fetch(API + '/api/health-consent', {
      method,
      cache: 'no-store',
      headers: {
        authorization: 'Bearer ' + idToken,
        'x-firebase-appcheck': token,
        'x-consent-contract': '2',
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
  if (!response.ok) throw new Error('Verifica del consenso non disponibile (HTTP ' + response.status + ').');
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object') throw new Error('Risposta server non valida.');
  const state = result as Partial<ServerStatus>;
  if ((state.status !== 'active' && state.status !== 'withdrawn' && state.status !== 'unregistered')
    || typeof state.revision !== 'number' || !Number.isSafeInteger(state.revision) || state.revision < 0
    || (state.status === 'unregistered' && state.revision !== 0)
    || (state.status !== 'unregistered' && state.revision < 1)) {
    throw new Error('Stato del consenso server non valido.');
  }
  return state as ServerStatus;
}

/**
 * Explicit, server-authenticated first acceptance: no cloud business access
 * is granted by the POST response alone. Bootstrap must revalidate consent
 * and the local causal journal before resuming.
 */
export async function registerInitialHealthConsent(user: User, acceptance: {
  acceptedTerms: true; acceptedHealthData: true; privacyVersion: string; termsVersion: string;
}): Promise<string> {
  if (auth.currentUser?.uid !== user.uid || currentHealthConsentStatus(user.uid) !== 'unregistered') {
    throw new Error('Sessione cambiata o primo consenso non richiesto.');
  }
  const accepted = await serverRequest(user, 'POST', { action: 'accept-initial', acceptance, expectedRevision: 0 });
  if (auth.currentUser?.uid !== user.uid) throw new Error('Sessione cambiata durante la registrazione.');
  if (accepted.status !== 'active' || accepted.revision !== 1 || typeof accepted.acceptedAt !== 'string') {
    throw new Error('Primo consenso non confermato dal server.');
  }
  return accepted.acceptedAt;
}

/** Export is permitted in suspended mode, but the Admin-only transport is
 * permitted only when the server is actually withdrawn. */
export async function readHealthConsentServerStatus(user: User): Promise<ServerStatus['status']> {
  return (await serverRequest(user, 'GET')).status;
}

/** Read the live generation for a separate, user-confirmed pending-data recovery. */
export async function readActiveHealthConsentRevision(user: User): Promise<number> {
  const state = await serverRequest(user, 'GET');
  if (state.status !== 'active' || state.revision < 2) throw new Error('Un nuovo consenso attivo non è stato verificato.');
  return state.revision;
}

/**
 * Permit a deliberate, authenticated, *device-only* reacceptance while offline.
 * The older server withdrawal remains encoded in the same durable owner marker.
 * Sync stays fenced until both remote transitions and the local journal reconcile.
 */
export function reacceptHealthConsentLocally(user: User, acceptance: {
  acceptedTerms: true; acceptedHealthData: true; privacyVersion: string; termsVersion: string;
}): void {
  if (typeof navigator === 'undefined' || navigator.onLine !== false) {
    throw new Error('La riattivazione locale è riservata alla modalità offline.');
  }
  if (auth.currentUser?.uid !== user.uid || acceptance.acceptedTerms !== true
    || acceptance.acceptedHealthData !== true
    || acceptance.privacyVersion !== LEGAL_VERSIONS.privacy
    || acceptance.termsVersion !== LEGAL_VERSIONS.terms) {
    throw new Error('Account o accettazione esplicita non validi.');
  }
  const saved = readMarker(user.uid);
  const pending = parsePendingRevision(saved);
  if (pending === null && saved !== 'withdrawn') throw new Error('Nessuna revoca locale da riattivare.');
  const cachedRevision = readCachedActiveRevision(user.uid);
  if (cachedRevision === null || (pending !== null && pending !== cachedRevision)
    || (verifiedRevisions.has(user.uid) && verifiedRevisions.get(user.uid) !== cachedRevision)) {
    throw new Error('Consenso precedente non verificabile su questo dispositivo.');
  }
  // This single durable write preserves the source revision of the withdrawal
  // across crashes, tabs and reloads; NEVER remove it on local acceptance.
  writeBrowserValue(marker(user.uid), offlineReacceptMarker(cachedRevision));
  onlineVerifiedRevisions.delete(user.uid);
  verifiedRevisions.set(user.uid, cachedRevision);
  setStatus(user.uid, 'active');
}

export async function refreshHealthConsent(user: User): Promise<HealthConsentStatus> {
  const uid = user.uid;
  const saved = readMarker(uid);
  const offlineReaccept = parseOfflineReaccept(saved);
  const offlineReacceptValid = offlineReaccept !== null
    && matchesCurrentLegalVersions(offlineReaccept)
    && readCachedActiveRevision(uid) === offlineReaccept.revision;
  // A delayed server check must not overwrite a newer local decision or
  // the consent generation published by another tab during network I/O.
  let observedGeneration = readBrowserValueStrict(generationMarker(uid));
  const serial = invalidateConsentChecks(uid);
  const isSameDecision = () => verificationSerials.get(uid) === serial
    && readMarker(uid) === saved
    && readBrowserValueStrict(generationMarker(uid)) === observedGeneration;
  const recoverCachedOfflineConsent = (): boolean => {
    const cached = saved === null ? readCachedActiveRevision(uid)
      : offlineReacceptValid ? offlineReaccept!.revision : null;
    if (cached === null || !isSameDecision()) return false;
    verifiedRevisions.set(uid, cached);
    setStatus(uid, 'active');
    return true;
  };
  // A periodic recheck must fence cloud writes without falsely presenting a
  // confirmed local consent as revoked. Locally committed edits retain the
  // last verified generation, like an offline session, until the response
  // either confirms it or fences it with a newer generation/withdrawal.
  // Cold-start checks and durable withdrawal intents remain fail-closed.
  const locallyVerified = (saved === null || offlineReacceptValid)
    && entries.get(uid) === 'active'
    && isHealthConsentWritable('user:' + uid);
  if (!locallyVerified) verifiedRevisions.delete(uid);
  onlineVerifiedRevisions.delete(uid);
  if (!locallyVerified) {
    setStatus(uid, saved === null || offlineReaccept !== null ? 'checking'
      : (parsePendingRevision(saved) !== null ? 'pending' : parseReacceptRevision(saved) !== null ? 'reaccepting' : saved as HealthConsentStatus));
  }
  try {
    // An already authorized device may continue locally with its most recent
    // server-confirmed generation while disconnected. New accounts, pending
    // withdrawal/reacceptance and unknown generations remain suspended.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      if (recoverCachedOfflineConsent()) return 'active';
      if (saved === null || offlineReaccept !== null) {
        setStatus(uid, 'error');
        return 'error';
      }
      return currentHealthConsentStatus(uid);
    }
    let state = await serverRequest(user, 'GET');
    if (!isSameDecision()) return currentHealthConsentStatus(uid);
    if (offlineReaccept !== null) {
      if (!offlineReacceptValid) {
        setStatus(uid, 'error');
        return 'error';
      }
      const sourceRevision = offlineReaccept.revision;
      // An uncertain offline withdrawal can already have reached the backend.
      // Always settle that precise transition before replaying the later opt-in.
      if (state.status === 'active' && state.revision === sourceRevision) {
        state = await serverRequest(user, 'POST', { action: 'withdraw', expectedRevision: sourceRevision });
        if (!isSameDecision()) return currentHealthConsentStatus(uid);
      }
      if (state.status === 'withdrawn' && state.revision === sourceRevision + 1) {
        state = await serverRequest(user, 'POST', {
          action: 'reaccept', expectedRevision: state.revision,
          acceptance: { acceptedTerms: true, acceptedHealthData: true,
            privacyVersion: offlineReaccept.privacyVersion, termsVersion: offlineReaccept.termsVersion },
        });
        if (!isSameDecision()) return currentHealthConsentStatus(uid);
      } else if (state.status === 'active' && state.revision === sourceRevision + 2) {
        // A lost POST acknowledgement is safe to finish only when the server
        // still attests the versions that were explicitly accepted offline.
        if (state.privacyVersion !== offlineReaccept.privacyVersion
          || state.termsVersion !== offlineReaccept.termsVersion
          || typeof state.acceptedAt !== 'string') {
          setStatus(uid, 'error');
          return 'error';
        }
      }
      if (state.status !== 'active' || state.revision !== sourceRevision + 2
        || typeof state.acceptedAt !== 'string') {
        // A newer trusted withdrawal overrides this device's older offline
        // reacceptance. Persist a distinct conflict fence across reloads.
        // Keep all local ciphertext/journal for explicit recovery, but do not
        // allow the cached older consent to re-enable fitness automatically.
        writeBrowserValue(marker(uid), saved!.replace('offline-reaccepted:', 'offline-conflict:'));
        setStatus(uid, 'error');
        return 'error';
      }
      // No cloud permission is published until the existing journal/epoch
      // validation below finishes. A pending old journal requires explicit recovery.
    }
    if (state.status === 'unregistered') {
      // A missing server record never authorizes cloud access or restores
      // an unsent local withdrawal by accident.
      verifiedRevisions.delete(uid);
      onlineVerifiedRevisions.delete(uid);
      serverConfirmedLegal.delete(uid);
      if (saved !== null) return currentHealthConsentStatus(uid);
      setStatus(uid, 'unregistered');
      return 'unregistered';
    }
    if (state.status === 'withdrawn') {
      serverConfirmedLegal.delete(uid);
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
    if (saved === 'withdrawn' && state.revision >= 2) {
      // The server accepted a NEW consent after this device withdrew.
      // Keep the local block until the person explicitly chooses what to do.
      setStatus(uid, 'stale-request');
      return 'stale-request';
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
    // Store the positive server result only AFTER the local generation was
    // validated. This marker is never enough to authorize remote operations.
    writeBrowserValue(lastActiveMarker(uid), String(state.revision));
    if (!isSameDecision()) return currentHealthConsentStatus(uid);
    verifiedRevisions.set(uid, state.revision);
    onlineVerifiedRevisions.set(uid, state.revision);
    if (state.privacyVersion === LEGAL_VERSIONS.privacy
      && state.termsVersion === LEGAL_VERSIONS.terms
      && typeof state.acceptedAt === 'string' && Number.isFinite(Date.parse(state.acceptedAt))) {
      serverConfirmedLegal.set(uid, {
        hasAcceptedTerms: true, hasAcceptedHealthData: true,
        acceptedAt: state.acceptedAt, privacyVersion: state.privacyVersion,
        termsVersion: state.termsVersion,
      });
    } else {
      serverConfirmedLegal.delete(uid);
    }
    if (saved !== null) removeBrowserValue(marker(uid));
    setStatus(uid, 'active');
    return 'active';
  } catch (error) {
    if (!isSameDecision()) return currentHealthConsentStatus(uid);
    if (error instanceof ConsentTransportUnavailableError && recoverCachedOfflineConsent()) return 'active';
    setStatus(uid, saved === null || offlineReaccept !== null ? 'error' : saved as HealthConsentStatus);
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
  const saved = readMarker(uid);
  const originalRevision = parsePendingRevision(saved);
  if (originalRevision === null && saved !== 'withdrawn') throw new Error('Richiesta precedente non riconosciuta.');
  const live = await serverRequest(user, 'GET');
  if (readMarker(uid) !== saved || currentHealthConsentStatus(uid) !== 'stale-request') {
    throw new Error('La revoca locale è cambiata durante la verifica.');
  }
  // The durable withdrawn marker has no request revision, but a live active
  // revision >= 2 proves a subsequent explicit reacceptance occurred.
  if (live.status !== 'active' || live.revision <= (originalRevision ?? 1)) {
    throw new Error('Il consenso server è cambiato; ripeti la verifica.');
  }
  writeBrowserValue(generationMarker(uid), String(live.revision));
  const { advanceLocalConsentRevisionIfClean } = await import('./sync/localRepository');
  const ready = await advanceLocalConsentRevisionIfClean('user:' + uid, live.revision);
  if (readMarker(uid) !== saved || currentHealthConsentStatus(uid) !== 'stale-request') {
    throw new Error('La revoca locale è cambiata durante il recupero.');
  }
  // The superseded request is cleared only after the live generation has
  // durably fenced old tabs. An old journal remains in IndexedDB in either case.
  removeBrowserValue(marker(uid));
  if (!ready) {
    setStatus(uid, 'recovery-required');
    return 'recovery-required';
  }
  writeBrowserValue(lastActiveMarker(uid), String(live.revision));
  verifiedRevisions.set(uid, live.revision);
  onlineVerifiedRevisions.set(uid, live.revision);
  setStatus(uid, 'active');
  return 'active';
}

export async function reconfirmStaleHealthWithdrawal(user: User): Promise<void> {
  const uid = user.uid;
  if (currentHealthConsentStatus(uid) !== 'stale-request') throw new Error('Nessuna revoca precedente da riconfermare.');
  const originalMarker = readMarker(uid);
  const originalGeneration = readBrowserValueStrict(generationMarker(uid));
  const live = await serverRequest(user, 'GET');
  // Never turn a newer decision made by another tab into an unsolicited
  // revocation merely because an older confirmation request arrived late.
  if (readMarker(uid) !== originalMarker
    || readBrowserValueStrict(generationMarker(uid)) !== originalGeneration
    || currentHealthConsentStatus(uid) !== 'stale-request') {
    throw new Error('La scelta locale è cambiata durante la riconferma della revoca.');
  }
  if (live.status !== 'active') {
    await refreshHealthConsent(user);
    return;
  }
  writeBrowserValue(marker(uid), pendingMarker(live.revision));
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
    if (readMarker(uid) !== saved) throw new Error('La scelta locale è cambiata durante la verifica.');
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
