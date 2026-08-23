# Review Report — Milestone 2: Training Cycles End Date & Two-Way Binding (Requirement R5)

**Reviewer**: Reviewer 1 (reviewer_critic)
**Verdict**: **APPROVE**

---

## 1. Observation

1. **TypeScript Definitions (`src/types.ts:210-222`)**:
   `TrainingCycle` interface includes optional `endDate?: string;`:
   ```typescript
   export interface TrainingCycle {
       id: string;
       name: string;
       durationWeeks: number; // es. 4, 6, 8, 12
       sessionsPerWeek?: number; // es. 1, 2, 3, 4, 5... (frequenza di allenamento settimanale)
       progressionMode?: 'sequential' | 'fixed'; // rotazione sequenziale continua vs fissa
       startDate?: string; // es. YYYY-MM-DD
       endDate?: string; // es. YYYY-MM-DD
       notes?: string;
       routines: TrainingCycleRoutineItem[];
       createdAt?: number;
       isActive?: boolean;
   }
   ```

2. **Zod Gateway & Schema Sanitization (`src/lib/schema.ts:319-331` & `423-431`)**:
   `TrainingCycleSchema` includes `endDate: safeOptionalString()`, ensuring any valid ISO string is preserved and any malformed/corrupted data falls back to `undefined` without throwing exceptions or dropping attributes during persistence:
   ```typescript
   export const TrainingCycleSchema = z.object({
       id: safeString(''),
       name: safeString(''),
       durationWeeks: safeNumber(4),
       sessionsPerWeek: safeOptionalNumber(),
       progressionMode: z.enum(['sequential', 'fixed']).optional().catch(undefined),
       startDate: safeOptionalString(),
       endDate: safeOptionalString(),
       notes: safeOptionalString(),
       routines: z.array(TrainingCycleRoutineItemSchema).catch([]).default([]),
       createdAt: safeOptionalNumber(),
       isActive: safeOptionalBoolean(),
   }).passthrough().catch({ id: '', name: '', durationWeeks: 4, routines: [] }).default({ id: '', name: '', durationWeeks: 4, routines: [] });
   ```
   `DomainParsers.parseTrainingCycles` filters and safely validates cycle arrays using `TrainingCycleSchema.safeParse`.

3. **Planning Timeline Calculation Engine (`src/lib/calc/planning.ts:35-155`)**:
   `calculateCycleTimeline` accurately calculates and formats `startDate` and `endDate`. When `cycle.endDate` is provided and valid (with `differenceInCalendarDays(parsedEnd, start) >= 0`), it is respected; otherwise, it computes `end = addDays(start, totalWeeks * 7 - 1)`.

4. **Component Implementation & Two-Way Binding (`src/components/Training/planning/CycleEditor.tsx`)**:
   - `computeEndDate(startIso, weeks)`: `addDays(startOfDay(parsed), totalWeeks * 7 - 1)`.
   - `computeWeeksFromDates(startIso, endIso)`: `Math.max(1, Math.round((diffDays + 1) / 7))`.
   - Handlers maintain strict bidirectional synchronization:
     - Changing duration in weeks updates end date text and picker values.
     - Changing end date (via direct text input in `GG/MM/AAAA` format or native calendar picker) recalculates duration in weeks.
     - Changing start date shifts end date while preserving the duration in weeks.
   - Form submission parses and persists `validStartDate` and `validEndDate` in ISO `YYYY-MM-DD` format.
   - UI styling and UX rules adhere to AGENTS.md:
     - Italian sentence case used across all labels: `"Data di inizio"`, `"Data di fine"`, `"Durata (settimane)"`, `"Frequenza di allenamento (sedute a settimana)"`, `"Salva modifiche"`, `"Salva ciclo"`.
     - Mobile Safari zoom prevention: `fontSize: '16px'` applied to all input fields and controls, with `minWidth: 0` on flex containers.

5. **Empirical Test, Build, and Lint Verification**:
   - `npm.cmd test`: **36 passed (36 files)**, **684 tests passed (0 failures)**.
   - `npm.cmd test -- tests/cycle_end_date.test.tsx`: **12 tests passed (100%)**.
   - `npm.cmd run build`: `tsc --noEmit && vite build` completed cleanly in 4.46s with 0 errors.
   - `npm.cmd run lint`: `oxlint` completed with 0 errors.

---

## 2. Logic Chain

1. *Observation 1 & 2* verify that type definitions and runtime gateway schemas are fully aligned. The field `endDate` is safely validated through `safeOptionalString()` in `TrainingCycleSchema`, properly loaded by `DomainParsers.parseTrainingCycles`, and persisted by `DB.saveUserData`.
2. *Observation 3* verifies that `calculateCycleTimeline` correctly handles both explicit and computed end dates, preventing timezone discrepancies and date formatting inconsistencies.
3. *Observation 4* confirms that the two-way binding mathematics in `CycleEditor.tsx` are mathematically sound (accounting for inclusive calendar intervals via `+ 1`), handle invalid/partial inputs gracefully, and adhere to mobile UX constraints (sentence case and `16px` font size).
4. *Observation 5* confirms that the full automated regression suite passes without any failures or regressions.

---

## 3. Caveats

- No caveats. The date arithmetic relies entirely on `date-fns` calendar day comparisons and local date utilities (`Logic.getLocalDateString` and `Logic.parseDateInput`), preventing UTC midnight offsets.

---

## 4. Conclusion

**Verdict: APPROVE**

The implementation of Milestone 2 (Training Cycles End Date & Two-Way Binding - Requirement R5) is complete, robust, well-tested, and fully compliant with project architectural rules and guidelines.

---

## 5. Verification Method

To independently verify the milestone:
1. Run all unit and integration tests:
   ```powershell
   npm.cmd test
   ```
2. Run targeted cycle end date tests:
   ```powershell
   npm.cmd test -- tests/cycle_end_date.test.tsx
   ```
3. Run TypeScript compiler and production build:
   ```powershell
   npm.cmd run build
   ```
4. Run linter:
   ```powershell
   npm.cmd run lint
   ```
