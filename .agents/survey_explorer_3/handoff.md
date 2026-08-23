# Survey Report: Persistence, Storage Tiering, Cloud Merge & Test Infrastructure

**Agent**: Survey Explorer 3  
**Date**: 2026-08-23  
**Target Milestone**: Survey Phase & Technical Assessment  
**Working Directory**: `C:\Users\gerar\Documents\GitHub\logbook\.agents\survey_explorer_3`

---

## 1. Observation

Direct code inspections and execution results across the codebase revealed the following exact structures and behaviors:

### 1.1 Cold Start & Fast Pre-render Bootstrap
In `src/main.tsx` (lines 25–43):
```typescript
let cached = await get<UserData>('logbook_cached_user_data');
if (!cached) {
  const catalog = await getCachedCatalog();
  cached = {
    library: catalog.exercises,
    customFoods: catalog.foods,
  } as any;
} else if (cached && (!cached.library || cached.library.length === 0)) {
    // Just in case it was cached empty by accident during dev
    const catalog = await getCachedCatalog();
    cached.library = catalog.exercises as any;
    cached.customFoods = catalog.foods as any;
}

window.__INITIAL_USER_DATA__ = cached || null;
const initialData = getInitialUserData();
if (initialData && !useAppStore.getState().userData) {
  useAppStore.setState({ userData: initialData });
}
```
- When starting cold (IndexedDB key `'logbook_cached_user_data'` empty) or in guest mode, `main.tsx` puts the entire array of catalog exercises (`catalog.exercises`) and catalog foods (`catalog.foods`) directly into `cached.library` and `cached.customFoods`.
- `window.__INITIAL_USER_DATA__` receives this object, and `useAppStore` initializes its `userData.library` and `userData.customFoods` with the entire static seed catalog (100+ items each).

### 1.2 Store Cache Serialization (IndexedDB Tier 2)
In `src/store/slices/createDataSlice.ts` (lines 25–39) and `src/store/slices/createSyncSlice.ts` (lines 59–65):
```typescript
export const saveUserDataToCache = (data: UserData | null) => {
    try {
        if (data) {
            idbSet('logbook_cached_user_data', data).catch((e) => { ... });
...
const finalData: UserData = {
    ...nextData,
    activeWorkout: nextData.activeWorkout !== undefined ? nextData.activeWorkout : localWorkout
};
saveUserDataToCache(finalData);
```
- Any store update (`saveUserData` or `setUserData`) immediately writes `finalData` to IndexedDB under `'logbook_cached_user_data'`.
- Because `finalData.library` and `finalData.customFoods` contain the entire resolved catalog (100+ exercises and foods), the whole static seed catalog is persisted into the user-specific IndexedDB cache.

### 1.3 Cloud Firestore Persistence & Catalog Extraction
In `src/lib/db.ts` (lines 182–233):
```typescript
// Re-split library & customFoods into pure overrides/custom so we don't save the whole catalog
const catalog = getInMemoryCatalog();
let effectiveCustomExercises = state.library || [];
let effectiveCustomFoods = state.customFoods || [];
let overridesToSave = state.catalogOverrides || {};

if (catalog) {
    const { customExercises, overrides: exOverrides } = migrateLegacyLibraryToOverrides(state.library || [], catalog.exercises);
    const { customFoods, overrides: foodOverrides } = migrateLegacyFoodsToOverrides(state.customFoods || [], catalog.foods);
    overridesToSave = {
        ...overridesToSave,
        exercises: exOverrides.exercises,
        hiddenExerciseIds: exOverrides.hiddenExerciseIds,
        foods: foodOverrides.foods,
        hiddenFoodIds: foodOverrides.hiddenFoodIds,
    };
    effectiveCustomExercises = customExercises;
    effectiveCustomFoods = customFoods;
}

if (!deepEqual(...) || ...) {
    const userRef = doc(db, "users", user.uid);
    const userDocData = {
        profile: state.profile || {},
        library: effectiveCustomExercises,
        routines: state.routines || [],
        customFoods: effectiveCustomFoods,
        ...
        catalogOverrides: overridesToSave
    };
    const cleanUserDocData = removeUndefinedValues(userDocData);
    checkDocSize(cleanUserDocData, "User Profile");
    batch.set(userRef, cleanUserDocData, { merge: true });
}
```
- In `src/lib/catalog/catalogService.ts` (lines 39, 270): `inMemoryCatalogCache` starts as `null` and is only populated after `getCachedCatalog()` or `syncGlobalCatalog()` completes.
- **Critical Vulnerability**: If `DB.saveUserData` is called when `catalog` (`getInMemoryCatalog()`) is `null` (e.g., initial save before sync completes, cleared cache, or in test environments), `migrateLegacyLibraryToOverrides` is skipped. `effectiveCustomExercises` remains `state.library` (all 100+ seed items), and `batch.set(userRef, ...)` writes the entire catalog into `users/{uid}` on Firestore.
- In `src/lib/catalog/deltaResolver.ts` (lines 323–335):
```typescript
for (const item of legacyLibrary) {
    const base = globalMap.get(item.id);
    if (!base || !item.isDefault) {
        // User-created custom exercise
        customExercises.push(item);
    }
```
- If an exercise in `state.library` has `isDefault` undefined or false, it is treated as a user custom exercise and written to Firestore.

