# Analysis Report: Requirement R1 (Sleep Format in HH:MM — UI Components, Form Inputs, & State Hooks)

**Explorer**: Teamwork Explorer (Explorer 2)  
**Milestone**: M1 (Data & Planning Enhancements)  
**Date**: 2026-08-20  
**Target Repository**: LogBook PWA (`C:\Users\gerar\Documents\GitHub\logbook`)  
**Scope**: UI components, form inputs, validation mechanisms, state hooks, and formatting for Requirement R1.

---

## 1. Executive Summary

This report delivers an exhaustive investigation of the UI layer, state management, form inputs, and history display for **Requirement R1 (Formato Sonno in HH:MM)**.

Key findings:
1. **State Hook (`useSleepMeasurements.ts`)**: Accurately manages state for all 5 sleep fields (`sleepHours`, `sleepDeep`, `sleepLight`, `sleepRem`, `sleepAwake`) plus `editingDate`. Dynamically normalizes legacy decimal data on rehydration via `Logic.formatSleepTime`, validates inputs via `Logic.isSleepTimeValid`, parses to canonical `HH:MM` strings via `Logic.parseSleepInput`, and supports complete or partial clearing of optional phases to `undefined`.
2. **UI Form Component (`DataSleep.tsx`)**: Built with dark glassmorphic styling, `<input type="time">` controls with mandatory `fontSize: '16px'` (iOS Safari zoom prevention per `AGENTS.md`), mobile-friendly 2x2 grid layout, `onFocus={select}`, and dynamic edit-mode visual cues (`border: 2px solid var(--primary-color)`, cancel button).
3. **Display & History Layer (`DataHistory.tsx` & `export.ts`)**: History cards render sleep duration with `Logic.formatSleepTime(day.sleepHours)` badge (`| 🌙 Sonno: 07:30`), and CSV export formats all 5 sleep phases into `misurazioni.csv` with Italian sentence case headers.
4. **Design System & Sentence Case Compliance**: All labels, headings, buttons, and alert messages strictly adhere to Italian sentence case (`"Ore sonno (totali) *"`, `"Dettagli fasi (opzionali)"`, `"Sonno profondo"`, `"Sonno leggero"`, `"Sonno REM"`, `"Tempo sveglio"`).
5. **Cross-Component Gap**: `mergeNutrition` in `src/lib/merge.ts` lacks explicit picking for the 5 sleep fields during guest-to-cloud merge.

---

## 2. Detailed Findings by Component

### 2.1 State Management & Hook: `src/hooks/useSleepMeasurements.ts`

#### A. State Architecture
```typescript
const [editingDate, setEditingDate] = useState<string | null>(null);
const [sleepHours, setSleepHours] = useState('');
const [sleepDeep, setSleepDeep] = useState('');
const [sleepLight, setSleepLight] = useState('');
const [sleepRem, setSleepRem] = useState('');
const [sleepAwake, setSleepAwake] = useState('');
```

#### B. Rehydration & Backward Compatibility
- Hook listens to `[todayDateStr, nutrition, editingDate]`.
- Target date is `editingDate || todayDateStr`.
- When loading `targetData = nutrition[targetDate]`:
  ```typescript
  if (targetData) {
      setSleepHours(Logic.formatSleepTime(targetData.sleepHours));
      setSleepDeep(Logic.formatSleepTime(targetData.sleepDeep));
      setSleepLight(Logic.formatSleepTime(targetData.sleepLight));
      setSleepRem(Logic.formatSleepTime(targetData.sleepRem));
      setSleepAwake(Logic.formatSleepTime(targetData.sleepAwake));
  } else {
      // Clear all fields
      setSleepHours(''); setSleepDeep(''); setSleepLight(''); setSleepRem(''); setSleepAwake('');
  }
  ```
- **Legacy Normalization**: If the store contains legacy numbers (e.g. `7.5` or `1.25`) or decimal strings (`"7.5"`, `"8h"`), `Logic.formatSleepTime` normalizes them to `"07:30"`, `"01:15"`, `"08:00"` upon rehydration into the input state.
- **Corrupt Value Resilience**: Invalid values (`null`, `undefined`, `999`, `"bad_str"`) normalize to empty string `''` without crashing.

