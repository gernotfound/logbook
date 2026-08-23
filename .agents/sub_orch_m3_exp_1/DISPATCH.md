## 2026-08-20T19:17:06Z

<USER_REQUEST>
You are Explorer 1 for Milestone M3 (R4: Intelligent Builder in RoutineEditor).
Your working directory is: C:\Users\gerar\Documents\GitHub\logbook\.agents\sub_orch_m3_exp_1
Original Request: C:\Users\gerar\Documents\GitHub\logbook\.agents\ORIGINAL_REQUEST.md
Project Scope: C:\Users\gerar\Documents\GitHub\logbook\PROJECT.md
Milestone Scope: C:\Users\gerar\Documents\GitHub\logbook\.agents\sub_orch_m3\SCOPE.md
Survey Report: C:\Users\gerar\Documents\GitHub\logbook\.agents\survey_explorer_3\survey_r4_r6.md

Tasks:
1. Thoroughly investigate `src/components/RoutineEditor.tsx`, how exercises are currently added to a routine, and how `<select>` or search is implemented.
2. Investigate fuzzy search utilities in the codebase (e.g. `src/lib/calc/search.ts`, `Logic.filterItems`, Fuse.js) and how search is implemented elsewhere (e.g. `ExercisePicker.tsx`, `ExerciseSelector.tsx`, or library search).
3. Specify exact UI/UX design for the intelligent search dropdown in `RoutineEditor.tsx`:
   - Typo-tolerant fuzzy search across exercise name, primaryMuscles, secondaryMuscles, category.
   - Dark glassmorphic popup/dropdown (`--glass-bg`, `--glass-border`, z-index, max-height, scrolling).
   - Touch-friendly on mobile, safe click-outside behavior, ESC key support, keyboard arrow navigation / Enter if applicable.
   - Strict CSS compliance: `font-size: 16px !important` on input to prevent iOS Safari auto-zoom.
   - Sentence case Italian labels/placeholders.
4. Write a detailed analysis and recommendations report to: `C:\Users\gerar\Documents\GitHub\logbook\.agents\sub_orch_m3_exp_1\report.md` and your `handoff.md`.
5. Send a completion message to the parent with the path to your report.
</USER_REQUEST>
