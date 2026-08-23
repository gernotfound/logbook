# Logbook PWA — Architectural & Refactoring Action Plan

## 1. Executive Summary & Codebase Assessment

This document presents a comprehensive, actionable refactoring plan for the **Logbook PWA** codebase (`C:\Users\gerar\Documents\GitHub\logbook`). The audit was synthesized from four deep-dive technical handoffs covering:
1. **Build & Lint Validation**: Oxlint static checks and Vite production build metrics.
2. **React Architecture & Component Organization**: Render lifecycle efficiency, component decomposition, prop-drilling, layer boundaries, and main-thread I/O.
3. **Zustand State Management & Firebase Data Flow**: Subscription granularity, cross-session state leakage, diffing cache lifecycle, auth synchronization, and offline handling.
4. **TypeScript Safety & Type Coverage**: Comprehensive audit of all 41 `.ts` / `.tsx` files in `src/`, eliminating explicit `any`, unsafe casts (`as`), non-null assertions (`!`), and missing prop interface contracts.

### Core Architecture Overview
- **Framework**: React 18 with Vite 5 and `vite-plugin-pwa` (Workbox Service Worker generation).
- **State Management**: Zustand 4 (`useAppStore` for global domain state, `useDialogStore` for UI dialog modal management).
- **Backend / Persistence**: Firebase 10 SDK (Firestore persistent local cache, Auth via Google Popup / Redirect) and `localStorage` for offline draft workouts.
- **Styling & UI**: Custom CSS variables, responsive mobile-first layouts, custom SVG muscle diagram (`MuscleModel`).

### Summary of Key Findings & Vulnerabilities
1. **Critical Data Leaks (Cross-User State Persistence)**: When a user logs out, `useAppStore` explicitly retains `localWorkout` in state and `localStorage`. Furthermore, `lib/db.ts` holds a module-level cache variable (`lastSavedStateStr`) that is never cleared on logout. If a different user signs in within the same SPA session, their state is diffed against the previous user's stringified payload, corrupting Firestore updates.
2. **Main-Thread I/O Bottlenecks**: During active workout tracking (`useWorkoutSession.ts`), every keystroke in set weight/reps inputs executes synchronous `localStorage.setItem('logbook_local_workout', JSON.stringify(workout))`. On mobile devices, this blocks the main thread and drops UI frames.
3. **Layer Violations & Component Monoliths**: Low-level data utility `lib/db.ts` directly imports UI store `useDialogStore` to show alerts during logouts and account deletions. `TrainingSession.tsx` is a 290-line monolith containing 14 distinct UI concerns, triggering complete full-tree re-renders on any single input update.
4. **Zustand Subscription Anti-Patterns**: Multiple custom hooks (`useNutritionMeals`, `useNutritionMeasurements`, `useNutritionPlanning`) call `useDialogStore()` without selector functions, subscribing their components to all dialog state changes (title, message, open state).
5. **TypeScript Safety Gaps**: While `src/types.ts` defines strong domain models, core calculation engine `lib/logic.ts`, database layer `lib/db.ts`, and context `AuthContext.tsx` rely on explicit `any` (48+ occurrences), disabling static type checking across downstream components.

---

## 2. Programmatic Validation Results (`npm run lint` & `npm run build`)

### `npm run lint` Summary (Oxlint)
- **Status**: PASSED (Exit Code 0)
- **Execution Time**: ~24ms across 47 files with 91 rules (12 threads)
- **Totals**: **0 Errors**, **30 Warnings**

#### Complete Breakdown of 30 Lint Warnings
| Priority | Category / Rule Name | File Path & Line Reference | Details / Description |
| :--- | :--- | :--- | :--- |
| **Medium** | `eslint(no-unused-vars)` | `src/store/useAppStore.ts:67:18` | Catch parameter `'e'` caught but never used |
| **Medium** | `eslint(no-unused-vars)` | `src/hooks/useWorkoutSession.ts:95:18` | Catch parameter `'error'` caught but never used |
| **Medium** | `eslint(no-unused-vars)` | `src/hooks/useWorkoutSession.ts:106:18` | Catch parameter `'error'` caught but never used |
| **Medium** | `eslint(no-unused-vars)` | `src/hooks/useWorkoutSession.ts:237:18` | Catch parameter `'error'` caught but never used |
| **Low** | `eslint(no-unused-vars)` | `tests/setup.tsx:68:15` | Parameter `'index'` declared but never used |
| **Medium** | `eslint(no-unused-vars)` | `src/hooks/useTrainingRoutines.ts:62:18` | Catch parameter `'error'` caught but never used |
| **Medium** | `eslint(no-unused-vars)` | `src/hooks/useTrainingRoutines.ts:76:18` | Catch parameter `'error'` caught but never used |
| **Low** | `eslint(no-unused-vars)` | `src/hooks/useSettings.ts:1:20` | Unused import `useEffect` from `'react'` |
| **Medium** | `eslint(no-unused-vars)` | `src/hooks/useSettings.ts:40:18` | Catch parameter `'error'` caught but never used |
| **Medium** | `eslint(no-unused-vars)` | `src/hooks/useNutritionMeasurements.ts:105:18` | Catch parameter `'error'` caught but never used |
| **Medium** | `eslint(no-unused-vars)` | `src/hooks/useTrainingHistory.ts:18:22` | Catch parameter `'error'` caught but never used |
| **Medium** | `eslint(no-unused-vars)` | `src/hooks/useTrainingExercises.ts:101:18` | Catch parameter `'error'` caught but never used |
| **Medium** | `eslint(no-unused-vars)` | `src/hooks/useTrainingExercises.ts:113:22` | Catch parameter `'error'` caught but never used |
| **Low** | `eslint(no-unused-vars)` | `src/hooks/useNutritionPlanning.ts:1:20` | Unused import `useEffect` from `'react'` |
| **Medium** | `eslint(no-unused-vars)` | `src/hooks/useNutritionPlanning.ts:46:18` | Catch parameter `'error'` caught but never used |
| **Low** | `eslint(no-unused-vars)` | `resize_icons.mjs:2:8` | Unused import `fs` from `'node:fs'` |
| **Medium** | `eslint(no-unused-vars)` | `src/hooks/useNutritionMeals.ts:56:18` | Catch parameter `'error'` caught but never used |
| **Medium** | `eslint(no-unused-vars)` | `src/hooks/useNutritionMeals.ts:126:18` | Catch parameter `'error'` caught but never used |
| **Medium** | `eslint(no-unused-vars)` | `src/hooks/useNutritionMeals.ts:149:18` | Catch parameter `'error'` caught but never used |
| **Medium** | `eslint(no-unused-vars)` | `src/hooks/useNutritionMeals.ts:166:18` | Catch parameter `'error'` caught but never used |
| **Medium** | `eslint(no-unused-vars)` | `src/hooks/useNutritionMeals.ts:193:22` | Catch parameter `'error'` caught but never used |
| **Low** | `eslint(no-unused-vars)` | `src/lib/db.ts:2:23` | Unused import `setDoc` from `'firebase/firestore'` |
| **Low** | `eslint(no-unused-vars)` | `src/lib/db.ts:2:31` | Unused import `deleteDoc` from `'firebase/firestore'` |
| **Low** | `eslint(no-unused-vars)` | `tests/edge_cases.test.tsx:8:8` | Unused import `TrainingView` |
| **Low** | `eslint(no-unused-vars)` | `tests/edge_cases.test.tsx:13:8` | Unused import `NutritionView` |
| **Low** | `eslint(no-unused-vars)` | `tests/edge_cases.test.tsx:17:8` | Unused import `CustomFoodModal` |
| **Medium** | `react(only-export-components)` | `src/contexts/AuthContext.tsx:22:14` | Fast Refresh warning (`export const useAuth = ...`) |
| **High** | `react-hooks(exhaustive-deps)` | `src/hooks/useHomeView.ts:50:56` | `useMemo` depends on `history`, inline default `userData?.history \|\| []` creates new array reference every render |
| **High** | `react-hooks(exhaustive-deps)` | `src/hooks/useHomeView.ts:59:9` | `useMemo` depends on `nutrition`, inline default `userData?.nutrition \|\| {}` creates new object reference every render |
| **High** | `react-hooks(exhaustive-deps)` | `src/hooks/useHomeView.ts:80:23` | `useMemo` depends on `nutrition`, inline default creates new object reference every render |

---

### `npm run build` Summary (Vite Production Build)
- **Status**: PASSED (Exit Code 0)
- **Build Duration**: 855ms
- **Transformed Modules**: 1842 modules

