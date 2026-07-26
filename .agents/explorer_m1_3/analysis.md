# React Views & Render Testing Audit Report

**Date**: 2026-07-26
**Agent**: Explorer 3 (React Views & Render Testing Audit)
**Working Directory**: `c:\Users\gerar\Documents\GitHub\logbook\.agents\explorer_m1_3`

---

## 1. Executive Summary

This audit evaluates all React components, views, context providers, custom hooks, and tab navigation in the Logbook PWA application following its refactoring from JavaScript Context to TypeScript + Zustand. 

The audit identified **1 critical runtime crash bug**, **1 UI display bug**, **1 module resolution import bug**, **unsafe context access risks**, and defined the precise setup required for `@testing-library/react` and `jsdom` test suites to render all views without crashing.

---

## 2. Codebase Inventory & Architecture

### 2.1 Navigation Architecture
The application uses a custom tab-based state navigation model (no `react-router`):
- **Main Tabs** (in `App.tsx`): `'home'`, `'training'`, `'nutrition'`, `'settings'`
- **Training Sub-Tabs** (in `TrainingView.tsx`): `'session'`, `'routines'`, `'exercises'`, `'history'`
- **Nutrition Sub-Tabs** (in `NutritionView.tsx`): `'meals'`, `'planning'`, `'measurements'`

### 2.2 Component & Hook Mapping

| Module | Component File | Custom Hook File | Purpose / Role |
|---|---|---|---|
| **Root & Shell** | `src/App.tsx`<br/>`src/main.tsx` | N/A | App shell, PWA SW registration, tab navigation, auth gate |
| **Auth Context** | `src/contexts/AuthContext.tsx` | N/A | Auth state listener (`onAuthStateChanged`), Firebase auth trigger |
| **Home** | `src/components/Home/HomeView.tsx` | `src/hooks/useHomeView.ts` | Overview dashboard, streak, TDEE widget, weight chart |
| **Training: View** | `src/components/Training/TrainingView.tsx` | N/A | Container for training sub-tabs |
| **Training: Session** | `src/components/Training/TrainingSession.tsx` | `src/hooks/useWorkoutSession.ts` | Active workout logger, sets/dropsets/isometrics |
| **Training: Timer** | `src/components/Training/WorkoutTimer.tsx` | N/A | Live workout timer (`mm:ss` / `hh:mm:ss`) |
| **Training: Routines** | `src/components/Training/TrainingRoutines.tsx` | `src/hooks/useTrainingRoutines.ts` | Routine manager & exercise order |
| **Training: Exercises** | `src/components/Training/TrainingExercises.tsx` | `src/hooks/useTrainingExercises.ts` | Exercise library editor & muscle focus |
| **Training: History** | `src/components/Training/TrainingHistory.tsx` | `src/hooks/useTrainingHistory.ts` | Workout history log & past ratings |
| **Training: Anatomy** | `src/components/Training/MuscleModel.tsx`<br/>`src/components/Training/MuscleModelPaths.tsx` | N/A | SVG anatomical muscle map |
| **Nutrition: View** | `src/components/Nutrition/NutritionView.tsx` | N/A | Container for nutrition sub-tabs |
| **Nutrition: Meals** | `src/components/Nutrition/NutritionMeals.tsx` | `src/hooks/useNutritionMeals.ts` | Food log, meal items, search & custom food |
| **Nutrition: Custom Food** | `src/components/Nutrition/CustomFoodModal.tsx` | N/A | Modal form for custom food entry |
| **Nutrition: Planning** | `src/components/Nutrition/NutritionPlanning.tsx` | `src/hooks/useNutritionPlanning.ts` | Calorie & macronutrient target calculator |
| **Nutrition: Measurements** | `src/components/Nutrition/NutritionMeasurements.tsx` | `src/hooks/useNutritionMeasurements.ts` | Weight & body fat (US Navy) logger |
| **Settings** | `src/components/SettingsView.tsx` | `src/hooks/useSettings.ts` | User profile, CSV export, account deletion |

---

## 3. Crash Risks & Detailed Bug Findings

### 🔴 Bug 1 [CRITICAL RUNTIME CRASH]: `timerDisplay` ReferenceError in `TrainingSession.tsx`
- **Location**: `src/components/Training/TrainingSession.tsx`, line 76
- **Observation**:
  ```tsx
  <div style={{ fontSize: '2rem', fontWeight: 'bold', margin: 0, fontFamily: 'monospace', color: 'var(--primary-color)' }}>
      {timerDisplay}
  </div>
  ```
