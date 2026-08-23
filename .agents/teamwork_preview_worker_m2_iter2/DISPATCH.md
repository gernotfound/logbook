## 2026-08-20T15:40:17Z
You are a Worker for Milestone 2 (Training Cycles End Date & Two-Way Binding - Requirement R5) Iteration 2 in the LogBook project.

Your working directory: C:\Users\gerar\Documents\GitHub\logbook\.agents\teamwork_preview_worker_m2_iter2

Read these files before starting work:
- C:\Users\gerar\Documents\GitHub\logbook\.agents\ORIGINAL_REQUEST.md
- C:\Users\gerar\Documents\GitHub\logbook\AGENTS.md
- C:\Users\gerar\Documents\GitHub\logbook\PROJECT.md
- C:\Users\gerar\Documents\GitHub\logbook\.agents\orchestrator\DEAD_ENDS.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Task:
Fix the defect in `src/components/Training/planning/CycleEditor.tsx`:
In `handleEndCalendarDateChange(val: string)`, line 171 errantly called `setDateTextInput(Logic.formatItalianDate(val));`, which overwrites the Start Date text input with the End Date when the user selects an End Date from the calendar picker.
Remove that line (or ensure only `setEndDateTextInput` is updated appropriately for the end date, while start date state is untouched).
Check `handleEndCalendarDateChange` and ensure clean two-way binding behavior:
When the user picks an End Date:
1. `setEndDate(val)` is updated.
2. `setEndDateTextInput(Logic.formatItalianDate(val))` is updated.
3. If `startDate` exists, calculate new duration in weeks: `Logic.calculateWeeksBetween(startDate, val)` and update `setDurationWeeks(weeks)`.
4. Do NOT touch `dateTextInput` / `startDate`!

Write ownership:
- You own `src/components/Training/planning/CycleEditor.tsx`.

Verification commands:
- Run `npm.cmd test -- tests/challenger_cycle_editor_interaction.test.tsx`
- Run `npm.cmd test -- tests/cycle_end_date.test.tsx`
- Run `npm.cmd test -- tests/e2e_enhancements_r1_r6.test.tsx`
- Run `npm.cmd test`
- Run `npm.cmd run build`
- Run `npm.cmd run lint`

Deliver your findings and verification logs in `C:\Users\gerar\Documents\GitHub\logbook\.agents\teamwork_preview_worker_m2_iter2\handoff.md` and send a message when done.
