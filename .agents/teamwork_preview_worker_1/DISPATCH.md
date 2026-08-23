## 2026-08-22T20:48:09Z

You are teamwork_preview_worker_1 (Implementation Worker).
Your working directory is: C:\Users\gerar\Documents\GitHub\logbook\.agents\teamwork_preview_worker_1
Project root: C:\Users\gerar\Documents\GitHub\logbook

Mandatory inputs to read first:
- ORIGINAL_REQUEST.md: C:\Users\gerar\Documents\GitHub\logbook\.agents\ORIGINAL_REQUEST.md
- Architecture & rules: C:\Users\gerar\Documents\GitHub\logbook\AGENTS.md
- Global Project Plan: C:\Users\gerar\Documents\GitHub\logbook\PROJECT.md
- Survey findings:
  - C:\Users\gerar\Documents\GitHub\logbook\.agents\teamwork_preview_spec_miner_survey_1\handoff.md
  - C:\Users\gerar\Documents\GitHub\logbook\.agents\teamwork_preview_explorer_survey_2\handoff.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Scope and Write Ownership:
You own editing and creating the following files:
1. `firestore.rules`
2. `src/lib/appCheck.ts`
3. `src/lib/firebase.ts`
4. `tests/setup.tsx`
5. `tests/firestore_security_rules.test.ts` (new)
6. `tests/workout_deletion_persistence.test.ts` (new)
7. `tests/appCheck_fallback.test.ts` (new)

Detailed Requirements to Implement:
1. **R1: Fix Firestore Security Rules for Workout Deletion**:
   - In `firestore.rules`:
     - Under `match /users/{userId}`, update the `create` and `update` rules' `incomingData().keys().hasOnly([...])` array to include `'catalogOverrides'`. The full allowed keys must match all root user document fields serialized in `DB.saveUserData` (`src/lib/db.ts`) and `UserData` (`src/types.ts`): `['profile', 'library', 'routines', 'customFoods', 'activeWorkout', 'trainingCycles', 'activeCycleId', 'nutritionPlanning', 'supplements', 'activePains', 'catalogOverrides']`.
     - Ensure the rules for `/global_catalog/{document=**}` allow read for authenticated users (or public read if applicable).
     - Ensure subcollection delete rules on `/users/{userId}/history_months/{month}` and `/users/{userId}/nutrition_months/{month}` allow delete when `isOwner(userId)`.
2. **R2: Clean AppCheck Initialization and Fallback**:
   - In `src/lib/appCheck.ts`:
     - When `siteKey` (`VITE_RECAPTCHA_V3_SITE_KEY` or `VITE_RECAPTCHA_SITE_KEY`) is missing or empty, do NOT log a warning or set `isFallbackOfflineMode = true`. Instead, treat AppCheck as cleanly unconfigured/disabled (`disabled: true`, `isFallbackOffline: false`, `success: true`).
     - Check `isSupported()` from `firebase/app-check` if in a browser environment to avoid initializing in unsupported browsers.
     - `isAppCheckFallbackOffline()` should only return `true` if AppCheck was configured and actively failed with network/token errors requiring offline fallback.
   - In `src/lib/firebase.ts`:
     - Update the `.then((res) => ...)` handler so that it only logs a warning if AppCheck was enabled and failed (`!res.success && !res.disabled`), and avoid calling it "modalità degradata" when AppCheck is simply not configured.
3. **Fix Test Setup Mock in `tests/setup.tsx`**:
   - Add `indexedDBLocalPersistence: {}` to the `firebase/auth` mock in `tests/setup.tsx` alongside `browserLocalPersistence: {}`.
4. **Implement Automated Test Suites**:
   - `tests/firestore_security_rules.test.ts`:
     - Parse/validate `firestore.rules` and compare the `hasOnly` whitelist on `users/{userId}` against `UserData` keys and `userDocData` payload from `DB.saveUserData`. Ensure all fields are permitted.
   - `tests/workout_deletion_persistence.test.ts`:
     - Test workout deletion flow using `useAppStore` / `DB.saveUserData`.
     - Test deleting a single workout session from a month with multiple sessions (verifies month doc is updated without deleted session).
     - Test deleting the last workout session in a month (verifies month doc is deleted from subcollection).
     - Verify no permission errors or batch failures occur.
   - `tests/appCheck_fallback.test.ts`:
     - Test `initAppCheck` when site key is missing, empty, or whitespace -> returns clean success/disabled, no offline fallback, no unhandled exceptions.
     - Test `isAppCheckFallbackOffline` behavior.
5. **Verification**:
   - Run `npm.cmd test` (all unit and integration tests must pass).
   - Run `npm.cmd run build` (TypeScript compilation and Vite build must exit 0).
   - Run `npm.cmd run lint` (0 errors).
6. **Handoff**:
   - Write your complete change log and test verification report in `C:\Users\gerar\Documents\GitHub\logbook\.agents\teamwork_preview_worker_1\handoff.md`.
   - Send a message to parent with path to handoff when done.
