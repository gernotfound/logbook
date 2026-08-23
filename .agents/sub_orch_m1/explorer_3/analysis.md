# Comprehensive Analysis: Requirement R5 (Training Cycle End Date & Two-Way Binding)

**Author**: Explorer 3 (Milestone M1 — Data & Planning Enhancements)  
**Date**: 2026-08-20  
**Working Directory**: `C:\Users\gerar\Documents\GitHub\logbook\.agents\sub_orch_m1\explorer_3`  
**Target Repository**: LogBook PWA (`C:\Users\gerar\Documents\GitHub\logbook`)  

---

## 1. Executive Summary

Requirement **R5** introduces an explicit **"Data di fine"** (End Date) indicator/picker in the training cycle editor (`CycleEditor.tsx`), coupled with **bidirectional two-way binding** between the duration in weeks (`durationWeeks`) and the end date (`endDate`).

Key Findings:
1. **Data Model & Zod Schema**: The `TrainingCycle` interface in `src/types.ts` already contains optional `startDate?: string` and `endDate?: string` (formatted as ISO `YYYY-MM-DD`). The Zod gateway in `src/lib/schema.ts` (`TrainingCycleSchema` and `DomainParsers.parseTrainingCycles`) validates, sanitizes, and preserves `endDate` without stripping it or crashing on corrupt types.
2. **Calculation Engine & Math**: The core date math (`computeEndDate` and `computeWeeksFromDates`) uses `date-fns` functions (`parseISO`, `startOfDay`, `addDays`, `differenceInCalendarDays`, `format`). End date is calculated as `start + (durationWeeks * 7 - 1)` days (inclusive interval). Weeks calculation is calculated as `Math.max(1, Math.round((differenceInCalendarDays(end, start) + 1) / 7))`.
3. **Timezone & Local Date Handling**: In accordance with `AGENTS.md`, dates are never handled with naive UTC `toISOString()`. Instead, `Logic.getLocalDateString()` and `Logic.parseDateInput()` manage local date strings, and `startOfDay` prevents UTC midnight shifts from distorting calendar day differences.
4. **UI Implementation & Mobile UX**: `CycleEditor.tsx` implements dual text inputs (`GG/MM/AAAA`) with calendar triggers (`📅` invoking native `<input type="date">` with `16px` font size for Safari iOS). Text blur handles auto-formatting and recovery from invalid partial inputs. `CycleCard.tsx` and `TrainingPlanning.tsx` display the computed date range (`📅 dal DD/MM/YYYY al DD/MM/YYYY (N sett.)`), status labels, and a progress bar.
5. **Quality & Test Coverage**: 53 unit, integration, and adversarial tests currently verify R5 in `tests/cycle_end_date.test.tsx`, `tests/challenger_cycle_editor_interaction.test.tsx`, `tests/challenger_m2_empirical_cycle_math.test.ts`, and `tests/training_planning.test.tsx`, passing with 100% success.
6. **Architectural Recommendation**: Export `computeEndDate` and `computeWeeksFromDates` from `src/lib/calc/planning.ts` (and expose on `Logic`) rather than keeping them duplicated as private helper functions across `CycleEditor.tsx` and test files.

---

## 2. Deep Dive: Calculation Logic & Date-fns Usage (`src/lib/calc/planning.ts`)

### 2.1 Existing Planning Functions
The file `src/lib/calc/planning.ts` contains four key calculation functions:

| Function | Signature | Purpose & Behavior |
|---|---|---|
| `calculateCycleTimeline` | `(cycle: TrainingCycle \| null, currentDate?: Date \| string) => CycleTimelineInfo` | Calculates timeline metrics: `formattedStartDate`, `formattedEndDate`, `formattedRange` (`"dal DD/MM/YYYY al DD/MM/YYYY"`), `currentWeek`, `totalWeeks`, `isStarted`, `isEnded`, `progressPercent`, `statusLabel` (`"Inizia tra X giorni"`, `"Settimana X di Y"`, `"Ciclo completato"`), and `daysRemaining`. Respects explicit `cycle.endDate` if valid (`differenceInCalendarDays >= 0`), otherwise falls back to `start + totalWeeks * 7 - 1`. |
| `calculateCycleSchedule` | `(cycle: TrainingCycle \| null, routines: WorkoutRoutine[]) => CycleScheduleResult` | Generates a complete week-by-week schedule (`weeks: WeeklyCycleSchedule[]`) mapping session indices to routine names, rotations (`rotationNumber`), and exact week date ranges (`DD/MM - DD/MM`). |
| `getNextScheduledRoutine` | `(cycle: TrainingCycle \| null, routines: WorkoutRoutine[], history: WorkoutSession[]) => NextScheduledRoutineResult \| null` | Determines the next routine in the sequential rotation by counting completed sessions in `history` belonging to the active cycle (`completedCount % N`). |
| `calculateCycleVolume` | `(cycle: TrainingCycle \| null, routines: WorkoutRoutine[], library: Exercise[]) => CycleVolumeResult` | Calculates weekly volume (sets per muscle group) and returns color highlights for the `MuscleModel` heatmap. |

