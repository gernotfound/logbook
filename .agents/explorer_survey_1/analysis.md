# LogBook Architecture & Codebase Specification Mining Report

**Date:** 2026-08-22  
**Author:** `explorer_survey_1` (Codebase & Architecture Spec Miner)  
**Target:** LogBook PWA Public Release Preparation (R1–R6)  
**Reference Documents:** `AGENTS.md`, `ORIGINAL_REQUEST.md`

---

## 1. Executive Summary

LogBook is an offline-first, client-rendered Progressive Web Application (PWA) built with **React 19**, **TypeScript**, **Vite**, **Zustand 5**, **Zod**, **IndexedDB (`idb-keyval`)**, **Vanilla CSS**, and **Firebase Modular SDK v12** (`firestore`, `auth`, `analytics`).

This report provides an exhaustive architectural mapping of the LogBook codebase across all core modules (`src/lib/firebase.ts`, `src/lib/db.ts`, `src/lib/schema.ts`, `src/store/useAppStore.ts`, `src/types.ts`, `src/contexts/AuthContext.tsx`, `src/store/useDialogStore.ts`, `src/lib/export.ts`), and establishes a precise gap analysis against requirements **R1 through R6** for public release on the zero-cost **Firebase Spark** plan.

---

## 2. 3-Tier Storage & Offline-First Architecture

LogBook implements a 3-tier storage strategy designed to operate seamlessly offline without data corruption or UI freeze:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ TIER 1: Cloud Persistence (Firebase Firestore)                              │
│ • Root doc: users/{uid} (profile, routines, cycles, overrides, settings)    │
│ • Monthly subcollections: history_months/{YYYY-MM}, nutrition_months/{YYYY-MM}│
│ • Windowed fetch: current month + past 2 months (O(1) read operations)      │
│ • Atomic writeBatch with fast-deep-equal diffing & 7000ms protective timeout│
└─────────────────────────────────────────────────────────────────────────────┘
                               ▲
                 DB.loadUserData() / DB.saveUserData() (debounced 1000ms)
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ TIER 2: Global Async Cache (IndexedDB via idb-keyval)                       │
│ • Key: 'logbook_cached_user_data'                                           │
│ • Holds full UserData tree (bypasses 5MB localStorage quota limit)          │
│ • Fast pre-render bootstrap: main.tsx -> window.__INITIAL_USER_DATA__       │
│ • Validated through UserDataSchema.parse() upon load                        │
└─────────────────────────────────────────────────────────────────────────────┘
                               ▲
               useAppStore (Zustand) single source of truth in memory
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ TIER 3: Synchronous Volatile Storage (localStorage)                         │
│ • 'logbook_local_workout': Active live session (visibilitychange sync save) │
│ • 'logbook_is_guest': Guest mode indicator ('true' / omitted)               │
│ • 'logbook_activeTab', 'logbook_trainingSubTab', 'logbook_nutritionSubTab', │
│   'logbook_dataSubTab': Tab state preservation                             │
│ • 'logbook_timer_state', 'logbook_timer_start', 'logbook_timer_accumulated' │
│ • Form drafts: 'draft_measurement', 'draft_exercise', 'draft_routine'       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Storage Keys Summary Table

