# CF-01/02 — isolated encrypted D1 replica candidate

This is a candidate API, **not an enabled production route**. The existing
Firebase/Firestore writer, IndexedDB journal and encrypted vault remain active.

- Schema: migrations/0001_encrypted_replica.sql through
  migrations/0007_cloud_key_custody.sql; only 0001/0002 have remote
  synthetic D1 readback evidence. Local-only rollback is **destructive,
  disposable-only** rollback in rollback/ (never apply it to user data).
- Local-only Wrangler configuration: wrangler.local.jsonc; placeholder database
  ID, workers.dev and preview URLs disabled, no domain route or public fixture.
  Do NOT replace the local placeholder with a remote database ID.
- Provider verification 2026-11-13: isolated **EU-jurisdiction** D1 resource
  `thelogbook-cf02-eu-isolated-20261113` (UUID
  `9aa51833-8adc-495f-bdfc-93b5542e8023`) was provisioned without
  connecting a Worker/domain. Migration 0001 was accepted (6 tables,
  5 triggers). Synthetic CAS and consent-regression requests were rejected,
  and a late failed statement rolled back an earlier receipt insert. This
  proves SQL behavior on remote D1, NOT HTTP Worker/Auth, quota or runtime.
- The database contains ciphertext envelopes and public causal metadata only.
  Root and monthly paths retain the existing cloud cipher v1 / Sync Protocol 3.
- Account identity, consent and epoch remain provisioned only by a separate
  trusted service. An isolated Auth/CSRF-gated replica membership API now
  handles slot registration, checkpoint and expired-lease retirement; it must
  not be used until real Auth and full-scan adoption are integrated.
- AUTH_GATE must be a **private service binding** that verifies an actual
  session, verified email, health consent, rate gate before D1, and session-bound CSRF for writes.
  It returns uid, fenceEpoch, healthConsentRevision and csrfVerified. No
  caller-supplied UID or static header is accepted as an identity.
- API_ORIGIN must be an exact HTTPS origin. When missing, requests fail closed.
  Origin, session, consent, account fence, replica lease and D1 CAS are distinct
  checks. No CORS wildcard or public debug endpoint is provided.
- POST /v1/sync/control reads the authenticated Protocol 3 replica registry,
  consent, account epoch and revision in one D1 batch. The client rejects
  invalid actors/checkpoint clocks and derives the stable frontier only from
  active replicas. POST /v1/sync/replica/claim and /v1/sync/replica/retire now change membership
  only after private Auth/CSRF, expected account revision/consent/epoch and
  lease/generation checks. The first SQL statement stores a digest-bound
  mutation event whose trigger fences the entire atomic D1 batch. A lost
  response can be matched to the original immutable mutation, even after
  a later global revision or slot reuse (within the same active account epoch).
  The response includes currentRevision and reconciliationRequired. An old
  receipt proves historical commit but NEVER authorizes local adoption:
  client claim/retire throws a typed reconciliation-required error. A claim
  needs a fresh AEAD-verified full scan before adoption; retirement remains
  pending until the register can be reconciled without inventing an ACK.
