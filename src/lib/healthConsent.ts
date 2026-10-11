import type { User } from 'firebase/auth';
import { ensureAppCheck } from './firebase';
import { getLimitedUseAppCheckToken } from './appCheck';
import { readBrowserValueStrict, removeBrowserValue, writeBrowserValue } from './sync/browserStorage';

export type HealthConsentStatus = 'checking' | 'active' | 'withdrawn' | 'pending' | 'reaccepting' | 'error';
type ServerStatus = { status: 'active' | 'withdrawn'; revision: number; acceptedAt?: string };
const API = (import.meta.env.VITE_ACCOUNT_DELETION_API_ORIGIN || 'https://logbook-gnf.vercel.app').replace(/\/$/, '');
const entries = new Map<string, HealthConsentStatus>();
const listeners = new Set<() => void>();
const verifiedReacceptance = new Map<string, string>();
const marker = (uid: string) => `logbook:v2:user:${uid}:health-consent-withdrawal`;
function notify() { for (const listener of listeners) listener(); }
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
    const saved = readMarker(uid);
    if (saved === 'pending' || saved === 'withdrawn' || saved === 'reaccepting') return saved;
    if (saved !== null) return 'error';
    return entries.get(uid) ?? 'checking';
  } catch {
    return 'error';
  }
}
export function isHealthConsentWritable(owner: string): boolean {
  if (!owner.startsWith('user:')) return true;
  const uid = owner.slice(5);
  return currentHealthConsentStatus(uid) === 'active' || (currentHealthConsentStatus(uid) === 'reaccepting' && verifiedReacceptance.has(uid));
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

export async function refreshHealthConsent(user: User): Promise<HealthConsentStatus> {
  const uid = user.uid;
  const saved = readMarker(uid);
  setStatus(uid, saved === null ? 'checking' : saved as HealthConsentStatus);
  try {
    const state = await serverRequest(user, 'GET');
    if (state.status === 'withdrawn') {
      writeBrowserValue(marker(uid), 'withdrawn');
      setStatus(uid, 'withdrawn');
      return 'withdrawn';
    }
    if (saved === 'pending') {
      // The previous request may have been lost. Never interpret an active
      // server as a reason to discard a durable revocation intent.
      const retry = await serverRequest(user, 'POST', { action: 'withdraw' });
      if (retry.status !== 'withdrawn') throw new Error('Revoca non registrata.');
      writeBrowserValue(marker(uid), 'withdrawn');
      setStatus(uid, 'withdrawn');
      return 'withdrawn';
    }
    if (saved === 'reaccepting') {
      // An explicit re-consent might have succeeded just before a crash.
      // Preserve the barrier; the user must complete the local step.
      setStatus(uid, 'reaccepting');
      return 'reaccepting';
    }
    if (saved !== null) removeBrowserValue(marker(uid));
    setStatus(uid, 'active');
    return 'active';
  } catch {
    setStatus(uid, saved === null ? 'error' : saved as HealthConsentStatus);
    return currentHealthConsentStatus(uid);
  }
}

export async function withdrawHealthConsent(user: User): Promise<void> {
  const uid = user.uid;
  writeBrowserValue(marker(uid), 'pending');
  setStatus(uid, 'pending');
  const server = await serverRequest(user, 'POST', { action: 'withdraw' });
  if (server.status !== 'withdrawn') throw new Error('Revoca non registrata dal server.');
  writeBrowserValue(marker(uid), 'withdrawn');
  setStatus(uid, 'withdrawn');
}

export async function reacceptHealthConsent(user: User, acceptance: {
  acceptedTerms: true; acceptedHealthData: true; privacyVersion: string; termsVersion: string;
}): Promise<string> {
  const uid = user.uid;
  const saved = readMarker(uid);
  if (saved !== 'withdrawn' && saved !== 'reaccepting') throw new Error('Revoca non confermata.');
  writeBrowserValue(marker(uid), 'reaccepting');
  setStatus(uid, 'reaccepting');
  const result = await serverRequest(user, 'POST', { action: 'reaccept', acceptance });
  if (result.status !== 'active' || typeof result.acceptedAt !== 'string') {
    throw new Error('Nuovo consenso non confermato dal server.');
  }
  verifiedReacceptance.set(uid, result.acceptedAt);
  return result.acceptedAt;
}

export function finishHealthConsentReacceptance(uid: string): void {
  if (readMarker(uid) !== 'reaccepting') throw new Error('Nessuna nuova accettazione in corso.');
  if (!verifiedReacceptance.has(uid)) throw new Error('Manca la conferma server del nuovo consenso.');
  removeBrowserValue(marker(uid));
  verifiedReacceptance.delete(uid);
  setStatus(uid, 'active');
}

export function refreshHealthConsentFromStorage(): void {
  notify();
}