### 1.4 Deterministic Guest Merge upon Google Login / Account Linking
In `src/lib/merge.ts` (lines 186–241):
```typescript
export function hasUserData(data?: UserData | null): boolean {
    if (!data) return false;
    if (data.history && data.history.length > 0) return true;
    if (data.routines && data.routines.length > 0) return true;
    if (data.library && data.library.length > 0) return true;
    if (data.customFoods && data.customFoods.length > 0) return true;
    ...
```
```typescript
export function mergeUserData(
    cloudData?: UserData | null,
    guestData?: UserData | null
): UserData {
    const cloud = cloudData || {};
    const guest = guestData || {};

    const rawMerged: UserData = {
        profile: mergeProfile(cloud.profile, guest.profile),
        library: mergeArrayById(cloud.library, guest.library),
        routines: mergeArrayById(cloud.routines, guest.routines),
        history: mergeArrayById(cloud.history, guest.history),
        nutrition: mergeNutrition(cloud.nutrition, guest.nutrition),
        customFoods: mergeArrayById(cloud.customFoods, guest.customFoods),
        activeWorkout: guest.activeWorkout !== undefined && guest.activeWorkout !== null
            ? guest.activeWorkout
            : (cloud.activeWorkout || null),
        nutritionPlanning: mergeNutritionPlanning(cloud.nutritionPlanning, guest.nutritionPlanning),
        trainingCycles: mergeArrayById(cloud.trainingCycles, guest.trainingCycles),
        activeCycleId: (guest.activeCycleId !== undefined && guest.activeCycleId !== null && guest.activeCycleId !== '')
            ? guest.activeCycleId
            : (cloud.activeCycleId || null),
        supplements: mergeArrayById(cloud.supplements, guest.supplements),
        activePains: Array.from(new Set([
            ...(cloud.activePains || []),
            ...(guest.activePains || [])
        ])),
    };

    return UserDataSchema.parse(rawMerged) as unknown as UserData;
}
```
- **False Positive in `hasUserData`**: Because `main.tsx` puts the seed exercises into `guestData.library` and seed foods into `guestData.customFoods`, `hasUserData(guestData)` evaluates to `true` on 100% of guest sessions, even when the user has never created any data.
- In `src/contexts/AuthContext.tsx` (lines 110–125): When an unauthenticated guest logs in or links a Google account, `AuthContext` sees `guestHasData === true` and invokes `mergeUserData(cloudData, guestData)` instead of adopting `cloudData`.
- **Merge Seed Pollution & Cloud Overwrite**: `mergeArrayById` merges the guest's 100+ seed items into the cloud user's library and overwrites cloud items with guest items on ID collision.
- **Omission of `catalogOverrides`**: `rawMerged` does not include `catalogOverrides`. When `UserDataSchema.parse(rawMerged)` runs, `catalogOverrides` falls back to default `{ exercises: {}, foods: {}, hiddenExerciseIds: [], hiddenFoodIds: [] }`. All overrides and hidden items from both cloud and guest are permanently lost!

### 1.5 LocalStorage Strict Serialization & Zod Validation
In `src/hooks/useLocalStorage.ts` (lines 10–38):
- `useLocalStorage` reads from `window.localStorage.getItem(key)` and uses `JSON.parse`.
- If a `schema` (ZodType) is provided, it validates via `schema.safeParse`. On failure, it logs a warning and returns `initialValue`.
- All writes execute `JSON.stringify(storedValue)` in a `useEffect`.
- On `visibilitychange` (hidden) in `useAppStore.ts`, the active workout `localWorkout` is synchronously saved to `localStorage` key `'logbook_local_workout'`.