#### Generated Production Asset Chunks
| Asset File Path | Size | Gzip Size | Notes / Role |
| :--- | :--- | :--- | :--- |
| `dist/manifest.webmanifest` | 0.67 kB | - | PWA Web App Manifest |
| `dist/index.html` | 1.31 kB | 0.53 kB | HTML Entry Point |
| `dist/assets/index-DNNU-Rtw.css` | 16.78 kB | 3.73 kB | Global Stylesheet |
| `dist/assets/WeightChart-DQH9XiqR.js` | 0.49 kB | 0.35 kB | Dynamic Chunk (Lazy Loaded) |
| `dist/assets/rolldown-runtime-Bh1tDfsg.js` | 0.56 kB | 0.36 kB | Bundler Runtime |
| `dist/assets/workbox-window.prod.es5-Bd17z0YL.js` | 5.65 kB | 2.20 kB | Workbox PWA Helper |
| `dist/assets/SettingsView-1JMtBIif.js` | 7.44 kB | 2.80 kB | Dynamic Chunk (Lazy Loaded) |
| `dist/assets/HomeView-CKcOPq9H.js` | 10.04 kB | 2.79 kB | Dynamic Chunk (Lazy Loaded) |
| `dist/assets/index-Cxpalko6.js` | 22.57 kB | 7.64 kB | Core Application Entry |
| `dist/assets/NutritionView-RAeRg09m.js` | 26.84 kB | 6.82 kB | Dynamic Chunk (Lazy Loaded) |
| `dist/assets/logic-DSZ7RXZM.js` | 27.05 kB | 7.72 kB | Business Logic Utility Module |
| `dist/assets/TrainingView-KV-2omcY.js` | 66.29 kB | 18.77 kB | Dynamic Chunk (Lazy Loaded) |
| `dist/assets/chartjs-B8C_Y7Pw.js` | 172.37 kB | 59.88 kB | Chart.js Vendor Chunk |
| `dist/assets/vendor-Bd7bmI69.js` | 185.05 kB | 58.64 kB | React & Utility Vendor Chunk |
| **`dist/assets/firebase-qPkOU6ni.js`** | **655.33 kB** | **193.73 kB** | **Firebase SDK Chunk (Exceeds 500 kB threshold)** |

#### Build Warnings
- **Vite Chunk Size Warning**: `(!) Some chunks are larger than 500 kB after minification.` (`firebase-qPkOU6ni.js` is 655.33 kB). Needs manual chunk splitting in `vite.config.ts`.

---

## 3. Prioritized Action Plan Roadmap

### Phase 1: High Priority (Critical Data Leaks, Performance Bottlenecks & Auth Logic)
*Target Completion: Immediate / Sprint 1*

1. **Item 1.1: Draft Workout Cross-User Data Leakage**
   - **File Reference**: `src/store/useAppStore.ts:94-96`
   - **Impact**: **Critical Security & Data Privacy Issue**. When User A logs out, `localWorkout` is retained in state and `localStorage`. When User B logs in, User B sees and overwrites User A's uncommitted workout session.
   - **Effort Estimate**: 0.5 hours

2. **Item 1.2: Module-Scoped Cache Persistence Across Auth Sessions**
   - **File Reference**: `src/lib/db.ts:6`, `src/lib/db.ts:213-222`
   - **Impact**: **Critical Data Corruption Risk**. Module variable `lastSavedStateStr` caches User A's stringified state. Upon User B login, `DB.saveUserData()` diffs User B's state against User A's string, causing incorrect array deletion or missing document updates in Firestore.
   - **Effort Estimate**: 0.5 hours

3. **Item 1.3: Synchronous `localStorage.setItem` & `JSON.stringify` on Keystroke**
   - **File Reference**: `src/hooks/useWorkoutSession.ts:179-231`, `src/store/useAppStore.ts:72-86`
   - **Impact**: **High Performance Bottleneck**. Heavy main-thread blocking I/O and CPU serialization on every single character entered into set weight/reps inputs during active workouts.
   - **Effort Estimate**: 1.5 hours

4. **Item 1.4: Incomplete Error Propagation in `DB.secureLogOut()` & Partial Logout State**
   - **File Reference**: `src/lib/db.ts:213-222`, `src/contexts/AuthContext.tsx:114-125`
   - **Impact**: **High Data Inconsistency Risk**. `DB.secureLogOut()` catches errors and suppresses rethrowing. `AuthContext.logout()` clears local state (`setUserData(null)`) even if Firebase `auth.signOut()` fails, leaving the client in an invalid semi-authenticated state.
   - **Effort Estimate**: 1.0 hour

5. **Item 1.5: Unhandled Rejection & Delayed Listener Registration in Auth Cleanup**
   - **File Reference**: `src/contexts/AuthContext.tsx:49-92`
   - **Impact**: **High Reliability Risk**. `initAuth` awaits OAuth redirect before setting `onAuthStateChanged`. If redirect handling fails or component unmounts, `authUnsubPromise` throws an unhandled promise rejection.
   - **Effort Estimate**: 1.0 hour

---

### Phase 2: Medium Priority (React Re-renders, Custom Hook Anti-Patterns & Zustand Subscriptions)
*Target Completion: Sprint 2*

1. **Item 2.1: Full Store Subscriptions in Custom Hooks**
   - **File Reference**: `src/hooks/useNutritionMeals.ts:10`, `src/hooks/useNutritionMeasurements.ts:9`, `src/hooks/useNutritionPlanning.ts:9`
   - **Impact**: **Medium Performance Issue**. `const { showAlert } = useDialogStore()` subscribes hooks to all modal state changes (opening/closing any dialog triggers re-renders across nutrition tabs).
   - **Effort Estimate**: 0.5 hours

2. **Item 2.2: Monolithic Workout Session Component Decomposition**
   - **File Reference**: `src/components/Training/TrainingSession.tsx:25-290`
   - **Impact**: **Medium-High Maintainability & Render Efficiency Issue**. 290-line component managing timer, set inputs, history modal, notes modal, and ratings. Decomposing into sub-components (`WorkoutTimerBar`, `ExerciseCard`, `SetRow`, `WorkoutRatingsFooter`) isolates set input re-renders.
   - **Effort Estimate**: 4.0 hours

3. **Item 2.3: Un-memoized Handler Objects in Custom Hooks**
   - **File Reference**: `src/hooks/useWorkoutSession.ts:242-265`, `src/hooks/useNutritionMeals.ts:199-206`, `src/hooks/useNutritionMeasurements.ts:110-124`, `src/hooks/useTrainingExercises.ts:119-125`
   - **Impact**: **Medium Performance Issue**. Custom hooks return un-memoized object literals containing 20+ newly created function references on every render, invalidating child `React.memo`.
   - **Effort Estimate**: 2.0 hours

4. **Item 2.4: Data Layer (`lib/db.ts`) Tight Coupling with UI Dialog Store**
   - **File Reference**: `src/lib/db.ts:4, 221, 253, 255`
   - **Impact**: **Medium Layer Violation**. Database persistence helper imports Zustand UI store to show dialog alerts, breaking separation of concerns and testability.
   - **Effort Estimate**: 1.0 hour

5. **Item 2.5: Presentation UI Rendered Inside `AuthProvider`**
   - **File Reference**: `src/contexts/AuthContext.tsx:138-148`
   - **Impact**: **Medium Organization Issue**. Context Provider directly renders fixed-position DOM elements (`saveError` banner) instead of delegating presentation to a dedicated UI toast container.
   - **Effort Estimate**: 0.5 hours

6. **Item 2.6: Root App Component Monolith & Navigation Re-render Anti-Pattern**
   - **File Reference**: `src/App.tsx:66-91, 105-131, 149-168`
   - **Impact**: **Medium Organization Issue**. Bottom navigation bar defines inline arrow functions for tab selection (`onClick={() => setActiveTab('home')}`), breaking child memoization.
   - **Effort Estimate**: 1.5 hours

7. **Item 2.7: Derived Search Results Stored in `useState`**
   - **File Reference**: `src/hooks/useNutritionMeals.ts:13, 61-76`
   - **Impact**: **Medium React Anti-Pattern**. Storing derived food search filter results in `useState` triggers double rendering and potential state desynchronization. Convert to `useMemo`.
   - **Effort Estimate**: 0.5 hours

8. **Item 2.8: Disabled ESLint Exhaustive Dependencies in Auth Sync Effect**
   - **File Reference**: `src/contexts/AuthContext.tsx:33-93`
   - **Impact**: **Medium Maintenance Issue**. `// eslint-disable-line react-hooks/exhaustive-deps` suppresses stale closure warnings on `loadData`.
   - **Effort Estimate**: 0.5 hours

9. **Item 2.9: Unhandled Promise Rejection in Firebase Analytics Initialization**
   - **File Reference**: `src/lib/firebase.ts:37-41`
   - **Impact**: **Low-Medium Reliability Issue**. `isSupported()` lacks `.catch()` handler when analytics fails in restricted or ad-blocker environments.
   - **Effort Estimate**: 0.25 hours

---

### Phase 3: Low Priority (TypeScript Strictness, Unused Imports & Bundle Optimization)
*Target Completion: Sprint 3*

