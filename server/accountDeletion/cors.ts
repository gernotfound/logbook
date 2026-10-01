import { RequestAuthError } from './httpAuth.js';

const DEFAULT_PUBLIC_APP_ORIGIN = 'https://thelogbook.web.app';

function parseConfiguredOrigin(
  name: 'PUBLIC_APP_ORIGIN' | 'PUBLIC_APP_LEGACY_ORIGIN',
  fallback?: string,
): string | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback ?? null;

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`${name} non valida.`);
  }

  if (url.protocol !== 'https:'
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== '' && url.pathname !== '/')) {
    throw new Error(`${name} deve essere un origin HTTPS esatto senza path, query o credenziali.`);
  }
  return url.origin;
}

export function allowedAccountDeletionOrigins(): ReadonlySet<string> {
  const primary = parseConfiguredOrigin('PUBLIC_APP_ORIGIN', DEFAULT_PUBLIC_APP_ORIGIN)!;
  const legacy = parseConfiguredOrigin('PUBLIC_APP_LEGACY_ORIGIN');
  return new Set(legacy ? [primary, legacy] : [primary]);
}

export function requireAccountDeletionOrigin(request: Request): string {
  const origin = request.headers.get('origin');
  if (!origin || !allowedAccountDeletionOrigins().has(origin)) {
    throw new RequestAuthError('Origin non autorizzata.', 403);
  }
  return origin;
}

export function accountDeletionCorsHeaders(origin: string | null, allowedHeaders: string): HeadersInit {
  if (!origin || !allowedAccountDeletionOrigins().has(origin)) return { vary: 'Origin' };
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': allowedHeaders,
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}
