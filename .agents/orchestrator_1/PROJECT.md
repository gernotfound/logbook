# Project: LogBook Public Release Plan & PoC (R1–R6)

## Architecture & System Overview
LogBook is an offline-first, client-centric Progressive Web App (PWA) built on React 19, TypeScript, Vite, Zustand 5, Zod, and Firebase Modular SDK v12, hosted on Vercel.
The public release architecture elevates security, data integrity, quota resilience, and GDPR privacy while strictly adhering to the 0-cost Firebase Spark tier (zero paid services, zero Cloud Billing).

### Core Architectural Pillars
1. **Zero-Cost Security & App Check (R1)**:
   - Client-side attestation via standard `ReCaptchaV3Provider` (1M free monthly evaluations on Spark tier).
   - 1-hour token TTL with automatic background refresh.
   - Non-secret site key injection (`VITE_RECAPTCHA_V3_SITE_KEY`).
   - Two-phase rollout: Phase 1 (Monitor Mode) $\rightarrow$ Phase 2 (Enforcement Mode).
   - Graceful offline degradation on unsupported browsers (`isSupported() === false`) or blocking environments, disabling cloud sync with Italian *Sentence case* notifications without impeding offline workouts.
   - Authorized Domains & API Key referrer security checklists.

2. **Server-Side Integrity & Quota Budgeting (R2)**:
   - Server-side `firestore.rules` enforcing user ownership, payload whitelisting, string lengths, and array bounds (`library <= 500`, `routines <= 100`, `customFoods <= 1000`, `trainingCycles <= 50`, `supplements <= 50`, `activePains <= 50`, monthly items `<= 120` / `<= 31`).
   - **Zero `get()` / `exists()` lookups** ($0 extra read costs on Spark tier).
   - Client-side 950 KB pre-write guard (`checkDocSize` in `db.ts`).
   - Mathematical quota modeling demonstrating sustainable capacity for 2,200–3,100 Daily Active Users on Spark limits (50k reads / 20k writes / 1GB storage).

3. **Global Catalog & Dual-Cache Architecture (R3)**:
   - Decoupled public catalog (`/global_catalog` with `manifest`, `exercises_v1`, `foods_v1`) with admin-only read-only rules.
   - Dedicated IndexedDB cache key (`'logbook_cached_global_catalog'`) separate from `'logbook_cached_user_data'`.
   - Lightweight $O(1)$ versioned manifest sync checking `version`, `updatedAt`, and `schemaVersion`.
   - Bundled static seed JSON (`seedExercises.json`, `seedFoods.json`) for instant zero-network first-time boot.
   - User delta model for custom entries and overrides conforming to the 5-step `AGENTS.md` checklist (`types.ts`, `schema.ts`, `db.ts`, `AuthContext.tsx`, `export.ts`).

4. **Resilient UX & Standardized Error Handling (R4)**:
   - Comprehensive error mapping translating Firebase error codes into Italian *Sentence case* messages.
   - Integration with `useDialogStore` (`showAlert`, `showConfirm`).
   - Explicit handling and validation of 3 critical failure scenarios:
     1. Network offline / disconnection (with clear confirmation that local IndexedDB save succeeded).
     2. App Check unsupported or blocked (clean fallback to local mode).
     3. Security rules rejection due to exceeded quota or invalid payload structure.

5. **Privacy-Safe Analytics (R2)**:
   - Explicit opt-in by default (`'logbook_analytics_consent'` in localStorage/IndexedDB).
   - Zero transmission of health, biometric, workout notes, exercise names, food names, weights, or user IDs.
   - Anonymous technical and bucketized interaction telemetry.

6. **GDPR Privacy Policy & Legal Architecture (R6)**:
   - Comprehensive Italian *Sentence case* Privacy Policy (`PRIVACY_POLICY.md`).
   - Explicit legal basis: Art. 6(1)(b) (contractual execution) + Art. 9(2)(a) GDPR (explicit consent for health & fitness data).
   - Strict 18+ age requirement to prevent underage data processing.
   - Transparent data processor disclosures: Google Firebase (Google Ireland Ltd / Google LLC) and Vercel Inc. under Data Privacy Framework (DPF) / Standard Contractual Clauses (SCC).
   - Deterministic retention schedule, user rights implementation (in-app CSV export, live rectification, complete cascade deletion), and settings placement.

---