1. **Item 3.1: Strict Typing of Domain Core Engine `Logic`**
   - **File Reference**: `src/lib/logic.ts:159-850`
   - **Impact**: **Medium Code Quality Issue**. 25+ domain methods accept/return `any`, defeating TypeScript checks across the entire calculation engine.
   - **Effort Estimate**: 3.0 hours

2. **Item 3.2: Complete TypeScript Safety Audit Refactoring across 41 Files**
   - **File Reference**: Audit of all 41 `.ts`/`.tsx` files in `src/` (48+ `any` items, 14 `as` casts, 6 `!` assertions, 12 missing prop interfaces).
   - **Impact**: **Medium Maintainability Issue**. Ensures 100% strict type check compliance without runtime assertions.
   - **Effort Estimate**: 4.0 hours

3. **Item 3.3: Dynamic Style Factory & Muscle Map Memoization**
   - **File Reference**: `src/components/Training/MuscleModel.tsx:18-24`
   - **Impact**: **Low Performance Issue**. Inline `getPathStyle` prop forces SVG path re-evaluation across all 80+ muscle path nodes on every render.
   - **Effort Estimate**: 0.5 hours

4. **Item 3.4: Inline Configuration Object in Hook Parameter**
   - **File Reference**: `src/App.tsx:44-52`
   - **Impact**: **Low Performance Issue**. Passing inline object to `useRegisterSW` re-instantiates options on every render.
   - **Effort Estimate**: 0.25 hours

5. **Item 3.5: Non-Chronological Object Keys Used for Weight Derivation**
   - **File Reference**: `src/hooks/useHomeView.ts:108-110`
   - **Impact**: **Low-Medium Logic Derivation Risk**. Object value key iteration order determines latest body weight when today's weight is missing.
   - **Effort Estimate**: 0.5 hours

6. **Item 3.6: Non-deterministic Timestamp IDs for Meal List Filtering**
   - **File Reference**: `src/hooks/useNutritionMeals.ts:31, 41, 135-137`
   - **Impact**: **Low Edge-Case Bug**. Filtering meals by millisecond timestamp can delete duplicate items added in the same tick.
   - **Effort Estimate**: 0.5 hours

7. **Item 3.7: Cleanup of 30 Lint Warnings**
   - **File Reference**: 26 `no-unused-vars`, 1 `react(only-export-components)`, 3 `react-hooks(exhaustive-deps)`.
   - **Impact**: **Low Code Hygiene**. Removes unused imports/variables and satisfies Fast Refresh / hook dependency rules.
   - **Effort Estimate**: 1.0 hour

8. **Item 3.8: Vite Bundle Splitting Strategy for Firebase Chunks**
   - **File Reference**: `vite.config.ts`
   - **Impact**: **Low-Medium PWA Loading Speed**. Splitting `firebase/auth`, `firebase/firestore`, and `firebase/app` into sub-chunks eliminates the 655 kB chunk warning.
   - **Effort Estimate**: 0.5 hours

---

## 4. Detailed Technical Analysis & Code Fix Proposals

### 4.1 React Architectural & Component Organization Issues (13 Findings)

#### Finding 1: Monolithic Workout Session Component
- **File Path & Line Range**: `src/components/Training/TrainingSession.tsx:25-290`
- **Category & Severity**: Organization (Monolithic Component) / **High Severity**
- **Impact & Risk Assessment**: `TrainingSession.tsx` is 290 lines long and handles routine selection, active timer, exercise cards, set weight/reps inputs, isometric/dropset modals, notes modal, water tracking, and fatigue ratings. Typing numbers into a single set input forces React to re-evaluate the entire 290-line component tree, causing input lag on mobile web.
- **Concrete Code Fix Proposal**:
```tsx
// BEFORE (src/components/Training/TrainingSession.tsx):
// Monolithic component rendering active workout timer, exercise cards, set inputs, notes, water, ratings:
export const TrainingSession = () => {
  const { activeWorkout, updateSet, endWorkout, ... } = useWorkoutSession();
  return (
    <div className="session-container">
      {/* 290 lines of mixed timer, exercise list, set inputs, modals, water tracking, and ratings */}
    </div>
  );
};

// AFTER (Decomposed into modular components under src/components/Training/session/):
// src/components/Training/session/WorkoutTimerBar.tsx
export const WorkoutTimerBar = React.memo(({ startTime }: { startTime: number }) => {
  const duration = useWorkoutTimer(startTime);
  return <div className="timer-bar">⏱️ {Logic.formatDuration(duration)}</div>;
});

// src/components/Training/session/SetRow.tsx
export const SetRow = React.memo(({ set, setIndex, exIndex, onUpdateSet }: SetRowProps) => {
  return (
    <div className="set-row">
      <input type="number" value={set.kg} onChange={e => onUpdateSet(exIndex, setIndex, 'kg', e.target.value)} />
      <input type="number" value={set.reps} onChange={e => onUpdateSet(exIndex, setIndex, 'reps', e.target.value)} />
    </div>
  );
});
```

---

#### Finding 2: Root App Component Monolith & Navigation Re-render Anti-Pattern
- **File Path & Line Range**: `src/App.tsx:66-91, 105-131, 149-168`
- **Category & Severity**: React Anti-Pattern / **Medium Severity**
- **Impact & Risk Assessment**: Bottom navigation buttons pass inline arrow functions `onClick={() => setActiveTab('home')}` (lines 151, 155, 159, 163), re-instantiating function reference props on every render and breaking navigation bar memoization.
- **Concrete Code Fix Proposal**:
```tsx
// BEFORE (src/App.tsx:149-168):
<button className={`nav-item ${activeTab === 'home' ? 'active' : ''}`} onClick={() => setActiveTab('home')}>
  <HomeIcon />
</button>
<button className={`nav-item ${activeTab === 'training' ? 'active' : ''}`} onClick={() => setActiveTab('training')}>
  <TrainingIcon />
</button>

// AFTER (src/App.tsx):
const handleSelectHome = useCallback(() => setActiveTab('home'), []);
const handleSelectTraining = useCallback(() => setActiveTab('training'), []);
const handleSelectNutrition = useCallback(() => setActiveTab('nutrition'), []);
const handleSelectSettings = useCallback(() => setActiveTab('settings'), []);

return (
  <NavigationFooter 
    activeTab={activeTab}
    onSelectHome={handleSelectHome}
    onSelectTraining={handleSelectTraining}
    onSelectNutrition={handleSelectNutrition}
    onSelectSettings={handleSelectSettings}
  />
);
```

---

#### Finding 3: Presentation UI Rendered Inside Context Provider
- **File Path & Line Range**: `src/contexts/AuthContext.tsx:138-148`
- **Category & Severity**: Organization (Mixed Concerns) / **Medium Severity**
- **Impact & Risk Assessment**: `AuthProvider` embeds a fixed-position HTML toast banner (`saveError`). Context providers should focus purely on state distribution; embedding UI presentation directly inside a provider mixes concerns and prevents uniform toast placement.
- **Concrete Code Fix Proposal**:
```tsx
// BEFORE (src/contexts/AuthContext.tsx:138-148):
return (
  <AuthContext.Provider value={value}>
    {children}
    {saveError && (
      <div style={{ position: 'fixed', bottom: '70px', left: '50%', transform: 'translateX(-50%)', background: '#ff4444', padding: '10px 20px', borderRadius: '8px', zIndex: 9999 }}>
        ⚠️ {saveError}
      </div>
    )}
  </AuthContext.Provider>
);

// AFTER (Extracted into standalone ToastContainer component):
// src/contexts/AuthContext.tsx:
return (
  <AuthContext.Provider value={value}>
    {children}
  </AuthContext.Provider>
);

// src/components/UI/ToastContainer.tsx:
export const ToastContainer = () => {
  const saveError = useAppStore(state => state.saveError);
  const setSaveError = useAppStore(state => state.setSaveError);
  if (!saveError) return null;
  return (
    <div className="toast-error-banner">
      <span>⚠️ {saveError}</span>
      <button onClick={() => setSaveError(null)}>✕</button>
    </div>
  );
};
```

---

#### Finding 4: Data Layer (`lib/db.ts`) Tight Coupling with UI Dialog Store
- **File Path & Line Range**: `src/lib/db.ts:4, 221, 253, 255`
- **Category & Severity**: Layer Violation / **Medium Severity**
- **Impact & Risk Assessment**: `lib/db.ts` imports `useDialogStore` and calls `useDialogStore.getState().showAlert(...)` inside `secureLogOut` and `deleteAccount`. Database utilities should remain pure data persistence layers; coupling low-level DB helpers to UI state stores breaks modularity and automated testing.
- **Concrete Code Fix Proposal**:
```ts
// BEFORE (src/lib/db.ts:4, 221):
import { useDialogStore } from '../store/useDialogStore';
// ...
async secureLogOut() {
  try {
    await waitForPendingWrites(db);
    await auth.signOut();
  } catch (error: any) {
    await useDialogStore.getState().showAlert("Errore durante il Log Out. Controlla la connessione.");
  }
}

// AFTER (src/lib/db.ts):
// Remove import of useDialogStore and throw typed error:
async secureLogOut() {
  await waitForPendingWrites(db);
  await auth.signOut();
  this.resetCache();
}

// In consuming UI layer (src/contexts/AuthContext.tsx / useSettings.ts):
const logout = useCallback(async () => {
  setSyncing(true);
  try {
    await DB.secureLogOut();
    useAppStore.getState().resetStore();
  } catch (error: any) {
    await useDialogStore.getState().showAlert("Errore durante il Log Out. Controlla la connessione.");
  } finally {
    setSyncing(false);
  }
}, []);
```

