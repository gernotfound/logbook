# Report di Indagine: State Management, Schema, Type Contracts e Catalog Resolution Pipeline

## 1. Observation

### 1.1 Contratti di Tipo e Schema (`src/types.ts` e `src/lib/schema.ts`)
- **Definizione di `UserData` (`src/types.ts:318-333`):**
  ```typescript
  export interface UserData {
      profile?: UserProfile;
      library?: Exercise[]; // Legacy, pre-migration
      routines?: WorkoutRoutine[];
      history?: WorkoutSession[];
      nutrition?: Record<string, NutritionDay>;
      customFoods?: Food[]; // Legacy, pre-migration
      activeWorkout?: WorkoutSession | null;
      nutritionPlanning?: NutritionPlanning;
      trainingCycles?: TrainingCycle[];
      activeCycleId?: string | null;
      supplements?: Supplement[];
      activePains?: string[];
      catalogOverrides?: CatalogOverrides; // New global catalog overrides
  }
  ```
- **Definizione di `CatalogOverrides` (`src/types.ts:311-316`):**
  ```typescript
  export interface CatalogOverrides {
      exercises?: Record<string, ExerciseOverride>;
      foods?: Record<string, FoodOverride>;
      hiddenExerciseIds?: string[];
      hiddenFoodIds?: string[];
  }
  ```
- **Sanitizzazione Zod (`src/lib/schema.ts:448-474`):**
  - `CatalogOverridesSchema`: valida mappe di override per esercizi e cibi con limite difensivo `max(500)` per `hiddenExerciseIds` e `hiddenFoodIds`. Fallback predefinito: `{ exercises: {}, foods: {}, hiddenExerciseIds: [], hiddenFoodIds: [] }`.
  - `UserDataSchema`: include `library` (`z.array(ExerciseSchema).max(500)`), `customFoods` (`z.array(FoodSchema).max(500)`) e `catalogOverrides`.
  - `defaultUserDataFallback` (`src/lib/schema.ts:337-359`): inizializza `library: []`, `customFoods: []`, `catalogOverrides: { exercises: {}, foods: {}, hiddenExerciseIds: [], hiddenFoodIds: [] }`.

---

### 1.2 Architettura dello Store Zustand (`src/store/useAppStore.ts` e Slices)
- Lo store è composto da 3 slice:
  1. `createDataSlice` (`src/store/slices/createDataSlice.ts`): gestisce `userData: UserData | null`, `setUserData`, `getInitialUserData()` e `saveUserDataToCache(data)`.
  2. `createWorkoutSlice` (`src/store/slices/createWorkoutSlice.ts`): gestisce `localWorkout` in `localStorage` sincrono con debouncer a 300ms e protezione `visibilitychange`.
  3. `createSyncSlice` (`src/store/slices/createSyncSlice.ts`): gestisce `saveUserData`, `updateUserData`, debouncer globale a 1000ms (`DEBOUNCE_DELAY_GLOBAL`), accodamento e rigetto Promise in caso di errore, `resetStore()`.
- **Inizializzazione sincrona da IndexedDB (`createDataSlice.ts:12-23`):**
  `getInitialUserData()` legge `window.__INITIAL_USER_DATA__` e valida il payload tramite `UserDataSchema.parse(parsed)`.
- **Persistenza asincrona Tier 2 (`createDataSlice.ts:25-39`):**
  `saveUserDataToCache` persiste l'intero oggetto `UserData` su IndexedDB con chiave `'logbook_cached_user_data'`.

---

### 1.3 Catalogo Globale e Resolver dei Delta (`src/lib/catalog/`)
- **Catalogo Globale Bundled Seed (`src/lib/catalog/catalogService.ts:52-81`):**
  - Carica staticamente `seedExercises.json` (71 esercizi) e `seedFoods.json` (116 alimenti standard).
  - `getSeedCatalog()` restituisce un oggetto conforme a `CachedGlobalCatalog` con `manifest.version = '1.0.0'`.
  - Cache dedicata su IndexedDB: chiave `CATALOG_CACHE_KEY = 'logbook_cached_global_catalog'` (separata da `logbook_cached_user_data`).
  - `getCachedCatalog()` tenta la lettura da memoria $\rightarrow$ IndexedDB $\rightarrow$ fallback immediato a `getSeedCatalog()` + popolazione asincrona di IndexedDB.
  - `syncGlobalCatalog(db)`: effettua 1 lettura Firestore O(1) di `global_catalog/manifest`. Se la versione coincide, non scarica nulla (0 letture aggiuntive); se la versione è diversa, scarica `exercises_v*` e `foods_v*` e aggiorna la cache.
