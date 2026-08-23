# Handoff Report — Reviewer & Adversarial Critic

## 1. Observation

### Codebase and Architecture Inspection
- **`src/lib/db.ts`**:
  - *Save Amnesia Fix (lines 253–269)*: `lastSavedStateStr = JSON.stringify(state)` is updated strictly upon successful `batch.commit()` or when `hasWrites === false`. When a network timeout, `code === 'unavailable'`, or offline error occurs in catch block (`lines 259–265`), `lastSavedStateStr` is intentionally NOT updated, ensuring subsequent saves will re-diff and sync pending changes. Non-offline critical errors (e.g. `permission-denied`) are re-thrown (`line 265`).
  - *Windowed Loading (lines 79–115)*: `DB.loadUserData()` calculates a 3-month rolling window `[0, 1, 2].map(offset => ...)` and issues targeted `getDoc()` queries for the user document, `history_months`, and `nutrition_months`, eliminating unbounded full-collection scans. New users without a Firestore doc receive default parsed state cleanly (`lines 61–77`).
  - *Batch Operations & Deletion Chunking (lines 306–314)*: `DB.deleteAccount()` slices all collected subcollection references and user doc references into chunks of `CHUNK_SIZE = 400`, preventing Firestore's 500-operation write limit from being exceeded.
  - *Document Size Guard (lines 18–24)*: `checkDocSize()` enforces a 950KB safety threshold before committing documents.

- **`src/lib/schema.ts`**:
  - *DomainParsers (lines 346–357)*: Exports 10 specialized domain parsers (`parseProfile`, `parseWorkoutSession`, `parseHistory`, `parseNutrition`, `parseLibrary`, `parseCustomFoods`, `parseRoutines`, `parseTrainingCycles`, `parseSupplements`, `parseNutritionPlanning`).
  - *Resilience & Sanitization*: Defensive converters (`safeString`, `safeNumber`, `safeOptionalNumber`, `safeOptionalNullableNumber`, `safeBoolean`, `safeOptionalBoolean`) recover gracefully from `NaN`, empty strings, wrong types, and `null` without throwing.
  - *Backward Compatibility*: `.passthrough()` is declared across all sub-schemas and `UserDataSchema` (`line 344`), ensuring unrecognized or legacy fields are not stripped.

- **`src/contexts/AuthContext.tsx`**:
  - *Deterministic Guest Merge (lines 98–122)*: When guest links Google account, `mergeUserData` reconciles array collections deduplicated by `id`, merges nutrition records by date/meal ID, and applies guest precedence for non-empty scalars before passing through `UserDataSchema.parse()`.
  - *In-flight Sync Reconciliation (lines 58–67)*: In `loadData()`, if `syncing` is active and local changes exist (`latestData`), `mergeUserData(cloudData, latestData)` prevents incoming cloud reads from obliterating in-flight local modifications.

- **`src/components/Training/TrainingSession.tsx`**:
  - *Referential Stability (lines 45, 394)*: `const EMPTY_HISTORY_ARRAY: Array<...> = [];` module-level constant is used as fallback in `pastWorkouts = exerciseHistoryMap.get(exItem.exId) || EMPTY_HISTORY_ARRAY;`, preserving referential identity (`===`) and avoiding redundant re-renders in memoized `SessionExerciseCard`.

- **`src/hooks/useNutritionPlanning.ts` & `src/hooks/useNutritionMeals.ts`**:
  - *Selector Narrowing & Immutability*: Hooks select fine-grained slices (`nutritionPlanning`, `nutritionMap`, `profile`) instead of entire `userData`, and avoid in-place state mutation. `tdeeCalc` is wrapped in `useMemo`.

- **`firestore.rules`**:
  - *Hardened Multi-Tenant Rules*: Global default deny `match /{document=**} { allow read, write: if false; }`. Whitelist on `users/{userId}` strictly allows the 9 known keys (`profile`, `library`, `routines`, `customFoods`, `activeWorkout`, `trainingCycles`, `activeCycleId`, `nutritionPlanning`, `supplements`). Monthly subcollections enforce regex `isValidMonthId(monthId)` (`^[0-9]{4}-(0[1-9]|1[0-2])$`).

### Build, Test, and Lint Execution Results
1. **`npm.cmd test`**:
   - **Result**: `Test Files 24 passed (24)`, `Tests 444 passed (444)`.
   - **Duration**: 26.32s. Zero failing tests.
