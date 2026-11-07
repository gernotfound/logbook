import { trustedBackendUrl } from './backendApi';
import type { User } from 'firebase/auth';
import type { UserData } from '../types';
import { LEGAL_VERSIONS } from './legalVersions';
import { auth, ensureAppCheck } from './firebase';
import { getLimitedUseAppCheckToken } from './appCheck';
import { readBrowserValueStrict, removeBrowserValue, writeBrowserValue } from './sync/browserStorage';
import { captureSessionForOwner, userOwner } from './sync/session';

export type HealthConsentStatus = 'unregistered' | 'checking' | 'active' | 'withdrawn' | 'pending' | 'reaccepting' | 'recovery-required' | 'erasure-required' | 'stale-request' | 'error';
type ServerStatus = { status: 'unregistered' | 'active' | 'withdrawn'; revision: number; acceptedAt?: string; privacyVersion?: string; termsVersion?: string; erasedBeforeRevision?: number };
const entries = new Map<string, HealthConsentStatus>();
const listeners = new Set<() => void>();
const verifiedReacceptance = new Map<string, string>();
const serverConfirmedLegal = new Map<string, NonNullable<UserData['legalConsent']>>();
class ConsentTransportUnavailableError extends Error {
  constructor() { super('Connessione al servizio consensi non disponibile.'); }
}
class ConsentRevisionConflictError extends Error {
  constructor() { super('Una decisione sul consenso più recente richiede un nuovo controllo.'); }
}
function isRetryableConsentTransportError(error: unknown): boolean {
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
const verifiedRevisions = new Map<string, number>();
// A UID alone is not a consent proof across Auth epochs, including A→B→A.
const verifiedSessionEpochs = new Map<string, number>();
// Offline access is local-only: a cached server approval must never authorize cloud I/O.
const onlineVerifiedRevisions = new Map<string, number>();
// A local withdrawn marker fences writes, but never proves the backend accepted
// the revocation. UI must not start erasure polling from that marker alone.
const confirmedServerWithdrawals = new Map<string, number>();
// Only the latest check may publish its result for an owner.
const verificationSerials = new Map<string, number>();
const invalidateConsentChecks = (uid: string) => {
  const next = (verificationSerials.get(uid) ?? 0) + 1;
  verificationSerials.set(uid, next);
  return next;
};
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
  verifiedSessionEpochs.delete(uid);
  onlineVerifiedRevisions.delete(uid);
  confirmedServerWithdrawals.delete(uid);
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
  if (status !== 'withdrawn') confirmedServerWithdrawals.delete(uid);
  entries.set(uid, status);
  notify();
}

/** A server GET or authenticated POST must attest the exact withdrawal before
 * UI may poll the destructive job; a cross-tab/local marker alone is insufficient. */
export function isVerifiedHealthWithdrawal(uid: string): boolean {
  return confirmedServerWithdrawals.has(uid)
    && entries.get(uid) === 'withdrawn'
    && currentHealthConsentStatus(uid) === 'withdrawn';
}
export function currentHealthConsentStatus(uid: string | undefined): HealthConsentStatus {
  if (!uid) return 'active';
  try {
    if (entries.get(uid) === 'recovery-required') return 'recovery-required';
    if (entries.get(uid) === 'erasure-required') return 'erasure-required';
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
    if (value === 'withdrawn') return value;
    return 'error';
  } catch {
    return 'error';
  }
}

export function withdrawGuestHealthConsent(): void {
  writeBrowserValue(guestMarker, 'withdrawn');
  notify();
}