- Candidate encrypted claim workflow: `cloudReplicaClaimRecovery.ts` writes an
  immutable claim mutationId/body to the owner-vault IndexedDB before sending
  it; the next session replays the exact same request. Only an authenticated
  matching request-bound receipt followed by a fresh complete ADK-open scan,
  the original unchanged checkpoint clock, the exact still-active replica
  membership (including sequence/lease and checkpoint clock), and two stable control reads can
  authorize an atomic `adoptReplicaCheckpoint()` that removes the stored
  intent. A historical receipt after an unrelated control revision can pass
  ONLY these same tests; changed cloud documents, retired/reused slots, lease
  or consent mismatch preserve the intent and journal. No business ACK is
  inferred from a claim receipt. On HTTP 409 with NO original receipt, the
  read-only POST /v1/sync/replica/status executes a SINGLE primary D1 SELECT
  joining the account revision and the mutation ledger under trusted
  Auth/consent/epoch/CSRF. Only `not-committed` after revision advance
  proves the original CAS can never commit. The client then performs a new
  complete ADK-open scan and two identical control reads, replacing the
  original intent with a NEW mutationId and checkpoint clock in the SAME
  encrypted IndexedDB record while preserving the business journal.
  It returns `retry-staged`: this is NOT a remotely committed claim;
  another guarded resume sends the new immutable request. `committed`,
  `inconclusive`, stale/corrupt scans or races preserve the old intent.
  When a proven committed historical claim still has its exact active
  incarnation/lease/sequence and a complete ADK-authenticated scan finds
  only an advanced cloud causal clock, two matching control reads allow a
  NEW mutationId/revision/clock to replace the original encrypted request
  atomically in IndexedDB. It returns `retry-staged`, not a grant, and the
  next resume sends that immutable request. A missing, retired, expired or
  reused incarnation, altered server checkpoint/lease/sequence, unstable
  control, forged AEAD or changed session cannot take this path. Those
  broader historical cases, real Auth wiring and HTTP provider proof remain
  TODO.
- Candidate durable retirement workflow: `cloudReplicaRetirementRecovery.ts`
  writes an immutable expired-lease target/mutationId into the same
  owner-encrypted vault before sending anything. `replayStoredRetirement()`
  reuses those bytes after a lost reply. A fresh matching retired register
  (checked twice) removes only the intent in one IndexedDB transaction; it
  does NOT ACK business operations or prove a stable frontier. A historical,
  request-bound receipt may be reconciled after unrelated account revisions
  only if two fresh identical control reads still show the exact target
  incarnation retired under the same consent/epoch, with its receipt's
  membership metadata. A historically committed retirement may also close
  as `superseded` when two identical controls prove a strictly newer generation
  with a different ID in the same slot. This only clears the retired intent:
  no business ACK, grant or causal GC. Same-generation replacements, changed
  consent, unstable controls and torn intents still fail closed.
  Claim, retirement and document delivery intents are mutually exclusive.
  After HTTP 409 with no receipt, the same strict primary-SQL status endpoint
  also accepts the original retirement body. Only `not-committed` after a
  strictly advanced revision allows a new retirement request. It requires the
  SAME still-active slot/replicaId/generation with elapsed lease and 5-minute
  skew, plus two stable control reads under unchanged consent/epoch. The new
  mutationId/revision replaces the encrypted intent in one IndexedDB update,
  preserving the business journal: `retry-staged` is NOT an ACK or successful
  retirement. Renewed leases, already-retired or reused slots, altered
  session/consent, and any unproven outcome preserve the original. Retirement
  of the device's own local writer is forbidden to avoid silently stranding
  unsent journal operations. Runtime integration and remediation of a
  historically committed claim that cannot be safely adopted remains TODO; this
  is not a working end-to-end logout/erasure path.
- POST /v1/sync/read reads up to eight ciphertext envelopes under one D1
  snapshot; POST /v1/sync/scan reads a bounded page with a revision-fenced
  cursor for a complete account checkpoint. Reads/scans carry an explicit
  consent revision to prevent cross-consent hydration or merge. SQL triggers
  reject revision and replica sequence regressions. POST /v1/sync/commit atomically
  advances a guarded replica, up to eight documents and a receipt;
  POST /v1/sync/receipt retrieves the content-bound receipt.
- POST /v1/sync/commit/status is a **candidate-only** small-body, CSRF-gated
  primary SQL read. The SAME SELECT checks account revision and the original
  batch receipt under the current session/owner/consent/fence. Absence of a
  receipt at the expected revision is `inconclusive`; only a later revision
  without that batch is `not-committed`. An existing digest-bound receipt
  yields `committed` (historical status), but status NEVER authorizes journal
  ACK: the client must still validate the exact `/receipt` before local
  acknowledgement. The candidate can restage only a proven uncommitted batch
  after a complete AEAD scan, two stable control reads and one atomic local
  intent replacement, but it is NOT wired to the active PWA.
