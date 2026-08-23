# Review & Adversarial Challenge Report — Reviewer 2 (Milestone M1: Requirement R5)

## 1. Observation

1. **`src/lib/calc/planning.ts` (lines 35–155, lines 208–330)**:
   - `calculateCycleTimeline`:
     - Safely parses `cycle.startDate` via `parseISO` or `new Date()`. If omitted, returns fallback with `${totalWeeks} settimane`, `currentWeek: 1`, `progressPercent: 0`, `isStarted: true`, `isEnded: false`.
     - Default end date is computed as `addDays(start, totalWeeks * 7 - 1)`.
     - If `cycle.endDate` is provided, it validates the date with `isValid(parsedEnd) && differenceInCalendarDays(parsedEnd, start) >= 0`. If valid, it assigns `end = startOfDay(parsedEnd)`.
     - Date difference calculations use `differenceInCalendarDays(now, start)`: handles future start dates (`isStarted: false`, daysToStart countdown), completed cycles (`isEnded: true`, `progressPercent: 100`), and active cycles with accurate `currentWeek` and `progressPercent`.
   - `calculateCycleSchedule`:
     - Rotates ordered routines across `durationWeeks` * `sessionsPerWeek`.
     - If `cycle.startDate` is provided, it populates each week's `startDateStr`, `endDateStr`, and `formattedRange` (e.g. `'20/08 - 26/08'`).

2. **`src/components/Training/planning/CycleEditor.tsx` (lines 14–37, lines 91–177, lines 328–536)**:
   - `computeEndDate(startIso, weeks)`: `addDays(startOfDay(parsed), totalWeeks * 7 - 1)` with `yyyy-MM-dd` formatting.
   - `computeWeeksFromDates(startIso, endIso)`: `Math.max(1, Math.round((diffDays + 1) / 7))`.
   - Two-way reactive handlers:
     - `handleDurationWeeksChange`: updates `durationWeeks`, recomputes and sets `endDate` and `endDateTextInput`.
     - `handleStartDateTextChange` / `handleStartCalendarDateChange` / `handleStartDateTextBlur`: updates `startDate`, keeps `durationWeeks`, recomputes and updates `endDate` and `endDateTextInput`.
     - `handleEndDateTextChange` / `handleEndCalendarDateChange` / `handleEndDateTextBlur`: updates `endDate`, recomputes and updates `durationWeeks`.
     - Blur handlers on text inputs gracefully recover to the last valid formatted date (`Logic.formatItalianDate`) if partial/corrupted text was typed.
   - Dual date input system: Users can type dates as Italian `GG/MM/AAAA` text or select via native calendar picker `<input type="date">`.
   - UI styling & constraints:
     - Form uses inline card expansion (`className="card mb-20"`), avoiding `<dialog>` modals per AGENTS.md Rule 7.
     - All inputs have `fontSize: '16px'` and `boxSizing: 'border-box'` to prevent iOS Safari auto-zoom per AGENTS.md Rule 7.
     - All labels and texts follow Italian sentence case: "Nome ciclo", "Data di inizio", "Data di fine", "Durata (settimane)", "Frequenza di allenamento (sedute a settimana)", "Note o obiettivo (opzionale)", "Sequenza rotazione schede", "Salva modifiche", "Salva ciclo" per AGENTS.md Rule 11.
     - Confirmation and alerts use `useDialogStore.getState().showAlert` per AGENTS.md Rule 7.

3. **`src/components/Training/planning/CycleCard.tsx` (lines 28–105)**:
   - Formats cycle timeline as `📅 ${timeline.formattedRange} (${cycle.durationWeeks} sett.) • ${sessionsPerWeek} sedute / sett.`
   - Displays real-time progress bar when cycle is active and has a `startDate`.
   - Supports toggleable schedule breakdown (`🔄 Vedi programmazione`).

4. **`src/components/Training/planning/TrainingPlanning.tsx` (lines 10–39, lines 59–83)**:
   - Uses module-level constants `EMPTY_ROUTINES`, `EMPTY_LIBRARY`, `EMPTY_CYCLES` in Zustand selectors to prevent infinite re-render loops (AGENTS.md Rule 6).
   - Manages cycle creation, editing, activation, deactivation, and duplication via `useAppStore.getState().saveUserData`.

