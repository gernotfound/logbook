# Challenger 2 Handoff Report — Milestone 2 (Training Cycles End Date & Two-Way Binding - Requirement R5)

## 1. Observation

### 1.1 Implementation Code Inspection
In `src/components/Training/planning/CycleEditor.tsx` lines 167-178:
```typescript
    const handleEndCalendarDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        if (val) {
            setEndDate(val);
            setDateTextInput(Logic.formatItalianDate(val));
            setEndDateTextInput(Logic.formatItalianDate(val));
            if (startDate) {
                const w = computeWeeksFromDates(startDate, val);
                setDurationWeeks(String(w));
            }
        }
    };
```
Line 171 explicitly calls `setDateTextInput(Logic.formatItalianDate(val));` when the **End Date** calendar picker triggers `onChange`.

### 1.2 Form Submission Handling
In `src/components/Training/planning/CycleEditor.tsx` lines 250-265:
```typescript
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        // ...
        const weeks = Math.max(1, parseInt(durationWeeks, 10) || 4);
        const freqPerWeek = Math.max(1, parseInt(sessionsPerWeek, 10) || cycleRoutines.length);
        const validStartDate = Logic.parseDateInput(dateTextInput) || startDate || undefined;
        const validEndDate = Logic.parseDateInput(endDateTextInput) || endDate || (validStartDate ? computeEndDate(validStartDate, weeks) : undefined);

        const cycle: TrainingCycle = {
            id: initialCycle?.id || Logic.generateId('cycle'),
            name: trimmedName,
            durationWeeks: weeks,
            sessionsPerWeek: freqPerWeek,
            progressionMode: 'sequential',
            startDate: validStartDate,
            endDate: validEndDate,
            // ...
        };
```

### 1.3 Empirical Test Execution
Created empirical test suite `tests/challenger_cycle_editor_interaction.test.tsx` containing 12 adversarial scenarios.
Executed via command: `npm.cmd test -- tests/challenger_cycle_editor_interaction.test.tsx`
Result:
```
 FAIL  tests/challenger_cycle_editor_interaction.test.tsx > Challenger 2 Empirical Verification: CycleEditor UI & Two-Way Binding > Scenario 6: [CRITICAL ADVERSARIAL] Calendar picker for End Date must NOT overwrite Start Date text
AssertionError: expected '14/10/2026' to be '20/08/2026' // Object.is equality

Expected: "20/08/2026"
Received: "14/10/2026"

 ❯ tests/challenger_cycle_editor_interaction.test.tsx:268:42
    266|         // CRITICAL CHECK: Start date text MUST NOT have been overwritten by 14/10/2026!
    267|         // In current CycleEditor.tsx line 171, setDateTextInput is wrongly called
    268|         expect(startDateTextInput.value).toBe('20/08/2026');
```

---

## 2. Logic Chain

1. **Premise 1**: The CycleEditor form provides two date selectors: "Data di inizio" (`#cycle-start-date`, controlled by `dateTextInput` / `startDate`) and "Data di fine" (`#cycle-end-date`, controlled by `endDateTextInput` / `endDate`). (Obs 1.1)
2. **Premise 2**: When a user selects a date from the End Date calendar picker (`endDatePickerRef`), `handleEndCalendarDateChange` executes. (Obs 1.1)
3. **Premise 3**: Line 171 of `CycleEditor.tsx` calls `setDateTextInput(Logic.formatItalianDate(val))` which updates the text input for "Data di inizio" to display the End Date value. (Obs 1.1, Obs 1.3)
4. **Premise 4**: When saving the form, `validStartDate` is computed using `Logic.parseDateInput(dateTextInput)`. Because `dateTextInput` was overwritten with the End Date, `validStartDate` resolves to the End Date instead of the actual Start Date. (Obs 1.2)
5. **Conclusion**: Picking an End Date via the calendar picker visibly corrupts the Start Date input field in the UI and permanently saves the corrupted Start Date (= End Date) on submission. (Obs 1.3)

---

## 3. Caveats

- All other two-way binding features (changing duration weeks updates end date, changing end date text updates weeks, changing start date shifts end date, typing invalid text and blurring restores the formatted date, leap year boundary calculations) passed completely.
- Only the End Date calendar picker handler has this line defect.

---

## 4. Conclusion

- **Verdict**: **CHALLENGE_FAILED**
- **Defect Summary**: In `src/components/Training/planning/CycleEditor.tsx`, line 171 contains an erroneous call: `setDateTextInput(Logic.formatItalianDate(val));` inside `handleEndCalendarDateChange`.
- **Recommended Action for Worker**:
  - Delete line 171 (`setDateTextInput(Logic.formatItalianDate(val));`) from `src/components/Training/planning/CycleEditor.tsx`.
  - Re-run `npm.cmd test -- tests/challenger_cycle_editor_interaction.test.tsx` to confirm all 12 scenarios pass (12/12).

---

## 5. Verification Method

To independently reproduce and verify:
1. Run the test suite:
   ```powershell
   npm.cmd test -- tests/challenger_cycle_editor_interaction.test.tsx
   ```
2. Observe `Scenario 6` failure: `expected '14/10/2026' to be '20/08/2026'`.
3. Invalidate/fix condition: Remove line 171 in `src/components/Training/planning/CycleEditor.tsx` and re-run the command; all 12 tests will pass with 0 errors.