- The client must verify AEAD and perform Protocol 3 merge **before** commit.
  The shared `cloudMergeEngine.ts` powers both Firestore writes and the D1
  candidate (`cloudReplicaCommit.ts`); each D1 write binds
  `expectedFenceEpoch` and health consent generation from the same authenticated
  document/control snapshot. Stable frontier and lastSeq are derived from the
  validated server replica register, not arbitrary caller parameters. A replica
  checkpoint is computed from a complete AEAD-verified scan; the server also
  compares the submitted clock with JSON1 aggregation of public `_sync.clock`
  metadata, **not** with encrypted private health/candidate fields. This does
  not prove the client actually decrypted every document. Local replica
  adoption and the D1 journal ACK are not wired into the **application runtime**;
  the isolated candidate stages and acknowledges only in tests.
  The isolated client candidate stores the **exact ciphertext, nonce, batch ID
  and delivered causal prefix** into the owner-encrypted IndexedDB envelope
  before any D1 commit. On a lost response, it replays these same bytes and
  acknowledges only a content-bound receipt. The receipt and journal prefix
  are reconciled in the very same IndexedDB transaction; unrelated concurrent
  local edits remain pending. The active Firestore journal is unchanged.
  Public writer/HTTP replica objects contain only slot, replicaId and
  generation; never spread local lease/checkpoint timestamps into strict Zod
  or AEAD metadata. No real Auth/ADK or D1 cloud activation is wired yet.
  A rejected/stale CAS requires a fresh read and merge. Receipt replay requires
  the same immutable sealed bytes, batch ID and SHA-256 receipt digest; it never
  infers success from a timeout. Full checkpoint, account-key transport and consent/erasure flows
  remain CF-03/04/05/06 responsibilities.
- The global Protocol 3 `_sync.writer.seq` is the batch's last sequence;
  a particular document's `_sync.clock[writer.slot]` can legitimately be
  lower. Require a positive actor dot **at most equal to writer.seq**, never inflate clocks to pass validation.
  The API allows up to eight 950 KB ciphertext envelopes per request plus
  bounded JSON overhead; this does NOT establish that an 8-envelope canonical
  hash/parse fits the Workers Free **10 ms CPU** limit. Benchmark on real
  provider Free and design bounded recovery before release.
- Migration 0002 fences reused replica identities against the immutable
  mutation ledger even after their original slot is replaced. The existing
  EU-jurisdiction D1 sandbox now has the index and trigger from 0002 verified
  by provider schema readback (13/11/2026). The resource remains disconnected
  from the published static-asset Worker; this does not prove remote HTTP
  enforcement or activate the API.
- The SQL subject fence prevents consent/epoch rollback, same-generation
  reactivation and revival of a deleted UID. It does not itself erase data,
  prove backup anti-resurrection, or implement CF-05/06.
- This SQL adapter models document writes and fencing, **not** the entire
  Firestore Rules contract yet. It must not become the application's default
  until complete differential tests and real Auth integration are validated.

For disposable local D1 only, Wrangler can apply the versioned migration with
its local database command. The node:test suite uses a transactional SQLite
adapter and is not evidence of remote D1 performance, IAM or quota.

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

## CF-05 — candidate first-consent boundary (not deployed)

`cloudflare/api/consent-worker.mjs` accepts identity-only requests
`POST /v1/consent/status`, `POST /v1/consent/initial` and
`POST /v1/consent/withdraw`.
These are candidate HTTP routes not bound to the public frontend or domain.
The private `AUTH_GATE` accepts the two routes only with a valid, non-revoked
host-only session. The first-accept mutation additionally requires session
CSRF, verified email, exact legal versions and three explicit booleans
(`acceptedHealthData`, `acceptedTerms`, `confirmsOver18`). The first two
reuse the active UI acceptance contract; age confirmation is an additional
explicit requirement. The server uses its own clock. With no existing
consent the status is `unregistered` with `revision: 0`, not implicit
acceptance. Responses preserve the client fields `revision`, ISO
`acceptedAt`, `privacyVersion` and `termsVersion`, with `fenceEpoch` for
the new session boundary.