5. **`src/lib/schema.ts` & `src/types.ts`**:
   - `TrainingCycle`: `startDate?: string; endDate?: string;`
   - `TrainingCycleSchema`: `startDate: safeOptionalString()`, `endDate: safeOptionalString()`.
   - `DomainParsers.parseTrainingCycles`: correctly normalizes arrays of cycles and preserves `startDate` and `endDate`.

6. **Test & Execution Verification**:
   - Target test suites for R5 and planning:
     `npm.cmd test -- --run tests/cycle_end_date.test.tsx tests/challenger_cycle_editor_interaction.test.tsx tests/challenger_m2_empirical_cycle_math.test.ts tests/training_planning.test.tsx`
     Result: **4 test files passed, 53 tests passed (0 failures)** in 27.63s.
   - Target test suites for M1 (R1 & R5):
     `npm.cmd test -- --run tests/guest_merge.test.ts tests/sleep_format.test.ts tests/cycle_end_date.test.tsx tests/challenger_m1_adversarial_sleep.test.ts tests/challenger_m1_sleep_stress.test.tsx tests/challenger_m1_stress.test.ts tests/challenger_cycle_editor_interaction.test.tsx tests/challenger_m2_empirical_cycle_math.test.ts`
     Result: **8 test files passed, 116 tests passed (0 failures)** in 15.32s.
   - Linter (`npm.cmd run lint`): `oxlint` finished with 0 errors.
   - Build (`npm.cmd run build`): M1 files have 0 TypeScript errors. (Note: Repo-level build exited with code 1 due to 3 unused/untyped variables in unrelated files `TrainingSession.tsx` and `SessionExerciseCard.tsx`).

---

## 2. Logic Chain

1. **Date Math & Precision (Observation 1 & 2)**:
   - For any cycle starting on day $D_0$ with duration $W$ weeks, the total inclusive duration is $7W$ days, so the end date is $D_0 + (7W - 1)$ days. For example: Start 2026-08-20, 4 weeks $\rightarrow$ End 2026-09-16 (diff = 27 days, total = 28 inclusive days).
   - Inversely, given start date $D_0$ and end date $D_1$, the elapsed days is $\Delta = \text{diff}(D_1, D_0) \ge 0$. The week count is $\text{round}((\Delta + 1) / 7)$, clamped to a minimum of 1.
   - Both formulas are cleanly implemented in `computeEndDate` and `computeWeeksFromDates` and thoroughly tested across all edge cases.

2. **Two-Way Binding & User Experience (Observation 2)**:
   - Editing `durationWeeks` immediately recalculates and updates `endDate` and its formatted text representation.
   - Editing `endDate` (via Italian text input or calendar picker) immediately recalculates and updates `durationWeeks`.
   - Editing `startDate` shifts `endDate` forward/backward while preserving the selected `durationWeeks`.
   - All input transitions preserve user focus and typing state without dropping intermediate keystrokes or crashing on empty/partial strings.

3. **Timezone & Persistence Safety (Observation 1, 2, 4, 5)**:
   - Default dates use `Logic.getLocalDateString()` (local timezone, e.g. `2026-08-20`), preventing midnight UTC rollback bugs per AGENTS.md Section 4.
   - Schemas use `safeOptionalString()` with `.passthrough()`, ensuring Firestore serialization (`db.ts`) and IndexedDB cache roundtrips preserve `startDate` and `endDate` without stripping properties.

4. **Integrity & Code Quality Verification**:
   - Zero hardcoded test outputs or facades detected.
   - Zero bypasses of state management or schema validation.
   - Zero native modal `<dialog>` elements or unhandled promises.
   - Strict adherence to dark glassmorphism styling and Italian sentence case.

---

## 3. Caveats

- **Repo-level TypeScript build**: While all Milestone M1 code (`src/lib/calc/planning.ts`, `CycleEditor.tsx`, `CycleCard.tsx`, `TrainingPlanning.tsx`, `schema.ts`, `types.ts`) compiles with zero TypeScript errors and passes all tests, running global `npm.cmd run build` fails on 3 pre-existing/unrelated items in `TrainingSession.tsx` and `SessionExerciseCard.tsx`. Per reviewer constraints, we do not modify code outside our scope, but report this observation for the orchestrator.

---

## 4. Conclusion