| Storage Type | Key Name | Data Type / Schema | Purpose | Lifecycle / Retention |
|---|---|---|---|---|
| **IndexedDB** | `'logbook_cached_user_data'` | `UserData` (validated via `UserDataSchema`) | Complete local cache of user data | Persistent across reloads; cleared on logout |
| **localStorage** | `'logbook_local_workout'` | `WorkoutSession` (`WorkoutSessionSchema`) | Live ongoing workout state; immediate synchronous write on backgrounding | Cleared on workout finish or store reset |
| **localStorage** | `'logbook_is_guest'` | `'true'` \| removed | Guest mode toggle | Set on guest login; removed on Google account link/logout |
| **localStorage** | `'logbook_activeTab'` | `'home'` \| `'training'` \| `'nutrition'` \| `'data'` \| `'settings'` | Active top-level navigation tab | Persistent |
| **localStorage** | `'logbook_trainingSubTab'` | `'session'` \| `'routines'` \| `'exercises'` \| `'cycles'` | Active Training view subtab | Persistent |
| **localStorage** | `'logbook_nutritionSubTab'` | `'meals'` \| `'day'` \| `'archive'` \| `'planning'` \| `'supplements'` | Active Nutrition view subtab | Persistent |
| **localStorage** | `'logbook_dataSubTab'` | `'measurements'` \| `'charts'` \| `'history'` | Active Data view subtab | Persistent |
| **localStorage** | `'logbook_timer_state'` | `'running'` \| `'paused'` \| `'stopped'` | Workout rest stopwatch status | Cleared on timer reset |
| **localStorage** | `'logbook_timer_start'` | String representation of timestamp (`Date.now()`) | Rest timer baseline start time | Cleared on timer reset |
| **localStorage** | `'logbook_timer_accumulated'` | String representation of accumulated milliseconds | Rest timer paused accumulation | Cleared on timer reset |
| **localStorage** | `'draft_measurement'` | JSON object: body measurements draft | Auto-saved draft in measurement modal | Cleared on save/cancel |
| **localStorage** | `'draft_exercise'` | JSON object: exercise draft | Auto-saved draft in exercise modal | Cleared on save/cancel |
| **localStorage** | `'draft_routine'` | JSON object: routine draft | Auto-saved draft in routine modal | Cleared on save/cancel |

---

## 3. Data Models & Zod Validation Layer

The application enforces a dual-layer type system: static TypeScript interfaces in `src/types.ts` and runtime sanitization schemas in `src/lib/schema.ts`.

### 3.1 Core Entity Schemas

1. **`UserData` (`UserDataSchema`)**:
   - `profile?: UserProfile` (`UserProfileSchema`, default `{}`)
   - `library?: Exercise[]` (`z.array(ExerciseSchema)`, default `[]`)
   - `routines?: WorkoutRoutine[]` (`z.array(WorkoutRoutineSchema)`, default `[]`)
   - `history?: WorkoutSession[]` (`z.array(WorkoutSessionSchema)`, default `[]`)
   - `nutrition?: Record<string, NutritionDay>` (`z.record(z.string(), NutritionDaySchema)`, default `{}`)
   - `customFoods?: Food[]` (`z.array(FoodSchema)`, default `[]`)
   - `activeWorkout?: WorkoutSession | null` (`WorkoutSessionSchema.nullable()`, default `null`)
   - `nutritionPlanning?: NutritionPlanning` (`NutritionPlanningSchema`, optional)
   - `trainingCycles?: TrainingCycle[]` (`z.array(TrainingCycleSchema)`, default `[]`)
   - `activeCycleId?: string | null` (safe union of string and null, default `null`)
   - `supplements?: Supplement[]` (`z.array(SupplementSchema)`, default `[]`)
   - `activePains?: string[]` (`z.array(safeString(''))`, default `[]`)

2. **`Exercise` (`ExerciseSchema`)**:
   - `id: string` (safeString)
   - `name: string` (safeString)
   - `notes?: string` (safeOptionalString)
   - `setsCount: number` (safeNumber)
   - `muscles?: string[]` (safe string array)
   - `secondaryMuscles?: string[]` (safe string array)
   - `sets: ExerciseSet[]` (`ExerciseSetSchema`)
   - `trackingType?: 'weight_reps' | 'time' | 'cardio'` (enum)
   - `isDefault?: boolean` (safeOptionalBoolean)
   - `isBodyweight?: boolean` (safeOptionalBoolean)
   - `equipmentWeight?: number` (safeOptionalNumber)

3. **`WorkoutRoutine` (`WorkoutRoutineSchema`)**:
   - `id: string`
   - `name: string`
   - `exercises: RoutineExercise[]` (`exId: string`, `setsCount: number | string`, `minReps?: number | string`, `maxReps?: number | string`, `defaultTechnique?: 'none' | 'dropset' | 'isometrics'`)

