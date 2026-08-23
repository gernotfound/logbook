# Handoff Report: Requirement R5 (Training Cycle End Date & Two-Way Binding)

**Agent**: Explorer 3 (Milestone M1 — Data & Planning Enhancements)  
**Date**: 2026-08-20  
**Target Milestone**: M1 (R1 & R5)  
**Status**: COMPLETE (Hard Handoff)  

---

## 1. Observation

### 1.1 Codebase Files & Lines Directly Inspected
- `src/lib/calc/planning.ts` (lines 1–541):
  - `calculateCycleTimeline` (lines 35–155): Evaluates `totalWeeks = Math.max(1, Number(cycle?.durationWeeks) || 4)`. Parses `cycle.startDate` using `parseISO` or `new Date` and normalizes with `startOfDay`. Computes default `end = addDays(start, totalWeeks * 7 - 1)`. If `cycle.endDate` is provided, parses and checks `differenceInCalendarDays(parsedEnd, start) >= 0` to set `end = startOfDay(parsedEnd)`. Returns `formattedStartDate`, `formattedEndDate`, `formattedRange` (`"dal DD/MM/YYYY al DD/MM/YYYY"`), `currentWeek`, `progressPercent`, and `statusLabel`.
  - `calculateCycleSchedule` (lines 208–330): Iterates through `w = 1..durationWeeks`, computing weekly interval `wStart = addDays(baseStartDate, (w - 1) * 7)` and `wEnd = addDays(wStart, 6)`.
  - `getNextScheduledRoutine` (lines 345–410): Computes next scheduled routine in the sequential rotation using `completedCount % N`.
  - `calculateCycleVolume` (lines 412–540): Computes muscle set volumes and color heatmaps for `MuscleModel`.
- `src/components/Training/planning/CycleEditor.tsx` (lines 1–798):
  - `computeEndDate` (lines 14–24): `addDays(startOfDay(parsed), totalWeeks * 7 - 1)` formatted as `yyyy-MM-dd`.
  - `computeWeeksFromDates` (lines 26–37): `Math.max(1, Math.round((diffDays + 1) / 7))`. Clamps `diffDays < 0` to `1`.
  - Reactive state (lines 49–69): `startDate`, `dateTextInput`, `endDate`, `endDateTextInput`, `durationWeeks`, `sessionsPerWeek`, `cycleRoutines`.
  - `handleDurationWeeksChange` (lines 91–99): When user types weeks `w >= 1`, recalculates `endDate = computeEndDate(startDate, w)` and `endDateTextInput = Logic.formatItalianDate(newEnd)`.
  - `handleStartDateTextChange` / `handleStartDateTextBlur` (lines 101–127): Parsing with `Logic.parseDateInput`, recalculates `endDate` preserving `durationWeeks`.
  - `handleStartCalendarDateChange` (lines 128–138): Triggered by calendar icon button `📅`, recalculates `endDate`.
  - `handleEndDateTextChange` / `handleEndDateTextBlur` (lines 140–165): Parsing with `Logic.parseDateInput`, recalculates `durationWeeks = String(computeWeeksFromDates(startDate, parsedIso))`.
  - `handleEndCalendarDateChange` (lines 167–177): Updates `endDate`, `endDateTextInput`, and recomputes `durationWeeks`.
  - UI inputs (lines 328–468): 2-column grid with `#cycle-start-date`, `#cycle-end-date`, and `<input type="date">` triggers, enforcing `fontSize: '16px'` for Safari iOS auto-zoom prevention.
  - Live summary (lines 515–535): `Periodo programmato: dal DD/MM/YYYY al DD/MM/YYYY (N settimane)`.
  - Form submission (lines 234–267): Prepares sanitized `TrainingCycle` object with both `startDate` and `endDate`.
- `src/components/Training/planning/CycleCard.tsx` (lines 62–72, 201–222):
  - Header: `📅 dal DD/MM/YYYY al DD/MM/YYYY (N sett.) • M sedute / sett.`
  - Active cycle timeline: renders `timeline.statusLabel`, `timeline.progressPercent`, and animated progress bar.
  - Weekly schedule accordion (lines 141–199).
- `src/components/Training/planning/TrainingPlanning.tsx` (lines 27–40, 230–251):
  - Renders active cycle header, timeline progress bar, `MuscleModel` heatmap, and cycle archive.
- `src/types.ts` (lines 210–221):
  - `TrainingCycle` defines `startDate?: string` and `endDate?: string`.
- `src/lib/schema.ts` (lines 319–331):
  - `TrainingCycleSchema` validates `startDate: safeOptionalString()` and `endDate: safeOptionalString()`.
- `src/lib/db.ts` (lines 180–200):
  - `DB.saveUserData` and `DB.loadUserData` serialize `trainingCycles: state.trainingCycles || []` in root doc `users/{uid}`.

