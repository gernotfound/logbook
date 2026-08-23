# Project: LogBook Guest Mode & Global Catalog Resolution

## Architecture
- **State & Resolution**: Zustand 5 global store (`src/store/useAppStore.ts`). Views consume resolved `userData.library` (exercises) and `userData.customFoods` (foods) computed via `resolveEffectiveExercises` and `resolveEffectiveFoods`.
- **Global Catalog Service**: `src/lib/catalog/catalogService.ts` and `deltaResolver.ts`. Seed files `seedExercises.json` and `seedFoods.json` provide instant offline catalog. IndexedDB key `'logbook_cached_global_catalog'` caches remote manifest/versions.
- **Bootstrap Lifecycle**: `src/main.tsx` pre-render bootstrap with `window.__INITIAL_USER_DATA__`.
- **Guest Flow & Cloud Merge**: `src/contexts/AuthContext.tsx` (`loginAsGuest`, `linkGoogleAccount`) and `src/lib/merge.ts` (`hasUserData`, `mergeUserData`).
- **Persistence Tiering**: `src/lib/db.ts` (`DB.saveUserData`, `DB.loadUserData`) and `src/store/slices/createDataSlice.ts` (`saveUserDataToCache`). Only deltas (`customExercises`, `customFoods`, `catalogOverrides`) are persisted to personal records.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Unified Catalog Resolution & Store Contract | Views consume `userData.library` and `userData.customFoods` as flat, resolved lists from store without inline per-render re-computation. | M1 | Survey / R1 |
| F2 | Guest Bootstrap & Seed Fallback | Cold start guest sessions resolve bundled seed catalog into store on first frame without empty list flashes. | M2 | Survey / R2 |
| F3 | Storage & Persistence Delta Isolation | Firestore `users/{uid}` and user cache store ONLY custom items, overrides, and hidden IDs. `DB.saveUserData` guarantees catalog fallback and never serializes static seed items. | M3 | Survey / R3 |
| F4 | Cloud Merge & Account Linking Integrity | `mergeUserData` merges `catalogOverrides` and true custom items; `hasUserData` detects real user data without false positives from static catalog. | M4 | Survey / R3 |
| F5 | E2E & Integration Verification | Opaque-box and unit/integration test suites (Tiers 1-4) validating guest cold start, persistence isolation, zero-flash transition, and merge integrity. | M0 & M5 | Survey / Acceptance Criteria |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M0 | E2E Test Suite Track | Implement opaque-box E2E test suite covering Tiers 1-4 in `tests/e2e_guest_catalog.test.ts` and publish `TEST_READY.md`. | none | DONE |
| M1 | Resolution Pipeline & Store Unification | Unify resolution helpers and ensure store provides resolved lists while tracking deltas cleanly. | none | DONE |
| M2 | Guest Bootstrap & Cold Start Lifecycle | Update `main.tsx` and `AuthContext.tsx` (`loginAsGuest`) to guarantee instant seed resolution without flashing `[]` or wiping guest catalog. | M1 | DONE |
| M3 | Storage & Persistence Delta Isolation | Update `db.ts` and `createDataSlice.ts` to ensure Firestore and user cache persist strictly deltas with resilient `getInMemoryCatalog` / `getSeedCatalog` fallback. | M1 | DONE |
| M4 | Cloud Merge & Account Linking Integrity | Fix `mergeUserData` and `hasUserData` in `merge.ts` and `AuthContext.tsx` to preserve `catalogOverrides` and merge only custom items. | M1, M3 | DONE |
| M5 | Final E2E Test Pass & Adversarial Hardening | Run full test suite across all tiers, pass 100% of E2E tests, and execute Tier 5 adversarial hardening. | M0, M2, M3, M4 | DONE |

## Interface Contracts
### `catalogService` ↔ Store / Bootstrap / DB
- `getSeedCatalog(): CachedGlobalCatalog`: Synchronous, infallible access to bundled seed exercises and foods.
- `getCachedCatalog(): Promise<CachedGlobalCatalog>`: In-memory -> IndexedDB -> seed fallback.
- `getInMemoryCatalog(fallbackToSeed?: true): CachedGlobalCatalog`: Synchronous memory lookup with fallback to `getSeedCatalog()`.

### `deltaResolver` ↔ Store / Merge / DB
- `resolveEffectiveExercises(globalExercises: CatalogExercise[], userCustom?: Exercise[], overrides?: CatalogOverrides): Exercise[]`
- `resolveEffectiveFoods(globalFoods: CatalogFood[], userCustom?: Food[], overrides?: CatalogOverrides): Food[]`
- `migrateLegacyLibraryToOverrides(library: Exercise[], globalExercises: CatalogExercise[]): { customExercises: Exercise[], overrides: CatalogOverrides }`
- `migrateLegacyFoodsToOverrides(foods: Food[], globalFoods: CatalogFood[]): { customFoods: Food[], overrides: CatalogOverrides }`
- `mergeCatalogOverrides(a?: CatalogOverrides | null, b?: CatalogOverrides | null): CatalogOverrides`

### `mergeUserData` ↔ `AuthContext`
- `mergeUserData(cloudData?: UserData | null, guestData?: UserData | null): UserData`
  - Merges `catalogOverrides` (merging exercise overrides, food overrides, hidden IDs).
  - Merges true custom exercises and foods deduplicated by ID.
  - Preserves profile, routines, history, nutrition, cycles, supplements.

## Code Layout
- `src/lib/catalog/`: Catalog service, seed files, delta resolver.
- `src/store/`: Zustand store, slices (`createDataSlice`, `createSyncSlice`, `createWorkoutSlice`).
- `src/lib/db.ts`: Firestore persistence, load/save, schema serialization.
- `src/lib/merge.ts`: Deterministic guest-to-cloud merge.
- `src/contexts/AuthContext.tsx`: Authentication state listener, guest mode login, Google account linking.
- `src/main.tsx`: Application bootstrap and pre-render cache setup.
- `tests/`: Vitest test suites.