4. **`WorkoutSession` (`WorkoutSessionSchema`)**:
   - `id?: string`, `routineId?: string`, `routineName?: string`, `cycleId?: string`, `cycleName?: string`
   - `date?: string` (format `YYYY-MM-DD`)
   - `globalStartTime?: number`, `globalEndTime?: number`, `globalDurationStr?: string`, `manualDurationStr?: string`
   - `moodRating?: number | null`, `pumpRating?: number | null`, `fatigueRating?: number | null`, `waterLiters?: number`, `endTime?: number`
   - `exercises: SessionExercise[]` (`exId`, `sessionNote`, `sets: SessionExerciseSet[]`, `minReps?`, `maxReps?`)
   - `isEditingHistory?: boolean`, `originalHistoryId?: string`, `pains?: string[]`

5. **`NutritionDay` (`NutritionDaySchema`)**:
   - `date: string` (`YYYY-MM-DD`)
   - `kcal: number`, `carbs: number`, `pro: number`, `fat: number`
   - Biometric measurements: `weight`, `bf`, `neck`, `waist`, `hip`, `chest`, `shoulders`, `biceps`, `thighs`, `calves`, `measurementTime`
   - `isDayOn?: boolean`
   - `meals?: LoggedMealItem[]` (`id`, `name`, `meal`, `quantity`, `baseQty`, `unit`, `kcal`, `carbs`, `pro`, `fat`, `time`, `foodId`, `brand`)
   - `supplementsIntake?: SupplementIntake[]` (`id`, `supplementId`, `amount`, `time`)
   - Sleep metrics: `sleepHours`, `sleepDeep`, `sleepLight`, `sleepRem`, `sleepAwake` (`safeOptionalSleepTime`)

6. **`Food` (`FoodSchema`)**:
   - `id?: string | number`, `name: string`, `kcal: number`, `pro: number`, `carbs: number`, `fat: number`
   - `brand?: string`, `category?: string`, `baseQty?: number`, `unit?: string`, `servingUnit?: string`, `servingWeight?: number | null`
   - `isCustom?: boolean`
   - Micronutrients: `satFat`, `sugars`, `sodium`, `fiber`, `iron`, `potassium`, `calcium`, `magnesium`, `cholesterol`

7. **`TrainingCycle` (`TrainingCycleSchema`)**:
   - `id: string`, `name: string`, `durationWeeks: number`, `sessionsPerWeek?: number`, `progressionMode?: 'sequential' | 'fixed'`, `startDate?: string`, `endDate?: string`, `notes?: string`, `routines: TrainingCycleRoutineItem[]`, `createdAt?: number`, `isActive?: boolean`

### 3.2 Defensive Runtime Zod Helpers

`src/lib/schema.ts` establishes runtime defense helpers with `.catch(...)` and `.default(...)`:
- `safeNumber(defaultVal = 0)`: Converts string to number, strips `NaN`, falls back to default.
- `safeOptionalNumber()`: Empty strings become `undefined`, strips `NaN`.
- `safeOptionalNullableNumber()`: Empty strings become `null`.
- `safeString(defaultVal = '')`: Converts numbers to string, fallback to default.
- `safeOptionalString()`: Returns string or `undefined`.
- `safeBoolean(defaultVal = false)`: Parses `'true'`, `'1'`, `1`, booleans.
- `safeOptionalSleepTime()`: Formats string/number time into standard sleep string via `formatSleepTime`.

### 3.3 DomainParsers Collection Filtering

Rather than failing completely if a single corrupt item exists in an array, `DomainParsers` in `src/lib/schema.ts` employs `array.reduce()` with `safeParse()`:
- Malformed items in `history`, `library`, `customFoods`, `routines`, `trainingCycles`, `supplements`, or `nutrition` are logged and discarded, allowing valid entries to load normally.

---

## 4. State Management, Synchronization & Error Handling Pathways

### 4.1 Zustand Store Architecture (`useAppStore.ts`)

The centralized store combines three slices:
- **`createDataSlice.ts`**: Holds `userData`. On update, immediately writes to IndexedDB cache (`saveUserDataToCache`). Protects `localWorkout` from being overwritten by network fetches.
- **`createWorkoutSlice.ts`**: Holds `localWorkout`. Synchronizes with `localStorage` debounced at 300ms (`DEBOUNCE_DELAY_LOCAL`).
- **`createSyncSlice.ts`**: Handles debounced cloud save (`DEBOUNCE_DELAY_GLOBAL` = 1000ms), Promise queuing, `saveError`, and `syncing` state.

