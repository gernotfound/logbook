# Project Execution Plan

## Objectives
Deliver R1 through R6 in LogBook with high engineering rigor:
- R1: Bodyweight & Equipment Volume Calc (`isBodyweight`, `equipmentWeight`, `src/lib/calc/workout.ts`, UI in Library/Exercise forms, schema).
- R2: Real-time Calorie calculation in Custom Foods (`Carbo*4 + Pro*4 + Grassi*9`).
- R3: Date selector in Measurements view (top of card, aligned with Meals/Supplements).
- R4: Vertical alignment of special set button (dropset/isometry "+") in `SessionSetRow.tsx`.
- R5: DOMS tracking UI in Home and Session completion view (`activePains` in UserData / state, SVG mannequin integration).
- R6: DOMS auto-healing logic upon session completion.

## Architectural Requirements
1. Strictly follow AGENTS.md.
2. 5-step checklist for `UserData` changes (`types.ts`, `schema.ts`, `db.ts`, `AuthContext.tsx`, `export.ts`).
3. Zod runtime validation with defensive fallback helpers.
4. Offline resilience and storage tiering (IndexedDB `idb-keyval`, synchronous `localStorage`).
5. Italian sentence case across all UI texts.
6. Dark glassmorphism consistency.
7. Automated testing with Vitest, build check with `npm run build`, lint with `npm run lint`.

## Execution Phases
1. **Survey (Explorers x3)**: Map files, existing state/schemas, component structures, test files.
2. **Decomposition & Test Track**: Define E2E/Unit test matrix and architecture in `PROJECT.md`.
3. **Implementation & Verification**: Run workers, reviewers, challengers, and auditors with gate enforcement.
4. **Final Acceptance**: Ensure 100% test pass, clean build, clean lint, clean audit.
