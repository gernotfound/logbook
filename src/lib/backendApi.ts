// Public client configuration for the trusted Vercel backend.
// Keep the fallback for existing installations built without the optional env.
export const BACKEND_API_ORIGIN = (
  import.meta.env.VITE_ACCOUNT_DELETION_API_ORIGIN || 'https://logbook-gnf.vercel.app'
).replace(/\/$/, '');
