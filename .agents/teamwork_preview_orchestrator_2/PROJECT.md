# Project: Architectural Refactoring Deep Forensic Audit & Verification

## Architecture & Refactoring Scope
Audit and deep verification of recent refactoring across:
- `src/lib/db.ts` (Persistence, DomainParsers usage, 3-month windowing, Save Amnesia bugfix, writeBatch handling)
- `src/lib/schema.ts` (DomainParsers, Zod schemas, fallback resilience, passthrough behavior)
- `src/hooks/useNutritionPlanning.ts` (useMemo logic, dependency arrays, re-render avoidance, UI responsiveness)
- `src/contexts/AuthContext.tsx` (Deterministic guest merge, cloud data loading with local pending mutations, race conditions)
- `src/components/Training/TrainingSession.tsx` (EMPTY_HISTORY_ARRAY memoization, selector stability, render loops)
- `firestore.rules` (Security rules conformance, multi-tenant isolation, no wildcards)
- `AGENTS.md` (Project rules, 5-step checklist, storage tiering, Zod gateway, etc.)

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | DomainParsers Resilience & Fallback | Verify DomainParsers in db.ts and schema.ts don't drop valid user fields or corrupt state | M1 | ORIGINAL_REQUEST §R1 |
| 2 | Save Amnesia & Windowed Loading | Verify save amnesia fix in db.ts commits lastSavedStateStr properly and 3-month windowing doesn't drop historical data | M1 | ORIGINAL_REQUEST §R1 |
| 3 | Deterministic Sync & Race Conditions | Verify AuthContext pending mutations merge and Firestore sync | M1 | ORIGINAL_REQUEST §R1 |
| 4 | React Hooks & Memoization (Performance) | Verify useMemo in useNutritionPlanning.ts and EMPTY_HISTORY_ARRAY in TrainingSession.tsx | M2 | ORIGINAL_REQUEST §R2 |
| 5 | Remediation & Fixes | Worker applies fixes if any regressions/bugs are identified | M3 | Acceptance Criteria |
| 6 | Deep Verification & Forensic Integrity Gate | Reviewers, Challengers, and Forensic Auditor verification | M4 | Acceptance Criteria |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | M1: Exploration & Codebase Survey | Parallel analysis of R1 & R2 by 3 Explorers/Miners | None | IN_PROGRESS |
| 2 | M2: Remediation & Fixes | Worker executes code fixes and runs builds/tests/lints | M1 | PLANNED |
| 3 | M3: Multi-Agent Review & Challenge | 2 Reviewers, 2 Challengers, 1 Forensic Auditor | M2 | PLANNED |
| 4 | M4: Final Synthesis & Handoff | Synthesize findings, verify all criteria, report to caller | M3 | PLANNED |

## Interface Contracts
- `DomainParsers`: Segregated Zod parsers for Profile, Library, Routines, CustomFoods, History, Nutrition, Supplements, Planning, Cycles.
- `DB.loadUserData` & `DB.saveUserData`: Preserves full backward compatibility and handles offline/online transitions.
