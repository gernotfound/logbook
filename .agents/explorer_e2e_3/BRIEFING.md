# BRIEFING — 2026-08-20T19:23:30Z

## Mission
Investigate test execution hazards (Zustand state bleeding, localStorage mocking vs jsdom, date/timezone edge cases, React context wrapping, async debouncing/IndexedDB mocking) and provide exact code recipes for test setup and teardown.

## 🔒 My Identity
- Archetype: teamwork_preview_explorer
- Roles: explorer
- Working directory: C:\Users\gerar\Documents\GitHub\logbook\.agents\explorer_e2e_3
- Original parent: d454277a-673b-4223-bb64-0eddd755e22b
- Milestone: E2E Test Execution Hazards Investigation

## 🔒 Key Constraints
- Read-only investigation — do NOT implement application code changes
- Adhere to Teamwork protocol and AGENTS.md rules
- Provide structured 5-component handoff report and exact code recipes

## Current Parent
- Conversation ID: d454277a-673b-4223-bb64-0eddd755e22b
- Updated: 2026-08-20T19:23:30Z

## Investigation State
- **Explored paths**:
  - `src/store/useAppStore.ts` & slice implementations (`createDataSlice.ts`, `createWorkoutSlice.ts`, `createSyncSlice.ts`)
  - `tests/setup.tsx`, `vitest.config.ts`, `tests/render.test.tsx`, `tests/zustand_save.test.ts`, `tests/e2e_enhancements_r1_r6.test.tsx`
  - `src/lib/utils/date.ts`, `src/lib/calc/planning.ts`
  - `src/contexts/AuthContext.tsx`, `src/store/useDialogStore.ts`, `src/components/UI/GlobalDialog.tsx`
  - `src/lib/db.ts`, `idb-keyval` mocking, `DEBOUNCE_DELAY_GLOBAL` (1000ms) & `DEBOUNCE_DELAY_LOCAL` (300ms)
- **Key findings**:
  - Full suite run triggers intermittent 5000ms timeouts on 6 tests when CPU load is high due to 40 concurrent test files; running isolated test files passes with 100% success.
  - Zustand store bleeding occurs if `useAppStore.getState().resetStore()` is omitted, leaving active timeouts (`globalSaveTimer`, `saveTimer`) and pending promises across test boundaries.
  - LocalStorage mock in `setup.tsx` stores data in in-memory object `localStorageStore`; tests must call `window.localStorage.clear()` in `beforeEach`/`afterEach`.
  - Date & timezone hazards: `getLocalDateString()` vs ISO UTC parsing, cycle end date calculation formula (`start + weeks*7 - 1`), sleep format conversion (`HH:MM`, 00:00-23:59 boundary, decimal migration).
  - Context rendering: `renderWithProviders` must properly handle `AuthProvider`'s `loadData` call and `useDialogStore` default resolve values.
  - Async debouncing: testing debounced saves requires `vi.useFakeTimers()` + `await vi.advanceTimersByTimeAsync(...)` + restoring real timers in `afterEach`.
- **Unexplored areas**: None, all 5 target topics thoroughly analyzed and verified with empirical test runs.

## Key Decisions Made
- Formulate standardized `beforeEach`/`afterEach` harness and test helper patterns for test authors.

## Artifact Index
- DISPATCH.md — incoming instructions
- BRIEFING.md — working memory and persistent state
- progress.md — liveness heartbeat
- handoff.md — 5-component handoff report with exact code recipes