- **Delta Resolver (`src/lib/catalog/deltaResolver.ts`):**
  - Modello matematico:
    $$\text{EffectiveLibrary} = (\text{GlobalExercises} \setminus \text{HiddenExerciseIds}) \oplus \text{ExerciseOverrides} \cup \text{UserCustomExercises}$$
    $$\text{EffectiveFoods} = (\text{GlobalFoods} \setminus \text{HiddenFoodIds}) \oplus \text{FoodOverrides} \cup \text{UserCustomFoods}$$
  - `resolveEffectiveExercises(globalExercises, userCustom = [], overrides?)`: esclude gli ID in `hiddenExerciseIds`, applica gli override presenti in `exercises`, imposta `isDefault: true`, premette/pospone i custom exercises con `isDefault: false`.
  - `resolveEffectiveFoods(globalFoods, userCustom = [], overrides?)`: esclude gli ID in `hiddenFoodIds`, applica gli override di `foods`, imposta `isCustom: false`, premette i custom foods con `isCustom: true`.
  - `migrateLegacyLibraryToOverrides` e `migrateLegacyFoodsToOverrides`: estraggono i delta (modifiche rispetto al catalogo base, custom items, hidden items) da array monolitici.

---

### 1.4 Bootstrap dell'Applicazione e Flussi di Caricamento
- **Inizializzazione in `src/main.tsx` (`lines 24-43`):**
  ```typescript
  let cached = await get<UserData>('logbook_cached_user_data');
  if (!cached) {
    const catalog = await getCachedCatalog();
    cached = {
      library: catalog.exercises,
      customFoods: catalog.foods,
    } as any;
  } else if (cached && (!cached.library || cached.library.length === 0)) {
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
- **Caricamento Cloud in `src/lib/db.ts` (`loadUserData`, lines 45-70):**
  1. Esegue `syncGlobalCatalog(db)` per ottenere il catalogo globale fresco (o da cache).
  2. Legge il documento `users/{uid}`.
  3. Esegue `migrateLegacyLibraryToOverrides` sui dati scaricati per estrarre custom e overrides.
  4. Risolve `state.library = resolveEffectiveExercises(catalog.exercises, customExercises, state.catalogOverrides)`.
  5. Risolve `state.customFoods = resolveEffectiveFoods(catalog.foods, customFoods, state.catalogOverrides)`.
- **Salvataggio Cloud in `src/lib/db.ts` (`saveUserData`, lines 182-200):**
  ```typescript
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
  ```
- **Modalità Guest e Link Google in `src/contexts/AuthContext.tsx`:**
  - `loginAsGuest()` (`lines 202-210`):
    ```typescript
    const loginAsGuest = useCallback(() => {
        localStorage.setItem(GUEST_KEY, 'true');
        isGuestRef.current = true;
        setIsGuest(true);
        if (!useAppStore.getState().userData) {
            setUserData(UserDataSchema.parse(defaultUserData) as unknown as UserData);
        }
    }, [setUserData]);
    ```
    Qui `defaultUserData` ha `library: []` e `customFoods: []`.
  - `linkGoogleAccount()` & `onAuthStateChanged` (`lines 93-132`):
    Invoca `mergeUserData(cloudData, guestData)` per unire i dati locali guest con il cloud.

---

### 1.5 Consumo da parte di Viste e Componenti
Tutti i componenti e hook consumano `library` e `customFoods` direttamente dallo store come liste piatte già risolte:
- `useTrainingExercises` (`src/hooks/useTrainingExercises.ts:56`):
  `const library = useAppStore(state => state.userData?.library || EMPTY_ARRAY);`
- `TrainingHistory` (`src/components/Training/TrainingHistory.tsx:15`):
  Crea la mappa da `userData?.library`.
- `TrainingRoutines` e `RoutineEditor` (`src/components/Training/routines/RoutineEditor.tsx:84`):
  Cerca gli esercizi in `library.find(l => l.id === ex.exId)`.
- `TrainingSession` (`src/components/Training/TrainingSession.tsx:174`):
  Costruisce `libraryMap = new Map(library.map(l => [l.id, l]))`.
- `TrainingPlanning` (`src/components/Training/planning/TrainingPlanning.tsx:16`):
  Passa `library` a `Logic.calculateCycleVolume`.
- `NutritionFoodArchive` (`src/components/Nutrition/NutritionFoodArchive.tsx:17`):
  `const customFoods = useAppStore(state => state.userData?.customFoods || EMPTY_FOODS);`
  Cerca tramite `Logic.searchFoods(customFoods, searchQuery)`.
- `useNutritionMeals` (`src/hooks/useNutritionMeals.ts:13`):
  `const customFoods = useAppStore(state => state.userData?.customFoods || EMPTY_FOODS);`
  Esegue la ricerca cibi per l'aggiunta ai pasti.
- `useHomeView` (`src/hooks/useHomeView.ts:109`) e grafici analytics:
  Leggono `library` da `state.userData?.library`.

Nessuna vista/componente esegue logica di risoluzione catalogo inline durante il render: si aspettano che `state.userData.library` e `state.userData.customFoods` contengano l'intero catalogo effettivo (standard + custom).

---

## 2. Logic Chain

### 2.1 Identificazione dei Dati Personali vs Dati di Catalogo Globale
1. **Dati di catalogo globale:**
   - 71 esercizi base in `seedExercises.json` / `global_catalog/exercises_v*`.
   - 116 alimenti base in `seedFoods.json` / `global_catalog/foods_v*`.
   - Immutabili dal client; scaricati/memorizzati in cache separata IndexedDB (`logbook_cached_global_catalog`).
2. **Dati personali (Delta utente):**
   - Esercizi custom creati dall'utente (`id` generato con `Logic.generateId('ex')`, `isDefault !== true`).
   - Alimenti custom creati dall'utente (`isCustom === true` o non presenti nel catalogo globale).
   - `catalogOverrides.exercises`: record con chiavi = ID esercizio catalogo e valori = proprietà sovrascritte (`name`, `notes`, `muscles`, `equipmentWeight`, `isBodyweight`, `trackingType`).
   - `catalogOverrides.foods`: record con chiavi = ID alimento catalogo e valori = macro/porzioni sovrascritte.
   - `catalogOverrides.hiddenExerciseIds`: array di ID di esercizi di catalogo eliminati/nascosti dall'utente.
   - `catalogOverrides.hiddenFoodIds`: array di ID di alimenti di catalogo eliminati/nascosti dall'utente.

### 2.2 Diagnosi delle Criticità nel Flusso Attuale
1. **Vulnerabilità A: Poluzione della cache utente e persistenza monolitica in Guest Mode:**
   - In `main.tsx` (`lines 28-36`), se IndexedDB non ha dati utente, viene iniettato `cached = { library: catalog.exercises, customFoods: catalog.foods }`.
   - Di conseguenza, `userData.library` e `userData.customFoods` contengono l'intero array grezzo di 71 esercizi e 116 alimenti.
   - A ogni mutazione locale di qualsiasi campo (es. profilo, routine, peso), `saveUserDataToCache` scrive l'intero array seed all'interno di `'logbook_cached_user_data'`.
2. **Vulnerabilità B: Inizializzazione vuota in `loginAsGuest()`:**
   - Se `window.__INITIAL_USER_DATA__` non è popolato (o fallisce il parse iniziale), `loginAsGuest()` in `AuthContext.tsx:208` chiama `setUserData(UserDataSchema.parse(defaultUserData))`.
   - Poiché `defaultUserData` ha `library: []` e `customFoods: []`, l'utente guest si ritrova con l'archivio esercizi e alimenti completamente vuoto.
3. **Vulnerabilità C: Dipendenza fragile da `getInMemoryCatalog()` in `DB.saveUserData`:**
   - In `DB.saveUserData`, l'estrazione dei delta si basa su `const catalog = getInMemoryCatalog()`.
   - Se `inMemoryCatalogCache` è `null` (ad es. se la pagina non ha ancora invocato `getCachedCatalog` o `syncGlobalCatalog`), la condizione `if (catalog)` fallisce.
   - In tal caso, `effectiveCustomExercises` rimane `state.library` (contenente tutti i 71+ esercizi) e `userDocData` salva l'intero catalogo statico su Firestore (`users/{uid}`), violando la quota e il vincolo di separazione.
4. **Vulnerabilità D: Perdita degli override e duplicazione catalogo in `src/lib/merge.ts`:**
   - In `mergeUserData(cloudData, guestData)`:
     - `library: mergeArrayById(cloud.library, guest.library)` unisce l'array cloud (solo custom) con l'array guest (che contiene tutti i 71 esercizi seed). Risultato: `mergedData.library` si riempie di 71+ elementi statici.
     - `catalogOverrides` **non viene minimamente considerato** in `rawMerged` (`merge.ts:218-238`), causando la perdita totale delle personalizzazioni e degli elementi nascosti creati in modalità guest quando l'utente collega l'account Google!
     - `hasUserData` (`merge.ts:186-199`) ignora `catalogOverrides`.

---

## 3. Caveats
- **Nessuna modifica al codice sorgente:** Questo report è un'indagine read-only. Nessun file in `src/` è stato modificato durante questa fase.
- **Test Suite di Progetto Preesistente:** L'esecuzione di `npm.cmd test` esegue 73 file di test con 1363 test (la quasi totalità passa con 1332 passati; i 31 fallimenti in vecchi test di stress sono dovuti a stringhe di errore specifiche e timeout in test di carico pesante).
- **TypeScript Clean:** La verifica statica dei tipi (`tsc --noEmit`) passa con 0 errori su tutto il repository.

---

## 4. Conclusion

### 4.1 Contratto Architetturale Unificato Consigliato
1. **Separazione Netta Storage vs Stato UI Risolto:**
   - **In Storage (Firestore Cloud & IndexedDB User Cache):**
     `UserData` deve memorizzare **esclusivamente i delta**: `customExercises` (in `library`), `customFoods` (in `customFoods`), e `catalogOverrides` (`{ exercises, foods, hiddenExerciseIds, hiddenFoodIds }`). Non deve mai essere serializzato l'intero catalogo seed.
   - **Nello Store Zustand (`useAppStore`):**
     Mantenere il contratto attuale esposto alle view: `state.userData.library` e `state.userData.customFoods` rimangono le liste complete già risolte tramite `resolveEffectiveExercises` e `resolveEffectiveFoods`. In questo modo nessuna delle oltre 15 viste/componenti deve essere riscritta o subire doppie risoluzioni a ogni render.
2. **Bootstrap Deterministico a Freddo (Zero-Flash & Offline-Resilient):**
   - Nel bootstrap `main.tsx` o nell'inizializzazione dello store:
     1. Ottenere sempre il catalogo globale (da memoria $\rightarrow$ cache IndexedDB $\rightarrow$ seed bundled `getSeedCatalog()`).
     2. Se i dati utente in cache contengono custom/overrides o array legacy, risolverli immediatamente tramite `resolveEffectiveExercises` / `resolveEffectiveFoods` prima di assegnare `window.__INITIAL_USER_DATA__`.
     3. Garantire che la memoria del catalogo (`inMemoryCatalogCache`) sia sempre popolata fin dal primo millisecondo di avvio.
3. **Blindatura di `saveUserData` e `saveUserDataToCache`:**
   - Quando si salva su IndexedDB o su Firestore:
     - Estrarre i delta tramite `migrateLegacyLibraryToOverrides` / `migrateLegacyFoodsToOverrides` usando sempre il catalogo (con fallback sincrono garantito a `getSeedCatalog()` se `getInMemoryCatalog()` fosse assente).
     - Persistere solo i delta.
4. **Blindatura del Merge Guest-to-Google (`merge.ts`):**
   - Aggiungere `catalogOverrides` in `mergeUserData`: unire le mappe `exercises` e `foods` e deduplicare i set `hiddenExerciseIds` e `hiddenFoodIds`.
   - Estrarre i veri custom exercises e custom foods prima di `mergeArrayById`, evitando di iniettare elementi di catalogo seed in `cloud.library`.

---

## 5. Verification Method

### 5.1 Ispezione dei File Chiave
- Contratto tipi: `src/types.ts` (`UserData`, `CatalogOverrides`, `CatalogExercise`, `CatalogFood`).
- Validazione Gateway: `src/lib/schema.ts` (`UserDataSchema`, `CatalogOverridesSchema`, `CatalogExerciseSchema`).
- Risoluzione Delta: `src/lib/catalog/deltaResolver.ts` (`resolveEffectiveExercises`, `resolveEffectiveFoods`, `migrateLegacyLibraryToOverrides`).
- Servizio Catalogo: `src/lib/catalog/catalogService.ts` (`getCachedCatalog`, `getSeedCatalog`, `syncGlobalCatalog`).
- Persistenza & Diffing: `src/lib/db.ts` (`loadUserData`, `saveUserData`).
- Merge Deterministico: `src/lib/merge.ts` (`mergeUserData`, `hasUserData`).
- Bootstrap: `src/main.tsx` (`initApp`).

### 5.2 Comandi di Verifica
- Verifica tipi TypeScript:
  ```powershell
  npx.cmd tsc --noEmit
  ```
- Build di produzione Vite:
  ```powershell
  npm.cmd run build
  ```
- Esecuzione Test Unitari e di Integrazione:
  ```powershell
  npx.cmd vitest run tests/catalog.test.ts tests/guest_merge.test.ts tests/schema_resilience.test.ts
  ```