// API and OAuth redirects must reach their trusted HTTP handlers, never the
// offline app shell. Otherwise a controlled PWA could swallow a signed code
// callback or turn a backend failure into a false successful page load.
export const AUTH_HTTP_NAVIGATION_DENYLIST = /^\/(?:api\/auth|v1)(?:\/|$)/;
