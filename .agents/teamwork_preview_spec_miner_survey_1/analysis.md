# Detailed Specification & Test Infrastructure Analysis

## Executive Summary
This document provides a comprehensive survey of Firestore security rules, database schemas, AppCheck initialization, and testing infrastructure for LogBook. It identifies the root cause of the "Missing or insufficient permissions" error during workout deletion, specifies the AppCheck fallback requirements, and defines a robust automated test strategy.

---

## 1. Firestore Security Rules & Authorization Architecture

### 1.1 Current `firestore.rules` Analysis
The Firestore security rules in `firestore.rules` define a default-deny policy with role/ownership helpers:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAuthenticated() { return request.auth != null; }
    function isOwner(userId) { return isAuthenticated() && request.auth.uid == userId; }
    function isValidMonthId(monthId) { return monthId.matches('^[0-9]{4}-(0[1-9]|1[0-2])$'); }
    function incomingData() { return request.resource.data; }

    match /{document=**} { allow read, write: if false; }

    match /users/{userId} {
      allow read, delete: if isOwner(userId);
      allow create, update: if isOwner(userId)
        && incomingData().keys().hasOnly([
          'profile',
          'library',
          'routines',
          'customFoods',
          'activeWorkout',
          'trainingCycles',
          'activeCycleId',
          'nutritionPlanning',
          'supplements',
          'activePains'
        ]);
        
      match /history_months/{monthId} {
        allow read, delete: if isOwner(userId);
        allow create, update: if isOwner(userId) && isValidMonthId(monthId);
      }
      
      match /nutrition_months/{monthId} {
        allow read, delete: if isOwner(userId);
        allow create, update: if isOwner(userId) && isValidMonthId(monthId);
      }
    }
  }
}
```

### 1.2 Root Cause of "Missing or Insufficient Permissions" during Workout Deletion
1. **The Discrepancy / Root Cause**:
   - `DB.saveUserData` in `src/lib/db.ts` (lines 217–228) serializes the root user document payload as:
     ```typescript
     const userDocData = {
         profile: state.profile || {},
         library: effectiveCustomExercises,
         routines: state.routines || [],
         customFoods: effectiveCustomFoods,
         activeWorkout: state.activeWorkout || null,
         trainingCycles: state.trainingCycles || [],
         activeCycleId: state.activeCycleId !== undefined ? state.activeCycleId : null,
         nutritionPlanning: state.nutritionPlanning || null,
         supplements: state.supplements || [],
         activePains: state.activePains || [],
         catalogOverrides: overridesToSave
     };
     ```
   - Notice the key **`catalogOverrides`**.
   - In `firestore.rules`, the root document write rule enforces:
     `incomingData().keys().hasOnly(['profile', 'library', 'routines', 'customFoods', 'activeWorkout', 'trainingCycles', 'activeCycleId', 'nutritionPlanning', 'supplements', 'activePains'])`.
   - `catalogOverrides` is **missing from the whitelist** in `firestore.rules`.
2. **Impact on Deletion**:
   - When a workout is deleted (`useTrainingHistory.deleteWorkout` -> `saveUserData`), `DB.saveUserData` combines changes into a single atomic `writeBatch(db)`.
   - If the root user document is updated in the same batch (e.g. `activeWorkout` cleared, `catalogOverrides` present on first state change or dirty diff), `batch.set(userRef, cleanUserDocData, { merge: true })` is added to the batch alongside `batch.set` or `batch.delete` on `history_months/{monthId}`.
   - Firestore processes batches **atomically**. Because `cleanUserDocData` contains `'catalogOverrides'`, Firestore rejects the write to `users/{uid}` with `code: 'permission-denied'`.
   - The entire batch fails, aborting the subcollection deletion.
   - `DB.saveUserData` throws an exception, leading to `saveError` and the UI alert: `"Errore durante l'eliminazione dell'allenamento."` / `"Errore critico durante il salvataggio Firestore"`.
3. **Secondary Rule Gap**:
   - `global_catalog` reads: `syncGlobalCatalog` queries `/global_catalog/manifest`. Since `firestore.rules` has a default deny-all without a rule for `/global_catalog/{document=**}`, remote catalog reads fail silently (falling back to static seed). An explicit public read rule `allow read: if true; allow write: if false;` for `global_catalog` is needed.

---

## 2. AppCheck Fallback Specification

### 2.1 Current Implementation Behavior
- In `src/lib/firebase.ts` (lines 56–60):
  ```typescript
  initAppCheck(app).then((res) => {
      if (!res.success) {
          console.warn("App Check fallito o non supportato. App in modalità degradata.", res.reason);
      }
  });
  ```
- In `src/lib/appCheck.ts` (lines 98–107):
  ```typescript
  if (!siteKey || siteKey.trim() === '') {
      console.warn(`[AppCheck] ${APP_CHECK_STRINGS.missingSiteKeyWarning}`);
      isFallbackOfflineMode = true;
      return {
          success: false,
          appCheck: null,
          isFallbackOffline: true,
          reason: APP_CHECK_STRINGS.missingSiteKeyWarning
      };
  }
  ```

### 2.2 Problems with Current AppCheck Behavior
1. When `VITE_RECAPTCHA_V3_SITE_KEY` is not supplied (the default in dev, test, and self-hosted environments):
   - It sets `isFallbackOfflineMode = true`.
   - It returns `success: false`.
   - It logs a warning stating that the app is in "modalità degradata".
2. Setting `isFallbackOfflineMode = true` falsely signals to any telemetry/state checks that the app is degraded or offline, even though Firebase Auth and Firestore function normally without App Check enforcement.

### 2.3 Required Behavior & Contract
- When `siteKey` is absent/empty:
  - Do NOT flag the app as broken or force `isFallbackOfflineMode = true`.
  - Return `{ success: true, appCheck: null, isFallbackOffline: false }` or a clean disabled state indicating App Check is unconfigured/optional.
  - Do not trigger noisy console warnings about "modalità degradata" when the key is intentionally not provided.
  - Allow standard Firestore operations to proceed unimpeded.

---

## 3. Existing Test Infrastructure & Setup Survey

### 3.1 Test Stack Overview
- **Runner**: Vitest 4.1.10 (`npm.cmd test` / `vitest run`).
- **DOM Environment**: `jsdom` 29.1.1.
- **Testing Library**: `@testing-library/react` 16.3.2.
- **Linter**: `oxlint` 1.76.0 (`npm.cmd run lint` passing with 0 errors).
- **TypeScript & Build**: TypeScript 7.0.2 / Vite 8.2.0 (`npm.cmd run build` passing with 0 errors).

### 3.2 Vitest Startup Bug in `tests/setup.tsx`
- **Observed Issue**: Running `npm.cmd test` failed on all 70 test suites with:
  ```
  Error: [vitest] No "indexedDBLocalPersistence" export is defined on the "firebase/auth" mock.
  ```
- **Root Cause**:
  `src/lib/firebase.ts` imports `indexedDBLocalPersistence` from `'firebase/auth'`, but `tests/setup.tsx` (lines 137–155) only mocks `browserLocalPersistence: {}`.
- **Fix Required in `tests/setup.tsx`**:
  Add `indexedDBLocalPersistence: {}` to the `firebase/auth` mock definition in `tests/setup.tsx`.

---

## 4. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Security Rules | Root User Doc Authorization | Whitelist allowed fields on `users/{userId}` create/update | `request.resource.data.keys()`, `userId` | `allow / deny` | Rejects payloads with extra keys (`permission-denied`) | `firestore.rules:28-44` |
| 2 | Security Rules | History Months Authorization | Validates month ID format `YYYY-MM` and ownership | `monthId`, `userId` | `allow / deny` | Rejects non-conforming month strings | `firestore.rules:47-51` |
| 3 | Security Rules | Nutrition Months Authorization | Validates month ID format `YYYY-MM` and ownership | `monthId`, `userId` | `allow / deny` | Rejects non-conforming month strings | `firestore.rules:54-58` |
| 4 | Security Rules | Global Catalog Access | Read-only rules for static exercise and food catalog | Collection path | `allow / deny` | Default-denied without explicit rule | `firestore.rules:23-25`, `catalogService.ts` |
| 5 | Database | Windowed History Loading | Loads target month and 2 preceding months (O(1) reads) | `user.uid`, target months array | Populates `state.history` | Catches & throws timeout/network errors | `src/lib/db.ts:99-119` |
| 6 | Database | Monthly History Chunking | Groups workout sessions by `YYYY-MM` and writes/deletes month docs | `state.history`, `oldState.history` | `batch.set`, `batch.delete` | Checks document size < 950KB | `src/lib/db.ts:235-267` |
| 7 | Database | Catalog Overrides Migration | Splits library/customFoods into catalog overrides and custom items | `state.library`, `state.customFoods` | `effectiveCustomExercises`, `overridesToSave` | Pure transformation | `src/lib/db.ts:182-200` |
| 8 | Database | Account Cascade Deletion | Batch deletes history_months, nutrition_months, user doc, Auth user | `user.uid` | Auth user deleted, docs removed | Chunked at 400 operations/batch | `src/lib/db.ts:331-371` |
| 9 | App Check | ReCaptcha V3 Provider Init | Initializes AppCheck if siteKey is present | `FirebaseApp`, `AppCheckInitOptions` | `AppCheckResult` | Sets `isFallbackOfflineMode` | `src/lib/appCheck.ts:83-150` |
| 10 | App Check | Missing Key Fallback | Handles missing `VITE_RECAPTCHA_V3_SITE_KEY` | None | `AppCheckResult` | Currently sets `isFallbackOffline=true` (needs clean non-blocking state) | `src/lib/appCheck.ts:98-107` |
| 11 | App Check | Telemetry Status | Returns diagnostic state of AppCheck provider and token TTL | None | `AppCheckStatusDetails` | Returns `provider: 'none'` when uninitialized | `src/lib/appCheck.ts:200-209` |
| 12 | State & Sync | Store Debounced Save | Debounces state mutations (1000ms) before committing to Firestore | `UserData` state | Promise resolution | Rejects promise and sets `saveError` on failure | `createSyncSlice.ts:40-93` |
| 13 | State & Sync | IndexedDB Tier 2 Cache | Instant offline cache of `UserData` | `UserData` | IndexedDB write | Catches and logs warn | `createDataSlice.ts:25-39` |
| 14 | State & Sync | Live Workout LocalStorage Shield | Synchronously saves active session to `localStorage` | `localWorkout` | `localStorage` item | Synchronous item set | `useAppStore.ts:22-35` |
| 15 | Error Handler | Sentence Case Error Mapping | Maps Firebase error codes to localized Italian Sentence case | `error: unknown` | `FormattedSyncError` | Fallback `ERR_UNKNOWN` | `src/lib/errorHandler.ts:56-287` |

---

## 5. Edge Cases

| # | Feature | Input | Observed Behavior |
|---|---------|-------|-------------------|
| 1 | Workout Deletion | Delete the only workout in a month (`history` has 1 item in `2026-08`) | `newHistMonths['2026-08']` is undefined; `batch.delete` called on `users/{uid}/history_months/2026-08`. |
| 2 | Workout Deletion | Delete one workout when multiple exist in the same month | `newHistMonths['2026-08']` has remaining items; `batch.set` called on `users/{uid}/history_months/2026-08`. |
| 3 | Workout Deletion | Delete workout while `catalogOverrides` exists in `state` | `batch.set` on `users/{uid}` included in atomic batch; denied by Firestore rules due to missing whitelist entry. |
| 4 | Workout Deletion | Delete active workout currently in progress | `localWorkout` cleared in `localStorage` and store; `activeWorkout: null` synchronized. |
| 5 | App Check Init | `VITE_RECAPTCHA_V3_SITE_KEY` is undefined | Triggers missing key fallback; should not disable online features or log critical warnings. |
| 6 | App Check Init | `VITE_RECAPTCHA_V3_SITE_KEY` is whitespace `"   "` | Handled same as empty string. |
| 7 | Month ID Formatting | Workout with timestamp but no `date` property | Derived via `getLocalDateString(h.globalStartTime).substring(0, 7)`. |
| 8 | Month ID Boundary | Month ID string `'2026-00'` or `'2026-13'` | Rejected by `isValidMonthId` regex `^[0-9]{4}-(0[1-9]|1[0-2])$`. |
| 9 | Document Size Guard | Payload exceeding 950KB | `checkDocSize` throws `ERR_DOC_SIZE_EXCEEDED` before sending to Firestore. |
| 10 | Offline Deletion | Workout deleted while offline (`navigator.onLine === false`) | Saved to IndexedDB; batch error caught with `isOfflineSafe: true`; diff preserved for retry on reconnection. |

---

## 6. Automated Testing Strategy Specification

To verify the fixes and prevent future regressions, the test suite must be structured as follows:

### Test Suite 1: Security Rules Whitelist & Constraint Verification (`tests/firestore_security_rules.test.ts`)
- **Objective**: Ensure that every property serialized by `DB.saveUserData` is permitted by `firestore.rules`.
- **Test Cases**:
  1. `users/{userId}` whitelist in `firestore.rules` includes all keys serialized by `DB.saveUserData`: `['profile', 'library', 'routines', 'customFoods', 'activeWorkout', 'trainingCycles', 'activeCycleId', 'nutritionPlanning', 'supplements', 'activePains', 'catalogOverrides']`.
  2. `global_catalog` public read rule is present: `match /global_catalog/{document=**} { allow read: if true; allow write: if false; }`.
  3. `isValidMonthId` rejects invalid formats (e.g. `'2026-8'`, `'2026-13'`, `'invalid'`) and accepts valid `YYYY-MM` formats.
  4. Ownership enforcement denies unauthenticated requests and mismatched `auth.uid`.

### Test Suite 2: Workout Deletion & Firestore Batching (`tests/workout_deletion_persistence.test.ts`)
- **Objective**: Verify that deleting a workout properly manages subcollections and document updates without permission errors.
- **Test Cases**:
  1. **Single workout in month deletion**: Deleting the sole workout in `2026-08` calls `batch.delete` on `history_months/2026-08`.
  2. **Multi-workout month deletion**: Deleting 1 of 2 workouts in `2026-08` calls `batch.set` on `history_months/2026-08` with the remaining workout.
  3. **Batch payload key validation**: Verify that any `batch.set` on `users/{uid}` contains only keys permitted by `firestore.rules`.
  4. **Active workout cleanup**: When the deleted workout matches `localWorkout.id`, `localWorkout` is cleared from `localStorage` and store.
  5. **Dialog & Error State**: Deletion completes without setting `saveError` or showing error dialogs.

### Test Suite 3: AppCheck Initialization & Non-Destructive Fallback (`tests/appCheck_fallback.test.ts`)
- **Objective**: Ensure AppCheck initializes cleanly when configured and degrades non-destructively when unconfigured.
- **Test Cases**:
  1. **Configured site key**: Initializes `ReCaptchaV3Provider`, acquires token, `isAppCheckActive() === true`, `isFallbackOffline() === false`.
  2. **Missing site key**: Returns `{ success: true, appCheck: null, isFallbackOffline: false }` without throwing errors or setting fallback offline mode.
  3. **Unsupported environment (`isSupported() === false`)**: Returns `{ success: false, appCheck: null, isFallbackOffline: true }` and Italian sentence case message.
  4. **State isolation**: `resetAppCheckStateForTesting()` resets all static state between test runs.

### Test Suite 4: `DB.saveUserData` & `useAppStore` Regression Prevention (`tests/db_save_and_delete_regression.test.ts`)
- **Objective**: Ensure data integrity during saves, deletes, and offline buffering.
- **Test Cases**:
  1. **Diffing accuracy**: Unchanged state does not generate Firestore writes (`hasWrites === false`).
  2. **Offline resilience**: When `commit()` times out or network is offline, data remains in IndexedDB and `saveError` indicates offline status without throwing fatal exceptions.
  3. **Debouncer timing**: Rapid consecutive mutations are batched into a single `DB.saveUserData` call after 1000ms.
