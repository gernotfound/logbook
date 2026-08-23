# Scope: Milestone M1 (Data & Planning Enhancements: R1 & R5)

## Overview
Milestone M1 covers two key enhancements:
1. **R1: Formato Sonno in HH:MM**
   - Goal: Transition sleep metrics (total sleep, deep, light, REM, awake) to support HH:MM format input and display, with full backwards compatibility for decimal numbers stored previously.
   - Files involved:
     - `src/lib/merge.ts`: ensure `mergeNutrition` merges `sleepHours`, `sleepDeep`, `sleepLight`, `sleepRem`, `sleepAwake` from guest and cloud data.
     - `src/lib/utils/date.ts`: helper functions for converting between decimal hours / minutes and `HH:MM` / `H:MM` strings, parsing user inputs, formatting for display.
     - `src/lib/schema.ts`: Zod schema support for sleep properties (allowing numbers, strings, or transforming to canonical representation).
     - `src/hooks/useSleepMeasurements.ts`: state handling and validation for sleep metrics.
     - `src/components/Data/DataSleep.tsx`: UI inputs accepting HH:MM (or time picker/text input) and displaying formatted sleep stages and total sleep.
     - `src/components/Data/DataHistory.tsx`: rendering sleep data in history tables/cards formatted as HH:MM.
     - `src/lib/export.ts`: exporting sleep data to CSV in readable format (HH:MM or decimal according to spec).

2. **R5: Data di fine nei Cicli di Allenamento**
   - Goal: Implement dynamic calculation and two-way binding between `durationWeeks` and `endDate` in training cycles.
   - Files involved:
     - `src/lib/calc/planning.ts`: calculation utilities for calculating `endDate` from `startDate` + `durationWeeks`, and conversely calculating `durationWeeks` from `startDate` and `endDate`.
     - `src/components/Training/planning/CycleEditor.tsx`: two-way reactive inputs for duration (weeks) and end date (date picker), updating one when the other changes.
     - `src/components/Training/planning/CycleCard.tsx`: display of cycle date range (`startDate` to `endDate`) and duration.

## Acceptance Criteria
- Unit tests pass: `npm.cmd test -- --run tests/sleep_format.test.ts tests/cycle_end_date.test.tsx` (and all other existing tests).
- Build succeeds with zero TypeScript errors: `npm.cmd run build`.
- Linter passes with zero warnings/errors: `npm.cmd run lint`.
- All Reviewers and Challengers approve.
- Forensic Auditor confirms CLEAN integrity.
