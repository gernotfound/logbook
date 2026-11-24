const UID_CONTEXT = 'thelogbook:kinde-owner:v1\0';
const SUBJECT = /^kp[_:][A-Za-z0-9_:-]{1,125}$/;

/** @param {unknown} value */
export function validKindeSubject(value) {
  return typeof value === 'string' && SUBJECT.test(value);
}

/** @param {unknown} value */
export function validKindeIssuer(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && value === url.origin && !url.port;
  } catch { return false; }
}

/** @param {string} issuer @param {string} subject */
export async function deriveKindeOwnerId(issuer, subject) {
  if (!validKindeIssuer(issuer) || !validKindeSubject(subject)) {
    throw new Error('invalid-kinde-owner-input');
  }
  const bytes = new TextEncoder().encode(UID_CONTEXT + issuer + '\0' + subject);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return 'k_' + btoa(String.fromCharCode(...digest))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
