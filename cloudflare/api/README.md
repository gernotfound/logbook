# CF-01/02 — contratti del candidato API D1 cifrato

**Quando leggere:** route e policy HTTP, sessione Auth Gate, documenti cifrati, ACK, consenso e verifiche D1 isolate. **Non inferire:** Worker privato distribuito non implica route fitness pubblica; gli snapshot nelle sezioni datate non provano il provider corrente. Consultare il [quadro operativo](../../docs/operations/cloudflare-current-state.md).

**Route authorization boundary:** `cloudflare/api-route-policy.mjs` is the single candidate allowlist and scope classification used by the public first-party D1 gateway, private `AUTH_GATE` and replica API's defensive checks of internal claims. It keeps `/v1/auth/logout` internal, distinguishes identity-only rights/withdrawal from verified-email fitness/initial consent, and marks routes that require CSRF. Its per-route byte ceilings reject excessive declared requests at the gateway and bound the replica and consent HTTP readers; empty-body routes retain their independent stream-draining guards. `Content-Length` is never proof of the actual stream length. The private Workers still own schema, session, owner, consent and recovery readbacks; a policy entry alone never grants access or publishes a Worker binding. Runtime-backed negative tests enforce the independently reviewed route set. A new route must be assigned exposure, scope and budget deliberately before either gateway can accept it.

**SYNC-7 candidate:** migration 0018 enforces at most five live replica memberships per owner (active lease including skew) in SQL insert/update. Protocol 3 retains all 16 actor slots and immutable mutation receipts. Renewal does not consume another place; no automatic active eviction. `409 replica-capacity` is a typed refusal, not non-commit proof, and does not clear local intent/journal. Migration 0019 adds explicit retirement with exact incarnation and confirmed last sequence, lease and checkpoint timestamps, using the same owner/session/consent/epoch/revision CAS and immutable receipt. Automatic expired retirement remains unchanged. Explicit cancellation `POST /v1/sync/replica/cancel` accepts the original strict claim or retirement body. If no receipt exists at the original revision, a bounded, owner/session/consent/cloud-key-fenced CAS increments only the control revision; the primary then rereads receipt and revision. It never creates a membership receipt or changes business data. The browser seals the cancellation marker before the request and suspends ordinary replay, rebase and adoption while it exists. Lost replies retry cancellation with the same intent; `committed` clears only the cancellation marker and requires ordinary reconciliation, not cancellation. Only a verified `not-committed` and matching owner/epoch/consent control permit removing the exact local intent. This deliberately invalidates other in-flight CAS at that revision; do not use cancellation as an automatic retry. Settings UI, trusted management bridge, device return recovery, abuse budget and remote verification remain open.

## Guida alla lettura selettiva

| Boundary | Documento |
|---|---|
| Account/sessione Kinde, HTTP bridge e OAuth fidato | [Auth e sessione candidate](auth-session-candidate.md) |
| Dati cifrati, rights-only, consenso, schema e custodia chiavi | [Replica e consenso candidate](replica-consent-candidate.md) |
| Erasure CF-06 e osservazione attività identity-only | [Erasure e attività candidate](erasure-candidate.md) |
| Migrazioni isolate e readback provider di novembre 2026 | [Checkpoint storici](provider-checkpoints.md) |

Queste sezioni conservano contratti e prove tecniche del candidato: leggere quelle pertinenti insieme ai gate di autorizzazione qui sotto. Lo [stato operativo](../../docs/operations/cloudflare-current-state.md) resta il punto d'accesso ai checkpoint più recenti; verificare il provider prima di operare.

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


