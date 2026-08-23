# Survey Report: R1 (Formato Sonno HH:MM) & R5 (Data di fine nei Cicli di Allenamento)

**Surveyor**: Teamwork Explorer (Survey Explorer 1)  
**Date**: 2026-08-20  
**Target Repository**: LogBook PWA (`C:\Users\gerar\Documents\GitHub\logbook`)  
**Scope**: 
- **Requirement R1**: Formato Sonno in `HH:MM` (input, display, schema validation, backward compatibility, CSV export, cloud merge).
- **Requirement R5**: Data di fine nei Cicli di Allenamento (two-way binding with duration in weeks, date math, schedule calculations, cycle card, timeline).

---

## 1. Executive Summary

This investigation analyzed the implementation details, data models, schema validation pipelines, date math logic, user interfaces, export systems, and edge cases for requirements **R1** and **R5** across the LogBook codebase.

- **R1 (Sleep in HH:MM)**: The application stores daily metrics in `UserData.nutrition[YYYY-MM-DD]`. Sleep metrics comprise total sleep duration (`sleepHours`) and optional phase breakdowns (`sleepDeep`, `sleepLight`, `sleepRem`, `sleepAwake`). The codebase contains defensive transformation utilities in `src/lib/utils/date.ts` (`formatSleepTime`, `parseSleepInput`, `isSleepTimeValid`), schema transformations in `src/lib/schema.ts` (`safeOptionalSleepTime`), UI inputs in `DataSleep.tsx` (`type="time"` with 16px font-size for iOS), display formatting in `DataHistory.tsx`, and CSV generation in `src/lib/export.ts`.  
  *Critical finding*: `mergeNutrition` in `src/lib/merge.ts` lacks explicit picking for the 5 sleep fields during guest-to-cloud account merging.
- **R5 (Cycle End Date & Two-Way Binding)**: The application manages training cycles via `UserData.trainingCycles`. The `TrainingCycle` model includes `startDate`, `endDate`, `durationWeeks`, and `sessionsPerWeek`. The `CycleEditor.tsx` component implements two-way binding: modifying `durationWeeks` calculates `endDate = start + (weeks * 7 - 1) days`; modifying `endDate` calculates `weeks = Math.round((diffDays + 1) / 7)`. Timeline and scheduling math in `src/lib/calc/planning.ts` (`calculateCycleTimeline`, `calculateCycleSchedule`) fully respects both start and end dates with local date handling per `AGENTS.md`.

---

## 2. Requirement R1: Formato Sonno in HH:MM

### 2.1 Problem Statement & Acceptance Criteria
- **User Requirement**: In the "Sonno" tab (biometrics/data view), convert all input and display fields from decimal format (e.g. `7.5` hours) to `HH:MM` time format (e.g. `07:30`).
- **Acceptance Criteria**:
  1. Entering `"08:30"` into the Sleep form saves and rehydrates accurately without parsing or runtime errors.
  2. Legacy decimal entries (e.g., `7.5`, `1.25`, `8`) in Firestore or IndexedDB are transparently normalized to canonical `HH:MM` strings (`"07:30"`, `"01:15"`, `"08:00"`).
  3. Sleep breakdown phases (Profondo, Leggero, REM, Sveglio) support optional `HH:MM` input and display.
  4. CSV export (`misurazioni.csv`) properly outputs `HH:MM` sleep values.

### 2.2 Data Structures & Storage Architecture
- **Type Definitions (`src/types.ts`, lines 153–178)**:
  ```typescript
  export interface NutritionDay {
      date: string; // YYYY-MM-DD
      kcal: number;
      carbs: number;
      pro: number;
      fat: number;
      weight?: number | string;
      bf?: number | string;
      // ... circumferences ...
      measurementTime?: string;
      isDayOn?: boolean;
      meals?: LoggedMealItem[];
      supplementsIntake?: SupplementIntake[];
      sleepHours?: number | string; // Standard HH:MM e.g. "07:30"
      sleepDeep?: number | string;  // Standard HH:MM e.g. "01:30"
      sleepLight?: number | string; // Standard HH:MM e.g. "04:00"
      sleepRem?: number | string;   // Standard HH:MM e.g. "01:30"
      sleepAwake?: number | string; // Standard HH:MM e.g. "00:30"
  }
  ```
