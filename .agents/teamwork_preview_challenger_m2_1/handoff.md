# Handoff Report — Milestone 2 Adversarial Review (Training Cycles End Date & Two-Way Binding - Requirement R5)

## 1. Observation

### 1.1 Empirical Verification Test Commands & Output
We executed the adversarial test suites `tests/challenger_empirical_m2.test.tsx` and `tests/challenger_cycle_editor_interaction.test.tsx` via Vitest.

**Command**:
```bash
npx vitest run tests/challenger_empirical_m2.test.tsx
```

**Verbatim Error Output**:
```
 FAIL  tests/challenger_empirical_m2.test.tsx > Empirical Challenger: Training Cycles End Date & Two-Way Binding Adversarial Suite (Milestone 2 - Requirement R5) > 6. CycleEditor UI Stress & Interaction Robustness > verifies selecting end date from calendar picker updates endDate without modifying startDate text input
AssertionError: expected '26/10/2026' to be '01/09/2026' // Object.is equality

Expected: "01/09/2026"
Received: "26/10/2026"

 ❯ tests/challenger_empirical_m2.test.tsx:404:42
    402|             expect(endDateInput.value).toBe('26/10/2026');
    403|             // Check start date is NOT corrupted
    404|             expect(startDateInput.value).toBe('01/09/2026');
```

### 1.2 Exact Bug Location in Source Code
In file `src/components/Training/planning/CycleEditor.tsx`, lines 167–178:
```typescript
    const handleEndCalendarDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        if (val) {
            setEndDate(val);
            setDateTextInput(Logic.formatItalianDate(val)); // <-- CRITICAL BUG: Mutates Start Date text input with End Date value!
            setEndDateTextInput(Logic.formatItalianDate(val));
            if (startDate) {
                const w = computeWeeksFromDates(startDate, val);
                setDurationWeeks(String(w));
            }
        }
    };
```

---

## 2. Logic Chain

1. **Intended Design**:
   - `dateTextInput` is the React state driving the value of the **Data di inizio** (Start Date) text field (`<input id="cycle-start-date" value={dateTextInput} ... />`).
   - `endDateTextInput` is the React state driving the value of the **Data di fine** (End Date) text field (`<input id="cycle-end-date" value={endDateTextInput} ... />`).
2. **Failure Mechanism**:
   - When a user clicks the calendar button 📅 for "Data di fine" and selects a date from the native date picker, the change handler `handleEndCalendarDateChange` triggers.
   - At line 171, `setDateTextInput(Logic.formatItalianDate(val))` is erroneously called alongside `setEndDateTextInput(Logic.formatItalianDate(val))`.
   - Consequently, selecting an End Date from the calendar picker overwrites the Start Date text input on screen with the End Date value, destroying the user's configured Start Date.
3. **Boundary Condition & Math Verification**:
   - Boundary weeks (0 weeks, -10 weeks) correctly clamp to 1 week duration in `computeEndDate` and fallback safely to 4 weeks in `calculateCycleTimeline`.
   - Huge duration (100 weeks, 520 weeks) generates correct calendar end dates without integer overflow or memory issues.
   - Inverted dates ($D_e < D_s$) safely return 1 week and fallback to duration-based calculation.
   - Leap year transitions (2024-02-29, Feb 2024 leap year 29 days vs Feb 2025 non-leap year 28 days, 2028 leap span) correctly calculate exact days.
   - Dec 31 -> Jan 01 rollovers and European Daylight Savings Time (DST) spring/fall boundaries maintain calendar day accuracy without 23h/25h hour drift.
   - Bidirectional mathematical round-trip ($D_e = D_s + 7W - 1 \iff W = \text{round}((D_e - D_s + 1)/7)$) is 100% invariant across all $W \in [1, 52]$ on multiple reference dates.

---

## 3. Caveats

- **Scope**: Review was constrained strictly to Requirement R5 / Milestone 2 (Training Cycles End Date & Two-Way Binding in `src/types.ts`, `src/lib/schema.ts`, `src/components/Training/planning/CycleEditor.tsx`, `src/lib/calc/planning.ts`).
- **Review-Only Constraint**: As a challenger, no implementation code in `src/` was modified. The bug is reported for the worker/implementer agent to address.

---

## 4. Conclusion

- **Verdict**: **`CHALLENGE_FAILED`** (Blocked due to confirmed UI state corruption bug in `CycleEditor.tsx`).
- **Required Fix**:
  In `src/components/Training/planning/CycleEditor.tsx`, remove line 171 (`setDateTextInput(Logic.formatItalianDate(val));`) from `handleEndCalendarDateChange`.

---

## 5. Verification Method

To independently reproduce and verify:
1. Run the empirical adversarial test:
   ```bash
   npx vitest run tests/challenger_empirical_m2.test.tsx
   ```
2. Observe failure in `verifies selecting end date from calendar picker updates endDate without modifying startDate text input`.
3. Inspect `src/components/Training/planning/CycleEditor.tsx:171`.