- **Analysis**: `{timerDisplay}` is referenced inside `TrainingSession.tsx`, but `timerDisplay` is **neither imported, nor destructured from `useWorkoutSession()`, nor declared in component state**. `WorkoutTimer` is imported on line 4 (`import WorkoutTimer from './WorkoutTimer';`), but line 76 directly accesses the un-declared identifier `{timerDisplay}`.
- **Impact**: Any time an active workout is in progress (`localWorkout` in Zustand is non-null), rendering `TrainingSession` will crash immediately with `ReferenceError: timerDisplay is not defined`.
- **Proposed Solution**:
  Replace `{timerDisplay}` on line 76 with:
  ```tsx
  <WorkoutTimer globalStartTime={activeWorkout.globalStartTime} />
  ```

---

### 🟡 Bug 2 [BUILD / RESOLUTION RISK]: Incorrect `.jsx` Extension Imports in `main.tsx`
- **Location**: `src/main.tsx`, lines 3–4
- **Observation**:
  ```ts
  import App from './App.jsx'
  import { AuthProvider } from './contexts/AuthContext.jsx'
  ```
- **Analysis**: The actual files on disk are `src/App.tsx` and `src/contexts/AuthContext.tsx`. Importing `.jsx` explicitly causes module resolution failures under standard TypeScript / Vite / Vitest configurations (`Cannot find module './App.jsx'`).
- **Impact**: Test runners (Vitest) and strict bundlers fail to resolve the module.
- **Proposed Solution**:
  Change imports in `src/main.tsx` to extensionless relative imports:
  ```ts
  import App from './App'
  import { AuthProvider } from './contexts/AuthContext'
  ```

---

### 🟡 Bug 3 [UI DISPLAY BUG]: `Logic.calculateNormocaloricaDiff` Property Access Mismatch in `NutritionPlanning.tsx`
- **Location**: `src/components/Nutrition/NutritionPlanning.tsx`, lines 116–126 vs `src/lib/logic.ts`, lines 317–327
- **Observation**:
  In `NutritionPlanning.tsx`:
  ```tsx
  const diff = Logic.calculateNormocaloricaDiff(macros, planning.normocalorica);
  ...
  CHO: {diff.carbs > 0 ? '+' : ''}{diff.carbs}%
  PRO: {diff.pro > 0 ? '+' : ''}{diff.pro}%
  FAT: {diff.fat > 0 ? '+' : ''}{diff.fat}%
  KCAL: {diff.kcal > 0 ? '+' : ''}{diff.kcal}%
  ```
  However, `Logic.calculateNormocaloricaDiff()` returns:
  ```ts
  return {
      kcalPct: kcalDiff.pct,
      carbsPct: carbsDiff.pct,
      proPct: proDiff.pct,
      fatPct: fatDiff.pct,
      formatted: kcalDiff.formatted,
      kcalDiff, carbsDiff, proDiff, fatDiff
  };
  ```
- **Analysis**: `diff.carbs`, `diff.pro`, `diff.fat`, `diff.kcal` evaluate to `undefined`.
- **Impact**: UI renders `CHO: undefined%`, `PRO: undefined%`, `FAT: undefined%`, `KCAL: undefined%` and badge styling checks fail.
- **Proposed Solution**: Update `NutritionPlanning.tsx` to use `diff.carbsPct`, `diff.proPct`, `diff.fatPct`, `diff.kcalPct`.

---

### 🟡 Bug 4 [UNSAFE CONTEXT / RENDER CRASH]: `AuthContext` Missing Default Value
- **Location**: `src/contexts/AuthContext.tsx`, line 6 & 8
- **Observation**:
  `const AuthContext = createContext();` (defaults to `undefined`). `useAuth()` calls `useContext(AuthContext)`.
- **Analysis**: If any component utilizing `useAuth()` (e.g., `App.tsx`, `SettingsView.tsx`) is rendered without being wrapped in `<AuthProvider>`, `useAuth()` returns `undefined`. Destructuring `{ currentUser, logout } = useAuth()` throws `TypeError: Cannot destructure property 'currentUser' of 'useAuth(...)' as it is undefined.`
- **Impact**: Breaks unit rendering tests for isolated views.
- **Proposed Solution**: Provide a fallback object to `createContext({ currentUser: null, loading: false, login: () => {}, logout: () => {} })`.