- **Storage Tiering**:
  - **Tier 1 (Cloud Firestore)**: Remote subcollection `users/{uid}/nutrition_months/{YYYY-MM}`, chunked by month. Handled by `DB.saveUserData` and `DB.loadUserData` in `src/lib/db.ts` (lines 113–125, 236–263).
  - **Tier 2 (Global IndexedDB Cache)**: Persisted under `'logbook_cached_user_data'` via `idb-keyval`.
  - **Tier 3 (State / In-Memory)**: Zustand store `useAppStore` (`state.userData.nutrition`).

### 2.3 Runtime Schema & Zod Gateway (`src/lib/schema.ts`)
- **Defensive Sleep Parser (`src/lib/schema.ts`, lines 5–18)**:
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
- **Schema Registration (`src/lib/schema.ts`, lines 282–287)**:
  ```typescript
  export const NutritionDaySchema = z.object({
      date: safeString(''),
      // ... macro & biometric fields ...
      sleepHours: safeOptionalSleepTime(),
      sleepDeep: safeOptionalSleepTime(),
      sleepLight: safeOptionalSleepTime(),
      sleepRem: safeOptionalSleepTime(),
      sleepAwake: safeOptionalSleepTime(),
  }).passthrough().catch({ date: '', kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [], supplementsIntake: [] });
  ```
- **Domain Parser (`src/lib/schema.ts`, lines 441–450)**:
  `DomainParsers.parseNutrition` validates each day record individually, ensuring single corrupt entries do not drop other dates.

### 2.4 Conversion Utilities (`src/lib/utils/date.ts` & `src/lib/logic.ts`)
- **`formatSleepTime(val)` (`src/lib/utils/date.ts`, lines 221–272)**:
  - **Numeric input**: `hours = Math.floor(val)`, `mins = Math.round((val - hours) * 60)`. If `mins >= 60`, increments hour and resets mins to 0. Clamps upper bound to `23:59`. Returns string `"HH:MM"`.
  - **String input**:
    - Matches time pattern `/^(\d{1,2}):(\d{1,2})$/` (e.g. `"8:30"` -> `"08:30"`, `"07:05"` -> `"07:05"`). Validates `0 <= h <= 23` and `0 <= m <= 59`.
    - Matches decimal strings (e.g. `"7.5"`, `"7,5"`, `"8h"`, `"1.25"`) by stripping `h`, replacing `,` with `.`, and calculating hours and minutes.
  - **Invalid/empty values**: Returns empty string `""` for `null`, `undefined`, `""`, `"invalid"`, negative numbers, `NaN`, or out-of-range times (`> 24h` or `> 59m`).
- **`parseSleepInput(val)` (`src/lib/utils/date.ts`, lines 274–278)**:
  Calls `formatSleepTime(val)` and returns canonical `"HH:MM"` or `null`.
- **`isSleepTimeValid(val)` (`src/lib/utils/date.ts`, lines 280–283)**:
  Validates non-empty string format by verifying `parseSleepInput(val) !== null`.
- **Logic Aggregator (`src/lib/logic.ts`, lines 14–16, 86–88, 139–141)**:
  Exposes `formatSleepTime`, `parseSleepInput`, and `isSleepTimeValid` on `Logic`.

### 2.5 UI & Component Layer
- **Hook `useSleepMeasurements` (`src/hooks/useSleepMeasurements.ts`, lines 1–118)**:
  - Manages states: `sleepHours`, `sleepDeep`, `sleepLight`, `sleepRem`, `sleepAwake`, `editingDate`.
  - On mount/date change: reads `nutrition[targetDate]` and populates local state with `Logic.formatSleepTime(targetData.sleepHours)` etc.
  - On submit `saveSleep`:
    - Validates mandatory `sleepHours` with `Logic.isSleepTimeValid`.
    - Validates optional sub-phases (`sleepDeep`, `sleepLight`, `sleepRem`, `sleepAwake`).
    - Parses all non-empty fields to canonical `"HH:MM"` via `Logic.parseSleepInput`.
    - Saves updated `NutritionDay` into Zustand `userData.nutrition[targetDate]`.
    - Displays feedback via `useDialogStore.showAlert`.
