# Review & Handoff Report — Milestone 2 (Training Cycles End Date & Two-Way Binding - Requirement R5)

## 1. Observation
1. **Source Code Inspection**:
   - `src/components/Training/planning/CycleEditor.tsx`:
     - Lines 14–24: `computeEndDate(startIso: string, weeks: number): string` calculates $D_e = D_s + (W \times 7 - 1)\text{ days}$ using `date-fns/addDays` on `startOfDay(parsed)`.
     - Lines 26–37: `computeWeeksFromDates(startIso: string, endIso: string): number` computes $W = \max(1, \text{round}((\text{diffDays} + 1) / 7))$ with defensive handling for invalid dates or negative diff.
     - Lines 167–177: `handleEndCalendarDateChange` updates `endDate` and `endDateTextInput`, and recomputes `durationWeeks` when `startDate` exists. The errant `setDateTextInput` call has been completely removed.
     - Lines 400–468: "Data di fine" section is properly laid out with Italian sentence case labels, 16px font inputs to prevent iOS Safari auto-zoom, and calendar picker modal/focus fallback.
     - Lines 247–266: `handleSubmit` packages both `validStartDate` and `validEndDate` into the saved `TrainingCycle`.
   - `src/lib/calc/planning.ts`:
     - Lines 80–92: `calculateCycleTimeline` respects `cycle.endDate` when present and valid, falling back to computed end date when omitted.
   - `src/lib/schema.ts` & `src/types.ts`:
     - `TrainingCycle.endDate?: string` in `src/types.ts` line 217.
     - `TrainingCycleSchema` in `src/lib/schema.ts` line 326: `endDate: safeOptionalString()`.
   - `src/lib/db.ts`:
     - Lines 83, 137: `DomainParsers.parseTrainingCycles` deserializes cycles and validates `endDate`.
     - Lines 179, 191, 196: `saveUserData` serializes `trainingCycles` via `removeUndefinedValues` and checks doc size.
   - `src/lib/merge.ts` & `src/contexts/AuthContext.tsx`:
     - `mergeUserData` merges `trainingCycles` via `mergeArrayById` deduplicated by `id` with guest priority and validates with `UserDataSchema.parse()`.

2. **Empirical Verification Commands and Results**:
   - Command: `npm.cmd test -- tests/cycle_end_date.test.tsx`
     - Result: `12 passed (12)` (1.39s)
   - Command: `npm.cmd test -- tests/challenger_cycle_editor_interaction.test.tsx`
     - Result: `12 passed (12)` (3.87s)
     - Note: Scenario 6 (`[CRITICAL ADVERSARIAL] Calendar picker for End Date must NOT overwrite Start Date text`) passed cleanly.
   - Command: `npm.cmd test -- tests/e2e_enhancements_r1_r6.test.tsx`
     - Result: `70 passed (70)` (13.89s)
   - Command: `npm.cmd test`
     - Result: `Test Files 40 passed (40)`, `Tests 746 passed (746)` (58.30s)
   - Command: `npm.cmd run build`
     - Result: `tsc --noEmit && vite build` completed with 0 errors (836ms).
   - Command: `npm.cmd run lint`
     - Result: `oxlint` completed with 0 errors (29 non-blocking warnings in test files).

3. **Integrity Violations Check**:
   - No hardcoded test fixtures or bypasses in source logic.
   - No dummy/facade implementations.
   - All calculations derive from authentic date mathematics using `date-fns`.

## 2. Logic Chain
1. From Observation 1, the implementation correctly satisfies Requirement R5:
   - "Data di fine" input is placed in the cycle editor with two-way binding against duration in weeks and start date.
   - Modifying duration in weeks immediately updates the end date; modifying the end date immediately recalculates the duration in weeks.
   - Start date modifications shift the end date while preserving the duration in weeks.
2. From Observation 1 & 2, the fix in Worker Iteration 2 (removing `setDateTextInput` from `handleEndCalendarDateChange`) cleanly decoupled end date calendar selection from start date text state, directly resolving the critical adversarial defect tested in Scenario 6.
3. From Observation 1, the 5-step checklist for new properties is fully respected: `types.ts`, `schema.ts`, `db.ts`, `AuthContext.tsx`/`merge.ts`, and `planning.ts` all handle `endDate` consistently.
4. From Observation 2, all 746 tests across 40 test suites pass 100%, and production build (`tsc` + `vite`) and linter pass with 0 errors.

## 3. Caveats
No caveats. All edge cases (leap years, year transitions, negative/zero duration clamping, invalid date recovery on blur, calendar picker triggers, mobile touch bounds, form submission) were verified empirically.

## 4. Conclusion
The implementation of Milestone 2 (Cycle End Date & Two-Way Binding - Requirement R5) is robust, complete, conforms strictly to architectural rules (AGENTS.md, PROJECT.md), and passes all quality and adversarial criteria.

**Verdict**: **`APPROVE`**

## 5. Verification Method
To independently verify:
```bash
npm.cmd test -- tests/cycle_end_date.test.tsx
npm.cmd test -- tests/challenger_cycle_editor_interaction.test.tsx
npm.cmd test -- tests/e2e_enhancements_r1_r6.test.tsx
npm.cmd test
npm.cmd run build
npm.cmd run lint
```
Inspect files:
- `src/components/Training/planning/CycleEditor.tsx`
- `src/lib/calc/planning.ts`
- `src/lib/db.ts`

---

## Quality & Adversarial Review Report

### Review Summary
**Verdict**: **APPROVE**

### Findings
- None. All requirements and edge cases are handled accurately.

### Verified Claims
- Two-way binding between weeks and end date $\rightarrow$ verified via `tests/cycle_end_date.test.tsx` and `tests/challenger_cycle_editor_interaction.test.tsx` $\rightarrow$ PASS
- Decoupled end date calendar picker from start date text $\rightarrow$ verified via `Scenario 6` of `tests/challenger_cycle_editor_interaction.test.tsx` $\rightarrow$ PASS
- Defensive date fallback and blur recovery $\rightarrow$ verified via `Scenario 4` & `Scenario 12` $\rightarrow$ PASS
- Leap year & year transition math $\rightarrow$ verified via `Scenario 10` & `Scenario 11` $\rightarrow$ PASS
- Firestore load, save, and guest merge integrity for `trainingCycles` $\rightarrow$ verified via `tests/challenger_guest_merge_stress.test.ts` and `tests/challenger_empirical_adversarial.test.ts` $\rightarrow$ PASS
- Full test suite execution (746 tests) $\rightarrow$ verified via `vitest run` $\rightarrow$ PASS
- Production build & TypeScript check $\rightarrow$ verified via `npm run build` $\rightarrow$ PASS
- Code hygiene & linter $\rightarrow$ verified via `npm run lint` $\rightarrow$ PASS

### Coverage Gaps
- None.
