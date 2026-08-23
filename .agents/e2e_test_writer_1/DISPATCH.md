## 2026-08-22T07:38:55Z
You are e2e_test_writer_1.
Your working directory is C:\Users\gerar\Documents\GitHub\logbook\.agents\e2e_test_writer_1.
Read the authoritative user request at C:\Users\gerar\Documents\GitHub\logbook\.agents\ORIGINAL_REQUEST.md, test plan at C:\Users\gerar\Documents\GitHub\logbook\TEST_INFRA.md, project plan at C:\Users\gerar\Documents\GitHub\logbook\PROJECT.md, project rules at C:\Users\gerar\Documents\GitHub\logbook\AGENTS.md, and survey report at C:\Users\gerar\Documents\GitHub\logbook\.agents\survey_explorer_3\handoff.md.

File Ownership:
You exclusively own and modify:
- `tests/sync_indicator_and_toast.test.tsx`
- `TEST_READY.md` (at project root)
DO NOT modify any `src/` files.

Tasks:
1. Create a comprehensive 4-Tier test suite in `tests/sync_indicator_and_toast.test.tsx` using Vitest and `@testing-library/react`:
   - **Tier 1: Feature Coverage (≥5 tests per feature, R1, R2, R3)**:
     - Verify `#sync-overlay` is completely absent from DOM in all states (`syncing: false` and `syncing: true`).
     - Verify `.sync-indicator` renders with "Salvataggio in corso..." in bottom-right when `syncing === true`.
     - Verify `.sync-indicator` unmounts when `syncing` transitions to `false`.
     - Verify `.sync-error-toast` renders with error message and danger styling when `saveError` is set.
     - Verify `.sync-error-toast` unmounts when `saveError` is `null`.
   - **Tier 2: Boundary & Corner Cases (≥5 tests per feature)**:
     - Rapid toggling of `syncing` (true -> false -> true).
     - Rapid updates to `saveError` resetting the 5s auto-dismiss timer.
     - Coexistence of `syncing === true` and `saveError !== null` without DOM or style collisions.
     - Auto-dismissal after 5000ms verified with fake timers (`vi.useFakeTimers()` / `vi.advanceTimersByTime(5100)`).
     - Manual dismissal via `✕` close button immediately clearing `saveError`.
     - `online` event firing clearing `saveError`.
     - Component unmount timer cleanup (no unmounted state errors).
   - **Tier 3: Cross-Feature Combinations (≥5 tests)**:
     - Active workout: user can click buttons, type weights/reps without UI being blocked while `syncing === true`.
     - Tab navigation: switching between Home, Training, Nutrition, Data, Settings tabs while `syncing === true` remains instant and preserves `.sync-indicator`.
     - PWA reload prompt and sync indicator coexistence.
   - **Tier 4: Real-World Application Workloads (≥5 tests)**:
     - Underground gym workout logging with spotty connection and auto-dismiss error recovery.
     - Rapid nutrition multi-item logging with debounced sync.
     - Workout completion while background sync runs.
2. Run `npm.cmd test -- tests/sync_indicator_and_toast.test.tsx` to verify that all tests execute and pass.
3. Publish `TEST_READY.md` at project root with the test runner command and full tier summary.
4. Write your report to `C:\Users\gerar\Documents\GitHub\logbook\.agents\e2e_test_writer_1\handoff.md` and send a message when done.
