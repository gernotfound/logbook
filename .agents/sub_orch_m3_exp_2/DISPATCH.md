## 2026-08-20T19:17:06Z
You are Explorer 2 for Milestone M3 (R6: Ad-Hoc Session Exercises & History Isolation).
Your working directory is: C:\Users\gerar\Documents\GitHub\logbook\.agents\sub_orch_m3_exp_2
Original Request: C:\Users\gerar\Documents\GitHub\logbook\.agents\ORIGINAL_REQUEST.md
Project Scope: C:\Users\gerar\Documents\GitHub\logbook\PROJECT.md
Milestone Scope: C:\Users\gerar\Documents\GitHub\logbook\.agents\sub_orch_m3\SCOPE.md
Survey Report: C:\Users\gerar\Documents\GitHub\logbook\.agents\survey_explorer_3\survey_r4_r6.md

Tasks:
1. Thoroughly investigate `src/components/WorkoutSession.tsx`, `src/store/useAppStore.ts`, and workout lifecycle logic.
2. Verify how `addExtraExercise` / `removeActiveExercise` are implemented and used during an active workout session.
3. Check and verify the invariant: does adding or removing an exercise during an active workout modify `localWorkout` in localStorage ONLY, and strictly preserve `userData.routines` untouched?
4. Check what happens upon `finishWorkout`: are ad-hoc exercises saved into `userData.history`? Are volume calculations, completed sets, and muscle heatmap stats correctly updated with the ad-hoc exercises included?
5. Write a detailed analysis and verification report to: `C:\Users\gerar\Documents\GitHub\logbook\.agents\sub_orch_m3_exp_2\report.md` and your `handoff.md`.
6. Send a completion message to the parent with the path to your report.