### 4.2 Save Pipeline & Promise Management

1. Component calls `saveUserData(updater)` or `updateUserData(updater)`.
2. Zustand updates in-memory `userData` and executes `saveUserDataToCache(finalData)` to IndexedDB immediately.
3. Zustand sets `syncing: true`, `saveError: null`.
4. Returns a `Promise<void>` pushed to `pendingPromises`.
5. Global debouncer timer (1000ms) runs.
6. `DB.saveUserData(currentState)` is invoked:
   - Evaluates `fast-deep-equal` on root doc and monthly buckets.
   - Executes `checkDocSize(< 950000 bytes)` on all write payloads.
   - Emits atomic `writeBatch.commit()` with a 7000ms timeout (`withTimeout`).
7. **Promise Resolution / Rejection**:
   - On success: all `pendingPromises` are resolved; `syncing: false`.
   - On failure: `saveError` is set to `"Errore sincronizzazione. Verifica la connessione."`; all `pendingPromises` are rejected with the error; `syncing: false` is reset in `finally`.
   - If offline (`navigator.onLine === false` or `unavailable` or `Timeout`): warns and allows Firestore internal cache queue to handle, without updating `lastSavedStateStr` so diffing retries when online.

### 4.3 Dialog System (`useDialogStore.ts` & `GlobalDialog.tsx`)

In compliance with `AGENTS.md`, native browser `window.alert()` and `window.confirm()` are prohibited.
- `useDialogStore` provides `showAlert(message, title = 'Avviso'): Promise<void>` and `showConfirm(message, title = 'Conferma'): Promise<boolean>`.
- Rendered by `<GlobalDialog />` at the root of the React tree with dark glassmorphism styling, accessible `role="alertdialog"`, and `aria-modal="true"`.

---

## 5. Comprehensive Gap Analysis vs. Requirements R1–R6

### R1. Infrastructural Security (Firebase App Check)

| Aspect | Current Codebase Implementation | R1 Target Requirement | Gap / Architectural Action |
|---|---|---|---|
| **App Check Initialization** | None in `src/lib/firebase.ts`. | `initializeAppCheck(app, { provider: new ReCaptchaV3Provider(siteKey), isTokenAutoRefreshEnabled: true })`. | Needs module creation; provider strictly reCAPTCHA v3 (free on Spark), not Enterprise. |
| **Site Key Handling** | No site key env variable. | Site key integrated into client bundle (`VITE_RECAPTCHA_SITE_KEY`) as public key. | Add env variable definition and verification in fail-fast check. |
| **Token TTL** | N/A | Documented standard TTL (e.g. 1 hour) with auto-refresh enabled. | Define token lifespan and refresh parameters in architectural plan. |
| **`isSupported()` Failure & Unsupported Browsers** | N/A | In enforcement mode, if `isSupported()` is false or token fails, cloud sync is disabled, app operates in local/offline mode only, and user is notified in Italian *Sentence case* via `useDialogStore`. | Design fallback interceptor in `AuthContext` / `db.ts` to switch to offline-only state. |
| **Console Security** | Google Cloud API key restrictions & Authorized Domains documented in `AGENTS.md`. | Complete verification checklist for reCAPTCHA v3 site key, authorized domains, and API Key referrer restrictions. | Formalize step-by-step console configuration in `PUBLIC_RELEASE_PLAN.md`. |

### R2. Quotas, Server-Side Rules & Privacy Analytics

