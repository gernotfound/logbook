# Technical Analysis Report: Requirement R1 (Sleep Format in HH:MM)

**Author**: Teamwork Explorer 1 (Milestone M1)  
**Date**: 2026-08-20  
**Target Project**: LogBook PWA (`C:\Users\gerar\Documents\GitHub\logbook`)  
**Scope**: Requirement R1 — Sleep Format in `HH:MM` (Data Model, Deterministic Guest Merge, Zod Gateway Schema Validation, Date/Time Utilities, CSV Export, Test Coverage).

---

## 1. Executive Summary & Objective

Requirement **R1** upgrades all sleep metrics (total sleep, deep sleep, light sleep, REM sleep, awake time) across LogBook to use standard `HH:MM` time format (e.g., `"07:30"`, `"01:45"`), replacing legacy decimal values (e.g. `7.5`, `1.75`), while preserving 100% backwards compatibility with historical entries stored in Firestore and IndexedDB.

This investigation conducted a code-level audit across 5 architectural pillars:
1. **Merge Logic (`src/lib/merge.ts`)**: Audit of `mergeNutrition` and `mergeUserData` for deterministic guest merge compliance.
2. **Schema & Types (`src/lib/schema.ts` & `src/types.ts`)**: Analysis of `safeOptionalSleepTime`, `NutritionDaySchema`, and `NutritionDay` interface.
3. **Date/Time Utilities (`src/lib/utils/date.ts` & `src/lib/logic.ts`)**: Verification of `formatSleepTime`, `parseSleepInput`, `isSleepTimeValid`, decimal-to-`HH:MM` math, string normalization, and boundary clamping.
4. **CSV Export System (`src/lib/export.ts`)**: Verification of CSV header compliance, formatting in `misurazioni.csv`, and UTF-8 BOM encoding for Excel.
5. **Testing & Verification (`tests/`)**: Review of test coverage in `tests/sleep_format.test.ts`, `tests/challenger_m1_adversarial_sleep.test.ts`, `tests/challenger_m1_sleep_stress.test.tsx`, and identification of test gaps.

---

## 2. Investigation Pillar 1: Deterministic Guest Merge (`src/lib/merge.ts`)

### 2.1 Direct Code Observation
In `src/lib/merge.ts`, `mergeNutrition` handles merging cloud nutrition records with guest nutrition records (lines 105–176):

```typescript
export function mergeNutrition(
    cloudNut?: Record<string, NutritionDay> | null,
    guestNut?: Record<string, NutritionDay> | null
): Record<string, NutritionDay> {
    const result: Record<string, NutritionDay> = {};
    const cloud = cloudNut || {};
    const guest = guestNut || {};
    const allDates = Array.from(new Set([...Object.keys(cloud), ...Object.keys(guest)]));

    for (const date of allDates) {
        const cloudDay = cloud[date];
        const guestDay = guest[date];

        if (cloudDay && !guestDay) {
            result[date] = { ...cloudDay };
        } else if (!cloudDay && guestDay) {
            result[date] = { ...guestDay };
        } else if (cloudDay && guestDay) {
            const mergedMeals = mergeArrayById(cloudDay.meals, guestDay.meals);
            const mergedSupplementsIntake = mergeArrayById(cloudDay.supplementsIntake, guestDay.supplementsIntake);
            // ... macro recalculations ...
            const pickVal = (gVal: any, cVal: any) =>
                (gVal !== undefined && gVal !== null && gVal !== '') ? gVal : cVal;

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
        }
    }

    return result;
}
```

### 2.2 Critical Finding: Sleep Metrics Omission on Date Collisions
- **Defect**: When a date exists in both cloud and guest datasets (`cloudDay && guestDay`), lines 151–172 construct the merged `NutritionDay` without copying `sleepHours`, `sleepDeep`, `sleepLight`, `sleepRem`, or `sleepAwake`.
- **Root Cause**: The properties were omitted from the explicit mapping object in `result[date]`.
- **Consequence**: If a guest user logs sleep metrics on a date for which cloud data already exists (e.g. earlier meals logged on cloud), and then logs in or links their Google account, **all 5 sleep properties are dropped** for that date.
- **Architectural Requirement (AGENTS.md Section 2)**: All biometric and nutrition day fields must be merged deterministically per date key using `pickVal` (guest priority when defined/non-empty, otherwise cloud).

