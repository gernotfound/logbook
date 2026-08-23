# Handoff Report: Test Execution Hazards & Isolation Recipes

## 1. Observation

Direct observations from codebase inspection, configuration files, and empirical test runs:

1. **Vitest & Environment Configuration (`vitest.config.ts`, `tests/setup.tsx`)**:
   - `vitest.config.ts`: `environment: 'jsdom'`, `setupFiles: ['./tests/setup.tsx']`, default `testTimeout: 5000` ms.
   - Running the full 40-suite test battery (`npm.cmd test`) executed 746 tests in 137s with 6 timeout failures under heavy parallel worker load:
     ```
     FAIL tests/challenger_react_hooks_memo_stress.test.tsx:257 (timeout in 5000ms)
     FAIL tests/edge_cases.test.tsx:140 (timeout in 5000ms)
     FAIL tests/reload_prompt.test.tsx:243 (timeout in 5000ms)
     FAIL tests/render.test.tsx:25 (timeout in 5000ms)
     FAIL tests/training_planning.test.tsx:182 (timeout in 5000ms)
     FAIL tests/training_planning.test.tsx:203 (timeout in 5000ms)
     ```
   - Running test files in isolation (e.g. `npm.cmd test -- tests/render.test.tsx`) passes 20/20 tests in 2.66s without any errors.

2. **Zustand Architecture & State Bleeding (`src/store/useAppStore.ts`, slices)**:
   - Store singleton composed of three slices: `DataSlice`, `WorkoutSlice`, `SyncSlice`.
   - In `src/store/slices/createWorkoutSlice.ts`:
     - `debouncedSaveLocalStorage` sets `saveTimer = setTimeout(..., 300)` writing to `localStorage['logbook_local_workout']`.
     - `clearWorkoutTimer()` clears `saveTimer`.
   - In `src/store/slices/createSyncSlice.ts`:
     - Module-level variables `let globalSaveTimer: ReturnType<typeof setTimeout> | null = null;` and `let pendingPromises: PendingPromise[] = [];`.
     - `saveUserData` initiates a 1000ms timer (`DEBOUNCE_DELAY_GLOBAL`) calling `DB.saveUserData(currentState)`.
     - `resetStore()`: cancels `saveTimer`, cancels `globalSaveTimer`, clears `pendingPromises`, removes `logbook_local_workout` from `localStorage`, removes `logbook_cached_user_data` from IndexedDB, and resets store fields to `{ userData: null, localWorkout: null, saveError: null, syncing: false }`.
   - Simple `useAppStore.setState({ ... })` does **not** clear background timers or pending promises.

3. **LocalStorage Mocking (`tests/setup.tsx`, `src/hooks/useLocalStorage.ts`)**:
   - `tests/setup.tsx` line 90 defines a module-level in-memory record `const localStorageStore: Record<string, string> = {};` mapped to `window.localStorage`.
   - `vi.clearAllMocks()` in tests only clears mock call counts/instances; it does **not** clear `localStorageStore`.
   - Explicit `window.localStorage.clear()` is required to remove stored keys between tests.
   - Node 22 prints `ExperimentalWarning: localStorage is not available because --localstorage-file was not provided`.

4. **Date & Timezone Utilities (`src/lib/utils/date.ts`, `src/lib/calc/planning.ts`)**:
   - `Logic.getLocalDateString()` formats `new Date()` as `'YYYY-MM-DD'` using `date-fns/format` in local timezone.
   - ISO strings with time/UTC components (e.g. `'2026-08-20T23:30:00Z'`) risk shifting day boundaries across timezones if parsed via `new Date(isoString)` rather than `parseISO(dateString)`.
   - Sleep formatting (`formatSleepTime`, `parseSleepInput`): converts numbers (e.g. `7.5` -> `"07:30"`), decimal strings (`"7,5"`, `"8h"`), and standard strings (`"08:30"`). Boundaries: `00:00` to `23:59`. Out-of-bounds or non-time strings return `""` / `null`.
   - Cycle calculation (`calculateCycleTimeline` in `src/lib/calc/planning.ts`):
     - End date formula: `end = addDays(start, totalWeeks * 7 - 1)`. For start `'2026-08-01'` and 4 weeks, end date is `'2026-08-28'` (28 days inclusive).