- **Component `DataSleep.tsx` (`src/components/Data/DataSleep.tsx`, lines 1–110)**:
  - Uses native `<input type="time" ... />` controls for `sleep-hours`, `sleep-deep`, `sleep-light`, `sleep-rem`, `sleep-awake`.
  - Places placeholders (`"07:30"`, `"01:30"`, `"04:00"`, `"00:30"`).
  - Explicitly enforces `fontSize: '16px'` for Safari iOS auto-zoom prevention per `AGENTS.md`.
- **Component `DataHistory.tsx` (`src/components/Data/DataHistory.tsx`, lines 51–58)**:
  - Renders logged sleep in history item: `{day.sleepHours && <span>| 🌙 Sonno: {Logic.formatSleepTime(day.sleepHours)}</span>}`.
- **Component `DataView.tsx` (`src/components/Data/DataView.tsx`, lines 47–51, 105–109)**:
  - Hosts sub-navigation tab `"Sonno"` (`currentSubTab === 'sleep'`).

### 2.6 CSV Export Integration (`src/lib/export.ts`)
- **`Exporter.exportToCSV` (`src/lib/export.ts`, lines 62–77)**:
  - Header: `Data,Peso (kg),Kcal,Carbo (g),Pro (g),Grassi (g),BF (%),Collo (cm),Torace (cm),Spalle (cm),Braccia (cm),Vita (cm),Fianchi (cm),Cosce (cm),Polpacci (cm),Ore sonno,Sonno profondo,Sonno leggero,Sonno REM,Tempo sveglio,Note`
  - Values formatted via `Logic.formatSleepTime(n.sleepHours)` through `Logic.formatSleepTime(n.sleepAwake)` to ensure consistent `HH:MM` output in `misurazioni.csv`.

### 2.7 Gap Analysis & Findings for R1
- **Critical Gap in `src/lib/merge.ts` (`mergeNutrition`)**:
  In `src/lib/merge.ts` (lines 151–172), when merging guest data with cloud data on date collisions, `mergeNutrition` constructs the merged `NutritionDay` object copying `weight`, `bf`, `neck`, `waist`, `hip`, `chest`, `shoulders`, `biceps`, `thighs`, `calves`, `measurementTime`, `isDayOn`, `meals`, `supplementsIntake`. **However, `sleepHours`, `sleepDeep`, `sleepLight`, `sleepRem`, and `sleepAwake` were omitted from the explicit `pickVal()` mapping.**
  - *Impact*: If a guest user logs sleep data and connects their Google account, their sleep data on matching dates would not be merged into the resulting cloud state.
  - *Recommendation*: Add `pickVal(guestDay.sleepHours, cloudDay.sleepHours)` etc. in `mergeNutrition`.

---

## 3. Requirement R5: Data di fine nei Cicli di Allenamento

### 3.1 Problem Statement & Acceptance Criteria
- **User Requirement**: In the "Nuovo ciclo di allenamento" / "Modifica ciclo" form (`CycleEditor`), below "Data di inizio", add a date picker/indicator for "Data di fine". Implement bidirectional two-way binding:
  - Changing the duration in weeks automatically computes and updates the end date.
  - Changing the end date automatically recalculates and updates the duration in weeks.
- **Acceptance Criteria**:
  1. Selecting 4 weeks starting on `01/09/2026` automatically sets the end date to `28/09/2026` (`start + 4 * 7 - 1` days).
  2. Modifying the end date recalculates the duration in weeks (`Math.round((diffDays + 1) / 7)`).
  3. Modifying the start date shifts the end date preserving duration in weeks.
  4. The cycle card and timeline preview reflect the calculated start and end dates with Italian formatting `dd/MM/yyyy`.