### 2.3 Concrete Implementation Recommendation
In `src/lib/merge.ts`, update `result[date]` in `mergeNutrition` (around line 170) to include:

```typescript
                sleepHours: pickVal(guestDay.sleepHours, cloudDay.sleepHours),
                sleepDeep: pickVal(guestDay.sleepDeep, cloudDay.sleepDeep),
                sleepLight: pickVal(guestDay.sleepLight, cloudDay.sleepLight),
                sleepRem: pickVal(guestDay.sleepRem, cloudDay.sleepRem),
                sleepAwake: pickVal(guestDay.sleepAwake, cloudDay.sleepAwake),
```

---

## 3. Investigation Pillar 2: Schema & Types (`src/lib/schema.ts` & `src/types.ts`)

### 3.1 Type Definitions (`src/types.ts`)
In `src/types.ts` (lines 153–178), `NutritionDay` defines the sleep properties as:
```typescript
export interface NutritionDay {
    date: string;
    kcal: number;
    carbs: number;
    pro: number;
    fat: number;
    weight?: number | string;
    bf?: number | string;
    neck?: number | string;
    waist?: number | string;
    hip?: number | string;
    chest?: number | string;
    shoulders?: number | string;
    biceps?: number | string;
    thighs?: number | string;
    calves?: number | string;
    measurementTime?: string;
    isDayOn?: boolean;
    meals?: LoggedMealItem[];
    supplementsIntake?: SupplementIntake[];
    sleepHours?: number | string;
    sleepDeep?: number | string;
    sleepLight?: number | string;
    sleepRem?: number | string;
    sleepAwake?: number | string;
}
```

### 3.2 Runtime Sanitization Gateway (`src/lib/schema.ts`)
In `src/lib/schema.ts` (lines 5–18, 282–287):
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
In `NutritionDaySchema`:
```typescript
export const NutritionDaySchema = z.object({
    date: safeString(''),
    kcal: safeNumber(0),
    carbs: safeNumber(0),
    pro: safeNumber(0),
    fat: safeNumber(0),
    // ... body measurements ...
    sleepHours: safeOptionalSleepTime(),
    sleepDeep: safeOptionalSleepTime(),
    sleepLight: safeOptionalSleepTime(),
    sleepRem: safeOptionalSleepTime(),
    sleepAwake: safeOptionalSleepTime(),
}).passthrough().catch({ date: '', kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [], supplementsIntake: [] }).default({ date: '', kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [], supplementsIntake: [] });
```

### 3.3 Storage vs Runtime Representation
- **Runtime format**: String in format `"HH:MM"` (e.g. `"07:30"`), or `undefined` if not set.
- **Stored format in IndexedDB**: String `"HH:MM"` or `undefined` (omitted from JSON object).
- **Stored format in Firestore (`nutrition_months/{YYYY-MM}`)**: `removeUndefinedValues()` strips `undefined` keys before writing to Firestore. On hydration via `DB.loadUserData` $\rightarrow$ `DomainParsers.parseNutrition` $\rightarrow$ `NutritionDaySchema.parse()`, missing fields or legacy numbers are parsed and returned as canonical `"HH:MM"` strings.
- **Defense against corruption**: If invalid strings (e.g., `"invalid"`, `"25:00"`, `NaN`, `-5`) or unexpected object structures enter the system, `safeOptionalSleepTime` returns `undefined` via `.catch(undefined)`, guaranteeing zero runtime crashes in React components.

---

## 4. Investigation Pillar 3: Date/Time Utilities (`src/lib/utils/date.ts` & `src/lib/logic.ts`)