- **Verdict: APPROVE**
- Requirement **R5 (Training Cycle End Date & Two-Way Binding)** is robust, mathematically precise, fully responsive, and adheres to all AGENTS.md architectural guidelines and design principles.
- 53 dedicated planning/cycle tests and all 116 M1 tests pass with 100% success.
- Linter passes with 0 errors.

---

## 5. Verification Method

To independently verify this implementation:

1. Run the R5 unit and interaction test suite:
   ```powershell
   npm.cmd test -- --run tests/cycle_end_date.test.tsx tests/challenger_cycle_editor_interaction.test.tsx tests/challenger_m2_empirical_cycle_math.test.ts tests/training_planning.test.tsx
   ```

2. Run the complete M1 test suite:
   ```powershell
   npm.cmd test -- --run tests/guest_merge.test.ts tests/sleep_format.test.ts tests/cycle_end_date.test.tsx tests/challenger_m1_adversarial_sleep.test.ts tests/challenger_m1_sleep_stress.test.tsx tests/challenger_m1_stress.test.ts tests/challenger_cycle_editor_interaction.test.tsx tests/challenger_m2_empirical_cycle_math.test.ts
   ```

3. Run linter:
   ```powershell
   npm.cmd run lint
   ```

4. Inspect the primary implementation files:
   - `src/lib/calc/planning.ts`
   - `src/components/Training/planning/CycleEditor.tsx`
   - `src/components/Training/planning/CycleCard.tsx`
   - `src/components/Training/planning/TrainingPlanning.tsx`

---

## Quality Review Summary

**Verdict**: APPROVE

### Verified Claims
- `computeEndDate` & `computeWeeksFromDates` mathematical precision $\rightarrow$ verified via `tests/challenger_m2_empirical_cycle_math.test.ts` $\rightarrow$ PASS
- Dual-input two-way reactive binding between `durationWeeks` and `endDate` $\rightarrow$ verified via `tests/cycle_end_date.test.tsx` and `tests/challenger_cycle_editor_interaction.test.tsx` $\rightarrow$ PASS
- Start Date alteration preserves duration weeks and recalculates end date $\rightarrow$ verified via unit & interaction tests $\rightarrow$ PASS
- End Date calendar picker does not overwrite Start Date input text $\rightarrow$ verified via Scenario 6 test $\rightarrow$ PASS
- Non-modal accordion / inline card design without `<dialog>` $\rightarrow$ verified via `CycleEditor.tsx` inspection $\rightarrow$ PASS
- iOS Safari auto-zoom prevention (`fontSize: 16px`) $\rightarrow$ verified via CSS styles inspection $\rightarrow$ PASS
- Italian sentence case conformity across all labels, titles, and placeholders $\rightarrow$ verified via JSX inspection $\rightarrow$ PASS
- Timezone safety using `Logic.getLocalDateString()` $\rightarrow$ verified via `CycleEditor.tsx` and `planning.ts` $\rightarrow$ PASS

---

## Adversarial Challenge Report

**Overall risk assessment**: LOW

### Challenges Tested & Results

1. **Challenge 1: Leap Year and Leap Day Transitions**
   - *Attack scenario*: Start date on `2024-02-01`, `2024-02-28`, `2024-02-29`, or `2028-02-15` with 4 weeks duration where February has 29 days.
   - *Result*: `computeEndDate` accurately handles leap years (e.g. `2024-02-01` + 4 weeks = `2024-02-28`, `2024-02-28` + 4 weeks = `2024-03-26`). $\rightarrow$ PASS

2. **Challenge 2: Year Boundary Transitions**
   - *Attack scenario*: Start date near end of year (`2026-12-25`, `2026-12-31`) spanning across new year into January/February 2027.
   - *Result*: Accurate rollover without year truncation or timezone offset bugs (e.g. `2026-12-25` + 4 weeks = `2027-01-21`). $\rightarrow$ PASS

3. **Challenge 3: Inverted Date Inputs (`endDate < startDate`)**
   - *Attack scenario*: User enters an end date earlier than start date.
   - *Result*: `calculateCycleTimeline` and `computeWeeksFromDates` safely clamp to 1 week / computed fallback without throwing exceptions. $\rightarrow$ PASS

4. **Challenge 4: Partial and Corrupted Input Text Recovery**
   - *Attack scenario*: User deletes input or types non-date strings ('invalid-date') and blurs the input field.
   - *Result*: `onBlur` handlers validate and restore the last valid formatted date without crashing the component state. $\rightarrow$ PASS