5. **Component Contexts & Rendering Providers (`tests/setup.tsx`, `src/contexts/AuthContext.tsx`)**:
   - `renderWithProviders` wraps target components with `<AuthProvider>`.
   - When `<AuthProvider>` mounts, `useEffect` triggers `onAuthStateChanged`. In `tests/setup.tsx`, `onAuthStateChanged` immediately fires with mock user `{ uid: 'test-user-id' }` and calls `loadData()`, which in turn calls `DB.loadUserData()`.
   - `useDialogStore` is mocked globally in `tests/setup.tsx` with `showAlert` resolving `undefined` and `showConfirm` resolving `true`.

---

## 2. Logic Chain

1. **State Bleeding Risk**:
   - If test 1 invokes `useAppStore.getState().saveUserData(...)` or `useWorkoutSetMutations.addExtraExercise(...)`, it arms a 1000ms or 300ms debounce timer and registers a promise in `pendingPromises`.
   - If test 1 finishes without awaiting or canceling the timer, the timer executes in test 2, invoking `DB.saveUserData` and mutating store `syncing` and `saveError` state.
   - *Resolution*: Every test suite must invoke `useAppStore.getState().resetStore()` in both `beforeEach` and `afterEach`.

2. **Storage Bleeding Risk**:
   - Because `localStorageStore` in `tests/setup.tsx` lives at module scope, keys like `logbook_local_workout`, `logbook_is_guest`, `logbook_activeTab`, and `logbook_timer_*` stay present across tests within the same runner thread.
   - *Resolution*: Every test suite must call `window.localStorage.clear()` in `beforeEach` and `afterEach`.

3. **Fake Timers vs Asynchronous Flush Risk**:
   - When using `vi.useFakeTimers()`, tests must use `await vi.advanceTimersByTimeAsync(1100)` rather than synchronous `vi.advanceTimersByTime(1100)` when debounce callbacks return Promises (such as `DB.saveUserData`).
   - If `vi.useFakeTimers()` is not restored with `vi.useRealTimers()` in `afterEach`, subsequent tests using `waitFor` or `screen.findBy*` will stall and hit the 5000ms timeout.
   - *Resolution*: Pair `vi.useFakeTimers()` in `beforeEach` with `vi.useRealTimers()` in `afterEach`.

4. **Context Hierarchy and Provider Isolation**:
   - Components requiring `useAuth()` or `useAppStore` must be rendered via `renderWithProviders(ui, { userData, localWorkout })`.
   - For tests asserting on dialog interactions (`showConfirm`, `showAlert`), the test can override `useDialogStore.getState().showConfirm` with a custom mock (e.g. returning `false` to simulate user cancellation).

---

## 3. Caveats

- Node 22 experimental localStorage warning is benign and does not affect JSDOM test assertions.
- When testing large multi-tier suites (such as 70+ test cases), running all 40 test files in parallel on constrained hardware can trigger Vitest default 5000ms timeouts; configuring a custom `testTimeout: 10000` in `vitest.config.ts` or running specific suites (`npm.cmd test -- tests/e2e_requirements.test.tsx`) prevents false positive timeout failures.
- No application source code was modified during this read-only investigation.

---

## 4. Conclusion & Exact Code Recipes

### Recipe 1: Standard Test File Setup and Teardown Harness

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAppStore } from '../src/store/useAppStore';
import { renderWithProviders, emptyUserData } from './setup';

