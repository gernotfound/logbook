# Handoff Report — Explorer 2 (State Logic & Zustand Store Audit)

## 1. Observation
Directly observed codebase state at `c:\Users\gerar\Documents\GitHub\logbook`:

1. **Runtime Crash in `TrainingSession.tsx`**:
   - File: `src/components/Training/TrainingSession.tsx`, line 76:
     ```tsx
     <div style={{ fontSize: '2rem', fontWeight: 'bold', margin: 0, fontFamily: 'monospace', color: 'var(--primary-color)' }}>
         {timerDisplay}
     </div>
     ```
   - Variable `timerDisplay` is **not imported, passed as prop, or defined via state** in `TrainingSession.tsx`.
   - `WorkoutTimer` component is imported on line 4 (`import WorkoutTimer from './WorkoutTimer';`) but never rendered.

2. **Zustand Store Implementation**:
   - File: `src/store/useAppStore.ts`.
   - Written without TypeScript interface types (`create((set, get) => ...)`).
   - Holds only primitive state setters (`setUserData`, `setLocalWorkout`, `setSyncing`, `setSaveError`).
   - Lacks domain action handlers (`addExercise`, `updateRoutine`, `addMeal`), forcing custom hooks (`useNutritionMeals`, `useTrainingRoutines`, `useWorkoutSession`) to perform manual shallow/deep cloning of `userData`.

3. **Date String UTC Generation**:
   - Files: `src/hooks/useNutritionMeals.ts:18`, `src/hooks/useNutritionMeasurements.ts:16`, `src/hooks/useHomeView.ts:49`, `src/hooks/useWorkoutSession.ts:38`.
   - All use `new Date().toISOString().split('T')[0]`.
   - `toISOString()` outputs UTC timestamps, which differ from local date between 22:00 and 00:00 in UTC+1/UTC+2 timezones.

4. **Persistence Disconnection (`localWorkout` vs `activeWorkout`)**:
   - `useAppStore.ts` loads `localWorkout` only once from `localStorage`.
   - `DB.ts` reads and writes `activeWorkout` to Firebase Firestore document (`users/{uid}`).
   - `AuthContext.tsx` loads cloud data into `userData`, but `useAppStore` never syncs `userData.activeWorkout` to `localWorkout`.
   - `setLocalWorkout` in `useWorkoutSession.ts` writes to `localStorage` but does not trigger a cloud save or update `userData.activeWorkout`.

5. **Form Hydration Defect**:
   - Files: `src/hooks/useNutritionPlanning.ts:8`, `src/hooks/useSettings.ts:14`.
   - Form hooks set initial React state via `useState(userData?.field || default)`.
   - When `userData` finishes loading asynchronously after initial component render, React `useState` initial values do not re-run.

6. **Calculation Error for 0 Quantity**:
   - Files: `src/hooks/useNutritionMeals.ts:45`, `src/components/Nutrition/NutritionMeals.tsx:85`.
   - Code: `const ratio = (m.quantity || m.baseQty || 100) / (m.baseQty || 100);`.
   - When `quantity = 0`, JS evaluates `(0 || 100)` to `100`, resulting in a ratio of `1.0` (calculates macros for 100g instead of 0g).

7. **Lost Features**:
   - **Rest Timer**: Implemented in `legacy_app_utf8.js:165-199` (`startRest`, `pauseRest`, `stopRest`, `resetRest`). Completely omitted in `src/`.
   - **Calendar Month View**: `getCalendarMonthGrid` and `getWorkoutDatesSet` exist in `src/lib/logic.ts:779-824` but are never called or rendered in any component.

---

## 2. Logic Chain

1. **Runtime Crash**:
   - *Observation*: `timerDisplay` is referenced on line 76 of `TrainingSession.tsx` without being declared.
   - *Deduction*: When `activeWorkout` is non-null, React attempts to evaluate `timerDisplay` during render. Since `timerDisplay` is undefined in scope, JavaScript throws an unhandled `ReferenceError`.
   - *Conclusion*: Active workout session view is completely broken and crashes at runtime.

2. **Persistence Desynchronization**:
   - *Observation*: `localWorkout` is managed via `localStorage` in `useAppStore`, while `activeWorkout` is stored in Firestore via `DB.ts`. Neither updates the other.
   - *Deduction*: User starting a workout session on one tab/device or reloading after cloud sync will see active session state vanish or desynchronize.
   - *Conclusion*: Active workout persistence across reloads/devices is broken.

3. **Zero Quantity Calculation**:
   - *Observation*: `(m.quantity || m.baseQty || 100)` uses `||` falsy operator.
   - *Deduction*: `0` is falsy in JS. When `quantity` is 0, the left operand evaluates to `m.baseQty` (100).
   - *Conclusion*: 0 grams quantity is computed as 100 grams calories and macros.

4. **Lost Rest Timer & Calendar View**:
   - *Observation*: `legacy_app_utf8.js` contained full rest timer logic and calendar grid rendering. `src/` contains no rest timer UI or state, and leaves calendar grid helper functions unused.
   - *Deduction*: During the JS Context -> TS Zustand refactor, these two features were left un-implemented.
   - *Conclusion*: Rest timer and historic monthly calendar grid are lost features requiring restoration.

---

## 3. Caveats

- **Firebase Connectivity**: We did not execute live network calls to Firebase servers (CODE_ONLY mode). Verification relies on static code inspection and logic tracing.
- **Service Worker / PWA Caching**: We did not test active PWA service worker background updates in a browser engine, though SW registration code in `App.tsx` was inspected.

---

## 4. Conclusion

The TS/Zustand refactor requires critical bug fixes and feature restorations before Milestone 2/3:
1. **Fix `TrainingSession.tsx` runtime crash** by rendering `<WorkoutTimer globalStartTime={activeWorkout.globalStartTime} />`.
2. **Type `useAppStore.ts`** and add explicit domain action handlers for Zustand.
3. **Restore Rest Timer** with start/pause/reset controls.
4. **Fix Zero-Quantity calculation** by checking `m.quantity !== undefined ? m.quantity : m.baseQty`.
5. **Fix UTC date formatting** across hooks to use local timezone date `YYYY-MM-DD`.
6. **Sync `localWorkout` with `userData.activeWorkout`** for seamless cloud/localStorage persistence.
7. **Hydrate form states** in `useNutritionPlanning` and `useSettings` when `userData` updates.

---

## 5. Verification Method

1. **Verify `TrainingSession.tsx` Fix**:
   - Run Vitest render test on `TrainingSession` with an active workout state (`localWorkout = { globalStartTime: Date.now(), ... }`).
   - Invalidation condition: `ReferenceError: timerDisplay is not defined`.

2. **Verify Zero-Quantity Calculation**:
   - Run `npx vitest run src/lib/logic.test.ts` or add a test for `quantity = 0` in `useNutritionMeals` `recalcTotals`.
   - Invalidation condition: Total calories > 0 when item quantity is 0.

3. **Verify Build & Types**:
   - Run `npx tsc --noEmit` and `npm run build`.
   - Invalidation condition: TypeScript or Vite compilation errors.
