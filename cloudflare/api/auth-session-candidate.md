# API private — Auth Gate, sessioni e OAuth Kinde candidati

**Quando leggere:** token e session issuer, route HTTP Kinde, trusted redirect, SameSite/CSRF, owner e proof-of-session.

**Non inferire:** la route candidata o un Worker privato distribuito non concedono fitness account pubblico.

**Autorità:** [indice API](README.md), [Ciclo account](../../.agents/rules/account-lifecycle.md), [Auth candidate](../../.agents/rules/account-kinde-candidate.md) e [quadro operativo](../../docs/operations/cloudflare-current-state.md).

## CF-03 private session gate candidate (not activated)

Migration `0003_auth_session_gate.sql` adds owner-scoped Auth principals and only
SHA-256 hashes of 32-byte random session/CSRF tokens. This schema is **new baseline,
not a migration of Firebase accounts**; the isolated D1 sandbox had only
`0001`/`0002` at the prior verified checkpoint. The new migration has not
been applied to a Cloudflare provider by this change.

`cloudflare/auth/session-gate.mjs` answers only
`POST https://auth-gate.internal/__internal/authorize` over an internal
service binding. The local-only Wrangler configs bind the D1 replica candidate
to this private Worker; neither config exposes the gate on workers.dev or a
custom route. The gate rejects any missing configuration, external route,
invalid/duplicated cookie, expired/revoked session, unverified or disabled
account, stale account epoch, missing/withdrawn consent and unmatched D1
fence. The second SQL fence inside protected reads and write batches also
requires the actual active subject and immutable revision-1 acceptance,
so removing the acceptance after the private gate cannot authorize a
ciphertext read, mutation, or historical receipt. Future reacceptance must
update both the gate and this SQL predicate together. It performs one primary SQL read joining session, principal and
consent, and validates a session-bound CSRF header on mutations. An
approximate Cloudflare rate-limit binding must approve before the D1 query,
otherwise no trusted claim is returned. Rate limiting is per-session and
per-location; global anonymous flood defense, password/email/Google antiabuse
and Free quota measurements remain CF-00/07 requirements.

**No account-creation, password verification, Google OAuth, email verification,
session issuance, token refresh, consent provisioning or key delivery exists
in this increment.** Only the future trusted Auth service may mint/revoke
sessions and synchronize `auth_epoch` with `sync_subjects.fence_epoch`.
Never seed a synthetic session in a deployed service or treat this gate's
unit tests as real authentication. `AUTH_GATE` remains unavailable to the
live frontend. No public Worker API has been deployed, no DNS/cutover has
been performed, and the Firebase runtime remains the active client path.
Production integration needs authenticated issuer, verified consent, logout
and session revocation/recovery, edge abuse controls and runtime tests.


## CF-03 trusted session issuance candidate (not a login endpoint)

`cloudflare/auth/session-issuer.mjs` is a private helper for the future
password/Google handler **after** it verifies credentials and verified-email
ownership. It does not authenticate the supplied UID and therefore **MUST
NEVER** be exposed as a public route or invoked from a user-provided UID.
A single conditional D1 `INSERT ... SELECT` requires an active,
email-verified principal and copies its current `auth_epoch` atomically;
zero affected rows, malformed D1 results and unknown write outcomes fail
closed without returning cookie headers. Auth epoch increments invalidate
already issued sessions in the separate private session gate.

An authenticated session uses a cryptographically random 32-byte opaque
token in a `__Host-logbook_session` cookie (`Secure; HttpOnly; SameSite=Lax;
Path=/`); its CSRF companion is also a random session-bound 32-byte token,
stored in a `__Host-logbook_csrf` host-only Secure/Lax cookie readable by
the same-origin PWA for `X-CSRF-Token`. D1 contains only SHA-256 token hashes.
The companion cookie survives reload and works across same-origin tabs,
without persisting the HttpOnly session token in JavaScript or IndexedDB.
Future logout and recovery must clear **both** cookies, preserve local
pending journal, and verify server revocation/epoch. The returned `setCookies`
are for the trusted Auth response only; never log, echo or cache them.

Issuance is possible before the first health consent, but the separate
`AUTH_GATE` still blocks every sync operation until the trusted consent
record is active. No code yet verifies actual password/Google credentials,
reissues login tokens, rotates sessions, provides first consent, or maps a
real signup result to `auth_principals`. The Node/SQLite tests are
synthetic and cannot validate provider CPU, OAuth or email delivery.