Migration `0004_initial_consent.sql` stores the immutable first acceptance
receipt and joins it to `sync_subjects` and `sync_state` in a single D1
batch. The initial insert revalidates the still-live auth session and account
epoch **within the SQL transaction** so a revocation between the AuthGate
and writer cannot silently authorize processing. A late failure rolls back
the entire grant; the caller must reread status after a lost response, not
invent an ACK or create a new owner. The sync gate now requires the actual immutable acceptance, exactly the
first revision, **and the current server-configured legal versions** before
accepting cloud writes. An older accepted document remains available as a
status read, but does not authorize sync until an explicit current consent
flow is implemented. Both status reads and writes recheck that the original hashed session
is still active in D1, including expiry and revocation after the private
gate has returned. The status read also denies an active revision other than
1; the immutable first receipt cannot be relabelled as a later consent.
Future reacceptance (revisions 2+) needs separate proofs and an
explicit gate extension; it cannot reuse revision-1 consent as authorization.

`cloudflare/api/wrangler.local.jsonc` is the unified local-only API
configuration. Its placeholder legal versions must match
`src/lib/legalVersions.ts` before any future deployment. The separate
consent config was removed in PR #1081. Missing or inconsistent provider
configuration denies acceptance.

Migration `0005_health_withdrawal_queue.sql` introduces a durable, owner-
and revision-scoped `health_erasure_jobs` record. The strictly validated
withdrawal intent `{ action: "withdraw", expectedRevision: 1,
confirmsErasure: true }` requires the private current Auth session and
CSRF but does not require the email to remain verified. A single conditional
SQL INSERT rechecks the current session, account status and immutable first
consent proof. Its AFTER INSERT trigger flips `sync_subjects.status`
to `withdrawn` in the same statement, rejecting a mismatched generation
rather than retaining a job with a writable subject. A replay or lost ACK
returns `{ status: "withdrawn", revision: 1, fenceEpoch, deletionStatus:
"pending" }` only when primary D1 confirms the user's still-valid session,
withdrawn grant and pending job. Auth epoch advances may not hide the
right to withdraw; the old consent fence is preserved as job metadata.
No request may claim erasure `complete`: the runner, rights-only export,
ADK retirement and final receipt **are not implemented**. Missing migration,
unavailable DB or an ambiguous readback fail closed.

**Incomplete and release NO-GO**: full Auth credential verifier, email/Google,
full erasure finalizer/receipt and rights-only export, reacceptance,
legal-change handling, keys/ADK, account deletion, real HTTP Cloudflare
measurement, frontend consent UI wiring and provider deployment. Existing Firebase
accounts and health data are NOT transferred. No live schema, route or DNS
is modified by the candidate. The fixture tests run Node SQLite and fake
service binding; they do not prove D1 runtime behavior.


## CF-05 — candidate ADK/KEK custody in Workers/D1 (not deployed)

- `migrations/0007_cloud_key_custody.sql` adds `cloud_account_keys` and a
  **per-owner, per-consent** immutable issuance record. The issuance trigger
  runs within the same D1 transaction as the first key insert; missing wrapped
  bytes after issuance can never be silently re-provisioned for that generation.
- `cloud-key-crypto.mjs` uses Workers WebCrypto AES-256-GCM to wrap only a
  **random 32-byte account ADK**, with a random 12-byte IV, owner/version AAD,
  canonical base64 fields and authenticated 16-byte tag. The KEK binding is
  `CLOUD_ACCOUNT_KEK_V1`, a separate Workers secret that has NOT been created.
  The old Vercel secret value is not imported into Cloudflare.
- `cloud-key-store.mjs` is an internal boundary, **not a user-facing key API**.
  Its caller must obtain trusted claims from private AuthGate with verified
  email, CSRF and rate admission. A D1 primary SQL statement rechecks current
  auth session, consent version, epoch, owner and erasure status for reads and
  first-key conditional insert. On lost write replies or competing provisioners,
  the store re-reads and unwraps only the persisted winner. The session is
  checked again after asynchronous decrypt. A rights-export may read an
  existing ADK after withdrawal for the matching erasure generation; it NEVER
  provisions a new ADK.
