# Codebase Static Audit & Structure Analysis

**Target Project**: Logbook PWA (`c:\Users\gerar\Documents\GitHub\logbook`)  
**Auditor**: Explorer 1 (Codebase Structure, TypeScript & Syntax Audit)  
**Date**: 2026-07-26  

---

## Executive Summary

A comprehensive static audit was performed on the Logbook PWA codebase following its major refactoring from JavaScript/Context to TypeScript/Zustand.

While the core user interface and logic features have been modularized into React components, custom hooks, and Zustand stores, the audit identified **critical compilation errors**, **a fatal runtime crash bug**, **React hook rules violations**, **property mismatches**, and **package configuration deficiencies**.

The findings are detailed below by category.

---

## 1. TypeScript Compilation & Type System Audit

### 1.1 Untyped Zustand Store (`src/store/useAppStore.ts`)
* **File**: `src/store/useAppStore.ts:4`
* **Issue**: The Zustand store is instantiated using raw JavaScript `create((set, get) => ...)` without a generic type parameter or TypeScript interface (`AppStore` or `AppState`).
* **Impact**: TypeScript infers the store object as `{}` or `unknown`. Consequently, any call to `useAppStore()` or `useAppStore(selector)` returns an untyped object `{}`.
* **Cascading Errors**: This single untyped store causes **38 TS2339 compilation errors** across almost every hook and component in the application:
  - `src/App.tsx(14,46)`: Property `syncing` does not exist on type `unknown`.
  - `src/contexts/AuthContext.tsx`: Properties `userData`, `setUserData`, `setSyncing`, `saveError`, `setSaveError` do not exist on type `{}`.
  - `src/hooks/useHomeView.ts(43,49)`: Property `userData` does not exist on type `unknown`.
  - `src/hooks/useNutritionMeals.ts(7,13)`: Properties `userData`, `saveUserData` do not exist on type `{}`.
  - `src/hooks/useNutritionMeasurements.ts(6,13)`: Properties `userData`, `saveUserData` do not exist on type `{}`.
  - `src/hooks/useNutritionPlanning.ts(6,13)`: Properties `userData`, `saveUserData` do not exist on type `{}`.
  - `src/hooks/useSettings.ts(8,13)`: Properties `currentUser`, `logout`, `userData`, `saveUserData` do not exist on type `{}`.
  - `src/hooks/useTrainingExercises.ts(6,13)`: Properties `userData`, `saveUserData` do not exist on type `{}`.
  - `src/hooks/useTrainingHistory.ts(4,13)`: Properties `userData`, `saveUserData` do not exist on type `{}`.
  - `src/hooks/useTrainingRoutines.ts(6,13)`: Properties `userData`, `saveUserData` do not exist on type `{}`.
  - `src/hooks/useWorkoutSession.ts(6,13)`: Properties `userData`, `saveUserData`, `localWorkout`, `setLocalWorkout` do not exist on type `{}`.

### 1.2 Missing Vite PWA Type Declarations (`virtual:pwa-register/react`)
* **File**: `src/App.tsx:5`
* **Issue**: `import { useRegisterSW } from 'virtual:pwa-register/react'` requires Vite PWA client ambient declarations.
* **Missing File**: The project lacks `src/vite-env.d.ts` (or `src/env.d.ts`) containing `/// <reference types="vite-plugin-pwa/react" />` and `/// <reference types="vite/client" />`.
* **Error**: `src/App.tsx(5,31): error TS2307: Cannot find module 'virtual:pwa-register/react' or its corresponding type declarations.`

### 1.3 Side-Effect CSS Import Declaration Error
* **File**: `src/main.tsx:5`
* **Issue**: `import './styles/global.css'` fails side-effect import check in tsc compiler.
* **Error**: `src/main.tsx(5,8): error TS2882: Cannot find module or type declarations for side-effect import of './styles/global.css'.`

