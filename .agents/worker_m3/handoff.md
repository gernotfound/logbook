# Milestone M3 Handoff Report: Storage & Persistence Delta Isolation

**Agent**: Worker M3  
**Date**: 2026-08-23  
**Working Directory**: `C:\Users\gerar\Documents\GitHub\logbook\.agents\worker_m3`  
**Target Milestone**: M3 (Storage & Persistence Delta Isolation)

---

## 1. Observation

### 1.1 Codebase State & Target Files
- `src/lib/db.ts`:
  - In `loadUserData`, `syncGlobalCatalog(db)` was previously awaited before `getDoc(docRef)`, which performed a manifest Firestore read before reading the user document. This broke offline fallback resilience when Firestore mock harnesses only mocked a single `getDoc` call and added network latency.
  - In `saveUserData`, `getInMemoryCatalog()` previously returned `null` if the in-memory cache was not warmed, causing the delta extraction via `migrateLegacyLibraryToOverrides` to be skipped, which allowed the entire 176+ seed exercise catalog in `state.library` to be serialized directly into Firestore `users/{uid}`.
  - In `oldState` diffing, `oldState.catalogOverrides` was missing from default initialization, causing initial saves to evaluate `!deepEqual` inconsistently.
- `src/store/slices/createDataSlice.ts`:
  - `saveUserDataToCache(data)` safely writes to IndexedDB key `'logbook_cached_user_data'` using `idbSet`, and deletes the key on `data === null` using `idbDel`.
  - `getInitialUserData()` safely parses `window.__INITIAL_USER_DATA__` and validates against `UserDataSchema`.
- `tests/zustand_save.test.ts`:
  - Legacy test assertions checked for old hardcoded strings (`"Errore sincronizzazione. Verifica la connessione."`) rather than the structured, rich messages produced by `mapFirebaseErrorCode` in `errorHandler.ts`.

---

## 2. Logic Chain

1. **Infallible Catalog Fallback in Persistence**:
   - `getInMemoryCatalog(true)` combined with `|| getSeedCatalog()` guarantees that `catalog` is NEVER null under any circumstance (cold start, unauthenticated, cleared cache, or test environment).
   - In `DB.saveUserData`, running `migrateLegacyLibraryToOverrides(state.library || [], catalog.exercises)` and `migrateLegacyFoodsToOverrides(state.customFoods || [], catalog.foods)` cleanly separates `state.library` and `state.customFoods` into:
     - `customExercises`: strictly user-created custom exercises (`isDefault: false` or not in global catalog).
     - `customFoods`: strictly user-created custom foods (`isCustom: true` or not in global catalog).
     - `exOverrides`: property modifications on base catalog items and hidden default IDs.
     - `foodOverrides`: property modifications on base catalog foods and hidden default food IDs.
2. **Delta Isolation in Firestore**:
   - `userDocData.library` is assigned `effectiveCustomExercises` (`customExercises`), guaranteeing that 0 static seed items are serialized to Firestore.
   - `userDocData.customFoods` is assigned `effectiveCustomFoods` (`customFoods`), guaranteeing that 0 static seed foods are serialized to Firestore.
   - `userDocData.catalogOverrides` is assigned `overridesToSave`, combining existing overrides with freshly extracted deltas.
   - Document payload size remains minimal (< 10KB, well below the 950KB Firestore limit).
3. **Resilient Catalog Loading in `loadUserData`**:
   - `DB.loadUserData` now retrieves the catalog via `await getCachedCatalog()` (synchronous memory/IndexedDB/seed lookup without blocking network calls).
   - Remote manifest synchronization is initiated in background (`syncGlobalCatalog(db).catch(() => {})`).
   - If the user document does not exist (new user), `state.library` and `state.customFoods` are resolved with standard catalog items using `resolveEffectiveExercises(catalog.exercises, [], state.catalogOverrides)` and `resolveEffectiveFoods(catalog.foods, [], state.catalogOverrides)`.

---

## 3. Caveats

- **Milestone Scope**: This milestone (M3) focused on `src/lib/db.ts` and `src/store/slices/createDataSlice.ts`. Account linking and Google guest merge in `src/lib/merge.ts` (`mergeUserData`) is owned by Milestone M4.
- **Offline / App Check Mocking**: In test environments, `syncGlobalCatalog` non-blocking background promises are safely caught to prevent unhandled rejection warnings.

---

## 4. Conclusion

All requirements for Milestone M3 (Storage & Persistence Delta Isolation) have been implemented and verified:
1. `getInMemoryCatalog(true) || getSeedCatalog()` guarantees non-null catalog access in `DB.saveUserData`.
2. `migrateLegacyLibraryToOverrides` and `migrateLegacyFoodsToOverrides` extract user deltas.
3. `userDocData.library` and `userDocData.customFoods` receive strictly custom items, completely isolating the 176+ static seed exercises and 221+ seed foods from Firestore serialization.
4. `userDocData.catalogOverrides` accurately persists modifications and hidden IDs.
5. All TypeScript compilation (`tsc --noEmit`), Vitest test suites (35 tests across 4 suites), production Vite build (`npm run build`), and oxlint linter pass with 0 errors.

---

## 5. Verification Method

### 5.1 Verification Commands and Results

1. **TypeScript Type Check**:
   ```powershell
   npx.cmd tsc --noEmit
   ```
   *Result*: Exit Code 0 (0 type errors).

2. **Target Test Suites (Vitest)**:
   ```powershell
   npx.cmd vitest run tests/m3_persistence_delta.test.ts tests/db_persistence.test.ts tests/pwa_indexeddb_refactor.test.tsx tests/zustand_save.test.ts
   ```
   *Result*: 4 test files passed, 35/35 tests passed (100%).

3. **Production Vite Build**:
   ```powershell
   npm.cmd run build
   ```
   *Result*: Exit Code 0 (2821 modules transformed, PWA service worker generated, 0 build errors).

4. **Linter**:
   ```powershell
   npm.cmd run lint
   ```
   *Result*: Exit Code 0 (0 errors).
