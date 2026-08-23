## 2026-08-20T15:15:01Z

Investigate the codebase for Requirement R4 and overall architectural compliance:
1. R4: Ricerca intelligente per l'aggiunta in Scheda (Fuzzy search text field with dropdown in RoutineEditor to add exercises from library).
   - Find `RoutineEditor.tsx`, `RoutineExerciseList.tsx`, or related routine builder components.
   - Inspect how exercises are currently added to routines.
   - Inspect existing fuzzy search usage in the project (e.g. `fuse.js` or `filteredMuscles` patterns) and dark glassmorphism styling patterns (`src/styles/global.css`, dropdown styles).
2. Architectural & AGENTS.md Compliance Survey:
   - Check the 5-step checklist in AGENTS.md for new fields/types.
   - Check test framework setup (`vitest`, existing test suites in `src/**/__tests__` or similar).
   - Check build and lint commands (`npm run build`, `npm run lint`).
   - Identify existing UI and styling conventions (Vanilla CSS, CSS custom properties, sentence case in Italian, `min-width: 0`, mobile UX).
