# Survey Report: Bootstrap, Catalog Initialization, Seed Fallback & Guest Mode Flow

## 1. Observation

Direct investigation of the codebase revealed the following exact observations:

### 1.1 App Bootstrap & Cache Pre-render (`src/main.tsx`)
- **Lines 25–43 in `src/main.tsx`**:
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
- When no cached user data exists (`'logbook_cached_user_data'` is `null`), `src/main.tsx` attempts to synthesize a temporary `UserData` object containing the seed/cached catalog items in `library` and `customFoods`.
- `window.__INITIAL_USER_DATA__` is populated and validated via `getInitialUserData()` (`UserDataSchema.parse`), which initializes the Zustand store.

### 1.2 Unauthenticated State Wipe in AuthProvider (`src/contexts/AuthContext.tsx`)
- **Lines 136–143 in `src/contexts/AuthContext.tsx`**:
```typescript
} else {
    // Nessun utente Firebase: resetta solo se NON siamo in modalità guest
    if (!isGuestRef.current && localStorage.getItem(GUEST_KEY) !== 'true') {
        DB.resetCache();
        useAppStore.getState().resetStore();
    }
    // Se guest: i dati rimangono nel localStorage, non tocchiamo nulla
}
```
- On initial cold start (landing / login page before the user selects guest or logs in with Google), `onAuthStateChanged` fires with `user = null`.
- Because `localStorage.getItem('logbook_is_guest')` is not set yet, `resetStore()` is executed.
- In `src/store/slices/createSyncSlice.ts` (lines 102–120), `resetStore()` wipes `useAppStore.setState({ userData: null })` and deletes `logbook_cached_user_data` from IndexedDB.

### 1.3 Guest Mode Login Flow (`src/contexts/AuthContext.tsx`)
- **Lines 16–34 in `src/contexts/AuthContext.tsx`**:
```typescript
const defaultUserData: UserData = {
    profile: {},
    library: [],
    routines: [],
    history: [],
    nutrition: {},
    customFoods: [],
    catalogOverrides: {},
    activeWorkout: null,
    trainingCycles: [],
    activeCycleId: null,
    nutritionPlanning: {
        weight: 80, carbsPerKg: 3.5, proPerKg: 2.0, fatPerKg: 1.0,
        lockedMacro: null, chartPeriod: 7,
        normocalorica: { kcal: 2500, carbs: 300, pro: 160, fat: 70 }
    },
    supplements: [],
    activePains: []
};
```
- **Lines 202–210 in `src/contexts/AuthContext.tsx`**:
```typescript
const loginAsGuest = useCallback(() => {
    localStorage.setItem(GUEST_KEY, 'true');
    isGuestRef.current = true;
    setIsGuest(true);
    // Se non ci sono dati precedenti in localStorage, inizializza con i default
    if (!useAppStore.getState().userData) {
        setUserData(UserDataSchema.parse(defaultUserData) as unknown as UserData);
    }
}, [setUserData]);
```
- When an unauthenticated user clicks "Accedi come ospite" / "Prova l'app", `loginAsGuest()` sets `userData` from `defaultUserData`, which has `library: []` and `customFoods: []`.
- `setUserData` saves `{ library: [], customFoods: [] }` into IndexedDB cache (`'logbook_cached_user_data'`).
- The guest store is now populated with empty arrays for exercises and foods.

### 1.4 UI View Consumption of Library & Foods
- **`src/hooks/useTrainingExercises.ts` (line 56)**:
  `const library = useAppStore(state => state.userData?.library || EMPTY_ARRAY);`
  Result in guest cold start: `library = []` (0 exercises displayed).
- **`src/components/Nutrition/NutritionFoodArchive.tsx` (lines 17 & 227–234)**:
  `const customFoods = useAppStore(state => state.userData?.customFoods || EMPTY_FOODS);`
  `{customFoods.length === 0 ? (<p>Nessun alimento presente.</p>) : ...}`
  Result in guest cold start: `customFoods = []` ("Nessun alimento presente" fallback shown).
- **`src/hooks/useNutritionMeals.ts` (lines 13 & 151)**:
  `const customFoods = useAppStore(state => state.userData?.customFoods || EMPTY_FOODS);`
  `const res = Logic.searchFoods(customFoods, query).slice(0, 15);`
  Result in guest cold start: Searching for common foods ("riso", "pollo", "uova") returns 0 results.

