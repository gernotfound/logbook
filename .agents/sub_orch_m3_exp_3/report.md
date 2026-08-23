# Test Coverage & Architecture Analysis Report: Milestone M3
**Author**: Explorer 3 (Milestone M3 — Test Coverage & Architecture Planning)  
**Date**: 2026-08-20  
**Target Features**: 
- **R4**: Intelligent Fuzzy Search in `RoutineEditor`
- **R6**: Ad-Hoc Session Exercises, Blueprint Immutability, and History Volume/Fatigue Tracking

---

## 1. Executive Summary

This investigation delivers a complete mapping of existing test suites across the LogBook codebase, identifies architectural testing gaps for Milestone M3 (Requirements R4 and R6), specifies comprehensive unit and integration test matrices, and establishes an actionable implementation and test plan for the Worker.

Key findings:
1. **Existing Test Health**: 40 test files containing 746 tests currently pass with 100% success rate under Vitest (`jsdom`).
2. **Requirement R4 (`RoutineEditor` Fuzzy Search)**:
   - Current implementation uses a legacy HTML `<select>` element (lines 70–84 in `RoutineEditor.tsx`).
   - The test in `tests/e2e_enhancements_r1_r6.test.tsx` (lines 467–499) simulates interaction with `select`.
   - Replacing `<select>` with a Fuse.js-backed text input and dark glassmorphic floating popup dropdown requires updating the interaction model in tests (typing into `<input type="text">` and clicking dropdown items) and adding exhaustive tests for fuzzy typo-tolerance, keyboard/mobile interactions, clear button (`✕`), and outside-click behavior.
3. **Requirement R6 (Ad-Hoc Session Exercises & Immutability)**:
   - Live session mutations (`addExtraExercise`, `removeActiveExercise`) in `useWorkoutSetMutations.ts` strictly mutate `localWorkout` in the Zustand store and synchronous `localStorage['logbook_local_workout']`.
   - `userData.routines` is never mutated during live session updates, preserving blueprint immutability.
   - On session completion (`endWorkout` in `useWorkoutSession.ts`), `localWorkout` (containing all ad-hoc exercises and sets) is prepended to `userData.history`.
   - `useHomeView.ts` automatically aggregates completed sets and dropsets from `userData.history` into weekly volume and 72-hour muscle fatigue heatmaps.
4. **Actionable Implementation Plan**: Clear 3-step execution plan prepared for the Worker, including code sketches, UI styling, and full test suite blueprints.

---

## 2. Investigation of Existing Test Suites

### 2.1 Test Infrastructure Overview
- **Framework**: Vitest v3 with `@testing-library/react` and `jsdom`.
- **Test Command**: `npm.cmd test` (Windows PowerShell compliant).
- **Test Setup**: `tests/setup.tsx` provides `renderWithProviders`, `emptyUserData`, mock implementations for `localStorage`, `matchMedia`, `ResizeObserver`, Canvas, and IndexedDB `idb-keyval`.

### 2.2 Inventory of Existing Related Test Suites

| Test File | Test Suite Name | Focus Areas & Coverage |
|---|---|---|
| `tests/e2e_enhancements_r1_r6.test.tsx` | LogBook PWA Enhancements E2E Suite | 44 tests covering R1–R6, including initial R4 and R6 flows, boundary conditions, cross-feature combinations, and real-world scenarios. |
| `tests/training_session_ui_improvements.test.tsx` | Training Session UI Improvements Suite | 11 tests covering exercise card styling, set row borders, remove set confirmation dialogs (`showConfirm`), dropset/isometry handling, and set mutation lifecycles. |
| `tests/workout_improvements.test.tsx` | Workout Improvements & History Edit Suite | 13 tests covering session rating validation, timer resets, `MuscleModel` rendering, historical workout editing, and `useHomeView` volume/dropset/fatigue calculations. |
| `src/lib/logic.test.ts` | Logic Functions & Calc Suite | 29 tests covering `Logic.filterItems` fuzzy search (typo tolerance, substring, multi-token), cycle math, date formatting, and rating validation. |
| `tests/challenger_r2_r3_r4_adversarial.test.tsx` | Adversarial Stress & Robustness Suite | Tests Firebase fail-fast, Zustand debounced saving concurrency, and `useLocalStorage` corruption resilience. |

---

## 3. Required Test Suites & Test Matrix Mapping

### 3.1 Suite 1: `RoutineEditor` Fuzzy Search, Dropdown & UX (Requirement R4)
Target Component: `src/components/Training/routines/RoutineEditor.tsx`