### 2.2 Date Math Formulas for Two-Way Binding
The two-way binding requires two complementary mathematical transformations:

#### Formula 1: Duration in Weeks $\rightarrow$ End Date
Given a start date $S$ (local midnight) and duration in weeks $W \ge 1$:
$$\text{Total Inclusive Days} = W \times 7$$
$$\text{End Date } E = S + (W \times 7 - 1) \text{ days}$$

- *Example 1*: Start = `2026-08-20`, Weeks = 4  
  $E = \text{2026-08-20} + 27 \text{ days} = \text{2026-09-16}$ (inclusive period of 28 days: 12 in Aug + 16 in Sept).
- *Example 2*: Start = `2026-09-01`, Weeks = 4  
  $E = \text{2026-09-01} + 27 \text{ days} = \text{2026-09-28}$.
- *Example 3*: Start = `2026-12-25`, Weeks = 4 (Year Transition)  
  $E = \text{2026-12-25} + 27 \text{ days} = \text{2027-01-21}$.

#### Formula 2: End Date $\rightarrow$ Duration in Weeks
Given a start date $S$ and an end date $E$:
$$\Delta_{\text{days}} = \text{differenceInCalendarDays}(E, S)$$
$$\text{If } \Delta_{\text{days}} < 0 \implies W = 1 \text{ (clamped)}$$
$$\text{Otherwise, } W = \max\left(1, \text{round}\left(\frac{\Delta_{\text{days}} + 1}{7}\right)\right)$$

- *Example 1*: Start = `2026-08-20`, End = `2026-09-30`  
  $\Delta_{\text{days}} = 41 \text{ days} \implies \text{Total days} = 42 \implies 42 / 7 = 6 \text{ weeks}$.
- *Example 2*: Start = `2026-08-20`, End = `2026-09-28` (Non-exact multiple)  
  $\Delta_{\text{days}} = 39 \text{ days} \implies \text{Total days} = 40 \implies 40 / 7 = 5.71 \implies \text{round} = 6 \text{ weeks}$.
- *Example 3*: Inverted dates (End = `2026-08-10` < Start = `2026-08-20`)  
  $\Delta_{\text{days}} = -10 < 0 \implies \text{clamped to } 1 \text{ week}$.

### 2.3 Timezone Safety & Local Date Guarantees
Per `AGENTS.md` (Section 4):
1. **Prohibition of UTC `toISOString()`**: ISO strings generated via `date.toISOString()` convert midnight in local time (e.g. `2026-08-20T00:00:00+02:00`) to UTC (`2026-08-19T22:00:00Z`), corrupting calendar dates.
2. **Standard Local Date Format**: All dates are stored as ISO date-only strings (`YYYY-MM-DD`) generated via `Logic.getLocalDateString()`.
3. **Defensive Parsing with `startOfDay`**: When converting strings to `Date` objects, `parseISO(dateStr)` or `Logic.parseDateInput(dateStr)` is used and normalized with `startOfDay(parsed)` to zero out hours, minutes, and seconds.
4. **Italian Display Format**: User-facing date inputs display dates in Italian `GG/MM/AAAA` format via `Logic.formatItalianDate()`, parsing user text with `Logic.parseDateInput()`.

---

## 3. Deep Dive: CycleEditor UI & Two-Way Reactive Binding (`CycleEditor.tsx`)

### 3.1 Component Architecture & State Management
In `src/components/Training/planning/CycleEditor.tsx`, the editor is an inline form container (avoiding modal `<dialog>` per AGENTS.md rule 7).