| Aspect | Current Codebase Implementation | R2 Target Requirement | Gap / Architectural Action |
|---|---|---|---|
| **Client Document Size Guard** | `checkDocSize` in `src/lib/db.ts` (< 950KB) using `new Blob([JSON.stringify(data)]).size`. | Client pre-write 950KB guard verified and enforced. | Current `checkDocSize` implementation matches client-side requirement. |
| **Firestore Security Rules** | Default / monolithic collection rules without fine-grained item caps or type whitelists. | Server-side rules in `firestore.rules` enforcing user ownership (`request.auth.uid == userId`), strict field types, maximum string lengths, maximum array sizes, and root document size <= 950KB without any `get()` or `exists()` calls. | Develop comprehensive `firestore.rules` and test with Firestore Emulator. |
| **Firebase Analytics Initialization** | In `src/lib/firebase.ts`: initialized automatically on startup if `isSupported()` is true. | Analytics must NOT initialize or track without explicit user opt-in consent. | Guard Analytics behind consent check; store consent in localStorage (`'logbook_analytics_consent'`). |
| **Analytics Privacy Policy & UI** | No opt-in banner, no consent UI in Settings. | Privacy-safe consent banner & Settings toggle. Zero sensitive/health data transmitted (no `uid`, food names, exercise names, weights, measurements, notes). | Create PoC UI for consent and privacy-safe event schema. |
| **Spark Plan Usage Calculation** | Windowed loading (3 months) in `db.ts`. Writes debounced (1s). | Exact calculation proving average daily user activity consumes < 1% of Spark daily limits (50k reads, 20k writes). | Document deterministic read/write math in `PUBLIC_RELEASE_PLAN.md`. |

### R3. Global Catalog, Offline Fallback & Separate Cache

| Aspect | Current Codebase Implementation | R3 Target Requirement | Gap / Architectural Action |
|---|---|---|---|
| **Catalog Architecture** | `defaultExercises` (~40KB) and `defaultFoods` (~41KB) are hardcoded in source and copied into every user's Firestore root doc (`users/{uid}.library` and `.customFoods`). | Global public catalog in Firestore (`catalog/exercises`, `catalog/foods` or `catalog/manifest`); user doc stores only overrides, custom items, and hidden IDs. | Decouple defaults from `UserData`. User doc shrinks from ~100KB to < 5KB initially. |
| **Catalog Cache Key** | Stored inside `'logbook_cached_user_data'`. | Dedicated versioned IndexedDB key (e.g. `'logbook_catalog_cache'`, separate from user data). | Define separate IDB storage for catalog. |
| **Sync Protocol** | Full write/load of defaults on every auth session. | Remote sync reads a lightweight manifest (`version`, `updatedAt`, `schemaVersion`, deterministic hashes) and only fetches catalog documents if local version is outdated. Zero realtime listeners. | Design manifest schema and conditional fetch algorithm. |
| **First Launch / Offline Seed** | Uses imported TypeScript arrays. | Seed JSON embedded in client bundle for instant guest/offline bootstrap. | Specify seed JSON layout and hydration mechanism. |
| **Firestore Rules for Catalog** | N/A | `match /catalog/{doc=**} { allow read: if true; allow write: if false; }`. Admin updates via Console only. | Add public read-only rule to `firestore.rules`. |

### R4. Resilient UX & Advanced Error Management

| Aspect | Current Codebase Implementation | R4 Target Requirement | Gap / Architectural Action |
|---|---|---|---|
| **Error Message Mapping** | Generic `"Errore sincronizzazione. Verifica la connessione."` on any save failure. | Granular mapping of Firebase error codes (`permission-denied`, `resource-exhausted`, `unavailable`, `unauthenticated`, `deadline-exceeded`) to user-friendly Italian in *Sentence case*. | Create `formatSyncError` mapper and integrate with `useDialogStore`. |
| **Local Save Confirmation** | IndexedDB save is quiet; failure in cloud shows error without clarifying that local copy succeeded. | Explicitly inform user that local storage (IndexedDB/localStorage) succeeded, and cloud sync will resume when connection/access is restored. | Implement dual-status reporting in sync error flows. |
| **Three Mandatory UX Scenarios** | Only generic offline banner in `AuthContext`. | Formal PoC covering: 1) Network absent with local save success; 2) App Check unsupported; 3) Rules rejection / quota limit. | Implement exact PoC handlers and dialog triggers. |

### R5. Isolation & Proof of Concept (PoC)

| Aspect | Current Codebase Implementation | R5 Target Requirement | Gap / Architectural Action |
|---|---|---|---|
| **Production Code Safety** | Production files in `src/`. | **Zero production files modified** (`src/` remains untouched). All artifacts reside in designated working directory. | Adhere strictly to read-only constraints. |
| **Emulator Test Suite** | Existing tests in `tests/`. | Automated Firestore Emulator test suite validating rule rejections (malformed payload, oversized strings/arrays, unauthorized access). Note: test mocks should include `indexedDBLocalPersistence` for `firebase/auth`. | Design and deliver comprehensive emulator test suite. |

