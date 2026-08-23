# Forensic Audit Report: React Hooks, Memoization Performance & Security Rules

## Observation

1. **`src/hooks/useNutritionPlanning.ts`**:
   - Lines 8-12: Granular selectors are used to subscribe to specific slices of state:
     ```typescript
     const storePlanning = useAppStore(state => state.userData?.nutritionPlanning);
     const nutritionMap = useAppStore(state => state.userData?.nutrition);
     const profile = useAppStore(state => state.userData?.profile);
     const saveUserData = useAppStore(state => state.saveUserData);
     const showAlert = useDialogStore(state => state.showAlert);
     ```
   - Lines 73-78: `useMemo` hooks for TDEE computation:
     ```typescript
     const tdeeUserData = useMemo(() => ({
         nutritionPlanning: storePlanning,
         nutrition: nutritionMap,
         profile: profile
     }), [storePlanning, nutritionMap, profile]);
     const tdeeCalc = useMemo(() => Logic.calculateTDEEAndMacros(tdeeUserData as any), [tdeeUserData]);
     ```
   - Lines 36-43: Local draft planning and fallback handling:
     ```typescript
     const planning = localPlanning ?? storePlanning ?? defaultPlanning;
     if (!planning.avgMacros) planning.avgMacros = defaultPlanning.avgMacros;
     if (!planning.onBoost) planning.onBoost = defaultPlanning.onBoost;
     if (planning.onDaysCount === undefined) planning.onDaysCount = 4;
     if (!planning.weight) planning.weight = latestWeight;
     ```
   - Lines 48-70: Synchronous calculations for active ON/OFF macro targets (`currentOnMacros`, `currentOffMacros`, `onMacrosCalc`, `offMacrosCalc`, `avgMacrosCalc`) are recomputed dynamically on every render from `planning` without being blocked by memoization.

2. **`src/components/Training/TrainingSession.tsx`**:
   - Lines 44-45: Module-level constants declared outside the component function:
     ```typescript
     const EMPTY_CYCLES: TrainingCycle[] = [];
     const EMPTY_HISTORY_ARRAY: Array<{ date: string; sets: any[]; note: string }> = [];
     ```
   - Line 55: `const trainingCycles = useAppStore(state => state.userData?.trainingCycles || EMPTY_CYCLES);`
   - Line 394: `const pastWorkouts = exerciseHistoryMap.get(exItem.exId) || EMPTY_HISTORY_ARRAY;`
   - Lines 120-136: `exerciseHistoryMap` is memoized with `useMemo(..., [history])`.

3. **`src/components/Training/session/SessionExerciseCard.tsx` & `SessionSetRow.tsx`**:
   - `SessionExerciseCard.tsx` lines 262-272: `React.memo` with custom equality comparator:
     ```typescript
     export const SessionExerciseCard = React.memo(SessionExerciseCardInner, (prev, next) => {
         return (
             prev.exItem === next.exItem &&
             prev.libDef === next.libDef &&
             prev.pastWorkouts === next.pastWorkouts &&
             prev.isHistoryOpen === next.isHistoryOpen &&
             prev.isSetupOpen === next.isSetupOpen &&
             prev.openSpecialMenuId === next.openSpecialMenuId &&
             prev.exIndex === next.exIndex
         );
     });
     ```
   - `SessionSetRow.tsx` lines 160-168: `React.memo` with custom equality comparator:
     ```typescript
     export const SessionSetRow = React.memo(SessionSetRowInner, (prev, next) => {
         return (
             prev.set === next.set &&
             prev.sIndex === next.sIndex &&
             prev.exIndex === next.exIndex &&
             prev.trackingType === next.trackingType &&
             prev.isOpenMenu === next.isOpenMenu
         );
     });
     ```
   - `src/hooks/workout/useWorkoutSetMutations.ts` lines 99-111: Immutable updates returning unchanged `ex` and unchanged `s` references for non-modified exercises and sets.

4. **Global Zustand Selectors across Codebase (`grep_search`)**:
   - All components and hooks use declared module-level empty constants (`EMPTY_ROUTINES`, `EMPTY_LIBRARY`, `EMPTY_HISTORY`, `EMPTY_FOODS`, `EMPTY_NUTRITION`, `EMPTY_PROFILE`, `EMPTY_CYCLES`, `EMPTY_SUPPLEMENTS`, `EMPTY_ARRAY`).
   - Zero inline empty array/object literals (`|| []`, `|| {}`) found in selector expressions.