### 4.1 Utility Functions Analysis
In `src/lib/utils/date.ts` (lines 221–283):

```typescript
export function formatSleepTime(val: number | string | undefined | null): string {
    if (val === undefined || val === null) return '';
    if (typeof val === 'number') {
        if (isNaN(val) || !isFinite(val) || val < 0 || val > 24) return '';
        let hours = Math.floor(val);
        let mins = Math.round((val - hours) * 60);
        if (mins >= 60) {
            hours += 1;
            mins = 0;
        }
        if (hours > 23) {
            hours = 23;
            mins = 59;
        }
        return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
    }
    if (typeof val === 'string') {
        const trimmed = val.trim();
        if (!trimmed) return '';

        // Match HH:MM or H:MM
        const timeMatch = trimmed.match(/^(\d{1,2}):(\d{1,2})$/);
        if (timeMatch) {
            const h = parseInt(timeMatch[1], 10);
            const m = parseInt(timeMatch[2], 10);
            if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
                return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
            }
            return '';
        }

        // Match decimal number string e.g. "7.5", "7,5", "8h", "1.25"
        const cleaned = trimmed.replace(/h/i, '').replace(',', '.').trim();
        if (/^\d+(\.\d+)?$/.test(cleaned)) {
            const num = parseFloat(cleaned);
            if (!isNaN(num) && isFinite(num) && num >= 0 && num <= 24) {
                let hours = Math.floor(num);
                let mins = Math.round((num - hours) * 60);
                if (mins >= 60) {
                    hours += 1;
                    mins = 0;
                }
                if (hours > 23) {
                    hours = 23;
                    mins = 59;
                }
                return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
            }
        }
    }
    return '';
}

export function parseSleepInput(val: string | number | undefined | null): string | null {
    if (val === undefined || val === null) return null;
    const formatted = formatSleepTime(val);
    return formatted !== '' ? formatted : null;
}

export function isSleepTimeValid(val: string | undefined | null): boolean {
    if (!val || typeof val !== 'string' || !val.trim()) return false;
    return parseSleepInput(val) !== null;
}
```

### 4.2 Backwards Compatibility Math Matrix

| Input Format | Sample Input | Parsed `hours` | Parsed `mins` | Formatted Output | Valid? |
|---|---|---|---|---|---|
| Decimal float | `7.5` | `7` | `Math.round(0.5 * 60) = 30` | `"07:30"` | Yes |
| Decimal float | `1.25` | `1` | `Math.round(0.25 * 60) = 15` | `"01:15"` | Yes |
| Decimal float | `6.75` | `6` | `Math.round(0.75 * 60) = 45` | `"06:45"` | Yes |
| Decimal float | `8.3333` | `8` | `Math.round(0.3333 * 60) = 20` | `"08:20"` | Yes |
| Integer number | `8` | `8` | `0` | `"08:00"` | Yes |
| Zero | `0` | `0` | `0` | `"00:00"` | Yes |
| Upper bound float | `23.5` | `23` | `30` | `"23:30"` | Yes |
| Clamp 24.0 | `24` | `24` $\rightarrow$ `23` | `59` | `"23:59"` | Yes |
| Comma decimal string | `"7,5"` | `7` | `30` | `"07:30"` | Yes |
| Suffix "h" string | `"8h"` | `8` | `0` | `"08:00"` | Yes |
| Suffix "h" decimal | `"7.5h"` | `7` | `30` | `"07:30"` | Yes |
| Time string without pad | `"8:30"` | `8` | `30` | `"08:30"` | Yes |
| Single digit minute | `"7:5"` | `7` | `5` | `"07:05"` | Yes |
| Canonical string | `"07:30"` | `7` | `30` | `"07:30"` | Yes |
| Negative number | `-1` | — | — | `""` | No |
| Out of bounds hour | `"25:00"` | `25` | — | `""` | No |
| Out of bounds minute | `"08:60"` | — | `60` | `""` | No |
| Corrupt text | `"random"` | — | — | `""` | No |
| Null / Undefined | `null` | — | — | `""` | No |