#### C. Validation & Submission Pipeline (`saveSleep`)
1. **Mandatory Total Sleep Validation**:
   - `!sleepHours || !Logic.isSleepTimeValid(sleepHours)`
   - Triggers non-blocking alert: `"Le ore di sonno sono obbligatorie e devono essere in un formato valido (HH:MM)."`
2. **Canonical Parsing of Total Sleep**:
   - `const parsedHours = Logic.parseSleepInput(sleepHours);`
3. **Optional Phase Validation**:
   - Each non-empty phase is validated independently:
     - `sleepDeep`: `"Il formato del sonno profondo non è valido (HH:MM)."`
     - `sleepLight`: `"Il formato del sonno leggero non è valido (HH:MM)."`
     - `sleepRem`: `"Il formato del sonno REM non è valido (HH:MM)."`
     - `sleepAwake`: `"Il formato del tempo sveglio non è valido (HH:MM)."`
4. **Clean Phase Clearing**:
   - `parsedDeep = sleepDeep ? Logic.parseSleepInput(sleepDeep) || undefined : undefined;`
   - Setting empty string in input leaves `undefined` in the resulting object, cleanly deleting old phase values from the day record.
5. **State Dispatch & Feedback**:
   - Dispatches immutable update to `userData.nutrition[targetDate]` via Zustand `saveUserData`.
   - Displays confirmation: `useDialogStore.showAlert("Dati sonno salvati per il ${targetDate}!")`.
   - Resets `editingDate` to `null`.

---

### 2.2 UI Form Component: `src/components/Data/DataSleep.tsx`

#### A. Visual Structure & Layout
- Card Container: `<div className="card" id="sleep-form-card" style={isEditing ? { border: '2px solid var(--primary-color)' } : undefined}>`
- Dynamic Header:
  - Create mode: `🌙 Dati sonno (${displayDate})`
  - Edit mode: `✏️ Modifica sonno (${displayDate})`
- Paragraph: `Registra la durata e la qualità del tuo sonno.`

#### B. Form Input Elements
1. **Total Sleep (Primary / Required)**:
   - Centered container (`maxWidth: '200px'`).
   - Label: `Ore sonno (totali) *`
   - Input: `<input id="sleep-hours" type="time" placeholder="07:30" value={sleepHook.sleepHours} onChange={e => sleepHook.setSleepHours(e.target.value)} onFocus={e => e.target.select()} style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', fontWeight: 'bold', fontSize: '16px', padding: '10px', margin: 0 }} />`
2. **Divider & Optional Breakdown Section**:
   - Subheader: `Dettagli fasi (opzionali)`
   - 2x2 responsive grid using `.input-row` with `display: flex`, `gap: 12px`, and child items having `flex: 1, minWidth: 0`:
     - Row 1:
       - **Sonno profondo**: `#sleep-deep`, `type="time"`, placeholder `"01:30"`, `fontSize: '16px'`
       - **Sonno leggero**: `#sleep-light`, `type="time"`, placeholder `"04:00"`, `fontSize: '16px'`
     - Row 2:
       - **Sonno REM**: `#sleep-rem`, `type="time"`, placeholder `"01:30"`, `fontSize: '16px'`
       - **Tempo sveglio**: `#sleep-awake`, `type="time"`, placeholder `"00:30"`, `fontSize: '16px'`

#### C. Action Controls
- If `isEditing`:
  - `Annulla` button (`.btn`, `flex: 1`, `background: 'rgba(255,255,255,0.1)'`, triggers `setEditingDate(null)`).
  - `💾 Salva modifiche` (`.btn .btn-primary`, `flex: 2`).
- If not editing:
  - `💾 Salva sonno` (`.btn .btn-primary`, `width: 100%`).

---

### 2.3 History & Export Layer: `DataHistory.tsx` and `export.ts`

#### A. History Listing (`src/components/Data/DataHistory.tsx`)
- Renders list of recorded days from `useNutritionMeasurements.measurementsHistory`.
- `measurementsHistory` filters `day.weight || day.bf || day.sleepHours`, ensuring days with only sleep data appear in the history list.
- Renders sleep duration badge:
  ```tsx
  {day.sleepHours && <span>| 🌙 Sonno: {Logic.formatSleepTime(day.sleepHours)}</span>}
  ```