---

#### Finding 5: Synchronous `localStorage.setItem` & `JSON.stringify` on Keystroke Thread
- **File Path & Line Range**: `src/hooks/useWorkoutSession.ts:179-231` & `src/store/useAppStore.ts:72-86`
- **Category & Severity**: Performance (Main Thread Blocking I/O) / **High Severity**
- **Impact & Risk Assessment**: When a user types numbers into set weight/reps input fields during a workout, `updateSet` triggers `setLocalWorkout` in `useAppStore`. `setLocalWorkout` executes `localStorage.setItem('logbook_local_workout', JSON.stringify(workout))` synchronously on every single keypress, causing input lag on mobile devices.
- **Concrete Code Fix Proposal**:
```ts
// BEFORE (src/store/useAppStore.ts:72-86):
setLocalWorkout: (workout) => {
  if (workout) {
    localStorage.setItem('logbook_local_workout', JSON.stringify(workout));
  } else {
    localStorage.removeItem('logbook_local_workout');
  }
  set({ localWorkout: workout });
}

// AFTER (Debounced local storage persistence):
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const debouncedSaveLocalStorage = (workout: WorkoutSession | null) => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      if (workout) {
        localStorage.setItem('logbook_local_workout', JSON.stringify(workout));
      } else {
        localStorage.removeItem('logbook_local_workout');
      }
    } catch (e) {
      console.error("Errore salvataggio localWorkout:", e);
    }
  }, 300);
};

setLocalWorkout: (workout) => {
  set({ localWorkout: workout });
  debouncedSaveLocalStorage(workout);
}
```

---

#### Finding 6: Custom Hooks Returning Un-memoized Handler Objects
- **File Path & Line Range**: `src/hooks/useWorkoutSession.ts:242-265`, `src/hooks/useNutritionMeals.ts:199-206`, `src/hooks/useNutritionMeasurements.ts:110-124`, `src/hooks/useTrainingExercises.ts:119-125`
- **Category & Severity**: React Anti-Pattern / **Medium Severity**
- **Impact & Risk Assessment**: `useWorkoutSession` returns an un-memoized object containing 23 state fields and handler functions. None of these functions are wrapped in `useCallback`. Consequently, every render instantiates 23 new function references, causing full re-renders of all consuming child components.
- **Concrete Code Fix Proposal**:
```ts
// BEFORE (src/hooks/useWorkoutSession.ts:242-265):
return {
  activeWorkout, routines, library, history, selectedRoutine, setSelectedRoutine,
  mood, setMood, pump, setPump, fatigue, setFatigue, water, setWater,
  startWorkout, endWorkout, deleteWorkout, addExtraExercise, reorderExercises,
  removeActiveExercise, addSet, removeSet, updateSet, addSpecialSet,
  updateSpecialSet, removeSpecialSet, updateSessionNote, updateSetupNote
};

// AFTER:
const startWorkout = useCallback(async () => { /* ... */ }, [selectedRoutine, activeWorkout, routines, setLocalWorkout, showAlert]);
const endWorkout = useCallback(async () => { /* ... */ }, [activeWorkout, showConfirm, mood, pump, fatigue, water, history, userData, saveUserData, setLocalWorkout, showAlert]);
const updateSet = useCallback((exIndex: number, setIndex: number, field: string, val: any) => { /* ... */ }, [activeWorkout, setLocalWorkout]);

return useMemo(() => ({
  activeWorkout, routines, library, history, selectedRoutine, setSelectedRoutine,
  mood, setMood, pump, setPump, fatigue, setFatigue, water, setWater,
  startWorkout, endWorkout, deleteWorkout, addExtraExercise, reorderExercises,
  removeActiveExercise, addSet, removeSet, updateSet, addSpecialSet,
  updateSpecialSet, removeSpecialSet, updateSessionNote, updateSetupNote
}), [activeWorkout, routines, library, history, selectedRoutine, mood, pump, fatigue, water, startWorkout, endWorkout, deleteWorkout, updateSet]);
```

---

#### Finding 7: Derived Search Results Stored in `useState`
- **File Path & Line Range**: `src/hooks/useNutritionMeals.ts:13, 61-76`
- **Category & Severity**: React Anti-Pattern / **Medium Severity**
- **Impact & Risk Assessment**: `searchResults` is stored in `useState` and populated imperatively in `handleSearch`. Storing derived search filter data in state causes double re-renders and risks showing stale food results when `userData.customFoods` updates while searching.
- **Concrete Code Fix Proposal**:
```ts
// BEFORE (src/hooks/useNutritionMeals.ts:13, 61-76):
const [searchResults, setSearchResults] = useState<any[]>([]);
const handleSearch = (q: string) => {
  setSearchQuery(q);
  if (q.trim().length <= 1) { setSearchResults([]); return; }
  const filtered = combinedFoods.filter(/* ... */);
  setSearchResults(filtered);
};

// AFTER (Derived via useMemo):
const [searchQuery, setSearchQuery] = useState('');

const searchResults = useMemo(() => {
  if (searchQuery.trim().length <= 1) return [];
  const q = searchQuery.toLowerCase();
  const customFoods = userData?.customFoods || [];
  const combined = [...COMMON_FOODS, ...customFoods];
  return combined.filter((f: Food) => 
    (f.name || '').toLowerCase().includes(q) || 
    (f.category || '').toLowerCase().includes(q) ||
    (f.brand || '').toLowerCase().includes(q)
  ).slice(0, 10);
}, [searchQuery, userData?.customFoods]);
```

---

#### Finding 8: Dynamic Style Factory Function Invalidating Child Memoization
- **File Path & Line Range**: `src/components/Training/MuscleModel.tsx:18-24`
- **Category & Severity**: Performance (Inline Callback Prop) / **Low-Medium Severity**
- **Impact & Risk Assessment**: `MuscleModel` defines `getPathStyle` inline inside the render loop and passes it as a prop to `<MuscleModelPaths getPathStyle={getPathStyle} />`. Because `getPathStyle` is a new function reference on every render, `MuscleModelPaths` cannot skip rendering, forcing SVG path re-evaluation across all 80+ muscle paths.
- **Concrete Code Fix Proposal**:
```tsx
// BEFORE (src/components/Training/MuscleModel.tsx:18-24):
const getPathStyle = (id: string) => {
  const isActive = activeSvgIds.has(id);
  return { fill: isActive ? 'var(--primary-color, #00e5ff)' : 'transparent', transition: 'fill 0.3s ease' };
};
return <MuscleModelPaths getPathStyle={getPathStyle} />;

// AFTER:
const activeSvgIds = useMemo(() => {
  const ids = new Set<string>();
  selectedMuscles.forEach(muscle => {
    const groupMap: Record<string, string[]> = Logic.GROUP_MAP;
    const mapped = groupMap[muscle];
    if (mapped) mapped.forEach(id => ids.add(id));
    else ids.add(muscle);
  });
  return ids;
}, [selectedMuscles]);

const getPathStyle = useCallback((id: string) => ({
  fill: activeSvgIds.has(id) ? 'var(--primary-color, #00e5ff)' : 'transparent',
  transition: 'fill 0.3s ease'
}), [activeSvgIds]);

return <MuscleModelPaths getPathStyle={getPathStyle} />;
```

---

#### Finding 9: Inline Configuration Object in Hook Parameter
- **File Path & Line Range**: `src/App.tsx:44-52`
- **Category & Severity**: Performance (Inline Object Prop) / **Low Severity**
- **Impact & Risk Assessment**: `{ onRegistered(r) { ... }, onRegisterError(error) { ... } }` is passed inline into `useRegisterSW(...)` inside `App`. Re-instantiating this object on every render causes internal effect re-subscriptions in `vite-plugin-pwa`.
- **Concrete Code Fix Proposal**:
```tsx
// BEFORE (src/App.tsx:44-52):
const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW({
  onRegistered(r) { if (r) setSwRegistration(r); },
  onRegisterError(error) { console.log('SW registration error', error); }
});

// AFTER:
const swOptions = useMemo(() => ({
  onRegistered(r: ServiceWorkerRegistration | undefined) {
    if (r) setSwRegistration(r);
  },
  onRegisterError(error: unknown) {
    console.warn('SW registration error:', error);
  }
}), []);

const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW(swOptions);
```