export function isHealthConsentWritable(owner: string): boolean {
  if (owner === 'guest') {
    const status = getGuestHealthConsentStatus();
    return status === 'active';
  }
  if (!owner.startsWith('user:')) return true;
  const uid = owner.slice(5);
  if (currentHealthConsentStatus(uid) !== 'active') return false;
  // An Auth epoch replacement invalidates the approval even when the UID
  // and persisted consent revision remain unchanged.
  try {
    const persisted = readBrowserValueStrict(generationMarker(uid));
    const verified = verifiedRevisions.get(uid) ?? 0;
    if (auth?.currentUser?.uid === uid && (verified < 1
      || verifiedSessionEpochs.get(uid) !== captureSessionForOwner(owner).epoch)) return false;
    // Node-only pure sync tests have no Firebase currentUser and use rev 0 fixtures.
    return verified === 0 ? auth?.currentUser?.uid !== uid && persisted === null : persisted === String(verified);
  } catch { return false; }
}
/** Cloud operations require a fresh server check in THIS online session. */
export function isHealthConsentCloudWritable(owner: string): boolean {
  if (!isHealthConsentWritable(owner)) return false;
  if (!owner.startsWith('user:')) return owner !== 'guest';
  const uid = owner.slice(5);
  if (auth?.currentUser?.uid !== uid || (typeof navigator !== 'undefined' && navigator.onLine === false)) return false;
  // An explicit withdrawal fences cloud operations until a fresh trusted
  // acceptance; offline consent reactivation no longer exists.
  try { if (readMarker(uid) !== null) return false; } catch { return false; }
  return onlineVerifiedRevisions.get(uid) === verifiedRevisions.get(uid)
    && verifiedRevisions.has(uid);
}

/**
 * Only the current online, server-confirmed legal versions can populate the
 * already-explicitly-accepted legalConsent field without a second prompt.
 * An untrusted local marker or a cached offline revision cannot do this.
 */
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
export async function readActiveHealthConsentRevision(user: User): Promise<{ revision: number; erasedBeforeRevision?: number }> {
  const state = await serverRequest(user, 'GET');
  if (state.status !== 'active' || state.revision < 2) throw new Error('Un nuovo consenso attivo non è stato verificato.');
  return {
    revision: state.revision,
    ...(state.erasedBeforeRevision !== undefined ? { erasedBeforeRevision: state.erasedBeforeRevision } : {}),
  };
}

