# Challenger 2 Report — Milestone M1: Requirement R5 (Training Cycle End Date & Two-Way Binding)

## Verdict: APPROVE

---

## 1. Observation

Direct empirical observations from source code inspection and test execution:

1. **Date Math & Timeline Calculations (`src/lib/calc/planning.ts`)**:
   - `calculateCycleTimeline`: Line 79-92 converts `startDate` and optional `endDate` into local midnight (`startOfDay`), and computes fallback `end = addDays(start, totalWeeks * 7 - 1)`. When explicit `endDate` is provided, it verifies `isValid(parsedEnd) && differenceInCalendarDays(parsedEnd, start) >= 0`.
   - Date range text is formatted in Italian sentence case format: `dal ${formattedStartDate} al ${formattedEndDate}` (Line 97).
   - Timeline progress percentage and phase labels handle all lifecycle boundaries:
     - `diffDays < 0` (before cycle start): `isStarted: false`, `isEnded: false`, `currentWeek: 0`, `statusLabel: 'Inizia tra X giorni'` / `'Inizia domani'` (Lines 102-118).
     - `0 <= diffDays < totalDays` (cycle in progress): `currentWeek: Math.min(totalWeeks, Math.floor(diffDays / 7) + 1)`, `statusLabel: 'Settimana W di N'` (Lines 137-154).
     - `diffDays === totalDays - 1` (last day of cycle): `currentWeek: totalWeeks`, `isEnded: false`, `progressPercent: 100`, `daysRemaining: 0`.
     - `diffDays >= totalDays` (cycle ended): `isStarted: true`, `isEnded: true`, `statusLabel: 'Ciclo completato'`, `daysRemaining: 0` (Lines 120-135).

2. **Two-Way Reactive State Binding (`src/components/Training/planning/CycleEditor.tsx`)**:
   - `handleDurationWeeksChange`: Line 91-99 parses numeric input and computes `computeEndDate(startDate, w)`, immediately synchronizing `endDate` and `endDateTextInput` (`Logic.formatItalianDate(newEnd)`).
   - `handleStartDateTextChange` & `handleStartDateTextBlur`: Lines 101-126 parse Italian date text (`Logic.parseDateInput`), shift `endDate` while preserving `durationWeeks`, and gracefully revert to last valid date on blur if input was invalid.
   - `handleStartCalendarDateChange`: Lines 128-138 update `startDate` and shift `endDate` based on `durationWeeks`.
   - `handleEndDateTextChange` & `handleEndDateTextBlur`: Lines 140-165 parse Italian date text, update `endDate`, and recalculate `durationWeeks = computeWeeksFromDates(startDate, parsedIso)` via `Math.round((diffDays + 1) / 7)`.
   - `handleEndCalendarDateChange`: Lines 167-177 update `endDate` and `endDateTextInput`, recalculate `durationWeeks`, and strictly preserve `startDate` without state pollution.
   - `handleSubmit`: Lines 234-267 sanitize `durationWeeks` (`Math.max(1, parseInt(durationWeeks, 10) || 4)`), `sessionsPerWeek`, `startDate`, and `endDate`, constructing a conforming `TrainingCycle` object passed to `onSave`.

3. **Schema & Persistence Resilience (`src/lib/schema.ts` & `src/lib/db.ts`)**:
   - `TrainingCycleSchema` includes optional `endDate: safeOptionalString`.
   - `DomainParsers.parseTrainingCycles` preserves `endDate` across cycle arrays.
   - `DB.saveUserData` and `DB.loadUserData` preserve `trainingCycles` and `activeCycleId` in the root user document with diffing via `fast-deep-equal`.

