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


const CSRF_COOKIE = '__Host-logbook_csrf';
const CSRF_TOKEN = /^[A-Za-z0-9_-]{43}$/;

function csrfCookie(cookies) {
  if (typeof cookies !== 'string' || cookies.length > 4096) return null;
  const tokens = cookies.split(';').map(part => part.trim())
    .filter(part => part.startsWith(CSRF_COOKIE + '='));
  if (tokens.length !== 1) return null;
  const token = tokens[0].slice(CSRF_COOKIE.length + 1);
  if (!CSRF_TOKEN.test(token)) return null;
  try {
    const bytes = atob(token.replaceAll('-', '+').replaceAll('_', '/') + '=');
    return bytes.length === 32
      && btoa(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') === token
      ? token : null;
  } catch {
    return null;
  }
}

/**
 * This revokes only the D1 application session, not Kinde SSO or device data.
 * A server 200 is ambiguous until a fresh canonical 401 proves signed-out.
 */
export async function revokeKindeDiagnosticSession(send = fetch, browserCookies = () => document.cookie) {
  let csrf;
  try { csrf = csrfCookie(browserCookies()); }
  catch { return 'unavailable'; }
  if (!csrf) return 'unavailable';
  try {
    const response = await send('/api/auth/logout', {
      method: 'POST', credentials: 'same-origin', mode: 'same-origin',
      cache: 'no-store', redirect: 'error',
      headers: { Accept: 'application/json', 'X-CSRF-Token': csrf },
      signal: AbortSignal.timeout(5000),
    });
    if (response.status !== 200 || response.redirected
      || ['opaque', 'opaqueredirect', 'error'].includes(response.type)
      || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
      return 'unavailable';
    }
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length)
      || Number(length) > MAX_RESPONSE_CHARS)) return 'unavailable';
    const body = await response.text();
    if (body.length > MAX_RESPONSE_CHARS) return 'unavailable';
    const data = JSON.parse(body);
    if (data === null || typeof data !== 'object' || Array.isArray(data)
      || Object.keys(data).join(',') !== 'status' || data.status !== 'signed-out') {
      return 'unavailable';
    }
    return await probeKindeSession(send) === 'signed-out' ? 'signed-out' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

if (typeof document !== 'undefined') {
  const check = document.getElementById('check-session');
  const result = document.getElementById('session-result');
  const logout = document.getElementById('end-session');
  if (check instanceof HTMLButtonElement && result instanceof HTMLElement
    && logout instanceof HTMLButtonElement) {
    let busy = false;
    const controls = (disabled, verified) => {
      check.disabled = disabled;
      logout.disabled = disabled;
      logout.hidden = !verified;
    };
    const verify = async () => {
      if (busy) return;
      busy = true;
      controls(true, false);
      result.textContent = 'Verifica della sessione in corso…';
      try {
        const state = await probeKindeSession();
        const messages = {
          verified: 'Sessione Kinde verificata. Le funzioni fitness dell’account restano disabilitate fino al collaudo completo.',
          'signed-out': 'Nessuna sessione applicativa TheLogBook attiva in questo browser.',
          unavailable: 'Impossibile confermare la sessione. Nessun accesso ai dati è stato autorizzato.',
        };
        result.textContent = messages[state];
        controls(false, state === 'verified');
      } finally {
        busy = false;
        check.disabled = false;
      }
    };
    const end = async () => {
      if (busy || logout.hidden) return;
      busy = true;
      controls(true, false);
      result.textContent = 'Chiusura della sessione in corso…';
      try {
        const state = await revokeKindeDiagnosticSession();
        result.textContent = state === 'signed-out'
          ? 'Sessione applicativa chiusa e verificata. La sessione SSO Kinde potrebbe essere ancora attiva.'
          : 'Disconnessione non confermata. Nessun dato locale è stato cancellato. Verifica nuovamente la sessione.';
      } finally {
        busy = false;
        check.disabled = false;
      }
    };
    check.addEventListener('click', () => { void verify(); });
    logout.addEventListener('click', () => { void end(); });
    // The diagnostic reads server status when opened directly.
    void verify();
  }
}