### 1.5 Authenticated Load Path (`src/lib/db.ts`)
- **Lines 45–70 in `src/lib/db.ts`**:
```typescript
// 1. Sync global catalog first (offline-resilient)
const catalogResult = await syncGlobalCatalog(db);
const catalog = catalogResult.catalog;

const docSnap = await withTimeout(getDoc(docRef), 6000, "Timeout recupero profilo utente");
if (docSnap && typeof docSnap.exists === 'function' && docSnap.exists()) {
    const data = docSnap.data() as Record<string, any>;
    ...
    state.catalogOverrides = data.catalogOverrides || {};
    const { customExercises, overrides: exOverrides } = migrateLegacyLibraryToOverrides(data.library || [], catalog.exercises);
    const { customFoods, overrides: foodOverrides } = migrateLegacyFoodsToOverrides(data.customFoods || [], catalog.foods);
    ...
    state.library = resolveEffectiveExercises(catalog.exercises, customExercises, state.catalogOverrides);
    state.customFoods = resolveEffectiveFoods(catalog.foods, customFoods, state.catalogOverrides);
} else if (!docSnap || (typeof docSnap.exists === 'function' && !docSnap.exists())) {
    state.library = catalog.exercises;
    state.customFoods = catalog.foods;
    ...
}
```
- In the authenticated cloud path (`DB.loadUserData`), the store receives the fully resolved lists: `state.library = resolveEffectiveExercises(...)` and `state.customFoods = resolveEffectiveFoods(...)`.
- The guest path currently bypasses `DB.loadUserData` entirely, leaving guest users with raw empty arrays (`[]`) instead of resolving with the catalog seed.

### 1.6 Global Catalog Service & Bundled Seed Dataset (`src/lib/catalog/`)
- `src/lib/catalog/seedExercises.json`: 176 structured exercises with muscles, secondary muscles, and tracking types.
- `src/lib/catalog/seedFoods.json`: 221 structured food items with macros, calories, serving units, and categories.
- `src/lib/catalog/catalogService.ts`:
  - Dedicated IndexedDB cache key: `CATALOG_CACHE_KEY = 'logbook_cached_global_catalog'` (completely separated from user data).
  - `getSeedCatalog()`: Instantaneous, synchronous parser for bundled seeds.
  - `getCachedCatalog()`: Retrieves from memory or IndexedDB (`logbook_cached_global_catalog`), falling back to `getSeedCatalog()`.
  - `syncGlobalCatalog(db)`: Reads 1 manifest document from Firestore (`global_catalog/manifest`). If version matches, 0 extra reads. If outdated, downloads updated exercise/food documents and updates local IDB cache.

