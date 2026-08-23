# Handoff Report: Explorer 1 (Milestone M1 — R1 Sleep Format in HH:MM)

**Agent**: Explorer 1  
**Milestone**: M1 (Data & Planning Enhancements)  
**Target Topic**: Requirement R1 (Sleep Format in `HH:MM`, Merge Logic, Schema, Utilities, Export, Tests)  
**Date**: 2026-08-20  

---

## 1. Observation

### 1.1 `src/lib/merge.ts` (lines 151–172)
In `mergeNutrition`, when both `cloudDay` and `guestDay` exist for the same date:
```typescript
            result[date] = {
                date,
                kcal,
                carbs,
                pro,
                fat,
                weight: pickVal(guestDay.weight, cloudDay.weight),
                bf: pickVal(guestDay.bf, cloudDay.bf),
                neck: pickVal(guestDay.neck, cloudDay.neck),
                waist: pickVal(guestDay.waist, cloudDay.waist),
                hip: pickVal(guestDay.hip, cloudDay.hip),
                chest: pickVal(guestDay.chest, cloudDay.chest),
                shoulders: pickVal(guestDay.shoulders, cloudDay.shoulders),
                biceps: pickVal(guestDay.biceps, cloudDay.biceps),
                thighs: pickVal(guestDay.thighs, cloudDay.thighs),
                calves: pickVal(guestDay.calves, cloudDay.calves),
                measurementTime: pickVal(guestDay.measurementTime, cloudDay.measurementTime),
                isDayOn: guestDay.isDayOn !== undefined ? guestDay.isDayOn : cloudDay.isDayOn,
                meals: mergedMeals,
                supplementsIntake: mergedSupplementsIntake,
            };
```
Verbatim finding: The fields `sleepHours`, `sleepDeep`, `sleepLight`, `sleepRem`, and `sleepAwake` are completely missing from the constructed return object.

### 1.2 `src/types.ts` (lines 173–177)
```typescript
    sleepHours?: number | string;
    sleepDeep?: number | string;
    sleepLight?: number | string;
    sleepRem?: number | string;
    sleepAwake?: number | string;
```

### 1.3 `src/lib/schema.ts` (lines 5–18, 282–287)
```typescript
const safeOptionalSleepTime = () =>
    z.union([
        z.string().transform(v => {
            const trimmed = v.trim();
            if (!trimmed) return undefined;
            const formatted = formatSleepTime(trimmed);
            return formatted || undefined;
        }),
        z.number().transform(v => {
            if (isNaN(v)) return undefined;
            const formatted = formatSleepTime(v);
            return formatted || undefined;
        })
    ]).optional().catch(undefined);
```
And inside `NutritionDaySchema`:
```typescript
    sleepHours: safeOptionalSleepTime(),
    sleepDeep: safeOptionalSleepTime(),
    sleepLight: safeOptionalSleepTime(),
    sleepRem: safeOptionalSleepTime(),
    sleepAwake: safeOptionalSleepTime(),
```

### 1.4 `src/lib/utils/date.ts` (lines 221–283)
- `formatSleepTime(val)`: handles numbers `0..24` (`Math.floor(val)` + `Math.round((val - hours) * 60)`), string regex `/^(\d{1,2}):(\d{1,2})$/`, decimal strings `/^\d+(\.\d+)?$/` (supporting `,` and `h`), and invalid/out-of-bound inputs returning `""`.
- `parseSleepInput(val)`: returns `"HH:MM"` string or `null`.
- `isSleepTimeValid(val)`: returns `boolean`.

### 1.5 `src/lib/export.ts` (lines 62–77)
- Header includes Italian sentence case columns: `Ore sonno,Sonno profondo,Sonno leggero,Sonno REM,Tempo sveglio`.
- Formats values via `Logic.formatSleepTime(n.sleepHours)` through `Logic.formatSleepTime(n.sleepAwake)`.
- Uses UTF-8 BOM `\uFEFF` in `downloadFile`.

### 1.6 Unit Tests Executed
- `npm.cmd test -- --run tests/sleep_format.test.ts`: Passed 11/11 tests in 749ms.
- `npm.cmd test -- --run tests/guest_merge.test.ts`: Passed 18/18 tests in 353ms.

