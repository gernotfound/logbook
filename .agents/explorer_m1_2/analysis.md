# Deep Audit: State Logic & Zustand Store Refactoring

**Target Repository**: `c:\Users\gerar\Documents\GitHub\logbook`  
**Auditor**: Explorer 2 (State Logic & Zustand Store Audit)  
**Date**: 2026-07-26  

---

## Executive Summary

A comprehensive audit of the React + TypeScript + Zustand refactored codebase (`src/`) was conducted against the legacy codebase (`legacy_app_utf8.js`, `legacy_logic_utf8.js`) and system requirements.

The refactoring successfully migrated the app to TypeScript and Vite with PWA support. However, several **critical runtime errors**, **state synchronization flaws**, **hydration bugs**, **timer regressions**, **calculation errors**, and **lost features** were identified.

Most notably:
1. **Critical Runtime Crash**: Navigating to an active workout session in `TrainingSession.tsx` crashes the application with a `ReferenceError` due to an undeclared `timerDisplay` variable.
2. **Lost Rest Timer**: The inter-set rest timer present in the legacy app was completely omitted during refactoring.
3. **Lost Calendar View**: The monthly calendar grid functions in `logic.ts` are unused by any component.
4. **Cloud/Local Persistence Disconnection**: Active workout state in `localStorage` is not synchronized with Firebase Firestore `userData.activeWorkout`.
5. **Zero-Quantity Calculation Bug**: Nutrition calculation evaluates `quantity = 0` as falsy (`(0 || 100)`), causing 0g portions to calculate as 100g.

---

## 1. State Corruption, Missing Initial States & Store Bugs

### 1.1 Critical Runtime Crash in `TrainingSession.tsx`
- **Location**: `src/components/Training/TrainingSession.tsx`, line 76.
- **Observation**:
  ```tsx
  <div style={{ fontSize: '2rem', fontWeight: 'bold', margin: 0, fontFamily: 'monospace', color: 'var(--primary-color)' }}>
      {timerDisplay}
  </div>
  ```
- **Evidence**: `timerDisplay` is **never declared, initialized, or imported** anywhere in `TrainingSession.tsx`.
- **Impact**: When `activeWorkout` is present, rendering `TrainingSession` immediately throws `ReferenceError: timerDisplay is not defined`, crashing the UI.
- **Root Cause**: The refactoring imported `WorkoutTimer` on line 4 (`import WorkoutTimer from './WorkoutTimer';`) but omitted replacing `{timerDisplay}` with `<WorkoutTimer globalStartTime={activeWorkout.globalStartTime} />`.

### 1.2 Untyped Zustand Store & Lack of Action Handlers
- **Location**: `src/store/useAppStore.ts`.
- **Observation**: `useAppStore` is declared using untyped JavaScript `create((set, get) => ...)` without TypeScript state interface generics (`create<AppState>()`).
- **Evidence**:
  ```ts
  export const useAppStore = create((set, get) => ({
      userData: null,
      saveError: null,
      syncing: false,
      localWorkout: (...),
      setLocalWorkout: ...,
      setUserData: ...,
      setSyncing: ...,
      setSaveError: ...,
      saveUserData: ...
  }));
  ```
- **Impact**: Store contains no domain action handlers (`addExercise`, `updateRoutine`, `addMeal`, etc.). Instead, individual custom hooks manually clone and mutate `userData` before calling `saveUserData({ ...userData, ... })`. This leads to verbose, error-prone spread mutations and potential race conditions when multiple asynchronous updates occur.

### 1.3 UTC Date Mismatch Corrupting Daily Data
- **Location**:
  - `src/hooks/useNutritionMeals.ts`, line 18: `const todayDateStr = new Date().toISOString().split('T')[0];`
  - `src/hooks/useNutritionMeasurements.ts`, line 16: `const todayDateStr = new Date().toISOString().split('T')[0];`
  - `src/hooks/useHomeView.ts`, line 49: `const todayStr = new Date().toISOString().split('T')[0];`
  - `src/hooks/useWorkoutSession.ts`, line 38: `date: new Date().toISOString().split('T')[0];`
- **Observation**: `toISOString()` returns UTC time.
- **Impact**: In timezones east of UTC (e.g. UTC+1/UTC+2 in Italy), actions performed between 10:00 PM and 11:59 PM local time receive tomorrow's UTC date string. Meals, weight measurements, or workouts logged late at night are stored under the wrong date key in `userData.nutrition` and `userData.history`.

### 1.4 Untyped AuthContext
- **Location**: `src/contexts/AuthContext.tsx`, line 6 (`const AuthContext = createContext();`).
- **Impact**: Consuming components receive `any` type from `useAuth()`, reducing type safety across authentication boundaries.

---

## 2. Persistence & Hydration Bugs

### 2.1 Disconnect Between `localWorkout` and Cloud `activeWorkout`
- **Location**: `src/store/useAppStore.ts` & `src/lib/db.ts`.
- **Observation**:
  - `useAppStore.ts` loads `localWorkout` only once from `localStorage.getItem('logbook_local_workout')`.
  - `DB.ts` saves and loads `activeWorkout` in Firebase Firestore (`data.activeWorkout`).
  - When `loadUserData` runs in `AuthContext.tsx`, `userData.activeWorkout` is set in `useAppStore`, but `localWorkout` is **never updated** with `userData.activeWorkout`.
  - When `setLocalWorkout` is called in `useWorkoutSession.ts`, it updates `localStorage` and `localWorkout`, but does **not** update `userData.activeWorkout` or trigger a cloud save.
- **Impact**:
  - If a user opens the app on a new device or reloads after a cloud sync, `localWorkout` remains null even if `activeWorkout` exists in Firebase.
  - Active workout state in `localStorage` and cloud database easily diverge.

