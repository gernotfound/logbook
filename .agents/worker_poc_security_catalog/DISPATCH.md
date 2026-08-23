# Task Assignment: Security, Rules & Catalog PoC Worker (Worker 2)

## Working Directory
`C:\Users\gerar\Documents\GitHub\logbook\.agents\worker_poc_security_catalog`

## Target Deliverables (Exclusive Ownership)
Within `C:\Users\gerar\Documents\GitHub\logbook\teamwork_projects\logbook_public_release\`:
1. `firestore.rules` (Spark-optimized zero `get()`/`exists()` rules with schema and array bounds)
2. `src/security/appCheck.ts` (App Check ReCaptchaV3Provider, token TTL, fallback offline mode on isSupported() === false)
3. `src/security/checkDocSize.ts` (950KB pre-write size checker)
4. `src/catalog/catalogTypes.ts` (manifest, catalog schemas, override delta models)
5. `src/catalog/seedExercises.json` & `src/catalog/seedFoods.json` (bundled default exercises & foods)
6. `src/catalog/catalogService.ts` (dedicated IndexedDB key `logbook_cached_global_catalog`, manifest reader O(1), seed fallback, sync)
7. `src/catalog/deltaResolver.ts` (merges global catalog with user custom exercises and overrides, conforming to AGENTS.md 5-step checklist)

## Mandatory Documents & Findings
- `C:\Users\gerar\Documents\GitHub\logbook\.agents\ORIGINAL_REQUEST.md`
- `C:\Users\gerar\Documents\GitHub\logbook\AGENTS.md`
- Explorer Analyses in `.agents/explorer_survey_1/analysis.md`, `.agents/explorer_survey_2/analysis.md`, `.agents/explorer_survey_3/analysis.md`

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Detailed Requirements
- Ensure strict compliance with 0-cost Firebase Spark constraints (no get()/exists() in rules).
- Array length limits in `firestore.rules`: `library <= 500`, `routines <= 100`, `customFoods <= 1000`, `trainingCycles <= 50`, `supplements <= 50`, `activePains <= 50`, `history_months <= 120`, `nutrition_months <= 31`.
- Manifest sync must use lightweight versioned manifest checking `version`, `updatedAt`, `schemaVersion`.
- Seed JSON files must provide realistic baseline datasets matching LogBook's current catalog format.
- Delta resolver must resolve library and foods efficiently in memory without bloating the user root document.

Deliver complete files to disk and report back with `handoff.md`.