```
CycleEditor State:
├── name: string ('')
├── startDate: string ('YYYY-MM-DD')
├── dateTextInput: string ('DD/MM/YYYY')
├── endDate: string ('YYYY-MM-DD')
├── endDateTextInput: string ('DD/MM/YYYY')
├── durationWeeks: string ('4' | '6' | ...)
├── sessionsPerWeek: string ('3' | '4' | ...)
├── notes: string ('')
└── cycleRoutines: TrainingCycleRoutineItem[]
```

### 3.2 Bidirectional Event Handlers

1. **Duration Weeks Change (`handleDurationWeeksChange`)**:
   - When user changes weeks, if `parseInt(val) >= 1`, computes `newEnd = computeEndDate(startDate, w)` and updates `endDate` (ISO) and `endDateTextInput` (`DD/MM/YYYY`).
2. **Start Date Text Change & Blur (`handleStartDateTextChange`, `handleStartDateTextBlur`)**:
   - Updates `startDate`, recomputes `endDate = computeEndDate(newStart, weeks)`, preserving `durationWeeks`.
   - On blur, auto-formats or rolls back to the last valid formatted date.
3. **Start Date Native Calendar Picker (`handleStartCalendarDateChange`)**:
   - Triggered via calendar icon button `📅`. Updates `startDate`, sets `dateTextInput`, and recomputes `endDate`.
4. **End Date Text Change & Blur (`handleEndDateTextChange`, `handleEndDateTextBlur`)**:
   - Updates `endDate = parsedIso`, calculates `w = computeWeeksFromDates(startDate, parsedIso)`, and updates `durationWeeks = String(w)`.
   - On blur, re-normalizes `endDateTextInput` to `Logic.formatItalianDate(endDate)`.
5. **End Date Native Calendar Picker (`handleEndCalendarDateChange`)**:
   - Updates `endDate = val`, `endDateTextInput = Logic.formatItalianDate(val)`, and updates `durationWeeks = String(computeWeeksFromDates(startDate, val))`.
6. **Form Submission (`handleSubmit`)**:
   - Validates name and routine count $\ge 1$.
   - Prepares sanitized `TrainingCycle` object with both `startDate` and `endDate`.
   - Invokes `onSave(cycle)`.

### 3.3 UI Layout & Italian Sentence Case Compliance
In compliance with `AGENTS.md` (Section 10 & 11):
- **Form Layout**: Responsive 2-column grid (`.grid-2.gap-15`) with text input + calendar picker button.
- **Font Size**: Explicit `fontSize: '16px'` on all inputs (`#cycle-name`, `#cycle-start-date`, `#cycle-end-date`, `#cycle-duration-weeks`, `#cycle-sessions-per-week`, `<textarea>`) to prevent Safari iOS auto-zoom.
- **Labels (Sentence Case)**:
  - `"Data di inizio"`
  - `"Data di fine"`
  - `"Durata (settimane)"`
  - `"Frequenza di allenamento (sedute a settimana)"`
  - `"Note o obiettivo (opzionale)"`
  - `"Sequenza rotazione schede"`
  - `"Periodo programmato: dal DD/MM/YYYY al DD/MM/YYYY (N settimane)"`

---

## 4. Visual Presentation in CycleCard & TrainingPlanning

### 4.1 `CycleCard.tsx`
- **Header Line**:
  - When `cycle.startDate` exists: `📅 dal DD/MM/YYYY al DD/MM/YYYY (N sett.) • M sedute / sett.`
  - When no `startDate`: `Durata: N settimane • M sedute / sett.`
- **Active Cycle Status & Progress Bar**:
  - Shows `timeline.statusLabel` (e.g. `"Settimana 2 di 4"` or `"Inizia tra 3 giorni"`).
  - Renders progress bar with width `${timeline.progressPercent}%` and smooth CSS transition.
- **Expandable Schedule Viewer**:
  - `🔄 Vedi programmazione (X sedute su Y sett.)` expands week-by-week badges showing `#1 Scheda A`, `#2 Scheda B`, etc.

### 4.2 `TrainingPlanning.tsx`
- **Active Cycle Card**:
  - Shows cycle name, duration in weeks, total sessions, and weekly sets.
  - Shows timeline badge `📅 dal DD/MM/YYYY al DD/MM/YYYY` with completion percentage.
  - Displays full `MuscleModel` heatmap and breakdown accordion.