### 1.7 Merge Logic Gap on Google Account Linking (`src/lib/merge.ts`)
- **Lines 211–241 in `src/lib/merge.ts`**:
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
        ...
        // catalogOverrides is MISSING here!
    };
    return UserDataSchema.parse(rawMerged) as unknown as UserData;
}
```
- `mergeUserData` completely omits `catalogOverrides`. When validated against `UserDataSchema`, `catalogOverrides` is reset to `{ exercises: {}, foods: {}, hiddenExerciseIds: [], hiddenFoodIds: [] }`.
- `mergeArrayById` merges `cloud.library` and `guest.library` directly by ID. If `guest.library` contains the resolved seed catalog, it would merge 176 seed exercises into the cloud library.

---

## 2. Logic Chain

1. **Root Cause of Empty Exercise & Food Lists in Guest Mode**:
   - On initial launch, `main.tsx` attempts to load seed exercises/foods into `window.__INITIAL_USER_DATA__` (Obs 1.1).
   - However, when the user arrives on the login/landing page, Firebase Auth initializes with `user = null`. `AuthContext` sees `localStorage.getItem('logbook_is_guest') !== 'true'` and calls `resetStore()`, deleting the cached data and setting `userData: null` (Obs 1.2).
   - When the user subsequently clicks "Accedi come ospite", `loginAsGuest()` populates `userData` from `defaultUserData`, where `library: []` and `customFoods: []` are hardcoded empty (Obs 1.3).
   - Because `useTrainingExercises`, `NutritionFoodArchive`, and `useNutritionMeals` read directly from `userData.library` and `userData.customFoods` (Obs 1.4), they render empty lists and search fails.

2. **Asymmetry Between Authenticated and Guest Resolution**:
   - Authenticated users going through `DB.loadUserData()` execute `syncGlobalCatalog(db)` $\rightarrow$ `resolveEffectiveExercises()` $\rightarrow$ `resolveEffectiveFoods()`, populating `userData.library` and `userData.customFoods` with the resolved catalog (Obs 1.5).
   - Guest users never run `DB.loadUserData()`, so they never receive the resolved catalog unless an equivalent local resolution pipeline is executed during guest initialization and bootstrap.

3. **Decoupling Resolved State (UI) from Stored Deltas (Persistence)**:
   - Views expect `userData.library` and `userData.customFoods` to contain the single, unified, resolved list (catalogo globale + custom + override - nascosti) so that searching, selecting, and rendering work seamlessly without needing view-level modifications (Obs 1.4, Requirement R1).
   - For persistence (Firestore `users/{uid}`, IndexedDB, export, and merge), the user document must ONLY contain user deltas: true custom items (`isDefault === false` or `isCustom === true`), overrides (`catalogOverrides`), and hidden IDs (Obs 1.5, Requirement R3).
   - When `DB.saveUserData` saves to Firestore, it calls `migrateLegacyLibraryToOverrides` to extract deltas; however, `getInMemoryCatalog()` must be guaranteed to be initialized so that catalog exercises are never mistakenly saved as custom exercises.

4. **Zero-Flash Lifecycle Transition (Seed $\rightarrow$ Cache $\rightarrow$ Remote Sync)**:
   - **Step 1 (Seed / Cold Start)**: `getSeedCatalog()` bundled in memory is synchronously available.
   - **Step 2 (Cache)**: IndexedDB `'logbook_cached_global_catalog'` provides cached catalog version.
   - **Step 3 (Remote Sync)**: `syncGlobalCatalog` checks manifest in background. If updated, it refreshes the in-memory/IDB catalog and updates the store's resolved library/foods without ever clearing them or passing through `[]`.

5. **Deterministic Merge Post-Guest**:
   - When a guest user links their account to Google (`linkGoogleAccount`), `mergeUserData` must:
     - Merge true custom exercises and true custom foods (excluding static catalog items).
     - Merge `catalogOverrides` (merging `exercises` map, `foods` map, `hiddenExerciseIds` set, `hiddenFoodIds` set).
     - Ensure `hasUserData` only returns `true` if genuine user data (custom items, overrides, history, workouts, routines) exists, ignoring pure static catalog presence (Obs 1.7).

---

## 3. Caveats

1. **View Contract Preservation**: UI components (`useTrainingExercises`, `useNutritionMeals`, `NutritionFoodArchive`, `TrainingPlanning`, `TrainingHistory`, `WorkoutSession`) currently expect `userData.library` and `userData.customFoods` to be an array of items. Modifying this contract inside components would require massive refactoring across dozens of files. Maintaining the store contract where `library` and `customFoods` provide the resolved list satisfies Requirement R1.
2. **Local IDB Cache**: If `saveUserDataToCache` in `createDataSlice` serializes `userData` to `logbook_cached_user_data`, storing the resolved list in cache allows fast pre-render bootstrap in `main.tsx`. On cloud save (`DB.saveUserData`), the delta separation in `db.ts` prevents bloat in Firestore `users/{uid}`.
3. **No Network Dependency for Guest**: Guest mode must operate 100% offline with zero Firestore calls. It must rely exclusively on `getSeedCatalog()` and `getCachedCatalog()`.

---

## 4. Conclusion

To eliminate the missing catalog bug in guest mode and fulfill all requirements of `ORIGINAL_REQUEST.md`:

1. **Bootstrap & Guest Mode Pipeline**:
   - In `src/contexts/AuthContext.tsx`, `loginAsGuest()` must initialize `userData.library` and `userData.customFoods` by resolving against `getCachedCatalog()` (using `resolveEffectiveExercises(catalog.exercises, [], {})` and `resolveEffectiveFoods(catalog.foods, [], {})`).
   - In `src/main.tsx`, pre-render initialization must load `getCachedCatalog()` and resolve any cached user deltas into effective lists for `__INITIAL_USER_DATA__`.
   - In `src/contexts/AuthContext.tsx`, `onAuthStateChanged` reset logic for unauthenticated users must avoid corrupting the seed catalog cache.

2. **Catalog Resolution & Persistence Decoupling**:
   - The Zustand store `userData.library` and `userData.customFoods` remain the single source of truth for the resolved effective lists for UI views.
   - `DB.saveUserData` in `src/lib/db.ts` must ensure `getInMemoryCatalog()` always falls back to `getSeedCatalog()` so `migrateLegacyLibraryToOverrides` and `migrateLegacyFoodsToOverrides` always separate deltas cleanly, preventing static seed items from ever being written to Firestore.

3. **Deterministic Guest Merge in `src/lib/merge.ts`**:
   - Update `mergeUserData` to merge `catalogOverrides` (merging exercise overrides, food overrides, and hidden ID sets).
   - Extract true custom items before merging arrays to prevent duplicating 176+ seed items into cloud collections.
   - Refine `hasUserData` to check for genuine custom items / overrides rather than static catalog lengths.

---

## 5. Verification Method

1. **Unit & Integration Tests**:
   - Run Vitest suite:
     ```powershell
     npm.cmd test
     ```
   - Target catalog and guest tests specifically:
     ```powershell
     npx.cmd vitest run tests/guest_merge.test.ts teamwork_projects/logbook_public_release/tests/catalog.test.ts teamwork_projects/logbook_public_release/tests/security_catalog.test.ts
     ```
2. **Cold Start Simulation**:
   - Simulate an empty IndexedDB store with `localStorage.getItem('logbook_is_guest') === null`.
   - Call `loginAsGuest()` and assert that `useAppStore.getState().userData.library.length >= 176` and `useAppStore.getState().userData.customFoods.length >= 221`.
   - Verify specific seed elements exist (e.g. exercise `"Panca piana bilanciere"` / ID `"panca-piana-bilanciere"`, food `"Petto di pollo"` / ID `"petto-pollo"`).
3. **Persistence Delta Verification**:
   - After running in guest mode, inspect `DB.saveUserData` payload and assert that `userDocData.library` only contains custom exercises and `userDocData.catalogOverrides` contains only user overrides, with zero duplicate static catalog items.
