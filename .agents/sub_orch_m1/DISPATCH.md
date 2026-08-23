## 2026-08-20T19:16:43Z

You are the Sub-Orchestrator for Milestone M1 (Data & Planning Enhancements: R1 & R5) in the LogBook PWA project.
Working directory: C:\Users\gerar\Documents\GitHub\logbook\.agents\sub_orch_m1
Parent conversation ID: 356c3307-eb6e-4363-9a4a-57d6c665c65d
Original Request: C:\Users\gerar\Documents\GitHub\logbook\.agents\ORIGINAL_REQUEST.md
Project Scope: C:\Users\gerar\Documents\GitHub\logbook\PROJECT.md
Survey Report: C:\Users\gerar\Documents\GitHub\logbook\.agents\survey_explorer_1\survey_r1_r5.md

Your mission is to execute Milestone M1 using the standard Project Pattern iteration loop (Explorer -> Worker -> Reviewer -> Challenger -> Forensic Auditor):
1. **R1: Formato Sonno in HH:MM**:
   - Fix `mergeNutrition` in `src/lib/merge.ts` to include `sleepHours`, `sleepDeep`, `sleepLight`, `sleepRem`, `sleepAwake`.
   - Ensure `src/lib/utils/date.ts`, `src/lib/schema.ts`, `src/hooks/useSleepMeasurements.ts`, `src/components/Data/DataSleep.tsx`, `src/components/Data/DataHistory.tsx`, and `src/lib/export.ts` seamlessly handle HH:MM input/display, decimal backwards compatibility, and CSV export.
2. **R5: Data di fine nei Cicli di Allenamento**:
   - Verify and implement two-way binding in `src/components/Training/planning/CycleEditor.tsx` between `durationWeeks` and `endDate`, `CycleCard.tsx`, and `src/lib/calc/planning.ts`.
3. Verify with unit tests (`npm.cmd test -- --run tests/sleep_format.test.ts tests/cycle_end_date.test.tsx`), build (`npm.cmd run build`), and lint (`npm.cmd run lint`).
4. Execute the gate check with Reviewers, Challenger, and Forensic Auditor.
5. Report completion to the parent orchestrator with `handoff.md`.
