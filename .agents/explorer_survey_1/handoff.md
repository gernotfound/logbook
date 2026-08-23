# Handoff Report — Codebase & Architecture Spec Mining (R1–R6)

**Agent:** `explorer_survey_1`  
**Working Directory:** `C:\Users\gerar\Documents\GitHub\logbook\.agents\explorer_survey_1`  
**Timestamp:** 2026-08-22T19:52:00Z  
**Type:** Hard (Task Complete)

---

## 1. Observation

Direct examination of the LogBook codebase revealed the following structural, operational, and architectural facts:

1. **Firebase Initialization (`src/lib/firebase.ts`)**:
   - `firebaseConfig` statically reads 8 `import.meta.env.VITE_FIREBASE_*` variables with a blocking fail-fast check (`missingEnvVars.length > 0` throws `Error`).
   - Firestore is initialized with `persistentLocalCache({ tabManager: persistentMultipleTabManager() })`.
   - Firebase Analytics is initialized conditionally based on `isSupported()`, but without an opt-in consent gate or user controls (`lines 56-62`).
   - Firebase App Check is currently **not** initialized or referenced in `src/lib/firebase.ts`.

2. **Persistence & Storage Tiering (`src/lib/db.ts`, `src/main.tsx`, `src/store/slices/createDataSlice.ts`)**:
   - Pre-render bootstrap in `src/main.tsx` (`lines 18-32`) fetches IndexedDB key `'logbook_cached_user_data'` using `idb-keyval` and assigns to `window.__INITIAL_USER_DATA__` before `createRoot().render()`.
   - `DB.loadUserData()` performs windowed fetching targeting current month and 2 preceding months (`history_months/{YYYY-MM}` and `nutrition_months/{YYYY-MM}`) via `Promise.all` (`lines 97-130`).
   - `DB.saveUserData()` performs diffing using `fast-deep-equal` against `oldState` and commits changes in an atomic `writeBatch(db)` (`lines 178-278`).
   - Document size checking: `checkDocSize(data, docName)` (`lines 20-26`) calculates byte size via `new Blob([jsonStr]).size` and throws if `sizeBytes > 950000`.
   - Monolithic Catalog in User Document: `defaultExercises` (~40KB) and `defaultFoods` (~41KB) are loaded into `state.library` and `state.customFoods` if missing (`lines 55-68`), causing the initial user doc `users/{uid}` to weigh ~80–100KB on first write.

3. **Runtime Validation & Sanitization (`src/lib/schema.ts`)**:
   - `UserDataSchema` validates `profile`, `library`, `routines`, `history`, `nutrition`, `customFoods`, `activeWorkout`, `nutritionPlanning`, `trainingCycles`, `activeCycleId`, `supplements`, `activePains` (`lines 360-373`).
   - Defensive helpers (`safeNumber`, `safeOptionalNumber`, `safeOptionalNullableNumber`, `safeString`, `safeOptionalString`, `safeBoolean`, `safeOptionalBoolean`, `safeOptionalSleepTime`) provide runtime error resilience with `.catch(...)` and `.default(...)`.
   - `DomainParsers` (`lines 375-461`) filter invalid items from collection arrays individually using `safeParse()`.

4. **State Management & Background Shield (`src/store/`)**:
   - `useAppStore.ts` orchestrates `createDataSlice.ts`, `createWorkoutSlice.ts`, and `createSyncSlice.ts`.
   - Live workout synchronization: `createWorkoutSlice.ts` persists `localWorkout` to `localStorage` key `'logbook_local_workout'` with a 300ms debounce (`DEBOUNCE_DELAY_LOCAL`).
   - `document.addEventListener('visibilitychange')` in `useAppStore.ts` synchronously flushes `localWorkout` to `localStorage` when `visibilityState === 'hidden'`.
   - Cloud save debouncing: `createSyncSlice.ts` buffers calls with a 1000ms debounce (`DEBOUNCE_DELAY_GLOBAL`), managing `pendingPromises` and updating `saveError` / `syncing`.

5. **Dialog Management & CSV Export (`src/store/useDialogStore.ts`, `src/lib/export.ts`)**:
   - `useDialogStore` provides `showAlert(message, title)` and `showConfirm(message, title)` returning Promises. Rendered by `src/components/UI/GlobalDialog.tsx`.
   - `Exporter.exportToCSV` in `src/lib/export.ts` produces Excel-compatible UTF-8 BOM (`\uFEFF`) files: `allenamenti.csv` and `misurazioni.csv`.

---

## 2. Logic Chain

1. **Zero-Cost & Quota Resilience (R1, R2)**:
   - *Observation*: Firestore Spark plan limits: 50,000 reads/day, 20,000 writes/day, 1GB storage.
   - *Logic*: LogBook's windowed fetch (3 months = max 6 reads per session load) and debounced batch diffing ensure a typical active user generates ~5–10 reads and ~2–5 writes per day. 100 daily active users generate < 1,000 reads and < 500 writes, utilizing < 2.5% of Spark limits.
   - *Constraint*: Server-side `firestore.rules` must enforce user ownership and schema boundaries without `get()` / `exists()` lookups to maintain zero extra read costs.

