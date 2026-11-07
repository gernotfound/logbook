// Public client configuration for the trusted Vercel backend.
// An invalid origin must fail closed before any caller sends authenticated data.
function validatedBackendOrigin(configured: string): string {
  const value = configured.trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    const loopback = url.hostname === 'localhost'
      || url.hostname === '127.0.0.1'
      || url.hostname === '[::1]';
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      return '';
    }
    return url.origin;
  } catch {
    return '';
  }
}

export const BACKEND_API_ORIGIN = validatedBackendOrigin(
  import.meta.env.VITE_ACCOUNT_DELETION_API_ORIGIN || '',
);

export function trustedBackendUrl(path: `/api/${string}`): string {
  if (!BACKEND_API_ORIGIN) throw new Error('Backend trusted non configurato.');
  return BACKEND_API_ORIGIN + path;
}
