const SESSION_PATH = '/api/auth/session';
const UID = /^k_[A-Za-z0-9_-]{43}$/;
const MAX_RESPONSE_CHARS = 512;

function knownIdentity(data) {
  return data !== null && typeof data === 'object' && !Array.isArray(data)
    && Object.keys(data).sort().join(',') === 'authenticated,emailVerified,fenceEpoch,healthConsentRevision,uid'
    && data.authenticated === true && data.emailVerified === true
    && typeof data.uid === 'string' && UID.test(data.uid)
    && Number.isSafeInteger(data.fenceEpoch) && data.fenceEpoch >= 1
    && Number.isSafeInteger(data.healthConsentRevision) && data.healthConsentRevision >= 0;
}

/**
 * Diagnostic only: never turn a Kinde session into a fitness/consent grant.
 * The UI deliberately reports no UID, cookies, tokens or personal information.
 */
export async function probeKindeSession(send = fetch) {
  try {
    const response = await send(SESSION_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      mode: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (response.redirected || ['opaque', 'opaqueredirect', 'error'].includes(response.type)
      || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
      return 'unavailable';
    }
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_CHARS)) {
      return 'unavailable';
    }
    const body = await response.text();
    if (body.length > MAX_RESPONSE_CHARS) return 'unavailable';
    const data = JSON.parse(body);
    if (response.status === 401
      && data !== null && typeof data === 'object' && !Array.isArray(data)
      && Object.keys(data).join(',') === 'error' && data.error === 'unauthorized') {
      return 'signed-out';
    }
    if (response.status === 200 && knownIdentity(data)) return 'verified';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

if (typeof document !== 'undefined') {
  const check = document.getElementById('check-session');
  const result = document.getElementById('session-result');
  if (check instanceof HTMLButtonElement && result instanceof HTMLElement) {
    const verify = async () => {
      if (check.disabled) return;
      check.disabled = true;
      result.textContent = 'Verifica della sessione in corso…';
      try {
        const state = await probeKindeSession();
        const message = {
          verified: 'Sessione Kinde verificata. La PWA e i dati salute rimangono disabilitati per questo account.',
          'signed-out': 'Nessuna sessione Kinde attiva in questo browser.',
          unavailable: 'Impossibile confermare la sessione. Nessun accesso ai dati è stato autorizzato.',
        };
        result.textContent = message[state];
      } finally {
        check.disabled = false;
      }
    };
    check.addEventListener('click', () => { void verify(); });
    // This document is also the OAuth callback's success destination.
    // A same-origin status read, not a redirect or token in the URL, proves login.
    void verify();
  }
}