### 1.6 Test Infrastructure (Vitest & Mocks)
- Config: `vitest.config.ts` (jsdom, `setupFiles: ['./tests/setup.tsx']`, timeout: 10000ms).
- Mock harness in `tests/setup.tsx`:
  - `localStorageMock`: in-memory object `localStorageStore`.
  - `idb-keyval`: in-memory object `idbStore`.
  - `firebase/*`: Mocks for `app`, `auth`, `firestore`, `app-check`.
  - `src/lib/db`: Mocked by default in component tests; can be unmocked via `vi.unmock('../src/lib/db')` for persistence tests.
  - Helper: `renderWithProviders(ui, options)`.
- Command Execution on Windows: Must use `npm.cmd test` (PowerShell security policy blocks `.ps1` wrapper).

---

## 2. Logic Chain

1. **Premise 1 (Storage Tiering Rule)**: Global catalog items must be maintained independently in the dedicated cache key `'logbook_cached_global_catalog'` (or bundled seed) and never persisted into personal user records (`'logbook_cached_user_data'` or Firestore `users/{uid}`).
2. **Premise 2 (Bootstrap Behavior)**: `src/main.tsx` constructs `window.__INITIAL_USER_DATA__` by assigning `catalog.exercises` to `library` and `catalog.foods` to `customFoods` whenever `'logbook_cached_user_data'` is empty.
3. **Inference 1 (Store State Conflation)**: The Zustand store `userData.library` and `userData.customFoods` become monolithic arrays containing both personal custom items and static seed items.
4. **Inference 2 (Cache Pollution)**: `saveUserDataToCache` in `createDataSlice.ts` serializes `useAppStore.getState().userData` directly into IndexedDB `'logbook_cached_user_data'`, embedding all 100+ seed items into the user's personal storage tier.
5. **Inference 3 (Firestore Leak on Cache Miss)**: `DB.saveUserData` depends on `getInMemoryCatalog()`. If `getInMemoryCatalog()` is null (synchronization not yet triggered or cache cleared), `DB.saveUserData` cannot compute delta overrides and writes the entire unstripped `state.library` and `state.customFoods` into the user's Firestore document.
6. **Inference 4 (Broken Guest Detection)**: `hasUserData` in `src/lib/merge.ts` checks `data.library.length > 0` and `data.customFoods.length > 0`. Because seed items are present in `library` and `customFoods`, `hasUserData(guestData)` is always `true`.
7. **Inference 5 (Destructive Merge)**:
   - When a guest signs in with Google, `AuthContext` believes the guest created data and runs `mergeUserData(cloudData, guestData)`.
   - `mergeArrayById` merges the guest's 100+ default seed items into `cloudData.library` and `cloudData.customFoods`, overwriting cloud customizations on ID collision.
   - `mergeUserData` completely omits `catalogOverrides` in its return object, causing `UserDataSchema.parse()` to reset `catalogOverrides` to empty defaults, destroying all user customizations.
8. **Inference 6 (UI Resolution Contract)**: UI views (`TrainingExercises`, `TrainingSession`, `NutritionFoodArchive`, etc.) currently read `useAppStore(state => state.userData?.library)` and `customFoods`. If `library` and `customFoods` are cleaned to hold only custom items, views must continue to receive the unified resolved list seamlessly (via store resolution or selectors) without UI regressions.

---

## 3. Caveats

1. **Legacy Firestore Documents**: Existing active users in production may have legacy Firestore documents that already contain full seed arrays in `library` or `customFoods`. The migration utility `migrateLegacyLibraryToOverrides` in `DB.loadUserData` successfully normalizes them upon cloud load, provided the catalog is available.
2. **Offline Catalog Synchronization**: In pure offline mode with empty IndexedDB, the app must rely exclusively on `getSeedCatalog()` from bundled `seedExercises.json` and `seedFoods.json`. The catalog resolution pipeline must never block UI rendering waiting for network.
3. **PowerShell Script Policy**: Running `npm test` directly in Windows PowerShell triggers a `PSSecurityException`. All CLI operations must use `npm.cmd test` or `npx.cmd`.

---

## 4. Conclusion