// Bound only read-only checks: a consent-changing POST must never be raced
// against a client-side timeout because the server might have committed.
const CONSENT_READ_TIMEOUT_MS = 15_000;
async function boundedConsentRead(user: User): Promise<ServerStatus> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      serverRequest(user, 'GET'),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new ConsentTransportUnavailableError()), CONSENT_READ_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export async function refreshHealthConsent(user: User): Promise<HealthConsentStatus> {
  const uid = user.uid;
  const startingAuthUid = auth.currentUser?.uid ?? null;
  if (startingAuthUid !== null && startingAuthUid !== uid) return currentHealthConsentStatus(uid);
  // A different login to the SAME UID is still a different authorization
  // generation. A delayed GET must never publish consent into that session.
  const startingSessionEpoch = captureSessionForOwner(userOwner(uid)).epoch;
  const saved = readMarker(uid);
  // A marker outside the supported current-state protocol is not a cached
  // consent or an invitation to migrate an old offline acceptance.
  if (saved !== null && saved !== 'withdrawn'
    && parsePendingRevision(saved) === null && parseReacceptRevision(saved) === null) {
    setStatus(uid, 'error');
    return 'error';
  }
  // A delayed server check must not overwrite a newer local decision or
  // the consent generation published by another tab during network I/O.
  let observedGeneration = readBrowserValueStrict(generationMarker(uid));
  const serial = invalidateConsentChecks(uid);
  const isSameDecision = () => verificationSerials.get(uid) === serial
    && (auth.currentUser?.uid ?? null) === startingAuthUid
    && captureSessionForOwner(userOwner(uid)).epoch === startingSessionEpoch
    && readMarker(uid) === saved
    && readBrowserValueStrict(generationMarker(uid)) === observedGeneration;
  const recoverCachedOfflineConsent = (): boolean => {
    const cached = saved === null ? readCachedActiveRevision(uid) : null;
    if (cached === null || !isSameDecision()) return false;
    verifiedRevisions.set(uid, cached);
    verifiedSessionEpochs.set(uid, startingSessionEpoch);
    setStatus(uid, 'active');
    return true;
  };
  // A periodic recheck must fence cloud writes without falsely presenting a
  // confirmed local consent as revoked. Locally committed edits retain the
  // last verified generation, like an offline session, until the response
  // either confirms it or fences it with a newer generation/withdrawal.
  // Cold-start checks and durable withdrawal intents remain fail-closed.
  const locallyVerified = saved === null
    && entries.get(uid) === 'active'
    && isHealthConsentWritable('user:' + uid);
  if (!locallyVerified) verifiedRevisions.delete(uid);
  verifiedSessionEpochs.delete(uid);
  onlineVerifiedRevisions.delete(uid);
  if (!locallyVerified) {
    setStatus(uid, saved === null ? 'checking'
      : (parsePendingRevision(saved) !== null ? 'pending' : parseReacceptRevision(saved) !== null ? 'reaccepting'
        : saved === 'withdrawn' ? 'withdrawn' : 'error'));
  }
  try {
    // An already authorized device may continue locally with its most recent
    // server-confirmed generation while disconnected. New accounts, pending
    // withdrawal/reacceptance and unknown generations remain suspended.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      if (recoverCachedOfflineConsent()) return 'active';
      if (saved === null) {
        setStatus(uid, 'error');
        return 'error';
      }
      return currentHealthConsentStatus(uid);
    }
    let state = await boundedConsentRead(user);
    if (!isSameDecision()) return currentHealthConsentStatus(uid);
    if (state.status === 'unregistered') {
      // A missing server record never authorizes cloud access or restores
      // an unsent local withdrawal by accident.
      verifiedRevisions.delete(uid);
  verifiedSessionEpochs.delete(uid);
      onlineVerifiedRevisions.delete(uid);
      serverConfirmedLegal.delete(uid);
      if (saved !== null) return currentHealthConsentStatus(uid);
      setStatus(uid, 'unregistered');
      return 'unregistered';
    }
    if (state.status === 'withdrawn') {
      serverConfirmedLegal.delete(uid);
      writeBrowserValue(marker(uid), 'withdrawn');
      confirmedServerWithdrawals.set(uid, state.revision);
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
      confirmedServerWithdrawals.set(uid, retry.revision);
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
      if (!isSameDecision()) return currentHealthConsentStatus(uid);
      const ready = await advanceLocalConsentRevisionIfClean(
        'user:' + uid, state.revision, isSameDecision, state.erasedBeforeRevision,
      );
      if (!isSameDecision()) return currentHealthConsentStatus(uid);
      if (ready === 'erased') {
        verifiedRevisions.delete(uid);
  verifiedSessionEpochs.delete(uid);
        onlineVerifiedRevisions.delete(uid);
        serverConfirmedLegal.delete(uid);
        setStatus(uid, 'erasure-required');
        return 'erasure-required';
      }
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
    verifiedSessionEpochs.set(uid, startingSessionEpoch);
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
    if (isRetryableConsentTransportError(error) && recoverCachedOfflineConsent()) return 'active';
    setStatus(uid, saved === null ? 'error'
      : parsePendingRevision(saved) !== null ? 'pending'
      : parseReacceptRevision(saved) !== null ? 'reaccepting'
      : saved === 'withdrawn' ? 'withdrawn' : 'error');
    return currentHealthConsentStatus(uid);
  }
}