```
┌─────────────────────────────────────────────────────────────┐
│                       RoutineEditor                         │
│                                                             │
│   [🔍 Cerca esercizio da aggiungere...               ✕]    │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ Floating Dropdown (var(--surface-color), max-h:220) │   │
│   │  • Panca piana bilanciere          [Pettorali]      │   │
│   │  • Panca inclinata manubri         [Pettorali]      │   │
│   │  • Tapis roulant                   [🏃 Cardio]      │   │
│   │  • Plank                           [⏱️ Tempo]       │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

#### Test Cases Specification:
1. **Initial Rendering & Collapsed State**:
   - Renders search input with placeholder `"🔍 Cerca esercizio da aggiungere..."` and `font-size: 16px`.
   - Floating dropdown is closed by default before user interaction.
2. **Focus & Open State**:
   - Focusing or clicking the search input opens the dropdown.
   - When search term is empty, renders the full library list (or top items) in alphabetical order.
3. **Exact & Substring Matching**:
   - Typing `"panca"` displays `"Panca piana bilanciere"`, `"Panca inclinata"`, etc., while hiding non-matching items like `"Squat"`.
4. **Fuzzy Typo-Tolerance (`Logic.filterItems` / Fuse.js)**:
   - Typing `"pancca"` or `"pnaca"` successfully matches `"Panca piana bilanciere"`.
   - Typing `"squatt"` or `"sqaut"` successfully matches `"Squat con bilanciere"`.
5. **Multi-Token Matching**:
   - Typing `"bilanciere panca"` matches `"Panca piana con bilanciere"`.
6. **Muscle & Category Matching**:
   - Searching for muscle name `"petto"` or `"bicipiti"` filters exercises targeting those muscles.
7. **Badges & Tracking Type Presentation**:
   - Renders appropriate badges (`🏃 Cardio`, `⏱️ Tempo`) next to non-weight tracking exercises.
8. **Selection & State Reset**:
   - Clicking an item invokes `onAddExercise(exerciseId)`.
   - Automatically clears the search input (`searchTerm = ''`) and closes the dropdown (`isDropdownOpen = false`).
9. **Clear Button (`✕`)**:
   - Clicking the clear button empties the input and resets or closes the dropdown.
10. **Empty State**:
    - When a search query produces no results (e.g. `"zzxxqq"`), displays `<div className="text-muted text-xs p-8 text-center">Nessun esercizio trovato</div>`.
11. **Outside Click Handling**:
    - Clicking outside the `RoutineEditor` search container closes the dropdown.
12. **Sentence Case Compliance**:
    - Validates Italian sentence case for all labels, placeholders, and empty state messages.

---

### 3.2 Suite 2: Live Session Ad-Hoc Modification & Immutability (Requirement R6)
Target Components/Hooks: `src/components/Training/TrainingSession.tsx`, `src/hooks/workout/useWorkoutSetMutations.ts`, `src/hooks/useWorkoutSession.ts`

```
                    ┌────────────────────────────┐
                    │ userData.routines (Store)  │  <─── IMMUTABLE BLUEPRINT
                    └─────────────┬──────────────┘
                                  │ startWorkout(routineId)
                                  ▼ (Deep Clone)
                    ┌────────────────────────────┐
                    │ localWorkout (Store & IDB) │  <─── MUTABLE LIVE INSTANCE
                    ├────────────────────────────┤
                    │ • addExtraExercise(exId)   │
                    │ • removeActiveExercise(idx)│
                    │ • reorderExercises(from,to)│
                    │ • updateSet / addSpecialSet│
                    └─────────────┬──────────────┘
                                  │ endWorkout()
                                  ▼
                    ┌────────────────────────────┐
                    │  userData.history (Store)  │  <─── PERSISTED WORKOUT
                    └────────────────────────────┘
