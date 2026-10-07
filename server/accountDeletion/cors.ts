import { RequestAuthError } from './httpAuth.js';

const DEFAULT_PUBLIC_APP_ORIGIN = 'https://thelogbook.web.app';

function parseConfiguredOrigin(fallback?: string): string | null {
  const raw = process.env.PUBLIC_APP_ORIGIN;
  if (raw === undefined || raw.trim() === '') return fallback ?? null;

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('PUBLIC_APP_ORIGIN non valida.');
  }

  if (url.protocol !== 'https:'
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== '' && url.pathname !== '/')) {
    throw new Error('PUBLIC_APP_ORIGIN deve essere un origin HTTPS esatto senza path, query o credenziali.');
  }
  return url.origin;
}

function allowedAccountDeletionOrigins(): ReadonlySet<string> {
  return new Set([parseConfiguredOrigin(DEFAULT_PUBLIC_APP_ORIGIN)!]);
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
