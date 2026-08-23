## 2026-08-20T15:18:50Z
You are the Worker for Milestone 1 (Sleep Format in HH:MM - Requirement R1) of the LogBook PWA enhancements project.
Working directory: C:\Users\gerar\Documents\GitHub\logbook\.agents\teamwork_preview_worker_m1
Original Request: C:\Users\gerar\Documents\GitHub\logbook\.agents\ORIGINAL_REQUEST.md
Project Scope: C:\Users\gerar\Documents\GitHub\logbook\PROJECT.md
Architecture Bible: C:\Users\gerar\Documents\GitHub\logbook\AGENTS.md
Explorer 1 Report: C:\Users\gerar\Documents\GitHub\logbook\.agents\teamwork_preview_explorer_survey_1\handoff.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Scope & Files Owned Exclusively:
- `src/lib/utils/date.ts`: Add `formatSleepTime(val: number | string | undefined | null): string`, `parseSleepInput(val: string): string | null`, and `isSleepTimeValid(val: string): boolean`. Ensure backward compatibility (e.g. 7.5 -> "07:30", "08:30" -> "08:30", 1.25 -> "01:15").
- `src/lib/logic.ts`: Export sleep helpers under `Logic`.
- `src/lib/schema.ts`: Implement `safeOptionalSleepTime()` in `NutritionDaySchema` for `sleepHours`, `sleepDeep`, `sleepLight`, `sleepRem`, `sleepAwake` to parse and format incoming values into standard `"HH:MM"` while converting legacy decimal numbers.
- `src/hooks/useSleepMeasurements.ts`: Update state initialization and saving logic to handle `HH:MM` strings, validate with `isSleepTimeValid`, and use sentence case for alerts.
- `src/components/Data/DataSleep.tsx`: Update input fields to time/formatted text with placeholder="07:30" or input type="time", with 16px font-size, and convert all labels to Italian sentence case (e.g. "Ore sonno (totali) *", "Dettagli fasi (opzionali)", "Sonno profondo", "Sonno leggero", "Sonno REM", "Tempo sveglio").
- `src/components/Data/DataHistory.tsx`: Display `🌙 Sonno: {Logic.formatSleepTime(day.sleepHours)}`.
- `src/lib/export.ts`: Format sleep values appropriately in CSV export.
- Unit tests: Add tests in `src/lib/logic.test.ts` or `tests/sleep_format.test.ts`.

Verification Commands:
Run `npm.cmd test`, `npm.cmd run build`, and `npm.cmd run lint`. All must pass cleanly with 0 errors.

Output:
Write handoff report to `C:\Users\gerar\Documents\GitHub\logbook\.agents\teamwork_preview_worker_m1\handoff.md`.
Send a message back when done.
