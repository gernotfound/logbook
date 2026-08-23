# Handoff Report — Milestone 2: Training Cycles End Date & Two-Way Binding (Requirement R5)

## 1. Observation
1. **TypeScript Type Definitions (`src/types.ts:210-221`)**:
   Prior to our change, `TrainingCycle` contained `startDate?: string;` but was missing `endDate?: string;`.
   ```typescript
   export interface TrainingCycle {
       id: string;
       name: string;
       durationWeeks: number;
       sessionsPerWeek?: number;
       progressionMode?: 'sequential' | 'fixed';
       startDate?: string;
       endDate?: string; // Added
       notes?: string;
       routines: TrainingCycleRoutineItem[];
       createdAt?: number;
       isActive?: boolean;
   }
   ```

2. **Zod Runtime Gateway Schema (`src/lib/schema.ts:319-331`)**:
   `TrainingCycleSchema` now includes `endDate: safeOptionalString()`, guaranteeing runtime sanitization without dropping the end date during Firestore/IndexedDB loads:
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

3. **Planning Calculation Engine (`src/lib/calc/planning.ts:35-144`)**:
   `calculateCycleTimeline` was updated to support and respect explicit `cycle.endDate` when present and valid, while falling back gracefully to standard `addDays(start, totalWeeks * 7 - 1)`:
   ```typescript
   const start = startOfDay(parsedStart);
   let end = addDays(start, totalWeeks * 7 - 1);
   if (cycle.endDate) {
       try {
           const parsedEnd = typeof cycle.endDate === 'string' && !cycle.endDate.includes('T')
               ? parseISO(cycle.endDate)
               : new Date(cycle.endDate);
           if (isValid(parsedEnd) && differenceInCalendarDays(parsedEnd, start) >= 0) {
               end = startOfDay(parsedEnd);
           }
       } catch {
           // fallback to computed end
       }
   }
   ```

4. **Interactive Component UI & Two-Way Binding (`src/components/Training/planning/CycleEditor.tsx`)**:
   - Added two-way binding helpers: `computeEndDate(startIso, weeks)` and `computeWeeksFromDates(startIso, endIso)`.
   - Added states and refs: `endDate`, `endDateTextInput`, `endDatePickerRef`.
   - Implemented reactive handlers:
     - `handleDurationWeeksChange`: updates `durationWeeks` and calculates new `endDate`.
     - `handleEndDateTextChange` / `handleEndDateTextBlur` / `handleEndCalendarDateChange`: updates `endDate` and computes `durationWeeks` using `Math.max(1, Math.round((diffDays + 1) / 7))`.
     - `handleStartDateTextChange` / `handleStartDateTextBlur` / `handleStartCalendarDateChange`: updates `startDate` and updates `endDate` while keeping `durationWeeks` constant.
   - Form submission includes both `validStartDate` and `validEndDate` in the `TrainingCycle` payload passed to `onSave`.
   - Follows Italian sentence case: `"Data di inizio"`, `"Data di fine"`, `"Durata (settimane)"`, `"Frequenza di allenamento (sedute a settimana)"`, `"Salva modifiche"`, `"Salva ciclo"`.
   - Prevented iOS Safari auto-zoom by enforcing `fontSize: '16px'` and `min-width: 0` on inputs.

5. **Test Suite & Verification Results**:
   - `npm.cmd test`: 36 test files passed, 684 tests passed, 0 failures.
   - `npm.cmd run build`: Compiled with 0 errors (TypeScript `tsc --noEmit` and Vite bundle).
   - `npm.cmd run lint`: 0 errors (oxlint).

---

## 2. Logic Chain
1. *Observation 1 & 2* establish that `TrainingCycle` requires `endDate?: string` across types, runtime Zod validation, and serialization. Adding `endDate: safeOptionalString()` ensures persistence through `DomainParsers.parseTrainingCycles`, `DB.loadUserData`, and `DB.saveUserData`.
2. *Observation 3* establishes that timeline and scheduling calculations (`calculateCycleTimeline` and `calculateCycleSchedule`) must reflect the end date whether calculated or explicitly set.
3. *Observation 4* establishes that the user experience in `CycleEditor.tsx` requires seamless bidirectional synchronization: adjusting weeks calculates the ending date, adjusting the end date calculates the duration in weeks, and shifting the start date preserves the duration while moving the end date.
4. *Observation 5* verifies that all unit, component, schema, and integration tests across the entire repository execute cleanly with zero regressions.

---

## 3. Caveats
- No caveats. The implementation adheres strictly to local timezone date manipulation (`date-fns` & `Logic.getLocalDateString`/`Logic.parseDateInput`) avoiding UTC midnight skew.

---

## 4. Conclusion
Milestone 2 (Requirement R5 - Training Cycles End Date & Two-Way Binding) is fully implemented, verified, and ready for audit.

---

## 5. Verification Method
To independently verify this milestone:
1. Run all unit and integration tests:
   ```powershell
   npm.cmd test
   ```
2. Run targeted cycle end date tests:
   ```powershell
   npm.cmd test -- tests/cycle_end_date.test.tsx
   ```
3. Run TypeScript type check and production build:
   ```powershell
   npm.cmd run build
   ```
4. Run linter:
   ```powershell
   npm.cmd run lint
   ```
5. Manual verification in UI:
   - Navigate to **Allenamento** $\rightarrow$ **Pianificazione**.
   - Open **Nuovo ciclo** or click **Modifica** on an existing cycle.
   - Observe the "Data di inizio" and "Data di fine" fields.
   - Modify "Durata (settimane)" to 8; observe "Data di fine" immediately updates to 8 weeks after "Data di inizio".
   - Pick a new "Data di fine" in the datepicker 12 weeks out; observe "Durata (settimane)" updates to 12.
   - Modify "Data di inizio"; observe "Data di fine" shifts accordingly keeping 12 weeks duration.