- **Cycles Archive List**:
  - Lists all saved cycles via `<CycleCard />`.
  - Provides actions: `⭐ Imposta come ciclo attivo`, `⏸️ Disattiva`, `✏️ Modifica`, `📋 Duplica`, `🗑️ Elimina`.

---

## 5. Storage Tiering & 5-Step Checklist Validation

Training cycles conform to the 3-Tier Storage architecture defined in `AGENTS.md`:

1. **Tier 1 (Cloud Firestore)**: Serialized inside root user document `users/{uid}.trainingCycles` by `DB.saveUserData` (`src/lib/db.ts`, line 191).
2. **Tier 2 (IndexedDB Cache)**: Persisted under `'logbook_cached_user_data'`.
3. **Tier 3 (State / Store)**: Zustand store `useAppStore` (`state.userData.trainingCycles` and `state.userData.activeCycleId`).

### 5-Step Checklist Status for `TrainingCycle.endDate`:
1. `src/types.ts`: `TrainingCycle` interface defines `endDate?: string` (Line 216).
2. `src/lib/schema.ts`: `TrainingCycleSchema` validates `endDate: safeOptionalString()` (Line 326) and `defaultUserDataFallback` defines `trainingCycles: []`.
3. `src/lib/db.ts`: `DB.loadUserData` and `DB.saveUserData` include `trainingCycles: state.trainingCycles || []` in diffing and serialization.
4. `src/contexts/AuthContext.tsx`: Initialized in `defaultUserData` (`trainingCycles: []`, `activeCycleId: null`).
5. `src/lib/export.ts`: Not applicable to workout CSV export, but cycles persist across cloud backups and restores.

---

## 6. Test Suite & Verification Results

### 6.1 Test Suites Inspected
The project contains 4 dedicated test suites covering R5:
- `tests/cycle_end_date.test.tsx` (12 tests)
- `tests/challenger_cycle_editor_interaction.test.tsx` (12 tests)
- `tests/challenger_m2_empirical_cycle_math.test.ts` (16 tests)
- `tests/training_planning.test.tsx` (13 tests)

### 6.2 Execution Results
- **Vitest Run**: `npm.cmd test -- --run tests/cycle_end_date.test.tsx tests/challenger_cycle_editor_interaction.test.tsx tests/challenger_m2_empirical_cycle_math.test.ts tests/training_planning.test.tsx`
  - **Result**: **53 tests passed out of 53** (0 failures).
- **TypeScript Build**: `npm.cmd run build` (`tsc --noEmit && vite build`)
  - **Result**: Built successfully with **0 TypeScript errors**.
- **Linter**: `npm.cmd run lint` (`oxlint`)
  - **Result**: **0 errors**.

---

## 7. Refactoring Proposal: Centralizing Date Math Helpers

### Proposed Optimization
Export `computeCycleEndDate` and `computeCycleWeeksFromDates` from `src/lib/calc/planning.ts` and `Logic` to avoid code duplication between `CycleEditor.tsx` and unit tests:

```typescript
// In src/lib/calc/planning.ts
export function computeCycleEndDate(startIso: string, weeks: number): string {
    try {
        const parsed = typeof startIso === 'string' && !startIso.includes('T') ? parseISO(startIso) : new Date(startIso);
        if (!isValid(parsed)) return startIso;
        const totalWeeks = Math.max(1, weeks);
        const end = addDays(startOfDay(parsed), totalWeeks * 7 - 1);
        return format(end, 'yyyy-MM-dd');
    } catch {
        return startIso;
    }
}

export function computeCycleWeeksFromDates(startIso: string, endIso: string): number {
    try {
        const start = typeof startIso === 'string' && !startIso.includes('T') ? parseISO(startIso) : new Date(startIso);
        const end = typeof endIso === 'string' && !endIso.includes('T') ? parseISO(endIso) : new Date(endIso);
        if (!isValid(start) || !isValid(end)) return 1;
        const diffDays = differenceInCalendarDays(startOfDay(end), startOfDay(start));
        if (diffDays < 0) return 1;
        return Math.max(1, Math.round((diffDays + 1) / 7));
    } catch {
        return 1;
    }
}
```
