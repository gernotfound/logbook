// Shared with the legacy HTTP adapter so the consent policy can be imported
// without instantiating Firebase or App Check in the guest shell.
export type ServerStatus = {
  status: 'unregistered' | 'active' | 'withdrawn';
  revision: number;
  acceptedAt?: string;
  privacyVersion?: string;
  termsVersion?: string;
  erasedBeforeRevision?: number;
};

export class ConsentTransportUnavailableError extends Error {
  constructor() { super('Connessione al servizio consensi non disponibile.'); }
}

export function isRetryableConsentTransportError(error: unknown): boolean {
  if (error instanceof ConsentTransportUnavailableError) return true;
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; retryable?: unknown };
  // Credential acquisition may fail before fetch, without proving withdrawal.
  if (candidate.code === 'auth/network-request-failed') return true;
  return candidate.retryable === true
    && (candidate.code === 'app-check-unavailable'
      || candidate.code === 'app-check-limited-use-unavailable');
}
