# Handoff Report: E2E Test Setup & 4-Tier Test Architecture Investigation

## 1. Observation
- **Test Runner & Configuration:**
  - `vitest.config.ts` (lines 1-16) configures Vitest with `react()`, `VitePWA({ registerType: 'prompt' })`, `environment: 'jsdom'`, `globals: true`, and `setupFiles: ['./tests/setup.tsx']`.
  - `package.json` (lines 11, 31, 36, 41) defines `"test": "vitest run"`, with Vitest v4.1.10, `@testing-library/react` v16.3.2, and `jsdom` v29.1.1.
- **Global Setup & Mocking (`tests/setup.tsx`):**
  - Lines 8-12: Mocks `window.scrollTo`, `window.alert`, `window.confirm`.
  - Lines 15-19: Mocks `ResizeObserver`.
  - Lines 22-43: Mocks `useDialogStore` with Zustand `showAlert` and `showConfirm` implementations.
  - Lines 57-87: Mocks `HTMLCanvasElement.prototype.getContext` to support Chart.js without canvas crashes.
  - Lines 90-105: Mocks synchronous `window.localStorage` with in-memory map `localStorageStore`.
  - Lines 108-120: Mocks asynchronous `idb-keyval` with in-memory map `idbStore`.
  - Lines 132-174: Mocks Firebase modular SDK (`firebase/app`, `firebase/auth`, `firebase/firestore`).
  - Lines 177-187: Mocks `DB` module (`loadUserData`, `saveUserData`, `secureLogOut`, `deleteAccount`).
  - Lines 242-262: Exports `renderWithProviders(ui, options)` wrapping components in `<AuthProvider>` and hydrating `useAppStore`.
- **State Management & Test Lifecycle (`src/store/useAppStore.ts` & slices):**
  - `src/store/slices/createSyncSlice.ts` (lines 100-119): Implements `resetStore()` which cancels active timers (`clearWorkoutTimer()`, `clearSyncTimers()`), purges `localStorage['logbook_local_workout']`, clears `idbStore`, and resets Zustand state.
- **Existing E2E Test Suite (`tests/e2e_enhancements_r1_r6.test.tsx`):**
  - 2161 lines of code containing 70 comprehensive test cases spanning:
    - **Tier 1 (Feature Coverage):** 30 tests (5 per requirement R1 to R6).
    - **Tier 2 (Boundary & Corner Cases):** 30 tests (5 per requirement R1 to R6).
    - **Tier 3 (Cross-Feature Combinations):** 6 tests (T3.1 to T3.6).
    - **Tier 4 (Real-World Workload Scenarios):** 4 tests (T4.1 to T4.4).
- **Execution Verification:**
  - Running `npm.cmd test` executed 40 test files (746 tests total), passing 100% with exit code 0.
  - Running `npm.cmd test tests/e2e_enhancements_r1_r6.test.tsx` passed all 70 tests in 21.5s with exit code 0.

---

## 2. Logic Chain
1. **Runner and Framework Fit:** Vitest with jsdom provides sub-second compilation via Vite transforms, full React 19 component rendering through `@testing-library/react`, and custom hook execution via `renderHook`.
2. **State Isolation Guarantee:** Because Zustand maintains singletons in memory and schedules background save debouncers (1000ms global, 300ms local), test suites MUST execute `useAppStore.getState().resetStore()`, `window.localStorage.clear()`, and `vi.clearAllMocks()` in both `beforeEach` and `afterEach`. This prevents state leakage across test cases.
3. **Async / Timer Discipline:** Testing components that trigger debounced saves (e.g. `saveSleep`, `useWorkoutSetMutations`, `endWorkout`) requires wrapping mutations and assertions in `act(async () => ...)` or `await vi.waitFor(...)` to ensure timers settle before unmounting.
4. **4-Tier Structure Alignment:**
   - **Tier 1 (Coverage):** Verifies basic happy-path requirements (R1: sleep format HH:MM; R2: live reordering; R3: live library sync; R4: fuzzy search; R5: cycle end-date two-way binding; R6: ad-hoc session exercises).
   - **Tier 2 (Boundary/Edge Cases):** Verifies resilience against corrupted formats, single-exercise limits, regex injection, multi-year timeline rollovers, and empty list edge cases.
   - **Tier 3 (Pairwise/Cross-Feature):** Validates interactions where multiple features operate in tandem (e.g. adding ad-hoc exercise + live reorder + real-time library rename + CSV export).
   - **Tier 4 (Real-World Gym Scenarios):** Emulates authentic multi-step user workflows (e.g. pivoting when gym equipment is busy, adding finishers, multi-week mesocycle setup, weekly recovery biometrics).

---

## 3. Caveats
- Windows PowerShell blocks running raw `npm test` when script execution policy is restricted (`PSSecurityException`). Always invoke `npm.cmd test` or `npx.cmd vitest run` in Windows environments.
- In React 19 / RTL 16, async state updates triggered inside component callbacks should be wrapped in `act(...)` or awaited with `waitFor` to prevent React act warnings in test logs.
- No source code modifications were made during this investigation; all observations and findings are purely read-only.

---

## 4. Conclusion & Recommendations
1. **Suite Organization:** The 4-Tier E2E test suite in `tests/e2e_enhancements_r1_r6.test.tsx` is already fully structured, comprehensive (70 tests across Tiers 1-4), and executes cleanly under `npm.cmd test`.
2. **Execution Strategy:**
   - Run full regression: `npm.cmd test` (runs all 40 test files / 746+ tests).
   - Run targeted E2E enhancement suite: `npm.cmd test tests/e2e_enhancements_r1_r6.test.tsx`.
3. **Expansion Strategy for Tier 4:** To reach ≥5 Tier 4 scenarios (from current 4 to 5), an additional scenario TC4.5 ("Equipment Availability Pivot & Cardio Addition" or "Offline Multi-Day Recovery & Sync") can be added seamlessly within the `Tier 4: Real-World Workload Scenarios` describe block.
4. **Test Authoring Rules for Future Tests:**
   - Always import `{ renderWithProviders, emptyUserData } from './setup'`.
   - Always reset Zustand store: `useAppStore.getState().resetStore()`.
   - Use `Logic.getLocalDateString()` for local timezone dates rather than raw UTC `toISOString()`.
   - For dialog confirmation interactions, ensure `useDialogStore` / `showConfirm` is mocked to resolve `true`.

---

## 5. Verification Method
To independently verify the test infrastructure and suite execution:

```powershell
# 1. Run the dedicated 4-tier E2E test suite
npm.cmd test tests/e2e_enhancements_r1_r6.test.tsx

# 2. Run the entire test suite across all 40 files
npm.cmd test

# 3. Verify TypeScript build and Vite packaging
npm.cmd run build

# 4. Verify code quality and styling
npm.cmd run lint
```
