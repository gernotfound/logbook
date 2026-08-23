## 2026-08-20T15:27:25Z

You are the Worker for Milestone 2 (Training Cycles End Date & Two-Way Binding - Requirement R5) of the LogBook PWA enhancements project.
Working directory: C:\Users\gerar\Documents\GitHub\logbook\.agents\teamwork_preview_worker_m2
Original Request: C:\Users\gerar\Documents\GitHub\logbook\.agents\ORIGINAL_REQUEST.md
Project Scope: C:\Users\gerar\Documents\GitHub\logbook\PROJECT.md
Architecture Bible: C:\Users\gerar\Documents\GitHub\logbook\AGENTS.md
Explorer 1 Report: C:\Users\gerar\Documents\GitHub\logbook\.agents\teamwork_preview_explorer_survey_1\handoff.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Scope & Files Owned Exclusively:
- `src/types.ts`: Add `endDate?: string;` to `TrainingCycle` interface.
- `src/lib/schema.ts`: Add `endDate: safeOptionalString()` to `TrainingCycleSchema`.
- `src/components/Training/planning/CycleEditor.tsx`:
  - Add "Data di fine" selector/indicator below or alongside "Data di inizio".
  - Implement two-way binding:
    * If the user changes `durationWeeks` -> calculate and update `endDate`.
    * If the user changes `endDate` -> calculate and update `durationWeeks` (`Math.max(1, Math.round((diffDays + 1) / 7))`).
    * If the user changes `startDate` -> update `endDate` keeping `durationWeeks` intact.
  - Include `endDate` in `handleSave` payload passed to `onSave`.
  - Ensure all labels and buttons use Italian sentence case (e.g. "Data di fine", "Durata (settimane)").
  - Ensure inputs have 16px font-size to prevent iOS Safari auto-zoom.
- `src/lib/calc/planning.ts`: Verify `calculateCycleTimeline` and `calculateCycleSchedule` properly handle `cycle.endDate`.
- Add/update unit and integration tests in `tests/training_planning.test.tsx` or new `tests/cycle_end_date.test.ts`.

Verification Commands:
Run `npm.cmd test`, `npm.cmd run build`, and `npm.cmd run lint`. All must pass cleanly with 0 errors.

Output:
Write handoff report to `C:\Users\gerar\Documents\GitHub\logbook\.agents\teamwork_preview_worker_m2\handoff.md`.
Send a message back when done.