### R6. GDPR Privacy Policy & Documentation

| Aspect | Current Codebase Implementation | R6 Target Requirement | Gap / Architectural Action |
|---|---|---|---|
| **Privacy Policy Document** | None in codebase. | Comprehensive `PRIVACY_POLICY.md` in Italian covering Data Controller, Processor (Google Firebase), Art. 9(2)(a) GDPR legal basis for health/fitness data, explicit retention periods, user rights, and Analytics opt-in. | Draft full GDPR-compliant privacy policy. |
| **Age Restriction** | Not explicitly enforced in documentation. | Explicitly state age threshold (≥ 18 years only) to avoid parental consent management under GDPR Art. 8. | Include in privacy policy and onboarding specifications. |
| **Technical Storage Disclosure** | Documented in `AGENTS.md`. | Explicitly explain technical use of IndexedDB and LocalStorage for offline-first caching without third-party tracking. | Include clear technical storage disclosures. |

---

## 6. Mandatory 5-Step Checklist Impact for Schema Extensions

`AGENTS.md` mandates that whenever a new property is added to `UserData`, all 5 files must be updated synchronously:

1. `src/types.ts`: Define interface and property on `UserData`.
2. `src/lib/schema.ts`: Create defensive Zod sub-schema, register in `UserDataSchema`, `defaultUserDataFallback`, and `DomainParsers`.
3. `src/lib/db.ts`: Map property in `DB.loadUserData`, include in `oldState`, `deepEqual` check, and serialization in `DB.saveUserData`.
4. `src/contexts/AuthContext.tsx`: Include default value in `defaultUserData`.
5. `src/lib/export.ts` (or `src/hooks/useSettings.ts`): Include in CSV export logic of `exportToCSV`.

### Catalog Decoupling Impact on the 5 Steps:
Under the R3 decoupled architecture:
- User-specific overrides (`customExercises`, `exerciseOverrides`, `hiddenCatalogExercises`, `customFoods`, `foodOverrides`, `hiddenCatalogFoods`) are added to `UserData` and **strictly adhere to the 5-step checklist**.
- The Global Catalog cache itself is stored under a separate IndexedDB key (`'logbook_catalog_cache'`) and is **NOT** part of `UserData`, preventing unnecessary bloated diffing, keeping user document sizes minimal (< 5KB initial), and maintaining complete separation of concerns.

---

## 7. Discovered Features & Architectural Interfaces