---

#### Finding 10: Non-Chronological Object Keys Used for Body Fat Calculation
- **File Path & Line Range**: `src/hooks/useHomeView.ts:108-110`
- **Category & Severity**: React Anti-Pattern / Logic Error / **Low-Medium Severity**
- **Impact & Risk Assessment**: `(Object.values(nutrition) as any[]).find(n => n?.weight)?.weight` relies on JavaScript object key iteration order to find the latest recorded weight when today's weight is missing. If dates were inserted out of chronological order in Firestore or local state, this returns an outdated weight value, causing inaccurate Body Fat % calculations.
- **Concrete Code Fix Proposal**:
```ts
// BEFORE (src/hooks/useHomeView.ts:108-110):
const currentWeight = todayNutrition.weight || (Object.values(nutrition) as any[]).find(n => n?.weight)?.weight || userData?.nutritionPlanning?.weight || 80;

// AFTER:
const currentWeight = useMemo(() => {
  if (todayNutrition.weight) return todayNutrition.weight;
  const sortedEntries = Object.values(nutrition)
    .filter((n: NutritionDay) => n?.weight && !isNaN(Number(n.weight)))
    .sort((a: NutritionDay, b: NutritionDay) => b.date.localeCompare(a.date));
  return sortedEntries[0]?.weight || userData?.nutritionPlanning?.weight || 80;
}, [todayNutrition.weight, nutrition, userData?.nutritionPlanning?.weight]);
```

---

#### Finding 11: Disabled ESLint Exhaustive Dependencies in Auth Sync Effect
- **File Path & Line Range**: `src/contexts/AuthContext.tsx:33-93`
- **Category & Severity**: Custom Hook Anti-Pattern / **Medium Severity**
- **Impact & Risk Assessment**: Line 93 contains `// eslint-disable-line react-hooks/exhaustive-deps`. `loadData` captures `setSyncing` and `setUserData` from Zustand state selectors, but is declared un-memoized outside `useEffect`. Bypassing dependency checks risks stale closure references during authentication state changes.
- **Concrete Code Fix Proposal**:
```ts
// BEFORE (src/contexts/AuthContext.tsx:33-93):
const loadData = async (user: any) => {
  // ...
};
useEffect(() => {
  // ...
  if (user) loadData(user);
}, []); // eslint-disable-line react-hooks/exhaustive-deps

// AFTER:
const loadData = useCallback(async (user: User | null) => {
  if (!user) return;
  setSyncing(true);
  try {
    const data = await DB.loadUserData();
    setUserData(data);
  } catch (error: unknown) {
    console.error("Errore caricamento dati in AuthContext:", error);
  } finally {
    setSyncing(false);
  }
}, [setSyncing, setUserData]);

useEffect(() => {
  let isMounted = true;
  // ...
  const unsubscribe = onAuthStateChanged(auth, async (user) => {
    if (!isMounted) return;
    setCurrentUser(user);
    if (user) await loadData(user);
    else { DB.resetCache(); useAppStore.getState().resetStore(); }
    setLoading(false);
  });
  return () => { isMounted = false; unsubscribe(); };
}, [loadData]);
```

---

#### Finding 12: Non-deterministic Timestamp IDs for Meal List Filtering
- **File Path & Line Range**: `src/hooks/useNutritionMeals.ts:31, 41, 135-137`
- **Category & Severity**: React Anti-Pattern (Unsafe Key Generation) / **Low Severity**
- **Impact & Risk Assessment**: Quick-add meal items set `time: new Date().getTime()` and delete items using `meals.filter((m: any) => m.time !== itemTime)`. If two items are added within the same millisecond or duplicate timestamps occur, deleting one item unintentionally deletes both.
- **Concrete Code Fix Proposal**:
```ts
// BEFORE (src/hooks/useNutritionMeals.ts:31, 135-137):
const addedItem = { name: quickData.name, time: new Date().getTime(), ... };
const removeFood = async (itemTime: number) => {
  const updatedMeals = meals.filter((m: any) => m.time !== itemTime);
};

// AFTER:
const addedItem: Meal = {
  id: Logic.generateId('meal'),
  name: quickData.name,
  meal: 'quick',
  quantity: 100,
  baseQty: 100,
  unit: 'g',
  kcal: quickData.kcal || 0,
  carbs: quickData.carbs || 0,
  pro: quickData.pro || 0,
  fat: quickData.fat || 0,
  createdAt: Date.now()
};

const removeFood = async (mealId: string) => {
  const updatedMeals = meals.filter((m: Meal) => m.id !== mealId);
  // ...
};
```

---

#### Finding 13: Loose TypeScript Typing across Core Domain Models
- **File Path & Line Range**: `src/types.ts:1-70`, `src/contexts/AuthContext.tsx:7, 24`, `src/hooks/useNutritionMeals.ts:13, 26`, `src/hooks/useWorkoutSession.ts:46`
- **Category & Severity**: Organization (Type Safety) / **Low-Medium Severity**
- **Impact & Risk Assessment**: Over 30 instances of `any` types exist across hooks and components (`currentUser: any`, `day: any`, `f: any`, `wo: any`, `selectedMuscles: any[]`). Loose typing bypasses compile-time checks, leading to optional property errors when rendering workout history or nutrition days.
- **Concrete Code Fix Proposal**:
```ts
// BEFORE (src/contexts/AuthContext.tsx:7):
export interface AuthContextType {
  currentUser: any;
  loading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

// AFTER:
import { User } from 'firebase/auth';

export interface AuthContextType {
  currentUser: User | null;
  loading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}
```

---

### 4.2 Zustand State Management & Firebase Data Flow Issues (8 Findings)

#### Issue 1: Full Store Subscription in `useNutritionMeals.ts`
- **File Path & Line Range**: `src/hooks/useNutritionMeals.ts:10`
- **Category & Severity**: Zustand Anti-Pattern / **Medium Severity**
- **Impact & Risk Assessment**: Calling `const { showAlert } = useDialogStore();` without a selector parameter subscribes `useNutritionMeals` to the entire `DialogState` object. Opening or closing any dialog modal in the app re-renders consuming nutrition meal components.
- **Concrete Code Fix Proposal**:
```typescript
// BEFORE (src/hooks/useNutritionMeals.ts:10):
const { showAlert } = useDialogStore();

// AFTER:
const showAlert = useDialogStore(state => state.showAlert);
```

---

#### Issue 2: Full Store Subscription in `useNutritionMeasurements.ts`
- **File Path & Line Range**: `src/hooks/useNutritionMeasurements.ts:9`
- **Category & Severity**: Zustand Anti-Pattern / **Medium Severity**
- **Impact & Risk Assessment**: Calling `const { showAlert } = useDialogStore();` without a selector parameter subscribes `useNutritionMeasurements` to all modal dialog state changes.
- **Concrete Code Fix Proposal**:
```typescript
// BEFORE (src/hooks/useNutritionMeasurements.ts:9):
const { showAlert } = useDialogStore();

// AFTER:
const showAlert = useDialogStore(state => state.showAlert);
```

---

#### Issue 3: Full Store Subscription in `useNutritionPlanning.ts`
- **File Path & Line Range**: `src/hooks/useNutritionPlanning.ts:9`
- **Category & Severity**: Zustand Anti-Pattern / **Medium Severity**
- **Impact & Risk Assessment**: Calling `const { showAlert } = useDialogStore();` without a selector parameter subscribes `useNutritionPlanning` to all modal dialog state changes.
- **Concrete Code Fix Proposal**:
```typescript
// BEFORE (src/hooks/useNutritionPlanning.ts:9):
const { showAlert } = useDialogStore();

// AFTER:
const showAlert = useDialogStore(state => state.showAlert);
```

---

#### Issue 4: Draft Workout State Leakage & Missing Store Reset on Logout
- **File Path & Line Range**: `src/store/useAppStore.ts:94-96`
- **Category & Severity**: Zustand Anti-Pattern / Data Flow / **High Severity**
- **Impact & Risk Assessment**: When `setUserData(null)` is invoked (during user sign-out), the store explicitly preserves `localWorkout` in memory (`return { userData: null, localWorkout: state.localWorkout }`). Furthermore, `localStorage.getItem('logbook_local_workout')` is retained. If User B signs in, User B sees and overwrites User A's uncommitted draft workout.
- **Concrete Code Fix Proposal**:
```typescript
// BEFORE (src/store/useAppStore.ts:94-96):
if (!rawNextData) {
    return { userData: null, localWorkout: state.localWorkout };
}

// AFTER:
if (!rawNextData) {
    try {
        localStorage.removeItem('logbook_local_workout');
    } catch (e) {
        console.error("Errore rimozione localWorkout:", e);
    }
    return { userData: null, localWorkout: null };
}

// Add resetStore action to AppState interface and store implementation:
export interface AppState {
    // ...
    resetStore: () => void;
}

resetStore: () => {
    try {
        localStorage.removeItem('logbook_local_workout');
    } catch (e) {}
    set({ userData: null, localWorkout: null, saveError: null, syncing: false });
}
```