### 2.2 Form State Hydration Bugs (`useNutritionPlanning` & `useSettings`)
- **Location**:
  - `src/hooks/useNutritionPlanning.ts`, line 8-18.
  - `src/hooks/useSettings.ts`, lines 14-16.
- **Observation**:
  ```ts
  const [planning, setPlanning] = useState(userData?.nutritionPlanning || defaultPlanning);
  ```
- **Impact**: Components initialize React local state on first mount when `userData` may still be `null` (loading from Firebase). When `userData` asynchronously loads and `useAppStore` updates, `useState` initial values do **not** re-initialize. The form fields stay stuck on default/blank values until unmounted and remounted.

---

## 3. Timer Logic Audit

### 3.1 Rest Timer (Cronometro Recupero) Completely Lost
- **Legacy Implementation**: In `legacy_app_utf8.js` (lines 165-199), a full rest timer was implemented:
  - `App.timers.restStartTime`, `restAccumulated`, `restState`, `lastRestStr`.
  - Functions: `startRest()`, `pauseRest()`, `stopRest()`, `resetRest()`.
  - UI display in `rest-timer-display`.
- **Current TS/Zustand Implementation**:
  - **100% missing**. No rest timer state, no hooks, no UI controls between sets in `WorkoutTimer.tsx` or `TrainingSession.tsx`.

### 3.2 WorkoutTimer Background Tick & Render Efficiency
- **Location**: `src/components/Training/WorkoutTimer.tsx`.
- **Observation**: Uses `setInterval` to call `setTimerDisplay` every 1000ms.
- **Impact**: While computing elapsed time from `globalStartTime` is correct across tab suspensions, interval re-renders trigger full component updates every second. There is no `visibilitychange` event listener to immediately refresh the display when returning from mobile background sleep.

### 3.3 Potential `NaN` in Duration Calculation
- **Location**: `src/hooks/useWorkoutSession.ts`, line 63.
- **Observation**: `Math.floor((endTime - activeWorkout.globalStartTime) / 1000)`. If `globalStartTime` is undefined or invalid, `durationStr` evaluates to `"NaN:NaN"`.

---

## 4. Calculation Logic Audit

### 4.1 Zero Quantity Falsy Bug in Meal Totals
- **Location**: `src/hooks/useNutritionMeals.ts`, line 45 & `src/components/Nutrition/NutritionMeals.tsx`, line 85.
- **Observation**:
  ```ts
  const ratio = (m.quantity || m.baseQty || 100) / (m.baseQty || 100);
  ```
- **Evidence**: If `m.quantity` is `0`, JavaScript evaluates `(0 || 100)` to `100` because `0` is falsy in JS logic.
- **Impact**: If a user enters `0` grams for a meal item, the nutrient multiplier ratio becomes `100 / 100 = 1.0` instead of `0 / 100 = 0.0`. The app computes calories and macros for 100g instead of 0g!

### 4.2 US Navy Body Fat Input Parsing Edge Cases
- **Location**: `src/lib/logic.ts`, lines 360-385 (`calculateUsNavyBodyFat`).
- **Observation**: If `waist <= neck` (males) or `waist + hip <= neck` (females), the logarithm `Math.log10(waist - neck)` receives `<= 0`, returning `NaN` / `null`.
- **Impact**: `useNutritionMeasurements.ts` alerts generic error message without highlighting which input failed validation.

---

## 5. Lost Features Audit

| Feature | Legacy Code Location | Current TS/Zustand Status | Impact |
|---|---|---|---|
| **Rest Timer** (Inter-set recovery timer) | `legacy_app_utf8.js:165-199` | **Completely Omitted** | High (core workout feature) |
| **Calendar Month Grid** | `legacy_logic_utf8.js:779-824` (`getCalendarMonthGrid`, `getWorkoutDatesSet`) | Code present in `logic.ts`, **Unused by UI** | Medium (loss of visual history calendar) |
| **Interactive SVG Muscle Map Filter** | `legacy_app_utf8.js:201-255` (`renderNewExMuscles`, `renderSVG`) | `MuscleModel.tsx` renders static paths only | Low-Medium (visual feedback missing) |

---

## Summary of Findings & Audit Matrix

| Issue ID | Module / File | Description | Severity | Impact Area |
|---|---|---|---|---|
| **BUG-01** | `TrainingSession.tsx:76` | Undeclared `timerDisplay` reference error | **CRITICAL** | App crash during workout |
| **BUG-02** | `useAppStore.ts` | Untyped Zustand store & missing domain actions | **HIGH** | Code quality & state integrity |
| **BUG-03** | `useNutritionMeals.ts:45` | Falsy zero `(quantity || baseQty)` macro bug | **HIGH** | Incorrect calorie/macro math |
| **BUG-04** | `useNutritionMeals.ts`, `useHomeView.ts` | `toISOString()` UTC timezone date mismatch | **MEDIUM** | Data saved under wrong date |
| **BUG-05** | `useAppStore.ts` / `DB.ts` | Disconnected `localWorkout` & cloud `activeWorkout` | **HIGH** | Loss of session on sync/reload |
| **BUG-06** | `useNutritionPlanning.ts`, `useSettings.ts` | `useState` initializers skip async `userData` hydration | **MEDIUM** | Stale form inputs after load |
| **FEAT-01** | `WorkoutTimer.tsx` / `useWorkoutSession.ts` | Rest Timer (cronometro recupero) completely lost | **HIGH** | Lost core functionality |
| **FEAT-02** | `src/lib/logic.ts:779-824` | Calendar month grid functions unrendered in UI | **MEDIUM** | Lost history calendar view |
