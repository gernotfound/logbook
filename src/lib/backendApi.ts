// Public client configuration for the trusted Vercel backend.
// A missing origin must not silently route authenticated requests to a default host.
export const BACKEND_API_ORIGIN = (
  import.meta.env.VITE_ACCOUNT_DELETION_API_ORIGIN || ''
).trim().replace(/\/$/, '');

export function trustedBackendUrl(path: `/api/${string}`): string {
  if (!BACKEND_API_ORIGIN) throw new Error('Backend trusted non configurato.');
  return BACKEND_API_ORIGIN + path;
}