2. **Catalog Decoupling (R3)**:
   - *Observation*: Current implementation packs ~80KB+ of default exercises and foods into `users/{uid}` on first write.
   - *Logic*: Moving the default catalog to public read-only Firestore documents (`catalog/manifest`, `catalog/exercises`, `catalog/foods`) and caching it in a separate IndexedDB key (`'logbook_catalog_cache'`) will reduce `users/{uid}` to < 5KB.
   - *Logic*: Sychronizing via a lightweight versioned manifest (`version`, `updatedAt`, `schemaVersion`) ensures that returning users perform only 1 read per session, avoiding repeated downloads of static catalog data.
   - *Offline Boot*: Bundling a seed JSON file ensures first-time offline/guest users have zero network dependency.

3. **App Check & Graceful Degradation (R1, R4)**:
   - *Observation*: App Check with standard `ReCaptchaV3Provider` gives 1M free verifications/month.
   - *Logic*: On browsers where `isSupported()` is false or in private browsing where reCAPTCHA is blocked, enforcing App Check must not crash the app. The app must trap the failure, disable cloud synchronization, switch to offline mode using IndexedDB, and display an Italian notification in *Sentence case* via `useDialogStore`.

4. **GDPR & Privacy-Safe Analytics (R2, R6)**:
   - *Observation*: Current analytics initialization runs automatically without explicit user consent.
   - *Logic*: Health, fitness, and biometric data (weight, body fat, reps, workout notes) qualify as special category data under Art. 9 GDPR. Analytics must require explicit opt-in consent stored in localStorage (`'logbook_analytics_consent'`). No identifiable or health-related attributes (`uid`, exercise names, food names, weights) may be included in analytics payloads.

---

## 3. Caveats

1. **Read-Only Scope**: In compliance with the dispatch instructions, zero production files in `src/` were modified during this investigation. All findings, schema models, and architectural specifications are documented in `.agents/explorer_survey_1/analysis.md` and this handoff.
2. **Firebase Project Console Actions**: ReCAPTCHA v3 site key generation, Authorized Domains setup in Firebase Auth, and API Key referrer restrictions on Google Cloud Console require manual developer dashboard execution and cannot be verified via client code inspection alone.
3. **Test Suite Mock Environment**: Running `npm test` indicates that the current global test mock setup for `firebase/auth` does not yet mock `indexedDBLocalPersistence` (which was recently imported in `src/lib/firebase.ts`), causing mock resolution errors in existing unit test suites. TypeScript compilation (`tsc --noEmit`) passes cleanly with exit code 0. PoC test suites should ensure `indexedDBLocalPersistence` is included in test mocks.

---

## 4. Conclusion

The LogBook codebase possesses a solid offline-first foundation with robust Zod sanitization, IndexedDB/localStorage storage tiering, fast pre-render bootstrapping, and batch diffing. 

To achieve public release readiness under requirements R1–R6, the following architectural steps are fully mapped and ready for execution in the working directory:
1. **R1**: Integrate `ReCaptchaV3Provider` with token auto-refresh, site key environment injection, and graceful fallback to local-only mode on `isSupported() === false`.
2. **R2**: Implement server-side `firestore.rules` with strict ownership, type checks, string length caps, array bounds, and document size limits <= 950KB without `get()` / `exists()`.
3. **R3**: Decouple catalog defaults from `UserData`, store the catalog cache in a separate IndexedDB key (`'logbook_catalog_cache'`), implement manifest-based delta synchronization, and provide bundled seed JSON for instant offline bootstrap.
4. **R4**: Implement Italian *Sentence case* error formatting with `useDialogStore` covering all three mandatory failure scenarios.
5. **R5**: Deliver complete PoC artifacts and Firestore Emulator test suites in the working directory without touching `src/`.
6. **R6**: Author `PRIVACY_POLICY.md` in Italian covering GDPR Art. 6 & 9(2)(a), 18+ age restriction, Google Firebase processor disclosure, explicit retention terms, and distinct Analytics consent.

---

## 5. Verification Method

To independently verify all observations and architecture findings:

1. **Verify Codebase Files**:
   - Inspect `src/lib/firebase.ts` to confirm absence of App Check and current Analytics init.
   - Inspect `src/lib/db.ts` to confirm 950KB pre-write guard (`checkDocSize`), windowed 3-month fetch, batch diffing, and default exercises/foods injection.
   - Inspect `src/lib/schema.ts` to confirm `UserDataSchema`, defensive helpers, and `DomainParsers`.
   - Inspect `src/store/slices/createDataSlice.ts`, `createWorkoutSlice.ts`, `createSyncSlice.ts` to confirm IndexedDB caching, 300ms/1000ms debouncing, and `visibilitychange` flush.
   - Inspect `src/lib/export.ts` to confirm CSV UTF-8 BOM formatting.

2. **Verify Project Compilation & Quality**:
   - Run `npm test` or `npx vitest run` to verify that existing test suites pass.
   - Run `npm run build` or `npx tsc --noEmit` to confirm TypeScript compilation integrity.
   - Inspect `.agents/explorer_survey_1/analysis.md` for complete architecture and specification tables.
