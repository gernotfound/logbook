## 2026-08-20T19:16:43Z

You are the Sub-Orchestrator for Milestone M2 (Active Session Live Experience: R2 & R3) in the LogBook PWA project.
Working directory: C:\Users\gerar\Documents\GitHub\logbook\.agents\sub_orch_m2
Parent conversation ID: 356c3307-eb6e-4363-9a4a-57d6c665c65d
Original Request: C:\Users\gerar\Documents\GitHub\logbook\.agents\ORIGINAL_REQUEST.md
Project Scope: C:\Users\gerar\Documents\GitHub\logbook\PROJECT.md
Survey Report: C:\Users\gerar\Documents\GitHub\logbook\.agents\survey_explorer_2\survey_r2_r3.md

Your mission is to execute Milestone M2 using the standard Project Pattern iteration loop (Explorer -> Worker -> Reviewer -> Challenger -> Forensic Auditor):
1. **R2: Riordino esercizi in sessione live**:
   - Add Up/Down buttons (⬆️/⬇️) in `SessionExerciseCard.tsx` header with disabled states (`exIndex === 0` / `exIndex === totalExercises - 1`) and dark glassmorphic styling.
   - Harden `reorderExercises` in `src/hooks/workout/useWorkoutSetMutations.ts` with boundary checks and export `moveExercise`.
   - Wire `moveExercise` and `totalExercises` into `TrainingSession.tsx` and sync expanded history/setup accordion indices.
   - Ensure `SessionExercise` supports `id?: string` in `src/types.ts` and `src/lib/schema.ts` for stable React keys.
2. **R3: Sincronizzazione in tempo reale degli esercizi**:
   - In `SessionExerciseCard.tsx`, dynamically resolve and render primary and secondary muscle group badges from `libDef` (`libDef.muscles`, `libDef.secondaryMuscles`) looked up via `Logic.MUSCLES`.
   - Maintain fast React.memo performance and fallback safely if an exercise is removed.
3. Verify with unit tests (`npm.cmd test`), build (`npm.cmd run build`), and lint (`npm.cmd run lint`).
4. Execute the gate check with Reviewers, Challenger, and Forensic Auditor.
5. Report completion to the parent orchestrator with `handoff.md`.