---

## 5. Investigation Pillar 4: CSV Export System (`src/lib/export.ts`)

### 5.1 CSV Export Logic
In `src/lib/export.ts` (lines 62–77):
```typescript
let nutritionCsv = "Data,Peso (kg),Kcal,Carbo (g),Pro (g),Grassi (g),BF (%),Collo (cm),Torace (cm),Spalle (cm),Braccia (cm),Vita (cm),Fianchi (cm),Cosce (cm),Polpacci (cm),Ore sonno,Sonno profondo,Sonno leggero,Sonno REM,Tempo sveglio,Note\n";
const nutritionDates = Object.keys(nutrition).sort();
nutritionDates.forEach(date => {
    const n = nutrition[date];
    let safeNotes = "";
    if (n.notes) {
        safeNotes = `"${n.notes.replace(/(\r\n|\n|\r)/gm, " ").replace(/"/g, '""')}"`;
    }
    const sHours = Logic.formatSleepTime(n.sleepHours);
    const sDeep = Logic.formatSleepTime(n.sleepDeep);
    const sLight = Logic.formatSleepTime(n.sleepLight);
    const sRem = Logic.formatSleepTime(n.sleepRem);
    const sAwake = Logic.formatSleepTime(n.sleepAwake);
    nutritionCsv += `${date},${n.weight || ''},${n.kcal || ''},${n.carbs || ''},${n.pro || ''},${n.fat || ''},${n.bf || ''},${n.neck || ''},${n.chest || ''},${n.shoulders || ''},${n.biceps || ''},${n.waist || ''},${n.hips || n.hip || ''},${n.thighs || ''},${n.calves || ''},${sHours},${sDeep},${sLight},${sRem},${sAwake},${safeNotes}\n`;
});
```

### 5.2 Verification Findings
1. **Sentence Case Compliance**: The column headers `"Ore sonno"`, `"Sonno profondo"`, `"Sonno leggero"`, `"Sonno REM"`, `"Tempo sveglio"` strictly respect AGENTS.md Rule 11.
2. **Standard HH:MM Formatting**: Every sleep field is passed through `Logic.formatSleepTime()` before CSV string concatenation. If a record has legacy numeric `7.5`, it outputs `"07:30"`. If empty, it outputs an empty cell `""`.
3. **Excel Compatibility**: `downloadFile` prepends UTF-8 Byte Order Mark `\uFEFF`, preventing character encoding corruption when opening `misurazioni.csv` in Excel on Windows and macOS.

---

## 6. Investigation Pillar 5: Test Coverage & Gap Analysis

### 6.1 Existing Test Suites
The codebase currently contains:
1. `tests/sleep_format.test.ts`:
   - 11 unit tests covering `Logic.formatSleepTime`, `Logic.parseSleepInput`, `Logic.isSleepTimeValid`, `NutritionDaySchema`, `UserDataSchema`, and CSV export.
   - Verified passing with exit code 0.
2. `tests/challenger_m1_adversarial_sleep.test.ts`:
   - Exhaustive boundary tests, float precision, malformed strings, prototype pollution resistance, `useSleepMeasurements` hook validation, sentence case UI rendering.
3. `tests/challenger_m1_sleep_stress.test.tsx`:
   - Integrated UI component rendering (`DataSleep` + `DataHistory`), form state synchronization, hydration from legacy formats, clearing optional phases, save alerts.

### 6.2 Test Gap Identified
- In `tests/guest_merge.test.ts`, there is no test verifying that sleep metrics (`sleepHours`, `sleepDeep`, `sleepLight`, `sleepRem`, `sleepAwake`) are merged when `guestDay` and `cloudDay` share the same date.
- **Recommended Test Case** (to be added to `tests/guest_merge.test.ts` or `tests/sleep_format.test.ts`):
  ```typescript
  it('merges sleep metrics (sleepHours, sleepDeep, sleepLight, sleepRem, sleepAwake) across matching dates', () => {
      const cloudDay = {
          date: '2026-08-20',
          kcal: 2000, carbs: 200, pro: 150, fat: 50,
          sleepHours: '07:00',
          sleepDeep: '01:30'
      };
      const guestDay = {
          date: '2026-08-20',
          sleepHours: '08:30', // guest overwrites cloud
          sleepLight: '04:30', // guest adds new field
          sleepRem: '01:30'    // guest adds new field
      };

      const merged = mergeNutrition({ '2026-08-20': cloudDay as any }, { '2026-08-20': guestDay as any });
      const day = merged['2026-08-20'];

      expect(day.sleepHours).toBe('08:30'); // guest priority
      expect(day.sleepDeep).toBe('01:30');  // cloud preserved
      expect(day.sleepLight).toBe('04:30'); // guest added
      expect(day.sleepRem).toBe('01:30');   // guest added
  });
  ```

---

## 7. Comprehensive Code Reference Matrix

| File Path | Line Range | Function / Entity | Role in R1 | Status / Actions Needed |
|---|---|---|---|---|
| `src/types.ts` | 173–177 | `NutritionDay` | Defines `sleepHours`, `sleepDeep`, `sleepLight`, `sleepRem`, `sleepAwake` as `number \| string`. | Complete & aligned. |
| `src/lib/schema.ts` | 5–18 | `safeOptionalSleepTime` | Transforms input (number/string) to canonical `"HH:MM"` or `undefined`. | Complete & aligned. |
| `src/lib/schema.ts` | 282–287 | `NutritionDaySchema` | Validates daily nutrition & sleep schema. | Complete & aligned. |
| `src/lib/utils/date.ts` | 221–283 | `formatSleepTime`, `parseSleepInput`, `isSleepTimeValid` | Decimal math, string regex parsing, and validation helpers. | Complete & aligned. |
| `src/lib/logic.ts` | 14–16, 86–88 | `Logic` aggregator | Exposes date and sleep helpers to components and hooks. | Complete & aligned. |
| `src/lib/merge.ts` | 151–172 | `mergeNutrition` | Cloud/guest merge on date collision. | **Needs patch**: add 5 sleep properties to merged object. |
| `src/lib/export.ts` | 62–77 | `Exporter.exportToCSV` | Exports formatted `HH:MM` sleep metrics in `misurazioni.csv`. | Complete & aligned. |
| `src/hooks/useSleepMeasurements.ts` | 1–118 | `useSleepMeasurements` | Hook managing sleep form state, validation, and storage dispatch. | Complete & aligned. |
| `src/components/Data/DataSleep.tsx` | 1–110 | `DataSleep` | UI component with `<input type="time">` and Sentence case labels. | Complete & aligned. |
| `src/components/Data/DataHistory.tsx` | 51–58 | `DataHistory` | Displays formatted `HH:MM` sleep in measurement history cards. | Complete & aligned. |
| `tests/sleep_format.test.ts` | 1–235 | Unit tests | Tests sleep logic, schema, and CSV export. | Passing (11 tests). |

---

## 8. Summary of Recommendations for Implementer

1. **Implementer Action 1**: Update `src/lib/merge.ts` in `mergeNutrition` (line 151) to map `sleepHours`, `sleepDeep`, `sleepLight`, `sleepRem`, and `sleepAwake` using `pickVal()`.
2. **Implementer Action 2**: Add a dedicated unit test in `tests/guest_merge.test.ts` verifying guest/cloud merge of sleep metrics across matching dates.
3. **Verification Command**:
   ```powershell
   npm.cmd test -- --run tests/sleep_format.test.ts tests/guest_merge.test.ts tests/challenger_m1_adversarial_sleep.test.ts tests/challenger_m1_sleep_stress.test.tsx
   npm.cmd run build
   npm.cmd run lint
   ```
