import { routeCandidateFirstPartyApi } from './first-party-api-candidate.mjs';

// TheLogBook's public edge exposes only explicitly reviewed Kinde OAuth
// and session endpoints. Removed Firebase Hosting's /__/auth/* helper proxy:
// no request, redirect or fallback may reach the retired external provider.
const KINDE_AUTH_ROUTES = new Set([
  '/api/auth/kinde/start',
  '/api/auth/kinde/callback',
  '/api/auth/session',
  '/api/auth/logout',
]);

export default {
  async fetch(request, env) {
    let url;
    try { url = new URL(request.url); } catch { return new Response(null, {
      status: 404, headers: { 'Cache-Control': 'no-store' },
    }); }
    if (!KINDE_AUTH_ROUTES.has(url.pathname)) return new Response(null, {
      status: 404, headers: { 'Cache-Control': 'no-store' },
    });
    return routeCandidateFirstPartyApi(request, {
      APP_ORIGIN: env?.APP_ORIGIN,
      KINDE_HTTP: env?.KINDE_HTTP,
    });
  },
};