---

#### Issue 5: Module-Scoped Cache Persistence Across Auth Sessions in `db.ts`
- **File Path & Line Range**: `src/lib/db.ts:6`, `src/lib/db.ts:213-222`
- **Category & Severity**: Firebase Data Flow / State Sync / **High Severity**
- **Impact & Risk Assessment**: Top-level module variable `let lastSavedStateStr: any = null;` caches the previous user's stringified JSON payload. When User A logs out and User B logs in within the same SPA session, `DB.saveUserData()` compares User B's state against User A's string, causing corrupted differential saves in Firestore.
- **Concrete Code Fix Proposal**:
```typescript
// BEFORE (src/lib/db.ts:6):
let lastSavedStateStr: any = null;

// AFTER (Expose resetCache and clear inside secureLogOut):
let lastSavedStateStr: string | null = null;

export const DB = {
    resetCache() {
        lastSavedStateStr = null;
    },
    async secureLogOut() {
        try {
            console.log("Attendo il completamento delle scritture offline...");
            await waitForPendingWrites(db);
            console.log("Tutti i dati sincronizzati. Eseguo il Log Out.");
            await auth.signOut();
            this.resetCache();
        } catch (error: unknown) {
            console.error("Errore durante il Log Out:", error);
            throw error; // Rethrow so caller handles partial logout state
        }
    },
    // ...
};
```

---

#### Issue 6: Unhandled Promise Rejection in Firebase Analytics Initialization
- **File Path & Line Range**: `src/lib/firebase.ts:37-41`
- **Category & Severity**: Firebase Data Flow / **Low-Medium Severity**
- **Impact & Risk Assessment**: `isSupported()` returns a `Promise<boolean>`. There is no `.catch()` handler chained to handle promise rejection when IndexedDB or analytics initialization fails in restricted browser contexts or ad-blocker environments.
- **Concrete Code Fix Proposal**:
```typescript
// BEFORE (src/lib/firebase.ts:37-41):
isSupported().then((supported) => {
    if (supported) {
        analytics = getAnalytics(app);
    }
});

// AFTER:
isSupported().then((supported) => {
    if (supported) {
        analytics = getAnalytics(app);
    }
}).catch((err) => {
    console.warn("Firebase Analytics non supportato o disabilitato:", err);
});
```

---

#### Issue 7: Unhandled Rejection in Auth Unsubscribe Cleanup
- **File Path & Line Range**: `src/contexts/AuthContext.tsx:49-92`
- **Category & Severity**: Firebase Data Flow / Memory Leak / **Medium Severity**
- **Impact & Risk Assessment**: `initAuth` awaits `getRedirectResult(auth)` before attaching `onAuthStateChanged`. In `useEffect` cleanup, `authUnsubPromise.then(...)` lacks a `.catch()` block. If `initAuth` throws or unmounts early, an unhandled promise rejection occurs.
- **Concrete Code Fix Proposal**:
```typescript
// BEFORE (src/contexts/AuthContext.tsx:49-92):
useEffect(() => {
    let isMounted = true;
    const authUnsubPromise = initAuth();
    return () => {
        isMounted = false;
        authUnsubPromise.then(unsub => unsub && unsub());
    };
}, []);

// AFTER:
useEffect(() => {
    let isMounted = true;

    // Execute redirect result check asynchronously without delaying onAuthStateChanged setup
    getRedirectResult(auth).catch(err => {
        console.warn("getRedirectResult warning (non-critico):", err);
    });

    const unsubscribe = onAuthStateChanged(auth, async (user: User | null) => {
        if (!isMounted) return;
        setCurrentUser(user);
        if (user) {
            await loadData(user);
        } else {
            DB.resetCache();
            useAppStore.getState().resetStore();
        }
        setLoading(false);
    });

    const handleVisibilityChange = async () => {
        if (document.visibilityState === 'visible' && auth.currentUser) {
            if (useAppStore.getState().userData !== null && !useAppStore.getState().syncing) {
                try {
                    await waitForPendingWrites(db);
                    await loadData(auth.currentUser);
                } catch (e) {
                    console.warn("Skipping visibility reload due to pending writes", e);
                }
            }
        }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
        isMounted = false;
        unsubscribe();
        document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
}, [loadData]);
```

---

#### Issue 8: Incomplete Error Propagation & Partial Logout State
- **File Path & Line Range**: `src/lib/db.ts:213-222` & `src/contexts/AuthContext.tsx:114-125`
- **Category & Severity**: Firebase Data Flow / Auth / **High Severity**
- **Impact & Risk Assessment**: `DB.secureLogOut()` catches all exceptions, shows a dialog alert, and returns normally without rethrowing. `AuthContext.logout()` awaits `DB.secureLogOut()` and proceeds to execute `setUserData(null)`, clearing local UI state even if Firebase `auth.signOut()` failed.
- **Concrete Code Fix Proposal**:
```typescript
// BEFORE (src/contexts/AuthContext.tsx:114-125):
const logout = useCallback(async () => {
    setSyncing(true);
    try {
        await DB.secureLogOut();
        setUserData(null);
    } catch (error: any) { ... }
    finally { setSyncing(false); }
}, []);

// AFTER:
const logout = useCallback(async () => {
    setSyncing(true);
    try {
        await DB.secureLogOut();
        useAppStore.getState().resetStore();
    } catch (error: unknown) {
        console.error("Errore durante il logout:", error);
        await useDialogStore.getState().showAlert("Errore durante il Log Out. Controlla la connessione.");
    } finally {
        setSyncing(false);
    }
}, [setSyncing]);
```

---

### 4.3 TypeScript Violations & Type Safety Improvements (48+ Items)

Detailed breakdown of all 41 TS/TSX files audited in `src/`, grouped by file path with precise line references, issue categories (`any`, `as`, `!`, missing prop interface), impact, and complete type-safe code fix snippets:

#### 1. `src/main.tsx`
- **Line 8** | Unsafe Type Assertion (`as HTMLElement`): `document.getElementById('root') as HTMLElement` assumes `#root` exists.
```typescript
// FIX Snippet (src/main.tsx:8):
const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');
createRoot(container).render(<React.StrictMode><App /></React.StrictMode>);
```

#### 2. `src/contexts/AuthContext.tsx`
- **Line 7** | `any`: `currentUser: any;` in `AuthContextType`.
- **Line 24** | Missing Prop Type: `{ children }: { children: any }`.
- **Line 25** | `any`: `useState<any>(null);`.
- **Line 33, 56** | `any`: `loadData = async (user: any)` and `onAuthStateChanged(auth, async (user: any)`.
- **Line 99, 119** | `any`: `catch (error: any)`.
```typescript
// FIX Snippet (src/contexts/AuthContext.tsx):
import { User } from 'firebase/auth';

export interface AuthContextType {
    currentUser: User | null;
    loading: boolean;
    login: () => Promise<void>;
    logout: () => Promise<void>;
}

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const loadData = useCallback(async (user: User | null) => { /* ... */ }, []);
```

#### 3. `src/lib/db.ts`
- **Line 6** | `any`: `let lastSavedStateStr: any = null;`.
- **Line 8** | `any`: `function checkDocSize(data: any, docName: string)`.
- **Line 21, 30** | `Record<string, any>`: Loose record used for `defaultNutritionPlanning` and `state`.
- **Line 46** | Unsafe Type Assertion (`as Record<string, any>`): Unsafe cast from Firestore doc.
- **Line 73, 74, 80, 82, 86** | `any` / Casts: `(d: any)`, `monthData as Record<string, any>`, `(state.nutrition as any)[date]`, `(a: any, b: any)`.
- **Line 107** | `Record<string, any>`: `async saveUserData(state: Record<string, any>)`.
- **Line 231, 235** | `as any`: `return { forEach: () => {} } as any;`.
```typescript
// FIX Snippet (src/lib/db.ts):
import { UserData, WorkoutSession, NutritionDay } from '../types';

let lastSavedStateStr: string | null = null;

function checkDocSize(data: unknown, docName: string) { /* ... */ }

export const DB = {
    async saveUserData(state: UserData) { /* ... */ }
};
```

#### 4. `src/lib/export.ts`
- **Line 4, 10, 14** | `any`: `exportToCSV(history: any[], nutrition: Record<string, any>)`, `session.exercises.forEach((ex: any)`, `ex.sets.forEach((set: any)`.
```typescript
// FIX Snippet (src/lib/export.ts):
import { WorkoutSession, NutritionDay, SessionExercise, SessionExerciseSet } from '../types';

export const Exporter = {
    async exportToCSV(history: WorkoutSession[], nutrition: Record<string, NutritionDay>) {
        session.exercises.forEach((ex: SessionExercise) => {
            ex.sets.forEach((set: SessionExerciseSet, idx: number) => { /* ... */ });
        });
    }
};
```