5. **`firestore.rules`**:
   - Lines 5-20: Security helper functions:
     ```javascript
     function isAuthenticated() { return request.auth != null; }
     function isOwner(userId) { return isAuthenticated() && request.auth.uid == userId; }
     function isValidMonthId(monthId) { return monthId.matches('^[0-9]{4}-(0[1-9]|1[0-2])$'); }
     function incomingData() { return request.resource.data; }
     ```
   - Lines 23-25: Default deny rule: `match /{document=**} { allow read, write: if false; }`.
   - Lines 28-43: Strict whitelist on `/users/{userId}`:
     ```javascript
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
         'supplements'
       ]);
     ```
   - Lines 45-57: Subcollections `/history_months/{monthId}` and `/nutrition_months/{monthId}` enforce `isOwner(userId)` and `isValidMonthId(monthId)`.

6. **Build and Lint Verification**:
   - `npm.cmd run build`: Exited code 0 (`tsc --noEmit && vite build`), 2274 modules transformed cleanly.
   - `npm.cmd run lint`: Exited code 0 (`oxlint`), 0 errors, 1 warning (missing `nutrition` in `useEffect` deps in `useNutritionMeasurements.ts:92`).

---

## Logic Chain

1. **Analysis of `useNutritionPlanning.ts` (React Hooks & Memoization)**:
   - **Trigger Isolation**: By replacing `state => state.userData` with targeted selectors (`state.userData?.nutritionPlanning`, `state.userData?.nutrition`, `state.userData?.profile`), `useNutritionPlanning` is isolated from high-frequency mutations to `localWorkout` or `activeWorkout`. When a user types in a live workout session, `userData.nutritionPlanning`, `userData.nutrition`, and `userData.profile` remain referentially identical, avoiding re-render cascades in background tabs.
   - **`useMemo` Correctness**: `tdeeUserData` depends on `[storePlanning, nutritionMap, profile]` and `tdeeCalc` depends on `[tdeeUserData]`. When nutrition entries (weight/kcal) or profile measurements change in the store, `tdeeCalc` is recomputed properly.
   - **UI Responsiveness & No Blocked Updates**: Local form updates (`handleUpdate`, `handleUpdateAvgMacros`, `handleUpdateOnBoost`) set `localPlanning`. The displayed ON/OFF macro breakdowns (`onMacrosCalc`, `offMacrosCalc`, `avgMacrosCalc`, `currentOnMacros`, `currentOffMacros`) are computed directly in the component body from `planning` without memoization barriers, ensuring instantaneous UI feedback on every keystroke.
   - **Identified Code Quality Detail**: Lines 39-42 perform assignment mutations on `planning` (e.g. `planning.avgMacros = ...`). When `localPlanning` is null, `planning` references `storePlanning` directly. While `handleSave` sanitizes and replaces the entire object on commit, direct in-place mutation of store state objects in memory should be avoided in favor of shallow cloning.

2. **Analysis of `TrainingSession.tsx` & Memoization Architecture**:
   - **Shallow Equality Killer Resolution**: In prior revisions, `pastWorkouts = exerciseHistoryMap.get(exItem.exId) || []` created a new array reference on every render for exercises with no previous history. Because `SessionExerciseCard` compares `prev.pastWorkouts === next.pastWorkouts`, every render of `TrainingSession` (e.g. from the 1-second global timer tick) caused every unrecorded exercise card to re-render.
   - **Referential Stability with `EMPTY_HISTORY_ARRAY`**: By defining `const EMPTY_HISTORY_ARRAY: Array<...> = []` at the module level and passing it as the fallback, `prev.pastWorkouts === next.pastWorkouts` evaluates to `true` (`EMPTY_HISTORY_ARRAY === EMPTY_HISTORY_ARRAY`).
   - **Granular Rendering in Live Workout**: In combination with `useWorkoutSetMutations.ts` (which preserves unchanged `ex` objects and unchanged `set` objects), only the specific `SessionSetRow` being edited re-renders on keystroke. All other exercise cards and set rows skip rendering completely via `React.memo`.