---

### 🟢 Bug 5 [MISSING DEFAULT PROP]: `TrainingView` Default Sub-Tab Missing
- **Location**: `src/components/Training/TrainingView.tsx`, line 7
- **Observation**: `const TrainingView = ({ subTab, setSubTab }) => ...` does not set a default value for `subTab` (unlike `NutritionView` which has `subTab = 'meals'`).
- **Impact**: When `TrainingView` is rendered standalone without props in a test, `subTab` is `undefined`, causing no sub-view to render (blank page).
- **Proposed Solution**: Change signature to `const TrainingView = ({ subTab = 'session', setSubTab = () => {} }) => ...`.

---

### 🟢 Bug 6 [WINDOW DIALOG DEPENDENCIES]: Unmocked `window.alert` and `window.confirm` Calls
- **Locations**:
  - `useWorkoutSession.ts`: lines 23, 27, 54, 90, 108
  - `useTrainingRoutines.ts`: lines 15, 33
  - `useTrainingExercises.ts`: lines 54, 74, 84, 93
  - `useSettings.ts`: lines 22, 32, 33
  - `useNutritionMeals.ts`: lines 113, 123
  - `useNutritionMeasurements.ts`: lines 20, 26, 30, 34, 47, 63
  - `useNutritionPlanning.ts`: line 40
- **Analysis**: Custom hooks call `window.alert` and `window.confirm` directly. In `jsdom`, calling unmocked `window.alert` throws an error or logs warnings, while `window.confirm` returns `false` by default, preventing actions from completing in automated tests.
- **Impact**: Actions like deleting workouts/routines or saving data will fail or throw in test environments unless mocked.

---

## 4. Navigation & Routing Audit

1. **No External Router**: The app uses tab state management (`activeTab`, `trainingSubTab`, `nutritionSubTab`) in `App.tsx`.
2. **Prop Drilling of `onNavigate`**:
   - `HomeView` receives `onNavigate` to switch tabs when user clicks "Riposo -> Vai" or "Nutrizione -> ✏️".
   - Guard against `onNavigate` being undefined: `onNavigate?.('training')` or default prop `onNavigate = () => {}`.
3. **Scroll Restoration**:
   - `App.tsx` has `useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [activeTab]);`.
   - In `jsdom`, `window.scrollTo` is missing and will throw `TypeError: window.scrollTo is not a function` unless mocked in the test setup.

---

## 5. Render Testing Strategy & Setup Requirements

### 5.1 Environment Configuration Blueprint
The project uses `vitest` version `4.1.10`, `jsdom` `29.1.1`, and `@testing-library/react` `16.3.2`.

To render all main views and components without crashing, the test runner requires a `setupFiles` script (e.g. `tests/setup.ts` linked in `vitest.config.js`).

#### Required Setup Mocks (`tests/setup.ts`):
```ts
import { vi } from 'vitest';
import '@testing-library/jest-dom';

// 1. Mock window.scrollTo
window.scrollTo = vi.fn();

// 2. Mock window.alert and window.confirm
window.alert = vi.fn();
window.confirm = vi.fn(() => true);

// 3. Mock Chart.js canvas methods
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  getImageData: vi.fn(),
  putImageData: vi.fn(),
  createImageData: vi.fn(),
  setTransform: vi.fn(),
  drawImage: vi.fn(),
  save: vi.fn(),
  fillText: vi.fn(),
  restore: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  stroke: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  rotate: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  measureText: vi.fn().mockReturnValue({ width: 0 }),
  transform: vi.fn(),
  rect: vi.fn(),
  clip: vi.fn(),
});

// 4. Mock Firebase auth module to prevent real network calls
vi.mock('../src/lib/firebase', () => ({
  auth: { currentUser: { uid: 'test-user-123', email: 'test@example.com', displayName: 'Test User' } },
  provider: {},
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  getRedirectResult: vi.fn().mockResolvedValue(null),
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn((auth, callback) => {
    callback({ uid: 'test-user-123', email: 'test@example.com', displayName: 'Test User' });
    return () => {};
  }),
  waitForPendingWrites: vi.fn(),
  deleteUser: vi.fn(),
}));

// 5. Mock virtual PWA register
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, vi.fn()],
    updateServiceWorker: vi.fn(),
  }),
}));
```

