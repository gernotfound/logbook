# Project Plan: Cloud Firestore Security and Stability Audit

## Architecture Overview
- Target App: LogBook PWA (React 19, TypeScript, Vite, Firebase SDK v12 modular).
- Target Deliverable Directory: `c:\Users\gerar\teamwork_projects\logbook_firebase_audit`.
- Target Source Code Repo: `c:\Users\gerar\Documents\GitHub\logbook` (Read-only, no modifications).

## Feature Inventory
| # | Feature / Requirement | Description | Assigned Milestone | Source |
|---|----------------------|-------------|-------------------|--------|
| 1 | R1: Rules Evaluation | Evaluate `request.auth.uid == userId` with `{document=**}`, owner-only model, absence of `get()`/`exists()` | M1, M4 | ORIGINAL_REQUEST.md §R1 |
| 2 | R1: 400-doc Batch Compatibility | Verify zero rule call limits impact during 400-doc deleteAccount batch | M1, M4 | ORIGINAL_REQUEST.md §R1 |
| 3 | R2: `src/lib/db.ts` Compatibility | Check `getDoc` on `users/{uid}`, monthly subcollections, `getDocs` during deleteAccount, and `writeBatch` sets/deletes | M1, M4 | ORIGINAL_REQUEST.md §R2 |
| 4 | R3: Emulator Test Infrastructure | Setup `@firebase/rules-unit-testing`, `firebase.json` for Firestore emulator, vitest/mocha test harness | M2 | ORIGINAL_REQUEST.md §R3, §R4 |
| 5 | R3: Security Smoke Tests | Fail-fast tests verifying anonymous and cross-tenant rejections before running suite | M3 | ORIGINAL_REQUEST.md §Acceptance Criteria |
| 6 | R3: Auth & Identity Testing | Distinct UIDs, special characters (hyphens, underscores), unauthenticated tokens | M3 | ORIGINAL_REQUEST.md §R3 |
| 7 | R3: CRUD Matrix | `get`, `list`, `create`, `update`, `delete` for owner vs non-owner vs anon across all paths | M3 | ORIGINAL_REQUEST.md §R3 |
| 8 | R3: Data Regression & Realistic Fixtures | Fixtures matching full state sets by `DB.saveUserData` | M3 | ORIGINAL_REQUEST.md §R3 |
| 9 | R3: Atomic Batch & Isolation Tests | Full multi-doc owner batch pass, single-cross-tenant batch failure with atomic rollback verification | M3 | ORIGINAL_REQUEST.md §R3 |
| 10 | R3: Outside Collections Denial | Ensure any document outside `/users/{uid}/...` is strictly denied | M3 | ORIGINAL_REQUEST.md §R3 |
| 11 | R4: Repeatable Execution & Config | `firebase.json`, `firebase emulators:exec` configuration and script validation | M2, M3 | ORIGINAL_REQUEST.md §R4 |
| 12 | R4: Rule Coverage Report | Generate coverage metrics for all rule lines, match statements, and branches | M4 | ORIGINAL_REQUEST.md §R4 |
| 13 | R4: Security Audit & Rollout/Rollback Playbook | Comprehensive audit report with IAM vs Client SDK distinction, rollout/rollback steps | M4 | ORIGINAL_REQUEST.md §R4 |
| 14 | Quality & Adversarial Verification | Challengers, Reviewers, and Forensic Auditor verification of tests and reports | M5 | System Protocol |

## Milestones & Execution Plan
1. **Milestone 1: Technical Survey & Architecture Analysis** (Explorers)
2. **Milestone 2: Test Environment & Emulator Setup** (Worker)
3. **Milestone 3: Comprehensive Test Matrix Implementation** (Test Writer / Worker)
4. **Milestone 4: Security Audit & Rule Coverage Report** (Worker)
5. **Milestone 5: Verification, Adversarial Stress Testing & Audit** (Challengers, Reviewers, Forensic Auditor)
6. **Milestone 6: Final Synthesis & Sentinel Report** (Orchestrator)