### 3.2 Data Structures & Storage Architecture
- **Type Definitions (`src/types.ts`, lines 210–221)**:
  ```typescript
  export interface TrainingCycle {
      id: string;
      name: string;
      durationWeeks: number; // e.g. 4, 6, 8, 12
      sessionsPerWeek?: number; // Weekly session frequency e.g. 3, 4, 5
      progressionMode?: 'sequential' | 'fixed';
      startDate?: string; // ISO string YYYY-MM-DD
      endDate?: string;   // ISO string YYYY-MM-DD
      notes?: string;
      routines: TrainingCycleRoutineItem[];
      createdAt?: number;
      completedSessionCount?: number;
      isActive?: boolean;
  }
  ```
- **Storage Tiering**:
  - **Firestore**: Root user document `users/{uid}` in the `trainingCycles` array field. Serialized by `DB.saveUserData` in `src/lib/db.ts` (line 191).
  - **IndexedDB**: Cache key `'logbook_cached_user_data'`.
  - **Zustand Store**: `useAppStore` (`state.userData.trainingCycles`).

### 3.3 Runtime Schema & Zod Gateway (`src/lib/schema.ts`)
- **`TrainingCycleSchema` (`src/lib/schema.ts`, lines 319–331)**:
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
  }).passthrough().catch({ id: '', name: '', durationWeeks: 4, routines: [] });
  ```
- **Domain Parser (`src/lib/schema.ts`, lines 423–431)**:
  `DomainParsers.parseTrainingCycles` safely filters and validates training cycles without dropping valid entries.

### 3.4 Date Math & Two-Way Binding Implementation (`CycleEditor.tsx`)
- **Mathematical Helper Functions (`src/components/Training/planning/CycleEditor.tsx`, lines 14–37)**:
  ```typescript
  function computeEndDate(startIso: string, weeks: number): string {
      try {
          const parsed = typeof startIso === 'string' && !startIso.includes('T') 
              ? parseISO(startIso) 
              : new Date(startIso);
          if (!isValid(parsed)) return startIso;
          const totalWeeks = Math.max(1, weeks);
          const end = addDays(startOfDay(parsed), totalWeeks * 7 - 1);
          return format(end, 'yyyy-MM-dd');
      } catch {
          return startIso;
      }
  }

  function computeWeeksFromDates(startIso: string, endIso: string): number {
      try {
          const start = typeof startIso === 'string' && !startIso.includes('T') 
              ? parseISO(startIso) 
              : new Date(startIso);
          const end = typeof endIso === 'string' && !endIso.includes('T') 
              ? parseISO(endIso) 
              : new Date(endIso);
          if (!isValid(start) || !isValid(end)) return 1;
          const diffDays = differenceInCalendarDays(startOfDay(end), startOfDay(start));
          if (diffDays < 0) return 1;
          return Math.max(1, Math.round((diffDays + 1) / 7));
      } catch {
          return 1;
      }
  }
  ```
- **Two-Way Binding Handlers**:
  1. **Weeks changed (`handleDurationWeeksChange`, lines 91–99)**:
     - Sets `durationWeeks`.
     - When `w >= 1` and `startDate` is defined, computes `newEnd = computeEndDate(startDate, w)`.
     - Sets `endDate = newEnd` and `endDateTextInput = Logic.formatItalianDate(newEnd)`.
  2. **Start date text/calendar changed (`handleStartDateTextChange`, `handleStartCalendarDateChange`, lines 101–138)**:
     - Parses input date to ISO format via `Logic.parseDateInput`.
     - Computes `newEnd = computeEndDate(parsedIso, weeks)`.
     - Updates `endDate` and `endDateTextInput`.
  3. **End date text/calendar changed (`handleEndDateTextChange`, `handleEndCalendarDateChange`, lines 140–177)**:
     - Parses input date to ISO format via `Logic.parseDateInput`.
     - Computes `w = computeWeeksFromDates(startDate, parsedIso)`.
     - Updates `durationWeeks = String(w)`.
- **UI Presentation (`src/components/Training/planning/CycleEditor.tsx`, lines 328–468)**:
  - Form layout uses a 2-column grid (`.grid-2.gap-15`) with:
    - "Data di inizio": Text input (`GG/MM/AAAA`) + calendar icon trigger `📅` for native `<input type="date">`.
    - "Data di fine": Text input (`GG/MM/AAAA`) + calendar icon trigger `📅` for native `<input type="date">`.
  - Followed by 2-column grid with "Durata (settimane)" and "Frequenza di allenamento (sedute a settimana)".
  - Live summary callout banner (lines 515–535):
    `Periodo programmato: dal DD/MM/YYYY al DD/MM/YYYY (N settimane)`.

### 3.5 Timeline & Scheduling Logic (`src/lib/calc/planning.ts`)
- **`calculateCycleTimeline` (`src/lib/calc/planning.ts`, lines 35–150)**:
  - Reads `cycle.startDate` and `cycle.endDate`.
  - Falls back to `start + durationWeeks * 7 - 1` if `cycle.endDate` is missing.
  - Compares against local date `currentDate` (`now = startOfDay(today)`).
  - Returns `CycleTimelineInfo`:
    - `formattedStartDate`, `formattedEndDate`, `formattedRange` (`"dal DD/MM/YYYY al DD/MM/YYYY"`).
    - `currentWeek` (1-based index clamped to `totalWeeks`).
    - `isStarted`, `isEnded`, `progressPercent` (0 to 100).
    - `statusLabel` (`"Inizia tra X giorni"`, `"Settimana X di Y"`, `"Ciclo completato"`).
- **`calculateCycleSchedule` (`src/lib/calc/planning.ts`, lines 208–344)**:
  - Generates week-by-week calendar breakdown with session rotation.
  - Maps exact date intervals for each week: `weekStart = addDays(start, (weekNum - 1) * 7)` and `weekEnd = addDays(weekStart, 6)`.
- **Cycle Card Presentation (`src/components/Training/planning/CycleCard.tsx`, lines 63–71, 141–199, 201–222)**:
  - Displays formatted date range: `📅 dal DD/MM/YYYY al DD/MM/YYYY (N sett.) • M sedute / sett.`
  - Renders visual progress bar for active cycles based on `timeline.progressPercent`.
  - Expandable schedule viewer (`🔄 Vedi programmazione`) showing all weeks and planned sessions.

---

## 4. Codebase Reference Matrix

| File Path | Relevant Lines | Component / Function | Purpose / Role |
|---|---|---|---|
| `src/types.ts` | 153–178 | `NutritionDay` | Type definitions for `sleepHours`, `sleepDeep`, `sleepLight`, `sleepRem`, `sleepAwake`. |
| `src/types.ts` | 210–221 | `TrainingCycle` | Type definitions for `startDate`, `endDate`, `durationWeeks`, `sessionsPerWeek`. |
| `src/lib/schema.ts` | 5–18 | `safeOptionalSleepTime` | Zod gateway helper converting number/string to canonical `HH:MM`. |
| `src/lib/schema.ts` | 262–287 | `NutritionDaySchema` | Runtime schema validation for nutrition & sleep metrics. |
| `src/lib/schema.ts` | 319–331 | `TrainingCycleSchema` | Runtime schema validation for training cycles with `startDate` & `endDate`. |
| `src/lib/schema.ts` | 423–450 | `DomainParsers` | Domain level parsers for `trainingCycles` and `nutrition`. |
| `src/lib/utils/date.ts` | 221–283 | `formatSleepTime`, `parseSleepInput`, `isSleepTimeValid` | Core sleep time parsing, formatting, and validation logic. |
| `src/lib/utils/date.ts` | 23–95 | `getLocalDateString`, `formatItalianDate`, `parseDateInput` | Local timezone date formatting and parsing utilities. |
| `src/hooks/useSleepMeasurements.ts` | 1–118 | `useSleepMeasurements` | State management hook for sleep inputs, validation, and storage dispatch. |
| `src/components/Data/DataSleep.tsx` | 1–110 | `DataSleep` | UI component for sleep logging with `<input type="time">`. |
| `src/components/Data/DataHistory.tsx` | 51–58 | `DataHistory` | Displays formatted `HH:MM` sleep metrics in biometric history. |
| `src/components/Data/DataView.tsx` | 14–122 | `DataView` | Sub-navigation container for "Misurazioni", "Sonno", "Biometria", "Storico". |
| `src/lib/export.ts` | 62–77 | `Exporter.exportToCSV` | Formats sleep columns (`Ore sonno`, `Sonno profondo`, etc.) in `misurazioni.csv`. |
| `src/lib/merge.ts` | 151–172 | `mergeNutrition` | Cloud/guest merge logic (needs sleep fields mapping). |
| `src/components/Training/planning/CycleEditor.tsx` | 14–37 | `computeEndDate`, `computeWeeksFromDates` | Math functions for cycle start/end dates and weeks calculation. |
| `src/components/Training/planning/CycleEditor.tsx` | 91–177, 328–468 | `CycleEditor` | Form with two-way binding between duration in weeks and end date picker. |
| `src/components/Training/planning/CycleCard.tsx` | 63–71, 201–222 | `CycleCard` | Card view displaying cycle duration, timeline range, progress bar, and schedule. |
| `src/lib/calc/planning.ts` | 35–150 | `calculateCycleTimeline` | Computes cycle timeline, current week, progress percentage, and status labels. |
| `src/lib/calc/planning.ts` | 208–344 | `calculateCycleSchedule` | Generates weekly rotation schedule and session mapping. |
| `src/lib/db.ts` | 113–125, 236–263 | `DB.loadUserData`, `DB.saveUserData` | Firestore persistence with monthly bucketing (`nutrition_months`) and root cycle storage. |

---

## 5. Architectural Alignment & AGENTS.md Compliance Checklist

1. **Storage Tiering (3-Tier Storage)**:
   - Sleep data resides in Tier 1 (`nutrition_months/{YYYY-MM}`) and Tier 2 (IndexedDB `logbook_cached_user_data`).
   - Training cycles reside in Tier 1 (`users/{uid}.trainingCycles`) and Tier 2 (IndexedDB).
2. **Zod Gateway & Runtime Sanitization**:
   - `safeOptionalSleepTime` defensively protects against `NaN`, corrupt strings, and negative numbers.
   - `TrainingCycleSchema` gracefully handles missing `endDate`, invalid types, and empty arrays.
3. **Date & Timezone Rules**:
   - Strictly avoids `toISOString()` for user data dates. Uses `Logic.getLocalDateString()` and `Logic.parseDateInput()`.
   - Start and end dates are evaluated with `startOfDay` to prevent timezone offsets from shifting dates.
4. **UX & Mobile PWA Constraints**:
   - No `<dialog>` modals used for forms (`CycleEditor` is rendered inline conditional view in `TrainingPlanning.tsx`).
   - Input fields specify `fontSize: '16px'` to eliminate Safari iOS auto-zoom.
   - All user-facing labels use **Sentence case** in Italian (e.g. `"Data di inizio"`, `"Data di fine"`, `"Durata (settimane)"`, `"Ore sonno (totali)"`, `"Sonno profondo"`).
5. **Excel CSV Compatibility**:
   - CSV export uses `\uFEFF` UTF-8 BOM and standard `HH:MM` strings for Excel compatibility.

---

## 6. Recommendations for Implementation & Testing

1. **Patch `mergeNutrition` in `src/lib/merge.ts`**:
   Add the 5 sleep properties to the object returned in line 151:
   ```typescript
   sleepHours: pickVal(guestDay.sleepHours, cloudDay.sleepHours),
   sleepDeep: pickVal(guestDay.sleepDeep, cloudDay.sleepDeep),
   sleepLight: pickVal(guestDay.sleepLight, cloudDay.sleepLight),
   sleepRem: pickVal(guestDay.sleepRem, cloudDay.sleepRem),
   sleepAwake: pickVal(guestDay.sleepAwake, cloudDay.sleepAwake),
   ```
2. **Automated Test Suite Verification**:
   - Vitest suite covers unit tests in `tests/sleep_format.test.ts` and `tests/cycle_end_date.test.tsx`.
   - Run verification command:
     `npm.cmd test -- --run tests/sleep_format.test.ts tests/cycle_end_date.test.tsx`
   - Run build check:
     `npm.cmd run build`
   - Run linter:
     `npm.cmd run lint`