### 1.4 Invalid Date Subtraction Math in TypeScript
* **Files & Lines**:
  - `src/lib/logic.ts:177`: `Math.ceil(Math.abs(lastDate - firstDate) / ...)`
  - `src/lib/logic.ts:336`: `Object.keys(...).sort((a,b) => new Date(a) - new Date(b))`
  - `src/hooks/useHomeView.ts:86`: `Object.keys(nutrition).sort((a,b) => new Date(a) - new Date(b))`
* **Issue**: Direct subtraction of `Date` objects (`Date - Date`) is illegal under strict TypeScript rules (TS2362 / TS2363).
* **Error**: `The left-hand side of an arithmetic operation must be of type 'any', 'number', 'bigint' or an enum type.`
* **Fix**: Use `lastDate.getTime() - firstDate.getTime()` and `new Date(a).getTime() - new Date(b).getTime()`.

### 1.5 Untyped AuthContext
* **File**: `src/contexts/AuthContext.tsx:6,8,10`
* **Issue**: `createContext()` is called with no default value or interface type (`createContext<AuthContextType | null>(null)`).
* **Error**: `src/contexts/AuthContext.tsx(6,21): error TS2554: Expected 1 arguments, but got 0.`

---

## 2. Runtime Bugs, Broken Imports & Syntax Audit

### 2.1 Critical Runtime Crash: Undefined Variable `timerDisplay` in `TrainingSession.tsx`
* **File**: `src/components/Training/TrainingSession.tsx:76`
* **Issue**:
  - Line 76 renders `{timerDisplay}` in the JSX sticky header.
  - `timerDisplay` is **never defined** anywhere in `TrainingSession.tsx` or returned by `useWorkoutSession.ts`.
  - Line 4 imports `import WorkoutTimer from './WorkoutTimer'`, but `WorkoutTimer` is **never rendered** in the JSX.
* **Impact**: **FATAL RUNTIME CRASH** (`ReferenceError: timerDisplay is not defined`) as soon as a user starts or enters an active workout session.
* **Fix**: Replace line 76 `{timerDisplay}` with `<WorkoutTimer globalStartTime={activeWorkout.globalStartTime} />`.

### 2.2 React Rules of Hooks Violation: Conditional Early Return in `useHomeView.ts`
* **File**: `src/hooks/useHomeView.ts:45-47,81,85,93,94`
* **Issue**:
  - Lines 45-47 contain an early return:
    ```ts
    if (!userData) {
        return { loading: true };
    }
    ```
  - Lines 81, 85, 93, 94 call 4 `useMemo` hooks *after* the early return.
* **Impact**: On initial app load when `userData` is `null`, `useHomeView()` executes 0 hooks. As soon as `userData` loads from DB, `useHomeView()` executes 4 `useMemo` hooks.
* **Error**: Triggers the fatal React runtime exception **"Rendered more hooks than during the previous render"**.
* **Fix**: Move the early return check to the component (`HomeView.tsx`), or move hook calls before the check (guaranteeing unconditional hook calls).

### 2.3 Property Mismatch in `NutritionPlanning.tsx`
* **File**: `src/components/Nutrition/NutritionPlanning.tsx:116-126`
* **Issue**:
  - Lines 116, 119, 122, 125 access `diff.carbs`, `diff.pro`, `diff.fat`, `diff.kcal`.
  - `Logic.calculateNormocaloricaDiff()` returns an object with properties `carbsPct`, `proPct`, `fatPct`, `kcalPct`, `carbsDiff`, `proDiff`, `fatDiff`, `kcalDiff`.
* **Impact**: `diff.carbs` evaluates to `undefined`. Macro difference badges display blank values (e.g. `CHO: %` instead of `CHO: +5.0%`).
* **Error**: TS2339 `Property 'carbs' does not exist on type...` (16 errors in `NutritionPlanning.tsx`).

### 2.4 String/Number Comparison Operator Mismatch in `HomeView.tsx`
* **File**: `src/components/Home/HomeView.tsx:134-135`
* **Issue**: `tdeeCalc.weightDiff > 0` compares a string formatted with `.toFixed(2)` to number `0`.
* **Error**: TS2365 `Operator '>' cannot be applied to types 'string' and 'number'.`
* **Fix**: Use `parseFloat(tdeeCalc.weightDiff) > 0`.