---

### 5.2 Test Helper & Custom Render Function
To render components under test with required Zustand store state and Auth Context:

```tsx
import React from 'react';
import { render } from '@testing-library/react';
import { AuthProvider } from '../src/contexts/AuthContext';
import { useAppStore } from '../src/store/useAppStore';

const mockDefaultUserData = {
  profile: { dob: '1990-01-01', height: '180', gender: 'M' },
  routines: [
    { id: 'rtn_1', name: 'Push Day', exercises: [{ exId: 'ex_1', setsCount: 3 }] }
  ],
  library: [
    { id: 'ex_1', name: 'Panca Piana', notes: 'Setup 3', muscles: ['chest'] }
  ],
  history: [],
  nutrition: {
    '2026-07-26': { kcal: 2000, carbs: 250, pro: 150, fat: 60, meals: [], weight: 80 }
  },
  nutritionPlanning: {
    weight: 80, carbsPerKg: 3.5, proPerKg: 2.0, fatPerKg: 1.0,
    normocalorica: { kcal: 2500, carbs: 300, pro: 160, fat: 70 }
  }
};

export function renderWithProviders(ui: React.ReactElement, initialUserData = mockDefaultUserData) {
  useAppStore.setState({
    userData: initialUserData,
    localWorkout: null,
    syncing: false,
    saveError: null
  });

  return render(
    <AuthProvider>
      {ui}
    </AuthProvider>
  );
}
```

---

### 5.3 View Render Test Suite Coverage Blueprint (Milestone 2 Target)

The following test scenarios must be included in the M2 test suite to guarantee zero-crash execution across all views:

1. **`App.tsx`**:
   - Renders loading spinner when `loading: true`.
   - Renders login screen when `currentUser: null`.
   - Renders app layout and bottom navigation bar when authenticated.
   - Navigates between main tabs (`Home`, `Training`, `Nutrition`, `Settings`).

2. **`HomeView.tsx`**:
   - Renders loading state when `userData: null`.
   - Renders Rest Day widget when no workout is recorded today.
   - Renders Completed Workout widget when workout recorded today.
   - Renders nutrition summary progress bar and macros.
   - Renders TDEE calculation widget and weight trend chart.

3. **`TrainingView.tsx` & Sub-Views**:
   - Renders `TrainingSession` (inactive state: routine selector and start button).
   - Renders `TrainingSession` (**active state**: after fixing `timerDisplay` bug, verifies exercise list, sets, extra exercise selector, ratings, end/delete workout buttons).
   - Renders `TrainingRoutines` (routine list, creation input, muscle model SVG).
   - Renders `TrainingExercises` (exercise library, muscle search dropdown, SVG model).
   - Renders `TrainingHistory` (past workout logs, exercise set breakdown, ratings).

4. **`NutritionView.tsx` & Sub-Views**:
   - Renders `NutritionMeals` (search input, meal cards, custom food modal toggle).
   - Renders `NutritionPlanning` (macro per kg inputs, normocalorica comparison badges).
   - Renders `NutritionMeasurements` (weight input, US Navy vs Manual BF selector).

5. **`SettingsView.tsx`**:
   - Renders user account information.
   - Renders biometric data inputs and save profile button.
   - Renders export CSV button and danger zone account deletion button.

---

## 6. Recommendations for Milestone 3 (Bug Fixes & Refactoring)

1. **Fix `TrainingSession.tsx`**: Replace `{timerDisplay}` with `<WorkoutTimer globalStartTime={activeWorkout.globalStartTime} />`.
2. **Fix `main.tsx`**: Remove `.jsx` file extensions from TypeScript imports.
3. **Fix `NutritionPlanning.tsx`**: Update property accessors on `diff` to `diff.carbsPct`, `diff.proPct`, `diff.fatPct`, `diff.kcalPct`.
4. **Harden `AuthContext.tsx`**: Add default value to `createContext` to allow wrapper-less rendering during isolated unit tests.
5. **Add Prop Defaults**: Add default prop values in `TrainingView` (`subTab = 'session'`) and `HomeView` (`onNavigate = () => {}`).

