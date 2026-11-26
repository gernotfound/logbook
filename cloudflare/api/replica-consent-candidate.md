# API private — replica cifrata, consenso e chiavi candidate

**Quando leggere:** read cifrato, rights-only, full-schema, consenso iniziale, ADK/KEK, policy e limiti del trasporto D1.

**Non inferire:** test isolati o status 200 non attestano consenso cloud, dati accessibili o GO pubblico.

**Autorità:** [indice API](README.md), [Storage candidato](../../.agents/rules/storage-cloudflare-candidate.md), [Consenso candidato](../../.agents/rules/health-cloudflare-candidate.md) e [quadro operativo](../../docs/operations/cloudflare-current-state.md).

## CF-05 rights-only encrypted document read (candidate, not publicly deployed)

`POST /v1/rights/scan` is deliberately separate from the active-fitness
`/v1/sync/scan` endpoint. After the original consent is withdrawn, an
authenticated current Kinde session may retrieve **ciphertext only** while the
original health-erasure job remains pending/processing and the independent
`RECOVERY_DB` still authorizes rights without an erasure cutoff. The private
AuthGate checks CSRF, owner and session even when email was subsequently marked
unverified. The D1 document adapter checks primary SQL consent/job/session
inside each bounded eight-document page transaction and the worker rechecks
both primary and independent registry before returning it. A finalizer or
restored old app snapshot must fail closed, never resurrect data.

The client `withKindeCandidateRightsCheckpoint` obtains an operation-scoped
existing ADK with purpose `rights-export`, reads every revision-pinned page,
authenticates every document with owner/path-bound AEAD, and delivers only a
complete checkpoint to an explicit consumer before zeroing ADK bytes. It does
not authorize sync, mutate IndexedDB, create or adopt an owner, or install a
fitness vault. A **separate candidate-only** `prepareKindeCandidateRightsJson`
formats the authenticated checkpoint as a downloadable rights JSON;
`KindeCandidateRightsPanel` requires an explicit browser gesture to request
the download. This JSON is not a restorable backup; the candidate panel
remains unmounted in the public identity-only app. Device-only edits and
drafts cannot be recovered from the cloud. Public `D1_API` remains unbound;
E2E/provider/browser release gates still apply.

## Candidate CF-03/04: cloud-key precondition and Kinde read boundary

An ADK-free replica claim now returns `428 {"error":"cloud-key-required"}`
only if the D1 primary confirms both key and issuance marker absent,
**revision zero and no existing ciphertext, replicas, receipts, mutations or
erasure job** after trusted session/consent, immutable receipt and CAS
checks. Session, consent, CAS and key state are read in **one primary SQL
snapshot**: an intervening revocation yields 403 and a competing committed
claim yields 409, not a stale 428. The ADK fence suite loads every canonical
migration and proves key deletion only through the real atomic finalizer.
A corrupt marker/old key or transient outage remains
`503 cloud-unavailable`; stale revision remains 409 and revoked
consent is denied. The network-only candidate client maps only the
exact 428 response to `CloudReplicaCloudKeyRequiredError` without
discarding the staged journal, rekeying automatically or inventing ACK.
`inspectKindeCandidateReplicaControl` binds trusted Kinde identity
and consent to an advisory D1 control read with a second session
check **and an authenticated owner UID returned by the control Worker**.
Even an A→B→A tab switch with equal revisions must reject the middle
owner; a missing control UID fails closed. The adapter cannot claim a
replica or open the local vault. Public
Firebase AuthContext and API exposure are unchanged.



## CF-03/05 full-schema trusted flow regression (15 November 2026)

The signed *synthetic* Kinde callback, first health consent, cloud-ADK
provision and replica-claim integration tests now apply the **entire current
D1 schema (0001–0010)**. The previous eight-migration fixture could report
a successful replica claim after consent without a wrapped ADK, because it
never installed the 0009 write fences. The full-schema scenario must deny a
claim before key provision **without a receipt, membership, or revision
change**, then grant it only after the real cloud-key HTTP worker stores
matching wrapped ADK and issuance metadata. A second owner is independently
fenced, provisioned and registered. Key HTTP tests additionally assert the
owner-specific SQL grant disappears on withdrawal while rights-only access
to an existing key remains permitted.

These checks exercise real candidate Worker/SQLite logic, not an active
Kinde tenant or deployed HTTP endpoint. Do not configure a public route,
cloud KEK or real health data based on synthetic CI success.


This is a candidate API, **not an enabled production route**. The existing
Firebase/Firestore writer, IndexedDB journal and encrypted vault remain active.

- Schema: migrations/0001_encrypted_replica.sql through
  migrations/0011_integer_cloud_key_clock.sql. Remote isolated D1 schema
  readback evidence dated 15/11/2026 covers 0001–0010 only; it does not
  attest the later integer-clock migration 0011. Local-only rollback is **destructive,
  disposable-only** rollback in rollback/ (never apply it to user data).
- Local-only Wrangler configuration: wrangler.local.jsonc; placeholder database
  ID, workers.dev and preview URLs disabled, no domain route or public fixture.
  Do NOT replace the local placeholder with a remote database ID.
