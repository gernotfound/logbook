# Task Assignment: Documentation & Master Plan Worker (Worker 1)

## Working Directory
`C:\Users\gerar\Documents\GitHub\logbook\.agents\worker_plan_policy`

## Target Deliverables (Exclusive Ownership)
1. `C:\Users\gerar\Documents\GitHub\logbook\teamwork_projects\logbook_public_release\PUBLIC_RELEASE_PLAN.md`
2. `C:\Users\gerar\Documents\GitHub\logbook\teamwork_projects\logbook_public_release\PRIVACY_POLICY.md`
(Also mirror to `C:\Users\gerar\teamwork_projects\logbook_public_release\` if possible)

## Mandatory Documents & Findings
- `C:\Users\gerar\Documents\GitHub\logbook\.agents\ORIGINAL_REQUEST.md`
- `C:\Users\gerar\Documents\GitHub\logbook\AGENTS.md`
- Explorer 1 Analysis: `C:\Users\gerar\Documents\GitHub\logbook\.agents\explorer_survey_1\analysis.md`
- Explorer 2 Analysis: `C:\Users\gerar\Documents\GitHub\logbook\.agents\explorer_survey_2\analysis.md`
- Explorer 3 Analysis: `C:\Users\gerar\Documents\GitHub\logbook\.agents\explorer_survey_3\analysis.md`

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Detailed Requirements
- **PUBLIC_RELEASE_PLAN.md**:
  - Full architectural blueprint covering R1–R6.
  - Zero-Cost Firebase Spark Tier verification & manual dashboard monitoring protocols (no Blaze, no Cloud Functions, no Cloud Billing).
  - App Check detailed architecture: `ReCaptchaV3Provider`, 1h token TTL, client-side non-secret site key safety, two-phase rollout (Monitor -> Enforcement), graceful offline degradation on `isSupported() === false`, Authorized Domains & API Key referrer security checklists.
  - Spark-Optimized Firestore Rules architecture: Zero `get()`/`exists()` calls ($0 extra read cost), payload whitelisting, array bounds, subcollection limits, and client 950KB pre-write size guard.
  - Quota mathematical model: cold sync (8 reads), daily usage (6-10 writes, 16-48 reads), supporting ~2,200-3,100 DAUs on Spark limits.
  - Global Catalog architecture: Dedicated IndexedDB cache key (`logbook_cached_global_catalog`), versioned manifest reading $O(1)$, seed JSON fallback, admin-only read-only Firestore rules, and user override delta model following the 5-step `AGENTS.md` checklist (`types.ts`, `schema.ts`, `db.ts`, `AuthContext.tsx`, `export.ts`).
  - Resilient UX & Error Handling: Sentence case Italian error mapping with `useDialogStore` covering the 3 mandatory failure scenarios.
  - Privacy-Safe Analytics: Opt-in/revocation local gate, zero health/biometric/exercise/nutrition/notes/UID telemetry, event taxonomy.
  - Testing & Verification strategy.

- **PRIVACY_POLICY.md**:
  - Authoritative GDPR Privacy Policy in Italian (*Sentence case*).
  - Data Controller & contact details.
  - Explicit 18+ requirement (underage usage strictly prohibited).
  - Data Processors: Google Firebase (Google Ireland Ltd / Google LLC) & Vercel Inc. under Data Privacy Framework (DPF) / Standard Contractual Clauses (SCC).
  - Categorization of data (authentication, training/nutrition, biometrics, technical, anonymous usage).
  - Legal bases: Art. 6(1)(b) GDPR (service execution) + Art. 9(2)(a) GDPR (explicit consent for biometric/health data).
  - Deterministic retention schedule (no vague "forever" claims).
  - Data subject rights: in-app CSV export, live rectification, complete cascade deletion.
  - Separate Analytics opt-in/revocation (functional with consent denied).
  - Local technical storage disclosure (localStorage / IndexedDB).
  - In-app placement specification (Settings view).

Deliver complete files to disk and report back with `handoff.md`.