- SQL blocks blind key overwrites and key deletion unless the account is
  withdrawn and an erasure worker holds an active `awaiting-keys` lease.
  The issuance marker survives erasure for anti-rekey; separate completed-job
  and selective-restore fences remain open.
- `tests/cloudflare/cf05-cloud-key-custody.node.mjs` exercises the actual
  WebCrypto codec, D1/SQLite triggers, private AuthGate, lost response,
  concurrent issuance, wrong KEK/AAD, missing key, revocation and rights-only.
  None of these tests proves real Worker binding, Kinde login or KEK recovery.
  This increment does NOT deploy an API Worker or initialize a live KEK.

## CF-06 — bounded erasure progress candidate (not deployed)

Migration `0006_health_erasure_progress.sql` adds a durable lease epoch, a
cryptographically random 32-byte internal lease token, expiry, and a
`data → awaiting-keys` phase to `health_erasure_jobs`. Schema triggers
prevent premature `complete`, lease regression, cross-owner reparenting,
early reacceptance and direct SQL writes to withdrawn documents/replicas.
The first consent acceptance and owner tombstone remain durable.

`cloudflare/jobs/health-erasure-worker.mjs` implements a **private
`scheduled` handler only**, with no public fetch, cron configuration or
provider deployment. One invocation leases at most one eligible withdrawn
owner and deletes no more than **four rows from one table**. The fixed,
server-side table order is encrypted documents, commit receipts, replica
mutation history and replica membership. Each SQL DELETE rechecks the
still-valid lease, withdrawn consent revision and epoch within that same
statement. An expired or stolen lease cannot continue; SQL/DB failures
throw without producing completion. After every known table is proven
empty in one conditional UPDATE, the job moves to `awaiting-keys`,
remaining `processing`, **not** `complete`. That phase is excluded from
the runnable scan to avoid starvation of younger jobs.

Reissuing `POST /v1/consent/withdraw` while a job is processing returns
only an owner/session-verified `deletionStatus: "processing"` (rather
than a false `pending`). A lost response to a DELETE is reconciled by
a future bounded scan after lease expiry, never by an invented ACK.
SQLite fixture tests cover concurrent leases, lost response, takeover
before DELETE, owner isolation, bounded batches, no resurrection,
rollbacks and prevention of premature completion. This does **not**
constitute provider Free-tier CPU/limits evidence.

**Key boundary:** The ADK/KEK custodian, rights-only export, encrypted
key record, final erasure of remaining account metadata, complete receipt
and reacceptance after erasure are still missing. In particular,
`awaiting-keys` means *the known replica tables were drained*, **not**
that the owner's health data, keys or backups have been fully deleted.
Never expose this worker through a route or schedule it on a real database
until those steps and their recovery tests are complete.

## One candidate API and trusted per-session logout (CF-03)

`wrangler.local.jsonc` is the single local-only API configuration. Its
`worker.mjs` entrypoint now dispatches encrypted sync, initial consent and
`POST /v1/auth/logout`. The redundant local CF-05 configuration was removed.
The config uses only placeholder D1, private AUTH_GATE, exact HTTPS origin and
legal-version values; no public Worker, route or provider migration is implied.

Logout requires the existing private session proof, session-bound CSRF,
same-origin POST and an empty body. A conditional D1 write revokes only
that session's hashed token at the current account epoch. Ambiguous write
outcomes require a primary read of that exact revoked token before returning
`signed-out` and expiring both host-only cookies. A failure never returns
false success or deletes another session. Logout also works before verified
email/initial consent; it does not grant fitness access.

This endpoint **does not** discard local ciphertext/journal, revoke other
devices, erase health data or close the account. A retry using an already
revoked cookie receives 401: the UI must never infer the previous call
succeeded without an authoritative response. The real frontend, credentials
verifier, account rights and provider runtime are still disconnected.


## Review: recheck the actual session at D1 transaction time