#### 5. `src/lib/firebase.ts`
- **Line 36** | Missing Type: `let analytics = null;` implicitly typed as `any`.
```typescript
// FIX Snippet (src/lib/firebase.ts:36):
import { Analytics } from "firebase/analytics";
let analytics: Analytics | null = null;
```

#### 6. `src/lib/foods.ts`
- **Line 1** | Missing Type: `COMMON_FOODS` array without explicit `Food[]` typing.
```typescript
// FIX Snippet (src/lib/foods.ts:1):
import { Food } from '../types';
export const COMMON_FOODS: readonly Food[] = Object.freeze([ /* ... */ ]);
```

#### 7. `src/lib/logic.ts`
- **Lines 159, 171, 185, 209, 222, 251, 264, 314, 347, 378, 404, 447, 527, 537, 550, 588, 617, 684, 716, 754, 766, 797, 826, 830, 850** | `any`: 25+ calculation & validation functions accept/return `any`.
```typescript
// FIX Snippet (src/lib/logic.ts):
import { Food, UserProfile, WorkoutSession, NutritionDay, MacroTarget } from '../types';

export const Logic = {
    calculateBodyFat(weight: number | string | undefined, profile: UserProfile | null | undefined): string | null { /* ... */ },
    searchFoods(foodsList: Food[], query: string, categoryFilter: string): Food[] { /* ... */ },
    calculateDailyNutritionSummary(dayMeals: Meal[], targetPlan: MacroTarget) { /* ... */ }
};
```

#### 8. `src/hooks/useHomeView.ts`
- **Lines 5, 11, 12, 90** | `any`: `calcStreak(history: any[])`, `filter((w: any) => ...)`.
- **Line 109** | `as any[]`: `(Object.values(nutrition) as any[])`.
```typescript
// FIX Snippet (src/hooks/useHomeView.ts):
import { WorkoutSession, NutritionDay } from '../types';

function calcStreak(history: WorkoutSession[]) {
    const workoutDates = new Set(
        history.filter((w: WorkoutSession) => w.globalStartTime)
               .map((w: WorkoutSession) => Logic.getLocalDateString(w.globalStartTime))
    );
}
```

#### 9. `src/hooks/useNutritionMeals.ts`
- **Lines 13, 26, 28, 67, 78, 80, 97, 137** | `any` / Casts: `useState<any[]>([])`, `handleQuickAdd = async (quickData: any)`.
```typescript
// FIX Snippet (src/hooks/useNutritionMeals.ts):
import { Food, Meal } from '../types';

const [searchResults, setSearchResults] = useState<Food[]>([]);
const handleQuickAdd = async (quickData: { name: string; kcal?: number; carbs?: number; pro?: number; fat?: number }) => { /* ... */ };
```

#### 10. `src/hooks/useNutritionMeasurements.ts`
- **Lines 11, 25, 26, 29** | `any`: `profile: any = userData?.profile || {};`, `handleEditClick = (day: any)`.
```typescript
// FIX Snippet (src/hooks/useNutritionMeasurements.ts):
import { UserProfile, NutritionDay } from '../types';

const profile: UserProfile = userData?.profile || {};
const handleEditClick = (day: NutritionDay) => { /* ... */ };
```

#### 11. `src/hooks/useNutritionPlanning.ts`
- **Lines 12, 33** | `any`: `useState<any>(null)`, `handleUpdate = (field: string, value: any)`.
```typescript
// FIX Snippet (src/hooks/useNutritionPlanning.ts):
import { NutritionPlanning } from '../types';

const [localPlanning, setLocalPlanning] = useState<NutritionPlanning | null>(null);
const handleUpdate = <K extends keyof NutritionPlanning>(field: K, value: NutritionPlanning[K]) => { /* ... */ };
```

#### 12. `src/hooks/useSettings.ts`
- **Line 16** | `any`: `const [localProfile, setLocalProfile] = useState<any>(null);`.
```typescript
// FIX Snippet (src/hooks/useSettings.ts:16):
import { UserProfile } from '../types';
const [localProfile, setLocalProfile] = useState<UserProfile | null>(null);
```

#### 13. `src/hooks/useTrainingExercises.ts`
- **Lines 15, 26, 27, 28, 34, 77, 90, 106** | `any`: `selectedMuscles: any[]`, `handleEditClick = (ex: any)`, `handleDelete = async (id: string, e: any)`.
```typescript
// FIX Snippet (src/hooks/useTrainingExercises.ts):
import { Exercise } from '../types';

interface MuscleOption { id: string; name: string }
const [selectedMuscles, setSelectedMuscles] = useState<MuscleOption[]>([]);
const handleEditClick = (ex: Exercise) => { /* ... */ };
const handleDelete = async (id: string, e: React.MouseEvent) => { /* ... */ };
```

#### 14. `src/hooks/useTrainingHistory.ts`
- **Line 15** | `any`: `filter((w: any) => w.id !== id)`.
```typescript
// FIX Snippet (src/hooks/useTrainingHistory.ts:15):
import { WorkoutSession } from '../types';
const updatedHistory = (userData.history || []).filter((w: WorkoutSession) => w.id !== id);
```

#### 15. `src/hooks/useTrainingRoutines.ts`
- **Line 67** | `any`: `handleDelete = async (id: string, e: any)`.
```typescript
// FIX Snippet (src/hooks/useTrainingRoutines.ts:67):
const handleDelete = async (id: string, e: React.MouseEvent) => { /* ... */ };
```

#### 16. `src/hooks/useWorkoutSession.ts`
- **Lines 46, 124, 126, 130, 164, 173, 179, 193, 201, 217, 226, 234** | `any`: Routine mapping, set updates, dropsets/isometrics handlers use `any`.
```typescript
// FIX Snippet (src/hooks/useWorkoutSession.ts):
import { RoutineExercise, SessionExercise, SessionExerciseSet } from '../types';

exercises: (routine.exercises || []).map((ex: RoutineExercise) => ({ /* ... */ }))
```

#### 17. `src/components/Home/HomeView.tsx`
- **Line 6** | Missing Prop Type: `const HomeView = ({ onNavigate }: any)`.
- **Line 111** | `as any` & `!`: `{(tdeeCalc as any)?.dailyDeficit! > 0 ? '+' : ''}`.
```typescript
// FIX Snippet (src/components/Home/HomeView.tsx):
interface HomeViewProps { onNavigate: (tab: string) => void; }

const HomeView: React.FC<HomeViewProps> = ({ onNavigate }) => {
    // JSX:
    {!tdeeCalc.error && tdeeCalc.dailyDeficit !== undefined && (
        <span>{tdeeCalc.dailyDeficit > 0 ? '+' : ''}{tdeeCalc.dailyDeficit} kcal/gg</span>
    )}
};
```

#### 18. `src/components/Home/WeightChart.tsx`
- **Lines 22, 39, 41** | `any` / Casts: `(ctx: any)`, `{ chartData: any }`, `options={CHART_OPTIONS as any}`.
```typescript
// FIX Snippet (src/components/Home/WeightChart.tsx):
import { ChartData, ChartOptions, TooltipItem } from 'chart.js';

const CHART_OPTIONS: ChartOptions<'line'> = {
    responsive: true,
    plugins: { tooltip: { callbacks: { label: (ctx: TooltipItem<'line'>) => `${ctx.parsed.y} kg` } } }
};

export default function WeightChart({ chartData }: { chartData: ChartData<'line'> }) {
    return <Line data={chartData} options={CHART_OPTIONS} />;
}
```

#### 19. `src/components/Nutrition/CustomFoodModal.tsx`
- **Line 2** | Missing Prop Type: `export default function CustomFoodModal({ cfData, setCfData, ... }: any)`.
```typescript
// FIX Snippet (src/components/Nutrition/CustomFoodModal.tsx:2):
interface CustomFoodModalProps {
    cfData: { name: string; brand: string; unit: string; kcal: string; carbs: string; pro: string; fat: string };
    setCfData: React.Dispatch<React.SetStateAction<any>>;
    saveCustomFood: () => Promise<void>;
    showCustomModal: boolean;
}
export default function CustomFoodModal({ cfData, setCfData, saveCustomFood, showCustomModal }: CustomFoodModalProps) {
```

#### 20. `src/components/Nutrition/NutritionMeals.tsx`
- **Line 34** | `any`: `searchResults.map((f: any, idx: number)`.
```typescript
// FIX Snippet (src/components/Nutrition/NutritionMeals.tsx:34):
import { Food } from '../../types';
{searchResults.map((f: Food, idx: number) => ( /* ... */ ))}
```

#### 21. `src/components/Nutrition/NutritionMeasurements.tsx`
- **Line 94** | `any`: `measurementsHistory.map((day: any) =>`.
```typescript
// FIX Snippet (src/components/Nutrition/NutritionMeasurements.tsx:94):
import { NutritionDay } from '../../types';
{measurementsHistory.map((day: NutritionDay) => ( /* ... */ ))}
```

