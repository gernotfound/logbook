# API D1 — checkpoint di migrazioni e provider (storico)

**Quando leggere:** ricostruzione delle verifiche isolate e del deployment privato in novembre 2026.

**Non inferire:** ledger, schemi, binding, URL e stato runtime attuali da snapshot datati; eseguire readback provider separato.

**Autorità:** [indice API](README.md), [quadro operativo](../../docs/operations/cloudflare-current-state.md) e [runbook](../../docs/operations/cloudflare-workers-migration.md).

## Isolated EU D1 remote migrations verified — 15 November 2026

The [manual main-only run #43702489692](https://github.com/gernotfound/logbook/actions/runs/43702489692)
completed **SUCCESS** on `main 5ca7afaca94e4431e298595eecdd2a023546fd21`
(v2.446.0), applying migrations `0009` and `0010` via
Wrangler. Independent Cloudflare readback verified **all 10
ordered migration ledger rows**, EU jurisdiction, disabled
read replication, Time Travel bookmark, the
`sync_writable_cloud_key` view, `health_erasure_finalizations`
table, receipt/key and erasure triggers, and finalization
columns. There were no real principals, sessions, cloud
keys or erasure jobs, and the one synthetic ciphertext
document and receipt were preserved. No Firebase data
was imported.

This establishes **only the isolated D1 schema milestone**.
The dedicated GitHub token was accessible and authorized
sufficiently for this run; exact IAM scope/expiry were not
independently inspected. There was no backup restore test,
authenticated Kinde HTTP test, KEK recovery, consent, sync,
erasure or production GO. Keep public Auth/Sync routes disabled.

## Isolated schema migration operations (historical checkpoint before manual run)

**Credential checkpoint, 15 November:** the product owner reports creating a
dedicated Cloudflare D1 API token and adding it to GitHub repository Actions
secrets as `CLOUDFLARE_D1_API_TOKEN`. The secret value was not shared.
Its effective permissions, scope, expiry, GitHub Actions availability and the
`CLOUDFLARE_ACCOUNT_ID` variable are not independently verified.
A separate Cloudflare readback still reports **8 of 10** migrations on
the EU isolated D1. No manual migration workflow run has been observed.
Token provisioning is not migration execution; the existing manual,
main-only Wrangler workflow must still pass its preflight and post-readback.



**Live readback 15 November, after main v2.445.0:** the EU synthetic D1 still
has only migration IDs 1–8, while the `0009` view and `0010` table/trigger
are absent. The Time Travel bookmark is available; zero principals, sessions,
cloud keys, or erasure jobs. Exactly one synthetic encrypted document and one
receipt remain. No GitHub manual D1 migration run exists. The operator must
configure the dedicated GitHub Actions secret (Cloudflare account D1 Edit only)
and dispatch the main-only workflow: see the
[operational runbook](../../docs/operations/cloudflare-workers-migration.md).
Direct SQL execution is **not** an equivalent substitute for Wrangler's
preflight, migration ledger, backup/rollback, and post-readback.


Direct provider readback on 15 November confirmed the synthetic EU D1 is at
**0008/0010**: no Kinde principal/session, no wrapped cloud key and no
erasure job, but one existing synthetic ciphertext document and receipt.
Both API/Auth Gate Workers remain private and bound to that D1; there is no
public Auth/Sync route. The source migrations 0009 and 0010 are on main,
but **not yet applied to the remote D1** at this checkpoint.

A main-only, manually dispatched workflow
[`cloudflare-d1-isolated-migrations.yml`](../../.github/workflows/cloudflare-d1-isolated-migrations.yml)
performs a read-only preflight of D1 identity, EU jurisdiction, read-replica
mode, Time Travel bookmark, exact ordered migration ledger and absence of
real identities/keys/jobs. It then invokes the official, pinned Wrangler
`d1 migrations apply --remote` command (backup and per-migration rollback
provided by Wrangler), followed by an independent schema/ledger readback.
The migration allowlist is pinned in
[`verify-cloudflare-isolated-d1-schema.mjs`](../../scripts/verify-cloudflare-isolated-d1-schema.mjs)
and has negative-regression tests. The workflow never deploys Workers,
modifies DNS or runs against a user database. It needs a dedicated
`CLOUDFLARE_D1_API_TOKEN` GitHub secret with least-privilege D1 write
permission; the existing Workers-only deployment secret must not be
expanded for SQL writes. **PR #1135 merged the workflow into main (`ed31c42a`), but the D1 migration workflow has not been dispatched**.
Do not dispatch until its exact-main CI gates pass and the token/target
are reviewed. A green migration does not prove Auth, consent, erasure
execution, ciphertext sync, backup restore or production safety.

## Private Cloudflare provider wiring, 14 November 2026

The isolated EU D1 has a Wrangler-compatible `d1_migrations` ledger for all
eight migration files; direct Cloudflare readback found the expected tables
and triggers, with the original synthetic rows unchanged. No account or session
is provisioned. Cloudflare's REST endpoint rejects `PRAGMA integrity_check`;
this operation is **not** verified and no restore was performed.

`cloudflare/api/wrangler.isolated.jsonc` and
`cloudflare/auth/wrangler.isolated.jsonc` pin the real sandbox by UUID,
use a private `AUTH_GATE` service binding and a separate rate-limit binding.
Neither config enables workers.dev, preview URLs, routes or custom domains.
The main-only post-verification workflow `cloudflare-api-isolated.yml` can
deploy these two private Workers and read back their bindings. A green config
test or a completed schema migration is **not proof of deployed Workers**;
consult the exact GitHub Actions run and provider readback. These Workers
must not be mounted on `thelogbook.me` until Kinde session/consent, ciphertext,
quota, and recovery paths are proven on real runtime with synthetic data.

## Private Worker runtime/provider checkpoint — 14 November 2026

On merged `main f3fc9b138e62bfc1fc6beb22ce6f2c7ba5d4e2f0`,
GitHub Actions [Cloudflare private deploy #43638837192](https://github.com/gernotfound/logbook/actions/runs/43638837192)
successfully built and uploaded both workers. Wrangler output confirmed
the D1 and Auth Gate service bindings, with *no deployed public targets*.
Direct Cloudflare connector readback subsequently confirmed live settings:
`DB` points to EU isolated D1 UUID `9aa51833-8adc-495f-bdfc-93b5542e8023`
on both workers, `AUTH_GATE` targets the private gate, the gate has
rate-limiter namespace `31003`, and both workers have disabled workers.dev
and preview URLs. The public `thelogbook-frontend` still only binds `ASSETS`.
No authenticated HTTP/runtime test has occurred, and user-facing API is NO-GO.

The deploy job's final readback failed HTTP 401 on a **D1 REST read**
because its GitHub deployment token is scoped for Workers. The D1 schema
0001–0008 was independently inspected with a different authorized
Cloudflare connector. Do not increase a deployment token's scope to
execute D1 SQL. Instead, the automated deploy readback verifies only the
Workers' actual binding IDs and disabled public URLs; schema/jurisdiction
are independently verified by the provider. Denied Worker reads still fail
closed. See `tests/cloudflare/cf02-provider-bindings.node.mjs`.