```

#### Test Cases Specification:
1. **Deep-Clone Isolation at Session Start**:
   - `startWorkout('routine_1')` initializes `localWorkout` with cloned exercises.
   - Modifying `localWorkout` does not affect the routine object in `userData.routines`.
2. **Ad-Hoc Exercise Addition (`addExtraExercise`)**:
   - Calling `addExtraExercise('ex_curls')` appends an exercise to `localWorkout.exercises`.
   - Generates unique set ID (`id: s_...`) and initial values.
   - `userData.routines` remains strictly unchanged (`expect(userData.routines).toEqual(originalRoutines)`).
3. **Ad-Hoc Exercise Removal (`removeActiveExercise`)**:
   - Triggers confirmation dialog (`showConfirm("Rimuovere questo esercizio dalla sessione corrente?")`).
   - If confirmed, removes exercise at target index from `localWorkout.exercises`.
   - If cancelled, leaves `localWorkout.exercises` unchanged.
   - Blueprint `userData.routines` remains unchanged in both cases.
4. **Live Reordering with Ad-Hoc Exercises (`reorderExercises`)**:
   - Moving an ad-hoc exercise up or down correctly shifts its position in `localWorkout.exercises`.
   - Preserves all nested sets, weight/reps, done status, dropsets, and notes.
5. **Real-Time Library Synchronization (R3 Interaction)**:
   - When library exercise name is edited in store while workout is active, `TrainingSession` immediately renders the updated name via dynamic `library.find(l => l.id === ex.exId)` lookup.
6. **Safari Background Suspend Resilience**:
   - When `visibilitychange` fires with `document.visibilityState === 'hidden'`, `localWorkout` containing ad-hoc exercises is synchronously saved to `localStorage['logbook_local_workout']`.
7. **Session Completion (`endWorkout`)**:
   - Packages `finishedWorkout` from `localWorkout` containing all ad-hoc exercises and completed sets.
   - Prepends `finishedWorkout` into `userData.history`.
   - Clears `localWorkout` and `localStorage['logbook_local_workout']`.
   - Blueprint `userData.routines` remains untouched with its original exercise list.

---

### 3.3 Suite 3: History Volume & Muscle Group Aggregation (Requirement R6)
Target Hook: `src/hooks/useHomeView.ts`

```
┌─────────────────────────────────────────────────────────────┐
│                   userData.history                          │
│  Workout: { exercises: [ex_bench (3 sets), ex_flyes (2 sets)] }│
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼ useHomeView()
┌─────────────────────────────────────────────────────────────┐
│  VolumeChartData:                                           │
│  - "Petto": 5 completati (3 bench + 2 flyes)                │
│                                                             │
│  MuscleColors (Fatigue Heatmap):                            │
│  - Primary ("chest_lower", "chest_upper"): #ef4444          │
│  - Secondary ("triceps", "delts_front"): #f97316 (50%)      │
└─────────────────────────────────────────────────────────────┘
```

#### Test Cases Specification:
1. **Ad-Hoc Standard Sets Volume Aggregation**:
   - An ad-hoc exercise added to workout and finished with 3 sets of 10 reps adds exactly 3 sets to its primary muscle category in `volumeChartData`.
2. **Ad-Hoc Dropsets Volume Aggregation**:
   - An ad-hoc exercise with 2 regular sets + 2 dropsets adds 4 completed sets to weekly volume.
3. **Empty/Unfinished Set Filtering**:
   - Ad-hoc exercises with blank sets (`kg: '', reps: ''`, `done: false`) are ignored in volume aggregation.
4. **Multi-Muscle Group Distribution**:
   - An ad-hoc exercise with multiple primary muscles (e.g. `['chest_upper', 'chest_lower']`) maps to the single parent category `"Petto"` without duplicate set inflation.
5. **72-Hour Fatigue Heatmap Calculation**:
   - Ad-hoc exercise sets performed within 24 hours produce active fatigue colors on primary atomic SVG paths and 50% decay on secondary muscle paths.
6. **CSV Export Verification (`Exporter.exportToCSV`)**:
   - Exporting data after completing a session with ad-hoc exercises includes all ad-hoc exercise rows and sets in `allenamenti.csv`.

---

## 4. Step-by-Step Implementation Plan for the Worker

### Step 1: RoutineEditor Fuzzy Search Component
1. Open `src/components/Training/routines/RoutineEditor.tsx`.
2. Add local state:
   ```tsx
   const [searchTerm, setSearchTerm] = useState('');
   const [isDropdownOpen, setIsDropdownOpen] = useState(false);
   const dropdownRef = useRef<HTMLDivElement>(null);
   ```
3. Add outside-click event listener to close dropdown on document click.
4. Compute `filteredExercises` using `Logic.filterItems(library, searchTerm, ['name'])` with fallback to full library when query is empty.
5. Replace lines 70–84 (`<select>`) with the text input and floating glassmorphic dropdown.
6. Ensure `font-size: 16px` on the search input to prevent iOS Safari auto-zoom.

### Step 2: TrainingSession Extra Exercise Addition Upgrade
1. Open `src/components/Training/TrainingSession.tsx`.
2. In lines 424–436 ("Aggiungi esercizio extra"), replace the legacy `<select>` with the same fuzzy search pattern for consistency across the app.

### Step 3: Test Suite Implementation & Verification
1. Update `tests/e2e_enhancements_r1_r6.test.tsx` (lines 467–499) to interact with the search input instead of `<select>`.
2. Add comprehensive test cases in `tests/routine_editor_fuzzy_search.test.tsx` and `tests/workout_session_adhoc_exercises.test.tsx`.
3. Execute the full test suite via `npm.cmd test` and verify all tests pass.
4. Execute `npm.cmd run build` to verify TypeScript compile-time type safety.
5. Execute `npm.cmd run lint` to verify zero linter warnings.

---

## 5. Verification Commands

```powershell
# 1. Run unit & integration test suites
npm.cmd test

# 2. Run TypeScript build verification
npm.cmd run build

# 3. Run linter
npm.cmd run lint
```
