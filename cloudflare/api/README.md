# CF-01/02 — isolated encrypted D1 replica candidate

This is a candidate API, **not an enabled production route**. The existing
Firebase/Firestore writer, IndexedDB journal and encrypted vault remain active.

- Schema: migrations/0001_encrypted_replica.sql and
  migrations/0002_reject_reused_replica_ids.sql; optional **destructive,
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
fence. It performs one primary SQL read joining session, principal and
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

