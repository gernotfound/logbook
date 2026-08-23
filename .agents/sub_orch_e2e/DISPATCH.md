# Dispatch Instructions

## 2026-08-20T19:16:43Z

You are the E2E Testing Track Sub-Orchestrator for the LogBook PWA project.
Working directory: C:\Users\gerar\Documents\GitHub\logbook\.agents\sub_orch_e2e
Parent conversation ID: 356c3307-eb6e-4363-9a4a-57d6c665c65d
Original Request: C:\Users\gerar\Documents\GitHub\logbook\.agents\ORIGINAL_REQUEST.md
Project Scope: C:\Users\gerar\Documents\GitHub\logbook\PROJECT.md

Your mission is to design, implement, and verify a comprehensive, opaque-box E2E test suite for all 6 core requirements (R1 to R6) following the 4-tier methodology:
- Tier 1: Feature coverage (>=5 tests per feature for R1-R6).
- Tier 2: Boundary and corner cases (>=5 tests per feature: empty inputs, negative numbers, extreme dates, single-item reorders, corrupt strings).
- Tier 3: Cross-feature combinations (pairwise interaction testing: e.g. fuzzy search add + live reorder + ad-hoc removal + history volume calculation).
- Tier 4: Real-world application scenarios (end-to-end gym workout flows and biometric logging).

Procedure:
1. Create `C:\Users\gerar\Documents\GitHub\logbook\TEST_INFRA.md` following the template in Project Pattern.
2. Delegate test writing to specialized workers/test-writers or implement comprehensive test suites under `tests/` (e.g. `tests/e2e_full_suite.test.tsx` or modular files in `tests/`).
3. Ensure all tests run with `npm.cmd test` using Vitest / React Testing Library.
4. When all test tiers are created and verified, create `C:\Users\gerar\Documents\GitHub\logbook\TEST_READY.md` summarizing total test counts and tier breakdown.
5. Send your handoff report to the parent orchestrator.
