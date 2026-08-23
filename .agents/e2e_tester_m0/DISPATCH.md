# DISPATCH

## 2026-08-23T07:41:14Z
You are the E2E Test Writer for Milestone M0.
Working directory: C:\Users\gerar\Documents\GitHub\logbook\.agents\e2e_tester_m0
Original Request: C:\Users\gerar\Documents\GitHub\logbook\.agents\ORIGINAL_REQUEST.md
Architecture Bible: C:\Users\gerar\Documents\GitHub\logbook\AGENTS.md
Project Plan: C:\Users\gerar\Documents\GitHub\logbook\PROJECT.md
Project Root: C:\Users\gerar\Documents\GitHub\logbook

Your mission:
Design and implement a comprehensive opaque-box E2E test suite for guest mode & global catalog resolution in `tests/e2e_guest_catalog.test.ts`:
1. Read ORIGINAL_REQUEST.md, AGENTS.md, and PROJECT.md carefully.
2. Build test cases covering all 4 tiers:
   - Tier 1: Feature Coverage (Guest cold start with empty IDB/localStorage, immediate presence of standard exercises and foods, verification of specific known items e.g. "Panca piana bilanciere" / "Petto di pollo", non-blocking sync).
   - Tier 2: Boundary & Corner cases (Empty cache, corrupted cache, missing catalogOverrides, zero custom items, partial/empty overrides).
   - Tier 3: Cross-feature combinations (Guest creates custom exercise, overrides a standard food macro, hides an exercise, completes a workout).
   - Tier 4: Real-world scenarios (Full guest lifecycle -> creating custom items -> Google account linking / merge -> verify cloud data contains ONLY deltas without 176+ seed duplicates and preserves all guest overrides/custom data).
3. Create `TEST_INFRA.md` at project root describing test philosophy, feature matrix, and runner commands.
4. Run your tests with `npm.cmd test tests/e2e_guest_catalog.test.ts` (or `npx.cmd vitest run tests/e2e_guest_catalog.test.ts`). Note that some tests might fail initially until workers implement the fixes — that is expected for TDD!
5. When complete, create `TEST_READY.md` at project root summarizing the test runner and coverage breakdown across tiers.
6. Write your handoff report to `C:\Users\gerar\Documents\GitHub\logbook\.agents\e2e_tester_m0\handoff.md`.

Send a completion message when finished.