## Feature Inventory
| # | Feature | Description | Milestone | Status |
|---|---------|-------------|-----------|--------|
| F1 | Architectural Master Plan | Comprehensive document detailing R1–R6, quota math, security rollout, and 5-step checklist | M1 | DONE |
| F2 | Firebase App Check Integration | ReCaptchaV3Provider, 1h TTL, site key config, monitor/enforcement phases, isSupported fallback | M2 | DONE |
| F3 | Spark-Optimized Firestore Rules | Zero get()/exists() security rules with schema, type, and array limits | M2 | DONE |
| F4 | Spark Quota Modeling & Pre-Write Guard | Mathematical budget analysis + client 950KB checkDocSize validator | M2 | DONE |
| F5 | Global Catalog & Dedicated IndexedDB Cache | Dedicated cache key, manifest sync, seed JSON fallback, and delta resolver | M3 | DONE |
| F6 | 5-Step AGENTS.md Delta Architecture | User override schema, types, db, auth, and CSV export mappings | M3 | DONE |
| F7 | Resilient Error Handling & UX Dialogs | Sentence case Italian error mapper with useDialogStore for 3 key scenarios | M4 | DONE |
| F8 | Privacy-Safe Analytics Module | Local opt-in/revocation, zero health/PII payload enforcement, bucketized telemetry | M4 | DONE |
| F9 | GDPR Privacy Policy Documentation | Full Italian GDPR policy (Art. 6 + 9(2)(a), 18+, Firebase DPF, retention, rights) | M5 | DONE |
| F10 | PoC Automated Test Suite | Comprehensive unit/integration tests validating rules, App Check, catalog, UX, and analytics | M6 | DONE |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Architectural Master Plan | Write `PUBLIC_RELEASE_PLAN.md` with complete technical specifications | Survey complete | DONE |
| M2 | Security, Rules & Quota PoC | Implement App Check provider, `firestore.rules`, 950KB guard & quota budget | M1 | DONE |
| M3 | Global Catalog & Cache PoC | Implement catalog service, dedicated IndexedDB, seed JSON, and delta resolver | M1 | DONE |
| M4 | Resilient UX & Privacy Analytics PoC | Implement error handler, 3 dialog scenarios, and privacy-safe analytics | M1 | DONE |
| M5 | GDPR Privacy Policy | Author complete `PRIVACY_POLICY.md` in Italian (*Sentence case*) | M1 | DONE |
| M6 | Test Verification & Audit | Automated test suite for PoC modules and forensic integrity audit | M2, M3, M4, M5 | DONE |

---

## Code Layout & Deliverables
All deliverables reside in `teamwork_projects/logbook_public_release/` (0 files modified in `src/`):

```
teamwork_projects/logbook_public_release/
├── PUBLIC_RELEASE_PLAN.md               # Master architectural plan (R1–R6)
├── PRIVACY_POLICY.md                    # Official GDPR Privacy Policy in Italian
├── firestore.rules                      # Spark zero-cost production-ready rules
├── firestore.indexes.json               # Firestore index configuration
├── src/
│   ├── security/
│   │   ├── appCheck.ts                  # App Check ReCaptchaV3Provider & fallback logic
│   │   └── checkDocSize.ts              # Client-side 950KB pre-write guard
│   ├── catalog/
│   │   ├── catalogService.ts            # Manifest reader, O(1) sync, seed loader
│   │   ├── catalogTypes.ts              # Global catalog schema & delta types
│   │   ├── seedExercises.json           # Bundled default exercises
│   │   ├── seedFoods.json               # Bundled default foods
│   │   └── deltaResolver.ts             # 5-step AGENTS.md library merger
│   ├── errors/
│   │   ├── errorHandler.ts              # Italian Sentence case error translator
│   │   └── errorScenarios.ts            # Handlers for 3 required failure scenarios
│   └── analytics/
│       ├── privacyAnalytics.ts          # Opt-in consent gate & zero-PII event logger
│       └── analyticsTypes.ts            # Event taxonomy & allowed generic schemas
└── tests/
    ├── rules.test.ts                    # Firestore rules validation (malformed, bounds, auth)
    ├── appCheck.test.ts                 # App Check flow & offline fallback tests
    ├── catalog.test.ts                  # Catalog manifest, seed fallback, and delta tests
    ├── errors.test.ts                   # Error handling & dialog scenario tests
    ├── analytics.test.ts                # Analytics consent & PII sanitization tests
    ├── security_catalog.test.ts         # Security & catalog integration tests
    ├── adversarial_challenger2.test.ts  # Challenger 2 stress tests
    ├── challenger_stress.test.ts        # Challenger 1 rules & delta stress tests
    └── vitest.config.ts                 # PoC test configuration
```
