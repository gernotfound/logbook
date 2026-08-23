# Handoff Report — Firestore Deletion Permission Fixes & AppCheck Clean Fallback

## 1. Observation
1. **Firestore Security Rules Whitelist Mismatch**:
   - In `firestore.rules`, the write rule for `users/{userId}` whitelisted 10 fields: `['profile', 'library', 'routines', 'customFoods', 'activeWorkout', 'trainingCycles', 'activeCycleId', 'nutritionPlanning', 'supplements', 'activePains']`.
   - In `src/lib/db.ts` (lines 216–228) and `src/types.ts` (line 331), `userDocData` serializes an 11th property: `catalogOverrides: overridesToSave`.
   - When deleting an exercise or workout, `DB.saveUserData` stages both `users/{userId}` and `users/{userId}/history_months/{YYYY-MM}` in a single atomic Firestore batch. Because `catalogOverrides` was rejected by the `hasOnly([...])` check, Firestore rejected the entire batch with `permission-denied`, preventing the workout deletion from persisting.
   - In `firestore.rules`, `/global_catalog/{document=**}` had no explicit rule and was blocked by the default deny rule.
2. **AppCheck Spurious Warnings & False Degradation**:
   - In `src/lib/appCheck.ts`, when `siteKey` (`VITE_RECAPTCHA_V3_SITE_KEY` or `VITE_RECAPTCHA_SITE_KEY`) was empty, `initAppCheck` set `isFallbackOfflineMode = true` and logged a warning.
   - In `src/lib/firebase.ts`, the `.then` handler logged `"App Check fallito o non supportato. App in modalità degradata."` even when AppCheck was simply not configured.
3. **Vitest Mock Setup Gap**:
   - In `tests/setup.tsx`, `firebase/auth` lacked the `indexedDBLocalPersistence: {}` export imported by `src/lib/firebase.ts`.

---

## 2. Logic Chain
1. By adding `'catalogOverrides'` to the `incomingData().keys().hasOnly([...])` array in `firestore.rules`, `userDocData` is fully whitelisted and passes Firestore security evaluation on create and update operations.
2. Adding `match /global_catalog/{document=**} { allow read: if true; allow write: if false; }` ensures the public global catalog can be retrieved without permission errors.
3. In `src/lib/appCheck.ts`, when `siteKey` is absent/empty/whitespace, `initAppCheck` cleanly returns `{ success: true, appCheck: null, isFallbackOffline: false, disabled: true, reason: 'Site key not configured' }` without logging warnings or marking the client as degraded offline mode.
4. In `src/lib/firebase.ts`, updating the handler to check `!res.success && !res.disabled` prevents misleading console warning banners when AppCheck is intentionally omitted.
5. In `tests/setup.tsx`, adding `indexedDBLocalPersistence: {}` and `firebase/app-check` mocks resolves import errors during test suite startup.
6. Three new automated test suites (`tests/firestore_security_rules.test.ts`, `tests/workout_deletion_persistence.test.ts`, and `tests/appCheck_fallback.test.ts`) verify that all fields in `UserData` match security rules, subcollection deletions behave properly when single workouts or entire months are removed, and AppCheck gracefully initializes or falls back.

---

## 3. Caveats
- If Firestore App Check enforcement is strictly enabled in the Firebase Console in the future without configuring `VITE_RECAPTCHA_V3_SITE_KEY`, backend requests will be rejected with `permission-denied` by Firebase server-side. In client code, AppCheck will remain disabled unless a valid key is provided.
- No other caveats.

---

## 4. Conclusion
- **R1 (Firestore Security Rules & Workout Deletion)**: Fixed. `catalogOverrides` is now whitelisted on `users/{userId}`, subcollection deletion rules for `history_months` and `nutrition_months` allow owner delete, and `global_catalog` is publicly readable.
- **R2 (AppCheck Clean Fallback)**: Fixed. Missing site keys are handled as cleanly unconfigured/disabled without false warning alarms or spurious offline degradation.
- **Test Infrastructure & Coverage**: Repaired `tests/setup.tsx` mock and implemented 15 new automated tests across 3 dedicated test files covering security rules whitelist, workout deletion batch persistence, and AppCheck fallback.
- **Build & Quality Gates**: `npm.cmd run build` passes with code 0 (0 TypeScript errors, Vite build succeeded). `npm.cmd run lint` passes with 0 errors. All 15 targeted unit and integration tests pass.

---

## 5. Verification Method
- **Run Targeted Test Suites**:
  ```powershell
  npx.cmd vitest run tests/firestore_security_rules.test.ts tests/workout_deletion_persistence.test.ts tests/appCheck_fallback.test.ts
  ```
  Result: 3 test files passed, 15 tests passed.
- **Run TypeScript & Vite Build**:
  ```powershell
  npm.cmd run build
  ```
  Result: Exits with code 0 (`tsc --noEmit && vite build`).
- **Run Linting**:
  ```powershell
  npm.cmd run lint
  ```
  Result: 0 errors.