#### 22. `src/components/Nutrition/NutritionView.tsx`
- **Line 5** | Missing Prop Type: `const NutritionView = ({ subTab = 'meals', setSubTab }: any)`.
```typescript
// FIX Snippet (src/components/Nutrition/NutritionView.tsx:5):
interface NutritionViewProps { subTab?: string; setSubTab: (subTab: string) => void; }
const NutritionView: React.FC<NutritionViewProps> = ({ subTab = 'meals', setSubTab }) => {
```

#### 23. `src/components/Training/MuscleModel.tsx`
- **Line 10** | `as any`: `const mapped = (Logic.GROUP_MAP as any)[muscle];`.
```typescript
// FIX Snippet (src/components/Training/MuscleModel.tsx:10):
const groupMap: Record<string, string[]> = Logic.GROUP_MAP;
const mapped = groupMap[muscle];
```

#### 24. `src/components/Training/MuscleModelPaths.tsx`
- **Line 2** | Missing Prop Type: `export default function MuscleModelPaths({ getPathStyle }: any)`.
```typescript
// FIX Snippet (src/components/Training/MuscleModelPaths.tsx:2):
interface MuscleModelPathsProps { getPathStyle: (id: string) => React.CSSProperties; }
export default function MuscleModelPaths({ getPathStyle }: MuscleModelPathsProps) {
```

#### 25. `src/components/Training/TrainingExercises.tsx`
- **Lines 95, 143** | `as any`: `<MuscleModel selectedMuscles={selectedMuscleIds as any} />`.
```typescript
// FIX Snippet (src/components/Training/TrainingExercises.tsx:95,143):
<MuscleModel selectedMuscles={selectedMuscleIds} />
```

#### 26. `src/components/Training/TrainingHistory.tsx`
- **Line 8** | `any`: `const map = new Map<string, any>();`.
- **Line 32-34** | `as any`: `(wo as any).mood`.
- **Line 49** | `!`: `deleteWorkout(wo.id!)`.
- **Lines 62, 66, 71** | `any`: `ex: any`, `s: any`.
```typescript
// FIX Snippet (src/components/Training/TrainingHistory.tsx):
import { WorkoutSession, SessionExercise, SessionExerciseSet, Exercise } from '../../types';
const map = new Map<string, Exercise>();
const moodVal = wo.moodRating ?? wo.mood;
onClick={() => wo.id && deleteWorkout(wo.id)}
(wo.exercises || []).map((ex: SessionExercise) => { /* ... */ });
```

#### 27. `src/components/Training/TrainingRoutines.tsx`
- **Lines 17, 138** | `any`: `routineExercises.forEach((ex: any) => ...)`.
- **Lines 41, 149** | `as string[]`: `Array.from(new Set(editMuscles)) as string[]`.
```typescript
// FIX Snippet (src/components/Training/TrainingRoutines.tsx):
import { RoutineExercise } from '../../types';
routineExercises.forEach((ex: RoutineExercise) => { /* ... */ });
<MuscleModel selectedMuscles={Array.from(new Set(editMuscles))} />
```

#### 28. `src/components/Training/TrainingSession.tsx`
- **Line 54** | `any`: `sets: any[]`.
- **Line 62** | `!`: `map.get(ex.exId)!`.
- **Lines 113, 142, 171, 201, 212, 232** | `any`: `exItem: any`, `s: any`, `ds: any`, `iso: any`.
```typescript
// FIX Snippet (src/components/Training/TrainingSession.tsx):
import { SessionExercise, SessionExerciseSet } from '../../types';
const map = new Map<string, Array<{ date: string; sets: SessionExerciseSet[]; note: string }>>();
const list = map.get(ex.exId);
if (list && list.length < 2) { list.push({ date: w.date, sets: ex.sets || [], note: ex.sessionNote }); }
```

#### 29. `src/components/Training/TrainingView.tsx`
- **Line 6** | Missing Prop Type: `const TrainingView = ({ subTab = 'session', setSubTab }: any)`.
```typescript
// FIX Snippet (src/components/Training/TrainingView.tsx:6):
interface TrainingViewProps { subTab?: string; setSubTab: (subTab: string) => void; }
const TrainingView: React.FC<TrainingViewProps> = ({ subTab = 'session', setSubTab }) => {
```

#### 30–41. Remaining Audited Files (Summary Table)
| File Path | Status / Audit Finding | Proposed Action |
| :--- | :--- | :--- |
| `src/types.ts` | Complete domain interfaces | Add optional legacy rating fields (`mood?`, `pump?`, `fatigue?`) |
| `src/store/useAppStore.ts` | 1 unused var (`e`), missing `resetStore` | Remove unused `e`, implement `resetStore()` action |
| `src/store/useDialogStore.ts` | Clean | Maintain selector-based store usage |
| `src/hooks/useWorkoutTimer.ts` | Clean | Wrapped in `useEffect` timer loop |
| `src/components/Settings/SettingsView.tsx` | Clean | Add explicit prop typing if needed |
| `src/components/UI/GlobalDialog.tsx` | Clean | Fully typed Zustand dialog modal |
| `tests/setup.tsx` | 1 unused index parameter | Rename `_index` |
| `tests/edge_cases.test.tsx` | 3 unused imports | Remove unused component imports |
| `resize_icons.mjs` | 1 unused `fs` import | Remove unused `import fs from 'node:fs'` |
| `vite.config.ts` | Chunk warning | Configure `manualChunks` in `rollupOptions` |
| `index.html` | Clean | Standard Vite PWA HTML template |
| `tsconfig.json` | Strict mode enabled | Retain strict compiler flags |

---

### 4.4 Build & Lint Warning Remediation Guide

#### 1. Remediation of 30 Lint Warnings (`npm run lint`)

```typescript
// 1. Unused Catch Parameters (e.g. src/store/useAppStore.ts:67, useWorkoutSession.ts:95, etc.)
// REPLACE:
} catch (error) { ... }
// WITH (Omit parameter if unneeded, or use _error):
} catch { ... }

// 2. Unused Imports (e.g. src/hooks/useSettings.ts:1, useNutritionPlanning.ts:1, db.ts:2)
// REMOVE:
import { useEffect } from 'react';
import { setDoc, deleteDoc } from 'firebase/firestore';

// 3. Fast Refresh Warning (src/contexts/AuthContext.tsx:22:14)
// Extract useAuth hook to standalone hook file src/hooks/useAuth.ts:
// src/hooks/useAuth.ts
import { useContext } from 'react';
import { AuthContext } from '../contexts/AuthContext';
export const useAuth = () => useContext(AuthContext);

// 4. Unstable Inline Dependencies in useHomeView.ts (lines 50, 59, 80)
// REPLACE:
const history = userData?.history || [];
const nutrition = userData?.nutrition || {};
// WITH (Memoized or top-level default constants):
const EMPTY_ARRAY: WorkoutSession[] = [];
const EMPTY_OBJECT: Record<string, NutritionDay> = {};

const history = userData?.history ?? EMPTY_ARRAY;
const nutrition = userData?.nutrition ?? EMPTY_OBJECT;
```

#### 2. Vite Bundle Optimization Strategy (`firebase-qPkOU6ni.js` Chunk Splitting)

Update `vite.config.ts` to add custom Rollup chunking rules:

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({ /* ... */ })
  ],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/firebase/auth')) {
            return 'firebase-auth';
          }
          if (id.includes('node_modules/firebase/firestore')) {
            return 'firebase-firestore';
          }
          if (id.includes('node_modules/firebase')) {
            return 'firebase-core';
          }
          if (id.includes('node_modules/chart.js') || id.includes('node_modules/react-chartjs-2')) {
            return 'chartjs';
          }
        }
      }
    }
  }
});
```

---

## 5. Verification & Testing Strategy

To ensure zero regressions and complete compliance with project requirements, execute the following step-by-step verification commands after applying each phase:

### Step 1: Programmatic Code Quality Validation (Linting)
Run Oxlint to confirm all 30 warnings are resolved with 0 errors:
```cmd
cmd /c "npm run lint"
```
*Target Result*: `Passed with 0 errors, 0 warnings`.

### Step 2: TypeScript Strict Compilation Check
Run the TypeScript compiler in no-emit mode to verify 100% type safety across all 41 files:
```cmd
npx tsc --noEmit
```
*Target Result*: `Done in X.XXs with 0 errors`.

### Step 3: Production Build & Asset Bundle Validation
Run Vite build to verify clean bundling and chunk optimization:
```cmd
cmd /c "npm run build"
```
*Target Result*: `PASSED with 0 errors, 0 warnings`. Confirm that `firebase-auth`, `firebase-firestore`, and `firebase-core` chunks are under the 500 kB threshold.

---
*End of Action Plan.*
