# Project Plan — LogBook Firestore Deletion & AppCheck Fixes

## Objectives
1. Identify and resolve root cause of "Missing or insufficient permissions" when deleting workout sessions in Firestore.
2. Fix AppCheck initialization and warning logic when `VITE_RECAPTCHA_V3_SITE_KEY` is absent or unsupported, ensuring clean fallback and no broken subsequent Firestore operations.
3. Write automated unit/integration tests covering workout deletion, security rules/queries, and AppCheck fallback.
4. Verify complete test suite (`npm test`), build (`npm run build`), and lint (`npm run lint`).

## Phase 0: Survey & Technical Investigation
- Dispatch 3 Explorers:
  1. `teamwork_preview_explorer` (Explorer 1): Codebase exploration of workout deletion flow in UI (`SessionExerciseCard`, `HistoryView`, etc.), Store (`useAppStore`), and DB layer (`src/lib/db.ts`, `src/lib/firebase.ts`, Firestore rules if present).
  2. `teamwork_preview_explorer` (Explorer 2): Codebase exploration of AppCheck initialization, config, fallback in `src/lib/firebase.ts` or related files, and error handling.
  3. `teamwork_preview_spec_miner` (Spec Miner 1): Examination of Firestore security rules, subcollection structure (`history_months`), document deletion permissions, and testing infrastructure in `vitest`.

## Phase 1: Architecture & Decomposition
- Synthesize explorer findings.
- Produce `PROJECT.md` with Feature Inventory, Milestones, Interface Contracts, and Code Layout.

## Phase 2: Execution Track & E2E Testing Track
- Implementation Track: Worker fixes deletion logic and AppCheck fallback.
- Review & Verification Track: Reviewers, Challengers, and Forensic Auditor.
- Testing: Comprehensive automated test coverage.

## Phase 3: Final Verification & Delivery
- All tests passing (`npm test`), clean build (`npm run build`), clean lint (`npm run lint`).
- Human report generation.
