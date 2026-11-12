# CF-01/02 — isolated encrypted D1 replica candidate

This is a candidate API, **not an enabled production route**. The existing
Firebase/Firestore writer, IndexedDB journal and encrypted vault remain active.

- Schema: migrations/0001_encrypted_replica.sql; optional **destructive,
  disposable-only** rollback in rollback/ (never apply it to user data).
- Local-only Wrangler configuration: wrangler.local.jsonc; placeholder database
  ID, workers.dev and preview URLs disabled, no domain route or public fixture.
- The database contains ciphertext envelopes and public causal metadata only.
  Root and monthly paths retain the existing cloud cipher v1 / Sync Protocol 3.
- Account, consent, replica enrollment and lease records must be provisioned
  by a separate trusted service. This API exposes no provisioning route.
- AUTH_GATE must be a **private service binding** that verifies an actual
  session, verified email, health consent and session-bound CSRF for writes.
  It returns uid, fenceEpoch, healthConsentRevision and csrfVerified. No
  caller-supplied UID or static header is accepted as an identity.
- API_ORIGIN must be an exact HTTPS origin. When missing, requests fail closed.
  Origin, session, consent, account fence, replica lease and D1 CAS are distinct
  checks. No CORS wildcard or public debug endpoint is provided.
- POST /v1/sync/read reads up to eight ciphertext envelopes under one D1
  snapshot; POST /v1/sync/commit atomically advances a guarded replica, up to
  eight documents and a receipt; POST /v1/sync/receipt retrieves the receipt.
- The client must verify AEAD and perform Protocol 3 merge **before** commit.
  A rejected/stale CAS requires a fresh read and merge. Receipt replay requires
  the same immutable sealed bytes and batch ID; it never infers success from a
  timeout. Full checkpoint, account-key transport and consent/erasure flows
  remain CF-03/04/05/06 responsibilities.
- This SQL adapter models document writes and fencing, **not** the entire
  Firestore Rules contract yet. It must not become the application's default
  until complete differential tests and real Auth integration are validated.

For disposable local D1 only, Wrangler can apply the versioned migration with
its local database command. The node:test suite uses a transactional SQLite
adapter and is not evidence of remote D1 performance, IAM or quota.