```
## Features Discovered
| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Auth & Startup | Fast Pre-render Bootstrap | Loads IndexedDB cache before ReactDOM render to eliminate loading flicker and race conditions | 'logbook_cached_user_data' from IndexedDB | window.__INITIAL_USER_DATA__, initial Zustand state | Fallback to null on corrupted cache | src/main.tsx:18-32, src/store/slices/createDataSlice.ts:12-23 |
| 2 | Storage | Active Workout Shield | Prevents network fetch from overwriting an active ongoing local workout | Incoming UserData from cloud, state.localWorkout | Preserved localWorkout in memory and localStorage | Ignores remote activeWorkout if local exists | src/store/slices/createDataSlice.ts:55-88 |
| 3 | Storage | Background Visibility Flush | Flushes live workout state synchronously to localStorage when page hides | document.visibilityState === 'hidden' | 'logbook_local_workout' written to localStorage | Logs error to console on QuotaExceeded | src/store/useAppStore.ts:22-35 |
| 4 | Persistence | Monthly History Partitioning | Splits workout history into monthly subcollection documents 'history_months/{YYYY-MM}' | UserData.history items with timestamps/dates | Firestore docs under users/{uid}/history_months | Throws if single month > 950KB | src/lib/db.ts:209-242 |
| 5 | Persistence | Monthly Nutrition Partitioning | Splits nutrition and daily body measurements into monthly docs 'nutrition_months/{YYYY-MM}' | UserData.nutrition records keyed by YYYY-MM-DD | Firestore docs under users/{uid}/nutrition_months | Throws if single month > 950KB | src/lib/db.ts:243-272 |
| 6 | Persistence | Fast Deep Equal Batch Diffing | Only writes modified root fields or modified months to Firestore writeBatch | Current state vs oldState | Atomic batch commit | Fails fast on network/timeout, retains diffing state | src/lib/db.ts:178-289 |
| 7 | Data Integrity | Pre-write Size Guard | Validates serialized JSON document size before sending to Firestore batch | Clean doc payload | Allowed write or Error | Throws error if payload > 950,000 bytes | src/lib/db.ts:20-26 |
| 8 | Guest Merge | Deterministic Multi-collection Merge | Merges local guest data into cloud data upon Google account linking | cloudData (UserData), guestData (UserData) | Unified UserData validated via UserDataSchema | Deduplicates arrays by id, guest priority on collision | src/lib/merge.ts:211-241 |
| 9 | UI / Dialogs | Global Dialog Store | Centralized promise-based alert and confirmation dialog system | message: string, title?: string | Promise<void> for alert, Promise<boolean> for confirm | Resolves gracefully on dismissal | src/store/useDialogStore.ts:1-63, src/components/UI/GlobalDialog.tsx |
| 10 | Export | Excel-compatible BOM CSV Exporter | Generates UTF-8 BOM CSV files for workouts and nutrition measurements | history: WorkoutSession[], nutrition: Record<string, NutritionDay>, library: Exercise[] | allenamenti.csv, misurazioni.csv blob downloads | Shows alert if history is empty | src/lib/export.ts:1-104 |
| 11 | Account Deletion | Cascaded Account & Subcollection Delete | Deletes user document, history_months, nutrition_months (chunked in max 400 ops) and Auth user | Current authenticated user | Firestore deletion & Auth user deletion | Catches 'auth/requires-recent-login' and prompts re-auth | src/lib/db.ts:305-345 |
| 12 | Sanitization | Defensive DomainParsers | Validates and sanitizes corrupt array elements individually rather than crashing the view | Raw array data from Firestore/IndexedDB | Sanitized typed array | Discards and logs invalid entries | src/lib/schema.ts:375-461 |
```

---

## 8. Edge Cases & Resilience Behaviors

```
## Edge Cases
| # | Feature | Input | Observed Behavior |
|---|---------|-------|-------------------|
| 1 | Pre-render bootstrap | IndexedDB contains corrupted or non-schema JSON | `UserDataSchema.safeParse` / `catch` triggers fallback to `null`; app boots with clean default state without crashing. |
| 2 | Active workout persistence | Mobile OS puts browser in background while typing set | `visibilitychange` listener immediately writes `localWorkout` to synchronous `localStorage`, bypassing 300ms debounce. |
| 3 | Cloud synchronization | Network connection drops mid-workout or during save | Firestore batch write throws timeout/unavailable; Zustand marks `saveError`; diffing state `lastSavedStateStr` is NOT updated, allowing transparent retry when online. |
| 4 | Guest account link | Guest user created new routines with matching ID to cloud routines | `mergeArrayById` deterministically assigns priority to guest routines on ID collision while preserving distinct cloud routines. |
| 5 | Date formatting | Workout logged at 00:15 local time | `getLocalDateString()` uses device local timezone instead of UTC `toISOString()`, preventing shift to previous calendar day. |
| 6 | Payload size limit | User attempts to insert excessive notes exceeding 950KB | `checkDocSize` throws blocking Error before Firestore call, preventing 1MB Firestore quota error and preserving dirty state. |
| 7 | Account deletion | User with > 500 monthly history and nutrition records deletes account | Operations are chunked into batches of max 400 operations (`CHUNK_SIZE = 400`), avoiding Firestore 500-operation batch limit. |
| 8 | Sleep metric input | User enters sleep duration as "7.5", "7:30", or number 7.5 | `safeOptionalSleepTime` transforms input via `formatSleepTime` into standardized `"07:30"` string. |
| 9 | Re-authentication | User attempts account deletion after long inactive session | Firebase Auth raises `auth/requires-recent-login`; `DB.deleteAccount` catches error and displays friendly Italian instruction. |
| 10| Online reconnection | Device regains network connection | `window.addEventListener('online')` in `useAppStore.ts` automatically clears `saveError`. |
```