2. **`npm.cmd run build`**:
   - **Result**: `tsc --noEmit && vite build` completed with exit code 0. Zero TypeScript errors.
   - PWA assets, bundles, and service worker generated cleanly.
3. **`npm.cmd run lint`**:
   - **Result**: `oxlint` completed with exit code 0 (0 errors, 1 standard React hooks warning).

---

## 2. Logic Chain

1. **Save Amnesia & Offline Resilience**:
   - In `db.ts`, `lastSavedStateStr` tracks the state confirmed by Firestore. Because `lastSavedStateStr` is only updated inside the `try` block after `batch.commit()` resolves or when no writes occurred, any offline network error or timeout leaves `lastSavedStateStr` pointing to the previous valid state.
   - On the next user action or save trigger, `deepEqual(state, oldState)` re-evaluates all uncommitted changes, producing `hasWrites = true` and retrying the commit.
   - Non-offline fatal errors are propagated so callers (Zustand store) reject the promise, update `saveError`, and alert the user.

2. **Windowed Loading**:
   - Querying `users/{uid}/history_months/{YYYY-MM}` and `nutrition_months/{YYYY-MM}` for only the current and prior 2 months bounds read latency to O(1) Firestore operations (1 user doc + 3 history docs + 3 nutrition docs = 7 `getDoc` calls maximum).
   - This prevents scaling bottlenecks when an account accumulates years of workout history.

3. **Schema Sanitization & Domain Parsers**:
   - The modular `DomainParsers` allow granular validation at load time without the CPU bottleneck of monolithic parsing.
   - Combined with `.passthrough()`, existing user collections are preserved without data corruption or key loss.

4. **Deterministic Merge & Race Condition Protection**:
   - The merge algorithm uses deterministic ID deduplication, avoiding blind object spreading.
   - In `AuthContext.tsx`, checking `syncing` in `loadData()` guarantees that background fetches do not wipe out mutations made while the network request was in flight.

5. **Integrity & Absence of Cheating**:
   - Source code contains real, active validation and persistence logic without facade mocks or hardcoded test returns.
   - All tests run against genuine implementations and verify both happy paths and hostile stress cases.

---

## 3. Caveats

- **Network-Level Latency in Stress Benchmarks**: In parallel test execution with 24 concurrent suites on Windows, CPU throttling can cause execution duration of synthetic merge benchmarks to vary; standalone test runs confirm sub-120ms performance for 1,000 items.
- **Historical History Access (> 3 months)**: The windowed loading fetches the last 3 months by default. Older months remain safely stored in Firestore subcollections. If a user needs to view data from 12+ months ago, a dedicated historical pagination query would load those on-demand.
- No other caveats.

---

## 4. Conclusion

**Verdict: APPROVE**

The architectural refactoring completely resolves all targeted issues:
- Save Amnesia is definitively eliminated with robust offline recovery and diffing.
- The 3-month windowing bounds Firestore read costs to O(1).
- Zod DomainParsers provide resilient, backward-compatible runtime defense.
- Deterministic guest merge and in-flight sync reconciliation eliminate data loss race conditions.
- Batch write chunking respects Firestore's 500-operation ceiling.
- `EMPTY_HISTORY_ARRAY` restores memoization stability in the training session.
- `firestore.rules` enforces multi-tenant owner authorization, document key whitelisting, and strict month ID regex.
- All 444 unit and adversarial stress tests pass, and both `build` and `lint` succeed cleanly with 0 errors.

---

## 5. Verification Method

To independently verify these conclusions:

```powershell
# 1. Run full unit and adversarial test suite
npm.cmd test

# 2. Verify TypeScript compilation and production bundle build
npm.cmd run build

# 3. Verify static analysis and linter
npm.cmd run lint

# 4. Inspect core implementation files
# - src/lib/db.ts (Save amnesia, windowing, chunking)
# - src/lib/schema.ts (DomainParsers, defensive schemas)
# - src/contexts/AuthContext.tsx (Merge & sync reconciliation)
# - firestore.rules (Security rules whitelist & month regex)
```

**Invalidation conditions**:
- Any regression causing `npm.cmd test` to fail.
- Any TypeScript error during `npm.cmd run build`.
- Any leak of non-whitelisted keys into Firestore user doc root.