### 1.2 Tool Commands & Verification Results
1. `npm.cmd test -- --run tests/cycle_end_date.test.tsx tests/challenger_cycle_editor_interaction.test.tsx tests/challenger_m2_empirical_cycle_math.test.ts tests/training_planning.test.tsx`
   - Result: `Test Files 4 passed (4)`, `Tests 53 passed (53)`, Duration 21.55s.
2. `npm.cmd run build` (`tsc --noEmit && vite build`)
   - Result: Exited with code 0. Zero TypeScript errors. All 2284 modules transformed.
3. `npm.cmd run lint` (`oxlint`)
   - Result: Exited with code 0. 0 errors.

---

## 2. Logic Chain

1. **Evidence 1.1 $\rightarrow$ Data Contract**: The `TrainingCycle` interface in `src/types.ts` and `TrainingCycleSchema` in `src/lib/schema.ts` explicitly include `startDate` and `endDate` as optional strings. Because `safeOptionalString()` is used, corrupt non-string inputs are sanitized to `undefined` and valid strings (`YYYY-MM-DD`) are preserved.
2. **Evidence 1.1 $\rightarrow$ Calculation Logic**: `computeEndDate` in `CycleEditor.tsx` adds `(totalWeeks * 7 - 1)` days to `startDate`. This models an inclusive calendar interval (e.g. 4 weeks = 28 days $\implies$ Day 1 through Day 28). `computeWeeksFromDates` calculates `Math.max(1, Math.round((differenceInCalendarDays(end, start) + 1) / 7))`, providing the exact inverse function with nearest-whole-week rounding.
3. **Evidence 1.1 $\rightarrow$ Timezone Safety**: Using `parseISO` or `Logic.parseDateInput` together with `startOfDay` ensures that calculations are performed in the local timezone without UTC midnight offset distortions, complying with `AGENTS.md` Section 4.
4. **Evidence 1.1 $\rightarrow$ Two-Way Binding Handlers**: In `CycleEditor.tsx`:
   - Modifying `durationWeeks` updates `endDate` via `computeEndDate`.
   - Modifying `endDate` (via text input or calendar picker) updates `durationWeeks` via `computeWeeksFromDates`.
   - Modifying `startDate` shifts `endDate` while preserving `durationWeeks`.
5. **Evidence 1.1 $\rightarrow$ Mobile UX & AGENTS.md Compliance**: `CycleEditor.tsx` uses inline cards instead of modal `<dialog>` (Rule 7), applies `fontSize: '16px'` to all text/date inputs (Rule 7), and renders user-facing Italian text in Sentence case (Rule 11).
6. **Evidence 1.2 $\rightarrow$ Automated Verification**: All 53 tests across 4 test suites pass, TypeScript builds with zero errors, and linting passes with zero errors.

---

## 3. Caveats

1. **Export Scope**: `trainingCycles` are persisted to Firestore and IndexedDB, but are not serialized into `allenamenti.csv` or `misurazioni.csv` (CSV exports currently export workout sessions and nutrition measurements per spec).
2. **Helper Function Centralization**: `computeEndDate` and `computeWeeksFromDates` currently reside as private helpers in `CycleEditor.tsx`. Moving them to `src/lib/calc/planning.ts` is an architectural enhancement that does not change functional behavior but improves maintainability.

---

## 4. Conclusion

Requirement **R5 (Data di fine nei Cicli di Allenamento)** is fully specified, mathematically sound, defensively validated via Zod, and thoroughly verified by 53 unit and adversarial test cases.

- **Two-way binding**: Fully operational and reactive.
- **Date calculations**: Inclusive 28-day intervals for 4-week cycles, robust rounding for fractional weeks, safe fallback for inverted dates.
- **Display**: Seamlessly integrated into `CycleEditor`, `CycleCard`, and `TrainingPlanning`.
- **Compliance**: Fully compliant with `AGENTS.md` (Sentence case, storage tiering, no `<dialog>`, 16px inputs, local date handling).

---

## 5. Verification Method

To independently verify all findings:

1. **Run Unit and Adversarial Test Suites**:
   ```bash
   npm.cmd test -- --run tests/cycle_end_date.test.tsx tests/challenger_cycle_editor_interaction.test.tsx tests/challenger_m2_empirical_cycle_math.test.ts tests/training_planning.test.tsx
   ```
   *Expected output*: 4 passed test files, 53 passed tests, 0 failures.

2. **Run TypeScript Build**:
   ```bash
   npm.cmd run build
   ```
   *Expected output*: Zero TypeScript compilation errors (`tsc --noEmit`), Vite production build completes successfully.

3. **Run Linter**:
   ```bash
   npm.cmd run lint
   ```
   *Expected output*: 0 errors.

4. **Inspect Files for Compliance**:
   - `src/lib/calc/planning.ts`: lines 35–155 (`calculateCycleTimeline`), lines 208–330 (`calculateCycleSchedule`).
   - `src/components/Training/planning/CycleEditor.tsx`: lines 14–37 (math helpers), lines 91–177 (two-way binding handlers), lines 328–468 (form UI).
   - `src/components/Training/planning/CycleCard.tsx`: lines 62–72 (date range display), lines 201–222 (progress bar).