- Provider verification 2026-11-13: isolated **EU-jurisdiction** D1 resource
  `thelogbook-cf02-eu-isolated-20261113` (UUID
  `9aa51833-8adc-495f-bdfc-93b5542e8023`) was provisioned without
  a public Worker/domain. **At that 13 November checkpoint** only
  0001–0008 were applied; subsequent [manual workflow #43702489692](https://github.com/gernotfound/logbook/actions/runs/43702489692)
  and independent Cloudflare readback on 15 November confirmed **0001–0010**.
  The original migration 0001 was accepted (6 tables,
  5 triggers). Synthetic CAS and consent-regression requests were rejected,
  and a late failed statement rolled back an earlier receipt insert. This
  proves SQL behavior on remote D1, NOT HTTP Worker/Auth, quota or runtime.
- **B-01 (merged to main, applied to isolated EU D1 on 15/11):** migration 0009 adds a shared
  active-owner/key grant and SQL fences for receipt insertion, replica mutation,
  direct document/replica writes and control revision advances. A valid grant
  needs an actual wrapped ADK row and an issuance marker matching uid, consent
  revision and issued timestamp, alongside active Auth, explicit consent and
  no unfinished erasure. A historical marker without the key is insufficient.
  Active receipts/causal ledger are immutable and direct SQL deletes are
  disallowed while the owner is active; bounded erasure DELETEs remain available
  after withdrawal, as does rights-only key release and eventual leased key
  deletion. Existing synthetic rows are not rewritten on migration. A keyless
  pre-existing replica cannot be silently provisioned or resumed: it requires
  separate authorized remediation, not an automatic reset. SQLite regression
  coverage uses all migrations, but neither real D1 enforcement nor authenticated
  end-to-end browser integration is certified by that test.
- **B-02 (merged to main, applied to isolated EU D1 on 15/11):** 0010
  introduces an immutable owner-scoped `health_erasure_finalizations` terminal
  receipt, `health_erasure_jobs.completed_at_ms`,
  `health_erasure_jobs.erased_before_revision`,
  `health_erasure_jobs.key_disposition` and
  `sync_subjects.erased_before_revision`. Its value N fences all consent
  revisions **strictly below N**; it is independent of the technical CAS
  counter `sync_state.revision`, which is not incremented at erasure.
  The complete operation is a **single** `INSERT ... SELECT ... RETURNING`
  into `health_erasure_finalizations`. Supply the five job-lease arguments
  `uid, consent_revision, fence_epoch, lease_epoch, lease_token` in that
  order; compute the server timestamp, `consent_revision + 1`, current
  `sync_state.revision` and key disposition/issuance timestamp inside the
  INSERT SELECT from trusted D1 tables. The SQL tested contract is
  `FINALIZE` in `tests/cloudflare/cf06-atomic-erasure-finalization.node.mjs`;
  the D-owned job worker must use the same statement, not separate DELETE/UPDATE
  commands. The job must hold a still-valid lease while in
  `processing/awaiting-keys`; if that lease expires, D must re-claim that
  phase using the existing monotone lease epoch and a new token before retry.
  `0006`'s current scheduler only claims `phase='data'`: the finalizer
  must explicitly cover `awaiting-keys` without weakening its fencing.
  BEFORE INSERT verifies the lease, withdrawn subject, matching owner/epoch,
  empty documents/receipts/mutations/replicas and exact ADK/issuance match.
  The AFTER INSERT trigger deletes the wrapped ADK if issued, changes the job
  to `complete`, and advances the subject consent+epoch and durable erasure
  floor. Every required DELETE or UPDATE checks `changes()=1`; any failure
  aborts the **same SQLite statement**, removing all partial side effects
  including the tentative receipt. It is not an assumption about D1.batch().
  `destroyed` requires a present, exactly matching ADK+marker.
  `never-issued` requires neither an ADK nor that generation's issuance
  marker. Marker-present/key-missing is corruption and always blocks complete.
  Direct standalone key DELETE and direct job status=complete are fenced.
  The issuance marker is never removed; job receipts are immutable and survive
  optional completed-job retention separately.
  The runner must regard a zero-row RETURNING as non-completion. Following an
  ambiguous/lost SQL reply it must re-read from D1 **first-primary**, verify
  terminal receipt, matching owner/generation, job `complete`, withdrawn
  subject revision/epoch/floor, no ADK and no ciphertext/replica/ledger residue.
  Only that combined durable proof can be reported as `complete`. A timeout,
  status 409 or missing receipt is not success. No Kinde identity deletion or
  user-data migration is performed by this SQL.
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


## CF-05 — candidate first-consent boundary (not deployed)

`cloudflare/api/consent-worker.mjs` accepts identity-only requests
`POST /v1/consent/status`, `POST /v1/consent/initial` and
`POST /v1/consent/withdraw`.
These are candidate HTTP routes not bound to the public frontend or domain.
The private `AUTH_GATE` accepts these routes only with a valid, non-revoked
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
The independent `RECOVERY_DB` must be open before pending enrollment and
must prove the same active generation before the API reports `active`.
If the application batch committed but the registry transition failed, a
CSRF-verified status request from a verified session with current legal documents
may promote the existing pending floor from primary proof. A missing floor
cannot be enrolled from a restored application snapshot.
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
CSRF but does not require the email to remain verified. The independent D1
first persists a deny for the exact subject generation. Its migration
`0003_withdraw_pending_health_consent.sql` allows a stranded pending floor
to move directly to blocked. A single conditional
SQL INSERT rechecks the current session, account status and immutable first
consent proof. Its AFTER INSERT trigger flips `sync_subjects.status`
to `withdrawn` in the same statement, rejecting a mismatched generation
rather than retaining a job with a writable subject. A replay or lost ACK
returns `{ status: "withdrawn", revision: 1, fenceEpoch, deletionStatus:
"pending" }` only when primary D1 confirms the user's still-valid session,
withdrawn grant and pending job, and the independent registry confirms the
withdrawal. An application write failure leaves the independent deny in
place for retries. Auth epoch advances may not hide the
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


## CF-05 — candidate ADK/KEK custody in Workers/D1 (historical implementation baseline)

- `migrations/0007_cloud_key_custody.sql` adds `cloud_account_keys` and a
  **per-owner, per-consent** immutable issuance record. The issuance trigger
  runs within the same D1 transaction as the first key insert; missing wrapped
  bytes after issuance can never be silently re-provisioned for that generation.
- `cloud-key-crypto.mjs` uses Workers WebCrypto AES-256-GCM to wrap only a
  **random 32-byte account ADK**, with a random 12-byte IV, owner/version AAD,
  canonical base64 fields and authenticated 16-byte tag. The separate Workers
  secret is named `CLOUD_ACCOUNT_KEK_V1`. On 19 November 2026, Cloudflare
  readback confirms this `secret_text` binding on the private
  `thelogbook-api-isolated` Worker; its value, matching external copy and
  ability to restore have **not** been verified. The old Vercel secret
  value is not imported into Cloudflare.
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
  These synthetic tests do not prove Kinde login or recovery of the actual
  stored KEK. A later Cloudflare readback confirms only that the private API
  Worker and its secret binding exist, **not** functional fitness cloud access.

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
response (only when proven) is JSON
`{format:'thelogbook-account-data-key',version:1,key:'<canonical base64>',uid,fenceEpoch,consentRevision,purpose}`.
UID, server Auth epoch and consent revision come from the private AuthGate claims
revalidated by the custodian; purpose is selected by the actual handler route.
Responses use no-store/no-cache and no CORS. The authenticated browser receives
its UID as the response-owner fence; wrapped-key ciphertext and Kinde tokens
are never returned. Worker-local ADK bytes are wiped in `finally`. This
cannot prevent intentional access by the authenticated browser; the key
is an online capability and must not be persisted alongside the independent
device vault.

Test `tests/cloudflare/cf05-cloud-key-http.node.mjs` calls the
actual top-level API + private AuthGate + consent handlers + store on
synthetic SQLite schema, covering owner isolation, concurrent/repeat
issuance, withdrawn rights-only, invalid CSRF/origin/body, expiry,
revocation and unavailable KEK/D1/rate gate. It runs in the M7 gate.

`src/lib/sync/cloudflareAccountKeyCandidate.ts` implements the candidate browser
adapter without Firebase initialization, persistent cache or vault/journal writes.
It checks a captured Kinde UID, server epoch, consent revision and operation
purpose against the complete response; its caller supplies the local Auth
generation guard, including A→B→A. Same-origin cookie/CSRF requests have a
12-second deadline and a 1024-byte JSON response cap, including streamed bodies.
Malformed headers/encoding, owner/generation/purpose mismatch and stale guards
fail closed; transient transport/HTTP failures remain distinguishable. HTTP 503
does not prove that a KEK/configuration problem is transient. Decoded bytes are
wiped on a late guard failure; the caller must wipe a returned ADK after its one
operation. The shared material codec/error is independent of either Auth backend.
Vitest integration calls this adapter through the actual Worker/AuthGate and
SQLite fixture shared with the Node HTTP suite: wrapped winner, lost response,
owner isolation, AEAD and unverified rights-only recovery are synthetic proofs,
not live Kinde, durable journal ACK, restore or public activation.

**NO-GO (Cloudflare readback 19/11/2026):** the live Static Assets Worker
`thelogbook-frontend` has neither `D1_API` nor a KEK secret; the separate
private `thelogbook-api-isolated` Worker does have `CLOUD_ACCOUNT_KEK_V1`
as `secret_text`, plus `DB`, `RECOVERY_DB` and `AUTH_GATE`. The local Wrangler
configuration remains synthetic. The presence of private bindings does not
prove the live Kinde/consent, ADK, journal or restore flow. Do not expose the
key endpoint until the complete Kinde/consent/device journal/rights+erasure,
secret custody/recovery, quota/WAF and Safari gates are verified.

