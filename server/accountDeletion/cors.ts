import { RequestAuthError } from './httpAuth.js';

const DEFAULT_PUBLIC_APP_ORIGIN = 'https://thelogbook.web.app';

type AppOriginEnv = 'PUBLIC_APP_ORIGIN' | 'PUBLIC_CANDIDATE_APP_ORIGIN';

function parseConfiguredOrigin(name: AppOriginEnv, fallback?: string): string | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback ?? null;

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(name + ' non valida.');
  }

  if (url.protocol !== 'https:'
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== '' && url.pathname !== '/')) {
    throw new Error(name + ' deve essere un origin HTTPS esatto senza path, query o credenziali.');
  }
  return url.origin;
}

function allowedAccountDeletionOrigins(): ReadonlySet<string> {
  const primary = parseConfiguredOrigin('PUBLIC_APP_ORIGIN', DEFAULT_PUBLIC_APP_ORIGIN)!;
  // Only a deliberately provisioned, exact second origin is allowed during
  // candidate testing; removing the environment variable restores single-origin CORS.
  const candidate = parseConfiguredOrigin('PUBLIC_CANDIDATE_APP_ORIGIN');
  return new Set(candidate ? [primary, candidate] : [primary]);
}

export function requireAccountDeletionOrigin(request: Request): string {
  const origin = request.headers.get('origin');
  if (!origin || !allowedAccountDeletionOrigins().has(origin)) {
    throw new RequestAuthError('Origin non autorizzata.', 403);
  }
  return origin;
}

export function accountDeletionCorsHeaders(origin: string | null, allowedHeaders: string): Record<string, string> {
  let allowed = false;
  try {
    allowed = origin !== null && allowedAccountDeletionOrigins().has(origin);
  } catch {
    // An invalid deployment origin must never make the error handler throw again.
    // The request origin guard has already failed; emit no CORS authorization.
    return { vary: 'Origin' };
  }
  if (!origin || !allowed) return { vary: 'Origin' };
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': allowedHeaders,
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}