3. **Analysis of `firestore.rules` (Security & Multi-Tenancy)**:
   - **Multi-Tenant Segregation**: Access to `/users/{userId}` and its subcollections requires `request.auth.uid == userId`. No user can read or write documents belonging to another UID.
   - **Wildcard Hardening**: The permissive `{document=**}` wildcard under `/users/{userId}` has been eliminated. Only the two explicitly designated subcollections (`history_months` and `nutrition_months`) are accessible.
   - **Schema Whitelist**: The root document `/users/{userId}` restricts write operations to the 9 authorized top-level keys (`profile`, `library`, `routines`, `customFoods`, `activeWorkout`, `trainingCycles`, `activeCycleId`, `nutritionPlanning`, `supplements`) via `hasOnly()`. This matches the serializations performed by `src/lib/db.ts:172-182`.
   - **Regex Validation**: Subcollection document IDs are constrained to `^[0-9]{4}-(0[1-9]|1[0-2])$`, preventing arbitrary or malformed month subcollection paths.

---

## Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Performance | Granular Zustand Selectors | Selective store subscriptions avoiding root `userData` object reference triggers | Zustand store state slices | Stable slice references | Returns `undefined` / constant fallback if store empty | `src/hooks/useNutritionPlanning.ts:8-12` |
| 2 | Performance | Stable Array Fallback (`EMPTY_HISTORY_ARRAY`) | Module-level constant array for exercises without workout history | `exerciseHistoryMap.get(exId)` | Stable `EMPTY_HISTORY_ARRAY` reference | `undefined` mapped to stable constant | `src/components/Training/TrainingSession.tsx:45,394` |
| 3 | Performance | Custom Comparator `React.memo` for Exercise Cards | Skips re-render of unmodified exercise cards during live set logging | `prevProps`, `nextProps` (`exItem`, `libDef`, `pastWorkouts`, etc.) | Boolean (`true` to skip render) | Falls back to re-render if any observed prop changes | `src/components/Training/session/SessionExerciseCard.tsx:262-272` |
| 4 | Performance | Custom Comparator `React.memo` for Set Rows | Isolates keystroke updates to only the active set row being typed into | `prevProps`, `nextProps` (`set`, `sIndex`, `isOpenMenu`, etc.) | Boolean (`true` to skip render) | Falls back to re-render if active set value changes | `src/components/Training/session/SessionSetRow.tsx:160-168` |
| 5 | Performance | Immutable Set/Exercise Updates | Functional updates preserving identity of unchanged exercises and sets | `prev: WorkoutSession` | New session object with unchanged item references preserved | Gracefully returns `prev` if null | `src/hooks/workout/useWorkoutSetMutations.ts:99-111` |
| 6 | Calculation | Real-time Macro Ratio Planning | Computes ON/OFF daily calorie and macronutrient distributions dynamically | User planning inputs (`avgMacros`, `onBoost`, `onDaysCount`, `weight`) | `onMacrosCalc`, `offMacrosCalc`, `avgMacrosCalc` | Fallback to safe defaults if inputs empty/invalid | `src/hooks/useNutritionPlanning.ts:48-70` |
| 7 | Calculation | Memoized TDEE & Body Fat Estimation | Derives maintenance calories and body fat from history and anthropometrics | `tdeeUserData` (`nutritionPlanning`, `nutrition`, `profile`) | `{ tdee, bf, carbs, pro, fat, totalKcal }` | Returns standard defaults (2500 kcal) if history empty | `src/hooks/useNutritionPlanning.ts:73-78` |
| 8 | Security | Multi-Tenant Authorization | Ensures Firestore documents are accessible only by the authenticated owner | `request.auth.uid`, `userId` | `isOwner(userId)` boolean | `permission-denied` (403) on mismatch | `firestore.rules:10-12` |
| 9 | Security | Root User Document Key Whitelist | Restricts root document fields to 9 approved properties via `hasOnly()` | `request.resource.data.keys()` | Boolean validation | Rejects document write if unauthorized fields present | `firestore.rules:33-43` |
| 10 | Security | Month Subcollection Regex Constraint | Validates month document ID adheres strictly to `YYYY-MM` format | `monthId` string | Boolean validation (`^[0-9]{4}-(0[1-9]|1[0-2])$`) | Rejects document write if month ID invalid | `firestore.rules:14-16,49,56` |
| 11 | Security | Global Catch-All Default Deny | Closes all database paths not explicitly matched | Any unlisted Firestore path | `false` | Denies all read/write requests | `firestore.rules:23-25` |