describe('My Feature Test Suite', () => {
    beforeEach(() => {
        // 1. Reset localStorage in-memory mock store
        window.localStorage.clear();
        // 2. Clear all active Zustand timers & reset store state to clean baseline
        useAppStore.getState().resetStore();
        // 3. Clear all mock call counts
        vi.clearAllMocks();
    });

    afterEach(() => {
        // 1. Ensure no dangling timers or state bleed into subsequent suites
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.restoreAllMocks();
    });
});
```

### Recipe 2: Testing Debounced Actions with Fake Timers

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAppStore } from '../src/store/useAppStore';
import { DB } from '../src/lib/db';

describe('Debounced Persistence Suite', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.clearAllMocks();
    });

    afterEach(() => {
        useAppStore.getState().resetStore();
        window.localStorage.clear();
        vi.useRealTimers(); // MANDATORY: restore real timers for other tests
    });

    it('debounces rapid saveUserData calls into a single DB write', async () => {
        const saveSpy = vi.spyOn(DB, 'saveUserData').mockResolvedValue(undefined);

        const p1 = useAppStore.getState().saveUserData({ ...mockData, profile: { name: 'V1' } });
        await vi.advanceTimersByTimeAsync(200);

        const p2 = useAppStore.getState().saveUserData({ ...mockData, profile: { name: 'V2' } });
        expect(useAppStore.getState().syncing).toBe(true);

        // Advance past 1000ms debounce threshold asynchronously
        await vi.advanceTimersByTimeAsync(1100);

        await Promise.all([p1, p2]);
        expect(saveSpy).toHaveBeenCalledTimes(1);
        expect(useAppStore.getState().syncing).toBe(false);
    });
});
```

### Recipe 3: Component Rendering with Custom Mock Data & Store State

```typescript
import React from 'react';
import { renderWithProviders, emptyUserData } from './setup';
import TrainingSession from '../src/components/Training/TrainingSession';

it('renders active workout with custom library definitions', () => {
    const mockLibrary = [
        { id: 'ex_bench', name: 'Panca Piana', targetMuscle: 'petto', muscles: ['chest'] }
    ];
    const mockLocalWorkout = {
        id: 'w1',
        routineName: 'Push Day',
        exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '80', reps: '10', done: false }] }]
    };

    const { container } = renderWithProviders(<TrainingSession />, {
        userData: {
            ...emptyUserData,
            library: mockLibrary
        },
        localWorkout: mockLocalWorkout
    });

    expect(container.textContent).toContain('Push Day');
    expect(container.textContent).toContain('Panca Piana');
});
```

### Recipe 4: Testing Dialog Confirm / Cancel Scenarios

```typescript
import { useDialogStore } from '../src/store/useDialogStore';

it('cancels deletion when user rejects confirmation dialog', async () => {
    // Override showConfirm to return false (simulate "Annulla")
    vi.spyOn(useDialogStore.getState(), 'showConfirm').mockResolvedValueOnce(false);

    // Trigger action that requests confirmation
    // ...
    // Verify target item was NOT deleted
});
```

### Recipe 5: Date Calculation & Timezone Edge Case Assertions

```typescript
import { Logic } from '../src/lib/logic';

// 1. Sleep Parsing & Display
expect(Logic.formatSleepTime(7.5)).toBe('07:30');
expect(Logic.formatSleepTime('7.5')).toBe('07:30');
expect(Logic.formatSleepTime('07:30')).toBe('07:30');
expect(Logic.parseSleepInput('25:00')).toBeNull(); // Boundary guard

// 2. Cycle End Date & Timeline Math (Inclusive days)
// Start date + 4 weeks = 28 days inclusive (e.g. 01/08 to 28/08)
const timeline = Logic.calculateCycleTimeline({
    id: 'c1',
    name: 'Cycle',
    durationWeeks: 4,
    startDate: '2026-08-01',
    routines: []
});
expect(timeline.startDate).toBe('2026-08-01');
expect(timeline.endDate).toBe('2026-08-28');
```

---

## 5. Verification Method

To independently verify all findings and test recipes:

1. **Execute Single Suite**:
   ```powershell
   npm.cmd test -- tests/render.test.tsx
   ```
   *Expected outcome*: All 20 tests pass with exit code 0.

2. **Execute Debounce & Error Rejection Suite**:
   ```powershell
   npm.cmd test -- tests/zustand_save.test.ts
   ```
   *Expected outcome*: All 9 tests pass, verifying timer advancing, rejection propagation, and store reset.

3. **Execute Requirements E2E Suite**:
   ```powershell
   npm.cmd test -- tests/e2e_enhancements_r1_r6.test.tsx
   ```
   *Expected outcome*: All tests pass without state bleeding or mock leakage.
