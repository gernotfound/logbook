import { readBrowserValueStrict, writeBrowserValue } from './sync/browserStorage';

export type HealthConsentRevocationStatus = 'none' | 'pending' | 'confirmed';
export const HEALTH_CONSENT_REVOCATION_EVENT = 'logbook:health-consent-revocation';

export function healthConsentRevocationKey(owner: string): string {
  if (owner !== 'guest' && !owner.startsWith('user:')) {
    throw new Error('Proprietario dei dati non valido.');
  }
  return 'logbook:v2:' + owner + ':health-consent-revocation-v1';
}

export function readHealthConsentRevocation(owner: string): HealthConsentRevocationStatus {
  const value = readBrowserValueStrict(healthConsentRevocationKey(owner));
  if (value === null) return 'none';
  if (value === 'pending' || value === 'confirmed') return value;
  // A corrupted security marker is not equivalent to the absence of revocation.
  throw new Error('Stato della revoca del consenso non leggibile.');
}

export function isHealthConsentWriteBlocked(owner: string): boolean {
  try {
    return readHealthConsentRevocation(owner) !== 'none';
  } catch {
    return true;
  }
}

export function assertHealthConsentWritable(owner: string): void {
  if (isHealthConsentWriteBlocked(owner)) {
    throw new Error('Consenso ai dati salute revocato o in verifica: modifiche sospese.');
  }
}

export function markHealthConsentRevocation(owner: string, status: Exclude<HealthConsentRevocationStatus, 'none'>): void {
  const key = healthConsentRevocationKey(owner);
  // A confirmed, server-authoritative revocation can repair a malformed local
  // marker. Pending requests must never silently overwrite corrupted evidence.
  const current = readBrowserValueStrict(key);
  if (current === 'confirmed') return;
  if (current !== null && current !== 'pending' && status !== 'confirmed') {
    throw new Error('Stato locale della revoca corrotto: attesa conferma server.');
  }
  writeBrowserValue(key, status);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(HEALTH_CONSENT_REVOCATION_EVENT));
}