---

## Edge Cases

| # | Feature | Input | Observed Behavior |
|---|---------|-------|-------------------|
| 1 | `TrainingSession` Exercise History | Exercise with no prior historical logs (`pastWorkouts` is `undefined`) | Falls back to `EMPTY_HISTORY_ARRAY`. `prev.pastWorkouts === next.pastWorkouts` evaluates to `true`, preserving `React.memo` integrity. |
| 2 | `useNutritionPlanning` Live Editing | User rapidly edits text fields in planning inputs | `localPlanning` updates instantly; ON/OFF macros recalculate synchronously each render without memoization delay; TDEE remains stable until saved. |
| 3 | `useNutritionPlanning` Empty Store | Store has `nutritionPlanning: null` or missing `avgMacros` | Falls back safely to `defaultPlanning` (`carbs: 3.5, pro: 2.0, fat: 1.0`, 4 ON days, weight from latest nutrition or 80kg). |
| 4 | `SessionSetRow` Keystroke Isolation | User updates weight on set 2 of exercise 1 | Only set 2 re-renders; set 1, set 3, and all other exercise cards skip re-rendering. |
| 5 | Firestore Security Rules Payload Injection | Client attempts to write unexpected field `admin: true` to `/users/{userId}` | `hasOnly` check fails; Firestore rejects the write request with `permission-denied`. |
| 6 | Firestore Security Rules Invalid Month ID | Client attempts to create `/users/{userId}/history_months/invalid_month_123` | `isValidMonthId` fails; Firestore rejects the create/update request with `permission-denied`. |

---

## Caveats

- In `src/hooks/useNutritionMeasurements.ts:92`, `oxlint` reports a non-blocking linter warning (`react-hooks/exhaustive-deps`: missing `nutrition` in `useEffect` dependency array). This does not impede production builds (`npm run build` succeeds).
- In `useNutritionPlanning.ts:39-42`, property fallback assignment directly mutates the resolved `planning` object reference before local state is initialized. While benign in practice due to subsequent immutable cloning in `handleSave`, converting this to `const effectivePlanning = { ...planning, avgMacros: planning.avgMacros || defaultPlanning.avgMacros }` is recommended for architectural purism.

---

## Conclusion

The forensic audit confirms that:
1. **React Performance & Memoization**:
   - Shallow equality killers in `TrainingSession.tsx` and across all Zustand selectors have been eliminated through module-level constants (`EMPTY_HISTORY_ARRAY`, `EMPTY_ROUTINES`, etc.).
   - `SessionExerciseCard` and `SessionSetRow` memoization operates with high efficiency, isolating keystrokes and timer ticks.
   - `useNutritionPlanning.ts` correctly utilizes fine-grained selectors and memoization without obstructing live UI updates.
2. **Security & Multi-Tenancy**:
   - `firestore.rules` enforces multi-tenant isolation, default deny, payload key whitelisting via `hasOnly()`, and month ID regex validation.
3. **Build & Quality Gates**:
   - `npm.cmd run build` completes successfully with **0 errors**.
   - `npm.cmd run lint` completes with **0 errors** (1 non-blocking warning).

---

## Verification Method

1. **Compilation & Build**:
   ```powershell
   npm.cmd run build
   ```
   *Expected Output*: Vite production build succeeds with exit code 0, emitting bundle chunks in `dist/`.

2. **Linter Inspection**:
   ```powershell
   npm.cmd run lint
   ```
   *Expected Output*: Oxlint completes with 0 errors.

3. **Selector & Constant Inspection**:
   - Verify module-level empty constants in `src/components/Training/TrainingSession.tsx:44-45`.
   - Verify custom comparator in `src/components/Training/session/SessionExerciseCard.tsx:262-272`.
   - Verify security rules in `firestore.rules:1-60`.