### 2.5 Relational `.js` Import in TypeScript File
* **File**: `src/lib/db.ts:1`
* **Issue**: `import { auth, db, waitForPendingWrites, deleteUser } from './firebase.js'` specifies `.js` extension instead of TS module `./firebase`.

---

## 3. Code Cleanliness, Unused Code & Lint Issues

Static linting via `oxlint` identified 6 errors and 18 warnings:

1. **Unused Imports**:
   - `src/components/Training/TrainingView.tsx:1`: `useState`
   - `src/components/Nutrition/NutritionView.tsx:1`: `useState`
   - `src/lib/firebase.ts:15`: `getFirestore`
   - `src/components/Training/TrainingSession.tsx:2,4`: `Logic` and `WorkoutTimer`
   - `resize_icons.mjs:2`: `fs`

2. **Unused Parameters & Variables**:
   - `src/components/Nutrition/CustomFoodModal.tsx:3`: `setShowCustomModal`
   - `src/hooks/useWorkoutSession.ts:5`: `onFinish`
   - `src/hooks/useTrainingRoutines.ts:5`: `setSubTab`
   - `src/components/Training/TrainingHistory.tsx:57,63`: `totalSets` and `si`
   - `src/contexts/AuthContext.tsx:15`: `userData`
   - `src/hooks/useHomeView.ts:85`: `chronoData`
   - `src/store/useAppStore.ts:14`: catch clause parameter `e`

3. **Fast Refresh Export Warning**:
   - `src/contexts/AuthContext.tsx:8`: `export const useAuth = () => useContext(AuthContext);` in the same file as `AuthProvider`.

4. **Non-UTF8 Legacy Source Files**:
   - Root files `legacy_app.js` and `legacy_logic.js` contain invalid UTF-8 encoding. Note: `legacy_app_utf8.js` and `legacy_logic_utf8.js` are present in root.

---

## 4. Dependency & Project Configuration Audit (`package.json`)

### 4.1 Missing Test Script
* **File**: `package.json`
* **Current Scripts**: `"dev"`, `"build"`, `"lint"`, `"preview"`.
* **Missing**: `"test": "vitest"` / `"test:run": "vitest run"`.
* **Impact**: Developers/CI cannot run tests via standard `npm test`.

### 4.2 Dependency Classification
* Test frameworks and rendering test dependencies (`@testing-library/react`, `@vitest/ui`, `jsdom`, `vitest`) are listed under `"dependencies"` instead of `"devDependencies"`.
* Moving these to `"devDependencies"` ensures a cleaner production build bundle footprint.

---

## Summary Table of Issues

| Issue | Location | Category | Severity |
|-------|----------|----------|----------|
| Untyped Zustand Store | `src/store/useAppStore.ts` | TypeScript | **HIGH** |
| Missing `virtual:pwa-register/react` types | `src/App.tsx`, missing `vite-env.d.ts` | TypeScript | **HIGH** |
| Undefined `timerDisplay` crash | `src/components/Training/TrainingSession.tsx:76` | Syntax / Logic | **CRITICAL** |
| Early return before React hooks | `src/hooks/useHomeView.ts:45` | React Rules | **CRITICAL** |
| Property mismatch `diff.carbs/pro/fat/kcal` | `src/components/Nutrition/NutritionPlanning.tsx:116-126` | Logic / TS | **HIGH** |
| Date subtraction TS errors | `src/lib/logic.ts`, `src/hooks/useHomeView.ts` | TypeScript | **MEDIUM** |
| String > 0 comparison error | `src/components/Home/HomeView.tsx:134` | TypeScript | **MEDIUM** |
| Untyped `AuthContext` | `src/contexts/AuthContext.tsx:6` | TypeScript | **MEDIUM** |
| Relational `.js` import | `src/lib/db.ts:1` | TypeScript | **LOW** |
| Missing `"test"` script | `package.json` | Dependencies | **MEDIUM** |
| Test deps in `"dependencies"` | `package.json` | Dependencies | **LOW** |
| Unused imports & variables (18 items) | Various components/hooks | Linting | **LOW** |