## CF-03 trusted OAuth candidate (not mounted)

`cloudflare/auth/kinde-oauth-flow.mjs` contains an isolated server-only
start/callback pair using Kinde Authorization Code + S256 PKCE. `POST /api/auth/kinde/start`
is **not currently routed**; the companion `GET /api/auth/kinde/callback`
is only a candidate callback path, not an allowed URL configured at Kinde.
The start request requires a same-origin `Origin` and an injected trusted
abuse limiter. D1 migration `0008_kinde_oauth_attempts.sql` stores only
a hash of the state, a browser-binding cookie hash, and short-lived
server-held verifier/nonce (10 minutes). Callback performs one atomic
`DELETE ... RETURNING` on the primary before any token exchange.
The browser cannot supply its own nonce, verifier, UID or redirect. Signed
verified email/ID+access token proof, owner provisioning and the existing
conditional D1 session issuer run in sequence. Access/ID tokens never reach
the browser or enter the D1 account tables.

The state is intentionally **not retryable** on token-provider timeout,
signature failure or ambiguous response. A crashed callback can leave a
short-lived unused principal/session, never an authorized response. Browser
binding is reused across concurrent tabs. The start handler prunes at most
16 expired attempts before each new state; independent low-traffic retention
and provider-side operational checks are still required before deployment. Perimeter rate limits, Kinde API
audience registration, PKCE with confidential client verified on the actual
tenant, provider credentials, live browser session/CSRF lifecycle, account
linking, multi-device, Safari and Free quotas remain **NO-GO**. Do not add
this module to `auth-proxy.mjs` or the published frontend until
the missing gates are satisfied. No provider/Production migration has been
applied here.


## CF-03 candidate HTTP bridge (not routed; branch increment)

`cloudflare/auth/kinde-http-worker.mjs` composes the already-tested
Kinde code+PKCE exchange with a same-origin HTTP boundary and the existing
D1 session/CSRF gate. This module has **no** published route or service
binding on `thelogbook-frontend`; do not enable it by deploying
the Static Assets Worker before the remaining release gates are met.

Candidate endpoints (same HTTPS origin as the PWA):
- `POST /api/auth/kinde/start` (navigation, no body; Origin and
  Fetch Metadata checked). Returns 303 to Kinde hosted login and sets a
  host-only HttpOnly browser-binding cookie.
- `GET /api/auth/kinde/callback` (Kinde browser redirect; state,
  browser cookie, signed tokens and verified email checked).
- `POST /api/auth/session` (same-origin, no body). Uses the
  **private** AUTH_GATE with the identity-only route and returns only the
  verified owner ID, current epoch, email verification and consent revision.
  Never exposes the D1 token hash or provider access/ID tokens.
- `POST /api/auth/logout` (same-origin, no body, session-bound
  X-CSRF-Token). Reuses the existing conditional D1 session revoker. It
  revokes **only one application session**, not the Kinde SSO session, and
  never erases the local vault/journal.

A mandatory AUTH_RATE_LIMITER binding applies a conservative
location-scoped start/callback cap with server-generated fixed keys
(no untrusted IP/header is treated as an identity). This is **not**
a provider-wide rate limit or a substitute for WAF/Turnstile,
request quotas and abuse measurements. Missing DB, AUTH_GATE, provider
configuration or rate binding fail closed. An isolated local-only
Wrangler config is at `cloudflare/auth/wrangler.kinde.local.jsonc`;
it contains placeholders, no live route and no Client Secret. Configure
real secret **only** in a separately authorized Workers deployment.

Tests in `cf03-kinde-http-worker.node.mjs` traverse signed
OIDC/PKCE -> stored D1 principal/session -> private gate -> session status
-> CSRF-protected logout, plus failures. This does not validate the
Kinde tenant, a deployed Worker, mobile Safari, or the production frontend
lifecycle. Before public mounting: register Kinde API Audience and authorize
the Back-end web application to request it; verify exact callback URL and
confidential client+PKCE, password≥15 including reset, email verification,
Google, account linking, Kinde SSO logout, session concurrency and revocation,
device vault, consent/erasure, provider CPU/Free and privacy.