export async function withdrawHealthConsent(user: User, freezeWriters?: () => void): Promise<void> {
  const uid = user.uid;
  // A stale settings callback must not leave a durable withdrawal that the
  // next login could replay as a newly confirmed destructive choice.
  if (auth.currentUser !== user) throw new Error('Sessione cambiata.');
  const verified = verifiedRevisions.get(uid);
  if (verified === undefined || verifiedSessionEpochs.get(uid) !== captureSessionForOwner(userOwner(uid)).epoch
    || !isHealthConsentWritable(userOwner(uid))) {
    throw new Error('Verifica prima il consenso sul server.');
  }
  writeBrowserValue(marker(uid), pendingMarker(verified));
  setStatus(uid, 'pending');
  // The durable local barrier precedes cancellation, network I/O and any
  // other async transition. An error must never silently undo the intent.
  freezeWriters?.();
  // The local pending marker is already durable and immediately fences writes.
  // A known offline device must not request an App Check token or attempt a
  // server POST merely to record that same local intent. AuthProvider will
  // reconcile the exact revision on the next online/foreground check.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
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
  const startingAuthUid = auth.currentUser?.uid ?? null;
  if (startingAuthUid !== null && startingAuthUid !== uid) throw new Error('Sessione cambiata.');
  if (currentHealthConsentStatus(uid) !== 'stale-request') throw new Error('Nessuna scelta recente da confermare.');
  const saved = readMarker(uid);
  const startingSessionEpoch = captureSessionForOwner(userOwner(uid)).epoch;
  // The same UID after A→B→A is not the session that began this decision.
  const sameAuth = () => (auth.currentUser?.uid ?? null) === startingAuthUid
    && captureSessionForOwner(userOwner(uid)).epoch === startingSessionEpoch;
  const originalRevision = parsePendingRevision(saved);
  if (originalRevision === null && saved !== 'withdrawn') throw new Error('Richiesta precedente non riconosciuta.');
  const live = await serverRequest(user, 'GET');
  if (!sameAuth()) throw new Error('Sessione cambiata durante la verifica.');
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
  const ready = await advanceLocalConsentRevisionIfClean('user:' + uid, live.revision,
    () => sameAuth() && readMarker(uid) === saved
      && readBrowserValueStrict(generationMarker(uid)) === String(live.revision),
    live.erasedBeforeRevision);
  if (!sameAuth()) throw new Error('Sessione cambiata durante il recupero.');
  if (readMarker(uid) !== saved || currentHealthConsentStatus(uid) !== 'stale-request') {
    throw new Error('La revoca locale è cambiata durante il recupero.');
  }
  // The superseded request is cleared only after the live generation has
  // durably fenced old tabs. An old journal remains in IndexedDB in either case.
  removeBrowserValue(marker(uid));
  if (ready === 'erased') {
    verifiedRevisions.delete(uid);
  verifiedSessionEpochs.delete(uid);
    onlineVerifiedRevisions.delete(uid);
    serverConfirmedLegal.delete(uid);
    setStatus(uid, 'erasure-required');
    return 'erasure-required';
  }
  if (!ready) {
    setStatus(uid, 'recovery-required');
    return 'recovery-required';
  }
  writeBrowserValue(lastActiveMarker(uid), String(live.revision));
  verifiedRevisions.set(uid, live.revision);
  verifiedSessionEpochs.set(uid, startingSessionEpoch);
  onlineVerifiedRevisions.set(uid, live.revision);
  setStatus(uid, 'active');
  return 'active';
}

export async function reconfirmStaleHealthWithdrawal(user: User): Promise<void> {
  const uid = user.uid;
  if (currentHealthConsentStatus(uid) !== 'stale-request') throw new Error('Nessuna revoca precedente da riconfermare.');
  const originalMarker = readMarker(uid);
  const originalGeneration = readBrowserValueStrict(generationMarker(uid));
  const startingUid = auth.currentUser?.uid ?? null;
  if (startingUid !== null && startingUid !== uid) throw new Error('Sessione cambiata.');
  const startingSessionEpoch = captureSessionForOwner(userOwner(uid)).epoch;
  const live = await serverRequest(user, 'GET');
  // Never turn a newer decision made by another tab into an unsolicited
  // revocation merely because an older confirmation request arrived late.
  if ((auth.currentUser?.uid ?? null) !== startingUid
    || captureSessionForOwner(userOwner(uid)).epoch !== startingSessionEpoch) {
    throw new Error('Sessione cambiata.');
  }
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
  const startingUid = auth.currentUser?.uid ?? null;
  if (startingUid !== null && startingUid !== uid) throw new Error('Sessione cambiata.');
  const startingSessionEpoch = captureSessionForOwner(userOwner(uid)).epoch;
  if (expectedRevision === null) {
    const live = await serverRequest(user, 'GET');
    if (live.status !== 'withdrawn') throw new Error('La revoca non risulta attiva sul server.');
    if ((auth.currentUser?.uid ?? null) !== startingUid
      || captureSessionForOwner(userOwner(uid)).epoch !== startingSessionEpoch) {
      throw new Error('Sessione cambiata.');
    }
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