- Uses `Logic.formatSleepTime` defensively to ensure legacy numbers (`7.5`) render as `"07:30"`.
- Clicking any history item triggers `onSelectEdit(day)`.

#### B. CSV Export (`src/lib/export.ts`)
- Header includes Italian sentence case sleep headers:
  `Ore sonno,Sonno profondo,Sonno leggero,Sonno REM,Tempo sveglio`
- Formatted values:
  - `Logic.formatSleepTime(n.sleepHours)`
  - `Logic.formatSleepTime(n.sleepDeep)`
  - `Logic.formatSleepTime(n.sleepLight)`
  - `Logic.formatSleepTime(n.sleepRem)`
  - `Logic.formatSleepTime(n.sleepAwake)`
- Guaranteed canonical `HH:MM` strings or empty strings `""` for missing fields.

---

## 3. Compliance with AGENTS.md Guidelines

| Guideline Category | AGENTS.md Requirement | Implementation in Sleep System | Verification Status |
|---|---|---|---|
| **Design System** | Dark glassmorphism (`--glass-bg`, `--glass-border`, `--primary-color`, `.card`, `.btn`) | Implemented in `DataSleep.tsx` and `DataHistory.tsx` with standard variables | ✅ Full Compliance |
| **Typography & Sentence Case** | Strict Italian sentence case (only first letter capitalized, acronyms capitalized) | `"Ore sonno (totali) *"`, `"Dettagli fasi (opzionali)"`, `"Sonno profondo"`, `"Sonno leggero"`, `"Sonno REM"`, `"Tempo sveglio"`, `"💾 Salva sonno"` | ✅ Full Compliance |
| **Mobile & iOS Constraints** | `font-size: 16px` on all inputs to prevent Safari auto-zoom | Explicit `fontSize: '16px'` inline and in `global.css` for all `#sleep-*` inputs | ✅ Full Compliance |
| **Flexbox Safety** | `min-width: 0` on flex children to prevent horizontal overflow on small screens | Applied to all input containers in `DataSleep.tsx` | ✅ Full Compliance |
| **Modal Restrictions** | Modals (`<dialog>`) prohibited for forms | `DataSleep` renders inline inside `DataView` sub-tabs without dialogs | ✅ Full Compliance |
| **Alert Dialogs** | No `window.alert()` or `window.confirm()`; use `useDialogStore` | `useSleepMeasurements` uses `useDialogStore.getState().showAlert(...)` | ✅ Full Compliance |
| **Offline & Storage** | IndexedDB cache Tier 2 + Firestore Tier 1 monthly bucketing | Persisted in `UserData.nutrition[YYYY-MM-DD]` under `nutrition_months/{YYYY-MM}` | ✅ Full Compliance |

---

## 4. Cross-Cutting Gap Analysis: Guest-to-Cloud Merge

### Finding: Omission of Sleep Fields in `src/lib/merge.ts`
In `src/lib/merge.ts` (`mergeNutrition`, lines 151–172), when combining guest data and cloud data on date collisions:
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
**Identified Issue**: `sleepHours`, `sleepDeep`, `sleepLight`, `sleepRem`, and `sleepAwake` were not included in `result[date]`.  
**Recommended Fix**: Add:
```typescript
sleepHours: pickVal(guestDay.sleepHours, cloudDay.sleepHours),
sleepDeep: pickVal(guestDay.sleepDeep, cloudDay.sleepDeep),
sleepLight: pickVal(guestDay.sleepLight, cloudDay.sleepLight),
sleepRem: pickVal(guestDay.sleepRem, cloudDay.sleepRem),
sleepAwake: pickVal(guestDay.sleepAwake, cloudDay.sleepAwake),
```

---

## 5. Implementation & Verification Recommendations

1. **Test Coverage**: All 40 unit and integration tests across `tests/sleep_format.test.ts`, `tests/challenger_m1_adversarial_sleep.test.ts`, and `tests/challenger_m1_sleep_stress.test.tsx` pass with zero failures.
2. **Build and Lint**: Verified clean build (`npm run build`) and clean lint (`npm run lint`).
3. **Integration Point**: The UI implementation is complete and robust; the only pending patch across the whole R1 scope is the guest-to-cloud merge in `src/lib/merge.ts`.
