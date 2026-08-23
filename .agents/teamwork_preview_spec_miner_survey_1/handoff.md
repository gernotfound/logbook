# Handoff Report — Spec & Test Infrastructure Survey

## 1. Observation
1. **Firestore Security Rules**: In `firestore.rules` (lines 31–44), the write rule for `users/{userId}` whitelists only:
   `['profile', 'library', 'routines', 'customFoods', 'activeWorkout', 'trainingCycles', 'activeCycleId', 'nutritionPlanning', 'supplements', 'activePains']`.
2. **Database Payload Discrepancy**: In `src/lib/db.ts` (lines 217–228), `DB.saveUserData` serializes `userDocData` with property `catalogOverrides: overridesToSave`. This property is also defined in `src/types.ts` (line 331) and validated in `src/lib/schema.ts` (line 473).
3. **AppCheck Initialization**: In `src/lib/appCheck.ts` (lines 98–107), when `VITE_RECAPTCHA_V3_SITE_KEY` is missing or empty, `initAppCheck` sets `isFallbackOfflineMode = true` and returns `success: false`. In `src/lib/firebase.ts` (lines 56–60), this logs `console.warn("App Check fallito o non supportato. App in modalità degradata.", res.reason);`.
4. **Vitest Mocking Gap in `tests/setup.tsx`**: In `tests/setup.tsx` (lines 137–155), `firebase/auth` is mocked with `browserLocalPersistence: {}`, but does NOT export `indexedDBLocalPersistence`. `src/lib/firebase.ts` (lines 12, 78) imports and uses `indexedDBLocalPersistence`. Running `npm.cmd test` fails at initialization across all 70 test suites due to:
   `Error: [vitest] No "indexedDBLocalPersistence" export is defined on the "firebase/auth" mock.`
5. **Codebase Quality & Build**:
   - `npm.cmd run lint` (`oxlint`): 0 errors, 70 warnings (unused imports in tests).
   - `npm.cmd run build` (`tsc --noEmit && vite build`): exits with code 0 (0 type errors).

---

## 2. Logic Chain
1. When a user deletes a workout (`useTrainingHistory.deleteWorkout` -> `saveUserData`), `DB.saveUserData` stages the state change into a `writeBatch(db)`.
2. `DB.saveUserData` stages both the root user document write (`batch.set(userRef, cleanUserDocData, { merge: true })`) and the subcollection change (`batch.set` or `batch.delete` on `users/{uid}/history_months/{month}`).
3. Firestore processes batches atomically. When evaluating `batch.set(userRef, ...)`, Firestore checks `incomingData().keys().hasOnly([...])`.
4. Because `cleanUserDocData` contains `'catalogOverrides'`, which is not present in `firestore.rules`'s whitelist, Firestore evaluates `hasOnly(...)` to `false` and rejects the entire batch with `code: 'permission-denied'`.
5. `DB.saveUserData` catches this error, logs `"Errore critico durante il salvataggio Firestore"`, and throws. `useAppStore` captures the error, sets `saveError`, and rejects the promise, causing the UI to show an error alert and blocking the deletion on the cloud.
6. For AppCheck, when the public reCAPTCHA site key is not configured in `.env`, `initAppCheck` incorrectly treats it as a failure and activates offline fallback mode instead of treating AppCheck as cleanly optional/unconfigured.

---

## 3. Caveats
- No changes to source code were made during this mining phase (read-only compliance).
- When updating `tests/setup.tsx` with `indexedDBLocalPersistence: {}`, all existing unit test files will unblock and execute under Vitest.

---

## 4. Conclusion
1. **Fix for Deletion Permission Error**: Update `firestore.rules` on `users/{userId}` to include `'catalogOverrides'` in `incomingData().keys().hasOnly([...])`, and add a public read-only rule for `/global_catalog/{document=**}`.
2. **Fix for AppCheck Fallback**: Update `src/lib/appCheck.ts` and `src/lib/firebase.ts` so that an absent `VITE_RECAPTCHA_V3_SITE_KEY` cleanly skips initialization without setting `isFallbackOfflineMode = true` or emitting "modalità degradata" warnings.
3. **Fix for Test Setup**: Add `indexedDBLocalPersistence: {}` to `tests/setup.tsx` so all Vitest test suites can run without mock import errors.
4. **Test Implementation Plan**: Implement dedicated automated test suites covering Security Rules whitelist verification, Workout Deletion persistence (single vs multi-item month chunking and deletion), AppCheck fallback, and `DB.saveUserData` regression safety.

---

## 5. Verification Method
- **Lint Check**: Run `npm.cmd run lint` (must complete with 0 errors).
- **TypeScript Build Check**: Run `npm.cmd run build` (must complete with 0 errors).
- **Test Setup Verification**: Add `indexedDBLocalPersistence: {}` to `tests/setup.tsx` and run `npm.cmd test`.
- **Targeted Test Execution**: Run `npx vitest run tests/firestore_security_rules.test.ts` and `npx vitest run tests/workout_deletion_persistence.test.ts`.