The internal `AUTH_GATE` now includes the SHA-256 digest of the current
opaque session in its **private** claims for sync routes as well as
identity-only routes. Neither the client nor its JSON body can supply this
value. Both ciphertext commits and replica membership mutations use
`cloudflare/auth/session-write-fence.mjs` inside the **first SQL INSERT**
of their atomic D1 batch: a revoked/expired session, changed account epoch,
disabled/unverified principal or mismatched owner forces the existing
`request_hash` CHECK to abort the complete batch. It cannot create
a document, receipt or new replica grant after a logout that committed
before this SQL statement. The original 0001..0004 schemas are unchanged.

**Read-side follow-up on this branch:** snapshot, paginated scan, replica
control, historical receipts/status, checkpoint-clock validation and error
reconciliation now require the same live session hash in their authorizing
SQL query. Protected reads use `withSession('first-primary')`; multiple
SELECTs are batched in a single D1 transaction so no unauthenticated page
can escape after an earlier authorization query. A revoked/expired/foreign
token or a changed account epoch yields no business result or ACK. The
session hash never appears in the HTTP request body, response or log.

A revocation that commits **before the relevant D1 transaction** blocks
the next protected read or write. This is not an absolute guarantee that
an already-running response can be recalled if logout occurs *after* that
transaction's snapshot, or that committed receipts should be discarded.
Consent withdrawal/erasure, global logout and account deletion still need
their own transactional protocol. Tests here run against synthetic
SQLite, not the deployed Workers/D1 runtime; CPU, quotas, mobile recovery
and the actual frontend flow remain release blockers.

## Target Kinde identity proof (not yet an API route)

`cloudflare/auth/kinde-token-verifier.mjs` validates signed user access tokens for the configured API. `cloudflare/auth/kinde-login-proof.mjs` additionally verifies the signed ID token, verified email, server-owned OAuth nonce and matching subject before any future trusted session issuance. Kinde uses separate token audiences; pin each per environment after live tenant observation. Neither helper implements OAuth state/PKCE, user provisioning, session creation, or an authenticated route, and neither is deployed. Never issue an app session based on an arbitrary client UID or self-reported email verification. The new Kinde identity flow must remain separate from the existing D1 consent/owner/session fences.


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


## CF-05 candidate HTTP key boundary (not publicly deployed)

The *same* candidate `cloudflare/api/worker.mjs` now dispatches two
exact HTTPS same-origin POST routes with **empty request bodies**:

- `/v1/cloud-key/sync`: requires a valid active session, current verified
  health consent/legal versions, a session-bound CSRF token and the private
  `AUTH_GATE`. The first key issuance is conditional on fresh empty D1
  sync state and a single durable issuance marker. A readback of the stored
  winner is required; an ambiguous SQL write is never an ACK.
- `/v1/cloud-key/rights-export`: requires the same authenticated
  CSRF-bound session but may read the existing ADK after an authorized
  health-consent withdrawal with a pending/processing erasure job. It must
  not provision a new key or reactivate fitness writes.

Both call `cloud-key-store.mjs`, which verifies D1 PRIMARY
principal/session/consent/erasure before and after WebCrypto unwrap. The
response (only when proven) is JSON `{format:'thelogbook-account-data-key',version:1,key:'<canonical base64>'}`
with no-store/no-cache, no CORS, and no UID, ciphertext or Kinde token
disclosure. Worker-local ADK bytes are wiped in `finally`. This
cannot prevent intentional access by the authenticated browser; the key
is an online capability and must not be persisted alongside the independent
device vault.

New test `tests/cloudflare/cf05-cloud-key-http.node.mjs` calls the
actual top-level API + private AuthGate + consent handlers + store on
synthetic SQLite schema, covering owner isolation, concurrent/repeat
issuance, withdrawn rights-only, invalid CSRF/origin/body, expiry,
revocation and unavailable KEK/D1/rate gate. It runs in the M7 gate.

**NO-GO:** these routes are not mounted on the live Static Assets Worker,
and no KEK secret or D1 binding has been created there. The local
Wrangler configs remain synthetic, and D1 sandbox still has partial
schema. Do not expose or deploy this key endpoint before complete
Kinde/consent/device journal/rights+erasure, secret custody/recovery,
quota/WAF and Safari verification.
