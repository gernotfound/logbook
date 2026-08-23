# BRIEFING — 2026-08-20T19:22:00Z

## Mission
Investigate RoutineEditor.tsx, exercise search mechanisms, fuzzy search utilities, and specify the UI/UX design for R4 Intelligent Search dropdown in RoutineEditor.

## 🔒 My Identity
- Archetype: explorer
- Roles: explorer, synthesizer
- Working directory: C:\Users\gerar\Documents\GitHub\logbook\.agents\sub_orch_m3_exp_1
- Original parent: 21178701-31fe-4e51-9ea3-1b9e0e523323
- Milestone: M3 (R4: Intelligent Builder in RoutineEditor)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement code modifications in source files
- Adhere strictly to AGENTS.md rules (sentence case Italian, dark glassmorphism, no tailwind, mobile-friendly font-size: 16px on inputs)
- Output detailed report in `report.md` and `handoff.md`

## Current Parent
- Conversation ID: 21178701-31fe-4e51-9ea3-1b9e0e523323
- Updated: 2026-08-20T19:17:06Z

## Investigation State
- **Explored paths**:
  - `src/components/Training/routines/RoutineEditor.tsx`
  - `src/hooks/useTrainingRoutines.ts`
  - `src/lib/calc/workout.ts` (`filterItems`, `searchRoutines`)
  - `src/hooks/useTrainingExercises.ts` (`filteredMuscles`, `normalizeStem`)
  - `src/lib/calc/nutrition.ts` (`searchFoods`)
  - `src/lib/constants/muscles.ts` (`MUSCLES`, `GROUP_MAP`)
  - `src/lib/calc/planning.ts` (`getDetailedMuscleCategory`)
  - `src/styles/global.css` (dark glassmorphic tokens, inputs, badges)
- **Key findings**:
  - `RoutineEditor.tsx` uses a static `<select>` without search or muscle metadata.
  - `Fuse.js` is bundled and active across `workout.ts`, `nutrition.ts`, and `useTrainingExercises.ts`.
  - Rich multi-field search can be built mapping `primaryMuscles` and `secondaryMuscles` to Italian names and categories with typo tolerance (`threshold: 0.38`).
  - Dark glassmorphic dropdown popup design specified with touch-friendly mobile controls, click-outside dismissal, ESC/arrow navigation, and `font-size: 16px !important`.
- **Unexplored areas**: none (investigation complete).

## Key Decisions Made
- Recommending `ExerciseSearchDropdown` component architecture for modularity and testability.
- Outlined exact search scoring model (direct matches $\rightarrow$ token matching $\rightarrow$ fuzzy Fuse.js).
- Provided complete technical report and handoff specifications.

## Artifact Index
- DISPATCH.md — incoming instructions log
- progress.md — liveness heartbeat and task progress
- report.md — complete analysis and UI/UX specification for R4 Intelligent Search
- handoff.md — 5-component handoff report