4. **Empirical Test Suite Execution**:
   - Ran `npm.cmd test -- --run tests/challenger_r5_comprehensive_stress.test.tsx tests/cycle_end_date.test.tsx tests/challenger_m2_empirical_cycle_math.test.ts tests/challenger_cycle_editor_interaction.test.tsx`:
   ```
   ✓ tests/challenger_m2_empirical_cycle_math.test.ts (16 tests) 24ms
   ✓ tests/cycle_end_date.test.tsx (12 tests) 496ms
   ✓ tests/challenger_r5_comprehensive_stress.test.tsx (13 tests) 574ms
   ✓ tests/challenger_cycle_editor_interaction.test.tsx (12 tests) 950ms

   Test Files  4 passed (4)
        Tests  53 passed (53)
   ```

---

## 2. Logic Chain

1. **Bijective Invariance (Weeks <-> End Date)**:
   - For all week values $W \in [1, 52]$ and arbitrary starting dates spanning leap years, standard years, and DST transitions, `computeEndDate(startDate, W)` produces an inclusive date span of exactly $7W$ days ($\Delta = 7W - 1$ days).
   - Reciprocally, `computeWeeksFromDates(startDate, endDate)` computes $\text{round}((\Delta + 1) / 7) = W$.
   - Verified across hundreds of date combinations in `tests/challenger_r5_comprehensive_stress.test.tsx`.

2. **Calendar Boundary Resilience**:
   - Leap years: 2024-02-15 + 4 weeks (28 days) correctly lands on 2024-03-13 (Feb has 29 days). Non-leap year 2025-02-15 + 4 weeks lands on 2025-03-14 (Feb has 28 days).
   - Month boundaries (e.g. Dec 25 -> Jan 21, Dec 31 -> Jan 06) and multi-year spans (52 weeks, 104 weeks) calculate exact calendar days without year drift.
   - DST transitions (Spring forward March 29, 2026; Fall back October 25, 2026): Because date calculations operate on `startOfDay` and calendar days, no 23h/25h hour-shift occurs.

3. **Adversarial Input Clamping & Error Recovery**:
   - Inverted dates (`endDate < startDate`): `computeWeeksFromDates` safely clamps to 1 week; `calculateCycleTimeline` detects negative delta and falls back to computed end date from `startDate + durationWeeks`.
   - 0 duration, negative numbers, or `NaN`: Clamped to minimum 1 week or safe fallback.
   - Invalid date text strings: `CycleEditor` maintains internal input during typing, and on `blur` cleanly reverts to the last valid formatted date without crashing.
   - Calendar pickers: Modifying end date via native date picker updates `endDateTextInput` and recalculates `durationWeeks` without corrupting `startDateTextInput`.

4. **UI & Architectural Conformance**:
   - Labels follow Italian sentence case: "Data di inizio", "Data di fine", "Durata (settimane)".
   - Modals/`<dialog>` are avoided in favor of inline responsive cards.
   - Data persists cleanly to IndexedDB and Firestore.

---

## 3. Caveats

- Out-of-scope TypeScript build errors currently exist in `src/components/Training/TrainingSession.tsx` and `SessionExerciseCard.tsx` due to in-progress work by other subagents on Milestone M2 (R2/R3 exercise reorder & live sync). These do not affect R5 components (`planning.ts`, `CycleEditor.tsx`, `CycleCard.tsx`), which type-check cleanly.

---

## 4. Conclusion

Requirement R5 (Training Cycle End Date & Two-Way Binding) satisfies all functional requirements, mathematical invariants, UI reactivity patterns, and adversarial edge-case stress tests.

**Verdict: APPROVE.**

---

## 5. Verification Method

To independently reproduce and verify this assessment:

1. Run the dedicated cycle end date and stress test suites:
   ```bash
   npm.cmd test -- --run tests/challenger_r5_comprehensive_stress.test.tsx tests/cycle_end_date.test.tsx tests/challenger_m2_empirical_cycle_math.test.ts tests/challenger_cycle_editor_interaction.test.tsx
   ```
2. Verify that all 53 tests pass with 0 failures.
3. Inspect `src/lib/calc/planning.ts` lines 79-154 and `src/components/Training/planning/CycleEditor.tsx` lines 91-177 for mathematical and reactive state implementations.
