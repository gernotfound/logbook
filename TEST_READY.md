# TEST_READY — Milestone M0: Guest Mode & Global Catalog Resolution

## 1. Milestone Status: READY
The comprehensive opaque-box E2E test suite for Milestone M0 is implemented in `tests/e2e_guest_catalog.test.ts` and ready for execution.

---

## 2. Test Execution Command
```bash
npx.cmd vitest run tests/e2e_guest_catalog.test.ts
```

---

## 3. Coverage Breakdown Across Tiers

| Tier | Scope | Test Count | Passing | Failing (TDD Baseline) |
|---|---|---|---|---|
| **Tier 1** | Feature Coverage (Cold start, seed fallback, specific items, zero-flash transition, flat store contract) | 6 | 6 | 0 |
| **Tier 2** | Boundary & Corner Cases (Corrupted IDB, missing overrides, zero custom items, partial/idempotent overrides, schema resilience) | 6 | 6 | 0 |
| **Tier 3** | Cross-Feature Combinations (Custom exercises/foods, overrides, hidden items, mixed routines/workouts, meal logging & macro math) | 4 | 4 | 0 |
| **Tier 4** | Real-World Scenarios & Cloud Merge Delta Isolation (Full lifecycle, Google linking, Firestore delta isolation, hasUserData, legacy migration) | 5 | 4 | 1 (`T4.1`) |
| **Total** | **All 4 Tiers** | **21** | **20** | **1** |

---

## 4. Implementation Bugs Discovered & Escalated

### Defect Escalation #1: `mergeUserData` does not merge `catalogOverrides`
- **File**: `src/lib/merge.ts` (lines 218–238)
- **Observed Behavior**: `mergeUserData` constructs `rawMerged` without assigning `catalogOverrides`. As a result, when a guest user links a Google account, any catalog overrides or hidden items defined in guest mode (or cloud mode) are lost (`merged.catalogOverrides` evaluates to `undefined`).
- **Test Case**: `T4.1: Full guest lifecycle -> Google linking merges custom data and preserves catalogOverrides`
- **Expected Resolution (Milestone M4)**: `mergeUserData` must merge `catalogOverrides` by merging exercise overrides, food overrides, and unioning hidden exercise/food IDs.

---

## 5. Artifact Index
- `tests/e2e_guest_catalog.test.ts`: Complete 4-tier E2E test suite
- `TEST_INFRA.md`: Test philosophy, architecture, and feature matrix
- `TEST_READY.md`: Test readiness declaration and TDD baseline summary