The investigation confirms four major architectural bugs in persistence and cloud merge:
1. **Cold Start & Guest Seed Injection**: `src/main.tsx` injects full static catalogs into `cached.library` and `cached.customFoods`, polluting both `window.__INITIAL_USER_DATA__` and the IndexedDB user cache.
2. **Firestore Seed Leak**: `DB.saveUserData` relies on synchronous `getInMemoryCatalog()`, which defaults to `null` on startup/test, causing full catalog serialization to Firestore if save is called before catalog initialization.
3. **Broken Guest Detection (`hasUserData`)**: `hasUserData` treats seed items as user-created data, preventing clean cloud adoption for fresh guest users.
4. **Data Loss in Deterministic Merge (`mergeUserData`)**: `mergeUserData` omits `catalogOverrides` (erasing all user overrides) and merges seed arrays into cloud library (polluting cloud documents and overwriting user modifications).

### Recommended Architectural Fixes:
1. **Unified Resolver in Store/Bootstrap**:
   - `userData.library` and `userData.customFoods` should hold only user-created custom items (deltas).
   - In-memory UI views consume resolved lists produced by `resolveEffectiveExercises(catalog.exercises, customExercises, catalogOverrides)` and `resolveEffectiveFoods(catalog.foods, customFoods, catalogOverrides)`.
2. **Shielded `DB.saveUserData`**: Ensure `DB.saveUserData` always has access to the catalog (falling back to `getSeedCatalog()` if in-memory cache is null) and persists strictly deltas (`customExercises`, `customFoods`, `catalogOverrides`).
3. **Fixed `hasUserData` & `mergeUserData`**:
   - `hasUserData` must ignore default seed items when checking `library` and `customFoods` (or check for `isDefault === false` / `isCustom === true`).
   - `mergeUserData` must explicitly merge `catalogOverrides` (combining `exercises`, `foods`, `hiddenExerciseIds`, `hiddenFoodIds`) and merge only true custom exercises/foods.

---

## 5. Verification Method

### 5.1 Automated Unit and Integration Tests (Vitest)
Run the test suites using `npm.cmd test`:

```bash
# 1. Run Guest Merge & Resilience Tests
npm.cmd test tests/guest_merge.test.ts
npm.cmd test tests/challenger_guest_merge_stress.test.ts

# 2. Run Persistence & Storage Tiering Tests
npm.cmd test tests/db_persistence.test.ts
npm.cmd test tests/pwa_indexeddb_refactor.test.tsx
npm.cmd test tests/zustand_save.test.ts
npm.cmd test tests/use_local_storage.test.tsx

# 3. Run Global Catalog & Delta Resolution Tests
npm.cmd test teamwork_projects/logbook_public_release/tests/catalog.test.ts
npm.cmd test teamwork_projects/logbook_public_release/tests/security_catalog.test.ts

# 4. Full Test Suite Run
npm.cmd test
```

**Baseline Vitest Status (Recorded 2026-08-23)**:
- Total Test Files: 73 (59 passed, 14 failed prior to catalog resolution fixes).
- Total Tests: 1,363 (1,331 passed, 32 failed).
- Core guest merge unit test (`tests/guest_merge.test.ts`): 19/19 tests passing (100%).
- Note on existing failures: Some legacy test files in `tests/zustand_save.test.ts` expect legacy hardcoded error messages rather than the rich `errorHandler.ts` messages, and certain heavy integration suites experience timeouts when run concurrently across all 73 suites. Single-suite execution runs in <1s.

### 5.2 Specific Assertions to Verify Fixes:
1. **Cold Start Persistence Check**:
   - Clear `idbStore` and `localStorageStore`.
   - Boot app in guest mode.
   - Assert `idbStore['logbook_cached_user_data'].library` does NOT contain 100+ seed items.
   - Assert UI displays standard exercises (e.g. "Panca piana", "Squat") from resolved catalog.
2. **Save Payload Inspection**:
   - In a guest or authenticated session, trigger `saveUserData`.
   - Inspect Firestore batch write payload in `DB.saveUserData`: assert `userDocData.library` and `userDocData.customFoods` contain only true custom items.
3. **Merge Post-Guest Verification**:
   - Create a custom exercise in guest session.
   - Simulate Google login with existing cloud account.
   - Assert merged data preserves the guest custom exercise, preserves cloud custom exercises, preserves all `catalogOverrides`, and does NOT duplicate seed catalog items into `library`.
