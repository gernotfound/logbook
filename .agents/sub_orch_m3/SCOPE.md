# SCOPE — Milestone M3: Intelligent Builder & Ad-Hoc Session

## Architecture
- Target Components:
  - `src/components/RoutineEditor.tsx` (R4)
  - `src/components/WorkoutSession.tsx`, `src/store/useAppStore.ts` (R6)
  - `src/lib/calc/search.ts` / `src/lib/utils/` / `Logic.filterItems` (Fuse.js)
  - CSS styling in `src/styles/global.css` or component-level styles.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| R4 | Intelligent Builder Search | Fuzzy search dropdown popup in RoutineEditor.tsx replacing static `<select>` | M3 | survey_r4_r6.md / ORIGINAL_REQUEST |
| R6 | Ad-Hoc Session Exercises | Extra exercises added/removed in live workout mutating only `localWorkout` and properly tracked in history | M3 | survey_r4_r6.md / ORIGINAL_REQUEST |

## Milestones & Tasks
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M3.1 | Survey & Technical Exploration | Deep investigation of RoutineEditor, Fuse.js / Logic.filterItems, and Session ad-hoc actions | none | IN_PROGRESS |
| M3.2 | Worker Implementation & Tests | Implement UI & verify ad-hoc session logic, ensure unit tests pass | M3.1 | PLANNED |
| M3.3 | Independent Reviews | Reviewers evaluate code quality, UX, styling, sentence case | M3.2 | PLANNED |
| M3.4 | Adversarial Challengers | Stress test search dropdown (special chars, mobile events) and session history immutability | M3.2 | PLANNED |
| M3.5 | Forensic Audit & Gate | Forensic integrity check & gate sign-off | M3.3, M3.4 | PLANNED |

## Interface Contracts & Constraints
- RoutineEditor fuzzy search must use `Logic.filterItems` or Fuse.js with keys `['name', 'primaryMuscles', 'secondaryMuscles', 'category']`.
- Search input MUST have `font-size: 16px !important` on mobile/inputs to prevent iOS Safari auto-zoom.
- Dropdown must float cleanly with glassmorphic styling (`--glass-bg`, `--glass-border`), touch-friendly on mobile, close on outside click / Esc / selection.
- Sentence case in Italian for all labels/placeholders (e.g. "Cerca esercizio da aggiungere...", "Aggiungi esercizio").
- Ad-hoc exercises in session (`addExtraExercise`, `removeActiveExercise`):
  - Must mutate `localWorkout` in `useAppStore` / `localStorage['logbook_local_workout']`.
  - Must NEVER mutate `userData.routines`.
  - When workout is completed, must be saved to `userData.history` and contribute properly to volume, sets, and muscle heatmap.
