# External services and off-repository configuration

This rule governs external systems whose effective configuration is not fully represented by the Git repository.

The stable human-readable decision register is `docs/operations/external-services-register.md`.

## Source of truth

- **MUST:** repository code/configuration and external provider state are separate sources of truth. Do not infer live provider settings from repository files alone.
- **MUST:** before changing an external integration, verify the live state in the competent system when access is available: GitHub, Vercel, Firebase/Google Cloud, Sentry, Snyk or Google Search Console.
- **MUST:** when a material external setting changes, update the external-services register in the same task or explicitly record why it cannot yet be updated.
- **MUST:** distinguish `ACTIVE`, `LEGACY`, `OPTIONAL`, `EXTERNAL-ONLY` and `VERIFY-LIVE` states. A setting reported historically is not proof of current runtime state.

## Public-repository privacy boundary

The repository is public.

- **MUST NOT:** commit secret values, auth tokens, private keys, service-account credentials, personal email addresses, billing/account identifiers, local workstation usernames or personal filesystem paths.
- **MUST:** document environment-variable **names and purpose**, not secret values.
- **SHOULD:** avoid duplicating public client identifiers/site keys in documentation when the name/role is sufficient.
- **MUST:** examples and test fixtures use synthetic identities and filesystem paths.
- **MUST:** if a private value is exposed, rotate/revoke it at the provider and scrub the current repository state where practical; deleting a chat/message or a later commit is not a substitute for rotation.

## Retirement and allowlists

- **MUST:** retired deployment origins/domains are removed from application configuration and external allowlists when they are no longer required.
- **MUST:** do not keep an old origin authorized merely for historical compatibility unless a real runtime still depends on it.
- **MUST:** before deleting a generic portability feature, prove that it is specific to the retired provider. Generic base-path/subpath support is not automatically legacy deployment code.
- **VERIFY:** API-key referrer restrictions, OAuth origins/redirects, Firebase Auth authorized domains, reCAPTCHA/Fraud Defense domains and Search Console properties are external state.

## Provider boundaries

### Firebase / Google Cloud

Firebase Authentication, Firestore, Firebase Admin and App Check are separate boundaries even when they share one Google Cloud project.

- Follow `.agents/rules/firebase-config.md` for client/server env contracts, App Check and Rules.
- Google Cloud may present reCAPTCHA Enterprise under the broader Fraud Defense product. LogBook currently uses the reCAPTCHA Enterprise provider through Firebase App Check; do not claim that Account defense, SMS defense, transaction defense or direct Fraud Defense assessment APIs are active without live evidence.
- Browser API-key restrictions and OAuth client configuration are external security controls and must be reviewed when the canonical deployment origin changes.

### Vercel

- Vercel is the Production hosting/runtime boundary and owns Production environment variables, Functions and cron execution.
- `main` remains the only deployment-enabled branch unless the repository contract is deliberately changed.
- Server-only credentials must never use a `VITE_` prefix.
- A successful Vercel deployment does not prove GitHub CI, and CI success does not prove the Production deployment.

### GitHub / CodeQL / Snyk

- GitHub is the repository, PR/ruleset and canonical CI source of truth.
- CodeQL is part of `Canonical Verification`; Snyk is supplementary and must not become the only blocking SAST control.
- Rulesets and required checks are external GitHub state: verify them directly before changing check names or merge behavior.

### Sentry

- Sentry is Error Monitoring only unless a later product decision explicitly expands scope.
- Do not enable Session Replay, tracing, logging or Application Metrics by accident while following onboarding prompts.
- Sentry auth tokens are build-only secrets; the browser DSN is public runtime configuration but should not be duplicated unnecessarily.
- Follow `docs/telemetry-sentry-guide.md` for payload minimization and source-map handling.

### Google Search Console

- Search Console is an indexing/verification system, not an application runtime dependency.
- Keep the canonical Production URL, verification mechanism, `robots.txt` and `sitemap.xml` coherent.
- Do not remove verification files/meta tags merely because indexing already succeeded; removal can invalidate future ownership checks.

## Required review when changing providers

Before replacing, removing or materially reconfiguring an external service:

1. identify current callers and runtime dependency;
2. verify live provider configuration;
3. identify data/privacy/security impact;
4. identify quotas/free-tier assumptions and failure behavior;
5. update code/config/tests;
6. update this rule if the invariant changes;
7. update `docs/operations/external-services-register.md` with the reason for the decision and verification date.