---

## 2. Logic Chain

1. **Premise 1 (Deterministic Guest Merge Rule, AGENTS.md Section 2)**: When merging guest and cloud state, guest values must take priority when non-empty, and cloud values must be preserved when guest values are undefined/empty (`pickVal(guest, cloud)`).
2. **Step 1 (Observation 1.1)**: `mergeNutrition` constructs `result[date]` on date collisions without mapping `sleepHours`, `sleepDeep`, `sleepLight`, `sleepRem`, and `sleepAwake`.
3. **Inference 1**: Any guest user logging sleep who links their Google account on a date that already has cloud data will lose their sleep metrics on that date.
4. **Step 2 (Observation 1.3 & 1.4)**: `safeOptionalSleepTime` and `formatSleepTime` correctly handle backward compatibility by parsing both modern `"HH:MM"` strings and legacy decimal numbers (e.g. `7.5` $\rightarrow$ `"07:30"`), returning `undefined` for invalid or empty values.
5. **Step 3 (Observation 1.5)**: `exportToCSV` correctly applies `Logic.formatSleepTime()` to all 5 sleep columns, ensuring Excel output is canonical `HH:MM`.
6. **Step 4 (Observation 1.6)**: The existing test suite covers sleep formatting, validation, and schema sanitization, but lacks an explicit test for `mergeNutrition` preserving sleep fields during guest-to-cloud merge on colliding dates.

---

## 3. Caveats

- **No caveats regarding schema or date utility math**: The regex parsing, decimal float math, and boundary clamping in `formatSleepTime` have been comprehensively validated and tested against adversarial edge cases (`00:00`, `23:59`, `24.0`, negative numbers, NaNs, malformed strings).
- **Scope note**: This report specifically addresses Requirement R1 (Sleep Format in HH:MM). Training cycle end dates (Requirement R5) are investigated by Explorer 2.

---

## 4. Conclusion

1. **Overall Status**: The data model, Zod Gateway (`safeOptionalSleepTime`), date utilities (`formatSleepTime`, `parseSleepInput`, `isSleepTimeValid`), UI inputs (`DataSleep.tsx`), history display (`DataHistory.tsx`), and CSV export (`export.ts`) are **robust, complete, and backwards compatible**.
2. **Defect Identified**: `mergeNutrition` in `src/lib/merge.ts` lacks the 5 sleep properties in `result[date]` on date collisions.
3. **Actionable Implementation Steps**:
   - **Patch `src/lib/merge.ts`**: Add `sleepHours`, `sleepDeep`, `sleepLight`, `sleepRem`, `sleepAwake` to `result[date]` in `mergeNutrition` using `pickVal()`.
   - **Add Merge Unit Test**: Add a test in `tests/guest_merge.test.ts` (or `tests/sleep_format.test.ts`) validating that sleep metrics are merged on date collisions with guest priority.

---

## 5. Verification Method

### 5.1 Verification Commands
To independently verify the implementation and test integrity:
```powershell
npm.cmd test -- --run tests/sleep_format.test.ts tests/guest_merge.test.ts tests/challenger_m1_adversarial_sleep.test.ts tests/challenger_m1_sleep_stress.test.tsx
npm.cmd run build
npm.cmd run lint
```

### 5.2 Files to Inspect
1. `src/lib/merge.ts` (lines 151–172) — verify addition of the 5 sleep fields with `pickVal()`.
2. `src/lib/schema.ts` (lines 5–18, 282–287) — verify `safeOptionalSleepTime` in `NutritionDaySchema`.
3. `src/lib/utils/date.ts` (lines 221–283) — verify `formatSleepTime`, `parseSleepInput`, `isSleepTimeValid`.
4. `src/lib/export.ts` (lines 62–77) — verify CSV column headers and `formatSleepTime` calls.

### 5.3 Invalidation Conditions
- Any test failure in `vitest run`.
- Any TypeScript compilation error in `tsc --noEmit` / `vite build`.
- Any drop of sleep properties during guest-to-cloud merge.
