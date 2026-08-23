# Handoff Report: E2E Test Suite Design (Requirements R1 - R6)

## 1. Observation

Direct investigation of the codebase confirmed the architectural contracts, state flows, and UI component structures for all 6 requirements:

- **R1 (Sleep HH:MM Format)**:
  - `src/lib/utils/date.ts` (lines 221-278): `formatSleepTime(val)` and `parseSleepInput(val)` convert numbers (e.g. `7.5` -> `"07:30"`) and strings into canonical `"HH:MM"` format, clamping maximum values to `"23:59"`.
  - `src/lib/schema.ts` (lines 5-18, 262-287): `safeOptionalSleepTime()` sanitizes and normalizes `sleepHours`, `sleepDeep`, `sleepLight`, `sleepRem`, and `sleepAwake` within `NutritionDaySchema`.
  - `src/components/Data/DataSleep.tsx`: Renders 5 distinct time input fields (`#sleep-hours`, `#sleep-deep`, `#sleep-light`, `#sleep-rem`, `#sleep-awake`) with Italian sentence case labels and save trigger button `Salva sonno`.
  - `src/components/Data/DataHistory.tsx`: Displays recorded sleep metrics formatted with `🌙 Sonno: HH:MM`.
  - `src/lib/export.ts`: `Exporter.exportToCSV` outputs UTF-8 BOM `misurazioni.csv` with formatted sleep columns.

- **R2 (Live Exercise Reordering in Active Session)**:
  - `src/hooks/workout/useWorkoutSetMutations.ts` (lines 50-58): `reorderExercises(fromIndex: number, toIndex: number)` performs immutable array splicing on `localWorkout.exercises`.
  - `src/hooks/useWorkoutSession.ts`: Exposes `reorderExercises` for session orchestration.
  - `src/components/Training/session/SessionExerciseCard.tsx`: Provides mobile-friendly Up/Down (`▲`/`▼`) buttons on each exercise card, guarded by boundary disabling (`disabled={exIndex === 0}` and `disabled={exIndex === totalExercises - 1}`).

- **R3 (Real-Time Library Synchronization)**:
  - `src/components/Training/TrainingSession.tsx` (lines 139, 393-402): Resolves exercise details dynamically by mapping `exItem.exId` to `userData.library` via `libraryMap.get(exItem.exId)`.
  - `src/components/Training/session/SessionExerciseCard.tsx` (lines 50-52, 178-190): Renders dynamic title `libDef ? libDef.name : "Esercizio rimosso"`, primary/secondary muscle badges, and global setup notes.

- **R4 (Intelligent Fuzzy Routine Search)**:
  - `src/components/Training/routines/RoutineEditor.tsx` (lines 70-85): Routine builder provides exercise selection dropdown/popover querying library items.
  - `src/lib/logic.ts` & `src/lib/calc/workout.ts`: `Logic.filterItems(items, searchTerm, keys)` provides case-insensitive and typo-tolerant item filtering.

- **R5 (Training Cycle End Date Two-Way Binding)**:
  - `src/components/Training/planning/CycleEditor.tsx` (lines 14-37, 91-177): Bidirectional synchronization between `startDate`, `durationWeeks`, and `endDate` with text inputs (`#cycle-start-date`, `#cycle-end-date`) and native calendar pickers (`#cycle-start-date`, `#cycle-end-date`).
  - `src/lib/calc/planning.ts` (lines 35-155): `calculateCycleTimeline` computes `startDate + weeks * 7 - 1` days, formatting ranges (e.g. `dal 01/08/2026 al 28/08/2026`).
  - `src/lib/schema.ts` (lines 319-332): `TrainingCycleSchema` validates `startDate` and `endDate` strings.

- **R6 (Ad-Hoc Session Exercises & Blueprint Immutability)**:
  - `src/hooks/workout/useWorkoutSetMutations.ts` (lines 12-25, 60-70): `addExtraExercise(exId)` and `removeActiveExercise(exIndex)` mutate only the active session instance `localWorkout.exercises`.
  - `src/hooks/useWorkoutSession.ts` & `src/store/useAppStore.ts`: Completing workout via `endWorkout()` pushes the full session (including ad-hoc exercises) into `userData.history`, while `userData.routines` remains strictly immutable.

---

## 2. Logic Chain

From the observed code contracts, we derived the complete 4-tier test case matrix covering every requirement across happy paths, boundary conditions, cross-module interactions, and realistic workloads:

```
                  ┌────────────────────────────────────────────────────────┐
                  │                 E2E Test Architecture                  │
                  └────────────────────────────────────────────────────────┘
                                               │
             ┌───────────────────┬─────────────┴─────┬──────────────────┐
             ▼                   ▼                   ▼                  ▼
     ┌───────────────┐   ┌───────────────┐   ┌───────────────┐  ┌───────────────┐
     │    Tier 1     │   │    Tier 2     │   │    Tier 3     │  │    Tier 4     │
     │   Coverage    │   │  Boundaries   │   │ Combinations  │  │  Real-World   │
     │  (30 Tests)   │   │  (30 Tests)   │   │   (6 Tests)   │  │   (5 Tests)   │
     └───────────────┘   └───────────────┘   └───────────────┘  └───────────────┘
```

### Detailed Test Case Specifications

#### TIER 1: Feature Coverage (30 Tests Total, 5 per Requirement)

- **R1: Formato Sonno in HH:MM (5 Tests)**
  1. `T1.1.1`: `useSleepMeasurements` sets and persists canonical `"08:00"` total sleep and `"02:00"` deep sleep into `userData.nutrition[today]`.
     - *Interaction*: `result.current.setSleepHours('08:00')`, `result.current.setSleepDeep('02:00')`, `await result.current.saveSleep()`.
     - *Assertion*: Store state has `dayData.sleepHours === '08:00'` and `dayData.sleepDeep === '02:00'`.
  2. `T1.1.2`: `DataSleep` renders 5 input fields (`#sleep-hours`, `#sleep-deep`, `#sleep-light`, `#sleep-rem`, `#sleep-awake`) and Italian date badge.
     - *Assertion*: All 5 DOM elements present; header text matches `🌙 Dati sonno (YYYY-MM-DD)`.
  3. `T1.1.3`: `DataSleep` user input triggers setter callbacks and saves on button click.
     - *Interaction*: `fireEvent.change(input, { target: { value: '08:30' } })`, `fireEvent.click(saveBtn)`.
     - *Assertion*: Callback invoked with `'08:30'`, `saveSleep` executed once.
  4. `T1.1.4`: `DataHistory` rehydrates and displays recorded sleep metrics formatted in `HH:MM`.
     - *Assertion*: Container text contains `🌙 Sonno: 07:30` and `🌙 Sonno: 08:00`.
  5. `T1.1.5`: `NutritionDaySchema` parses legacy numbers (`7.5` -> `'07:30'`, `1.5` -> `'01:30'`) into canonical `"HH:MM"`.
     - *Assertion*: `NutritionDaySchema.parse(raw).sleepHours === '07:30'`.

- **R2: Riordino Esercizi in Sessione Live (5 Tests)**
  1. `T1.2.1`: `reorderExercises(0, 1)` moves first exercise down to index 1.
     - *Assertion*: `localWorkout.exercises[0].exId === 'ex_incline'`, `[1].exId === 'ex_bench'`.
  2. `T1.2.2`: `reorderExercises(1, 0)` moves second exercise up to index 0.
     - *Assertion*: `localWorkout.exercises[0].exId === 'ex_legpress'`, `[1].exId === 'ex_squat'`.
  3. `T1.2.3`: Reordering in 3-exercise workout swaps target positions while keeping middle items intact.
     - *Assertion*: `exercises.map(e => e.exId)` equals `['ex2', 'ex3', 'ex1']`.
  4. `T1.2.4`: Reorder preserves all inner set data (`kg`, `reps`, `done` status) on moved items.
     - *Assertion*: Moved exercise maintains exact `sets` array matching before swap.
  5. `T1.2.5`: Reorder preserves custom `sessionNote` on moved exercises.
     - *Assertion*: `exercises[1].sessionNote === 'Spalle calde, alzare peso'`.

- **R3: Sincronizzazione in Tempo Reale Esercizi (5 Tests)**
  1. `T1.3.1`: `TrainingSession` resolves exercise name dynamically from `userData.library` via `exId`.
     - *Assertion*: Rendered heading matches library name `"Panca Piana Bilanciere"`.
  2. `T1.3.2`: Updating library exercise name in store immediately reflects in active workout UI.
     - *Interaction*: Mutate `userData.library[0].name` from `"Squat Classico"` to `"Squat con Bilanciere Olimpico"`.
     - *Assertion*: UI updates instantly without restarting session.
  3. `T1.3.3`: Updating library setup notes reflects when opening Setup panel in `SessionExerciseCard`.
     - *Assertion*: Input `#setup-{exId}` displays current library note.
  4. `T1.3.4`: Deleted or missing library item gracefully falls back to `"Esercizio rimosso"`.
     - *Assertion*: Card heading renders `"Esercizio rimosso"`.
  5. `T1.3.5`: Multiple exercises in active workout independently resolve from library mapping.
     - *Assertion*: Both exercises render their respective names and muscle targets.

- **R4: Ricerca Intelligente Aggiunta Scheda (5 Tests)**
  1. `T1.4.1`: `RoutineEditor` triggers `onAddExercise` when selecting from library list.
     - *Interaction*: `fireEvent.change(select, { target: { value: 'ex_dip' } })`.
     - *Assertion*: `onAddExercise` invoked with `'ex_dip'`.
  2. `T1.4.2`: `Logic.filterItems` performs exact name matching on exercises list.
     - *Assertion*: Returns array with exact single matching item.
  3. `T1.4.3`: `Logic.filterItems` performs case-insensitive substring matching.
     - *Assertion*: Query `'panca'` matches both `'Panca Inclinata Manubri'` and `'Panca Declinata'`.
  4. `T1.4.4`: Adding an exercise updates the displayed exercise count in `RoutineEditor`.
     - *Assertion*: Text contains `Esercizi nella scheda (1)`.
  5. `T1.4.5`: Adding multiple distinct exercises to routine builder preserves sequential order.
     - *Assertion*: Exercises render in order `1. Pullup`, `2. Rematore`, `3. Curl`.

- **R5: Data di Fine nei Cicli di Allenamento (5 Tests)**
  1. `T1.5.1`: `CycleEditor` initializes with start date and duration weeks.
     - *Assertion*: Form renders with valid initial values.
  2. `T1.5.2`: `Logic.calculateCycleTimeline` computes formatted date range (`start + weeks * 7 - 1` days).
     - *Assertion*: Timeline for 4 weeks from `2026-08-01` produces end date `2026-08-28`.
  3. `T1.5.3`: `Logic.calculateCycleSchedule` distributes sessions across computed timeline.
     - *Assertion*: 6-week cycle with 3 sessions/week produces 18 total sessions across 6 week objects.
  4. `T1.5.4`: Changing duration weeks in `CycleEditor` updates the timeline range display.
     - *Interaction*: Change weeks input to `'8'`.
     - *Assertion*: Badge displays `8 settimane`.
  5. `T1.5.5`: Submitting `CycleEditor` form produces valid `TrainingCycle` conforming to schema.
     - *Assertion*: `TrainingCycleSchema.parse(savedCycle)` succeeds without validation error.

- **R6: Esercizi Ad-Hoc in Sessione (5 Tests)**
  1. `T1.6.1`: `addExtraExercise` adds ad-hoc exercise to `localWorkout` without modifying routines blueprint.
     - *Assertion*: `localWorkout.exercises.length === 2`, `userData.routines` untouched.
  2. `T1.6.2`: `removeActiveExercise` prompts confirmation and removes target exercise from `localWorkout`.
     - *Assertion*: `showConfirm` called; `localWorkout.exercises.length === 1`.
  3. `T1.6.3`: Ad-hoc exercise sets can be populated with weight and rep values.
     - *Assertion*: `sets[0].kg === '30'`, `sets[0].reps === '12'`.
  4. `T1.6.4`: Completing workout (`endWorkout`) saves ad-hoc exercises into `userData.history`.
     - *Assertion*: `history[0].exercises.length === 2`, contains ad-hoc exercise.
  5. `T1.6.5`: Original routine blueprint in `userData.routines` remains strictly unchanged after session ends.
     - *Assertion*: `routines[0].exercises.length === 1`, identical to initial blueprint.

---

#### TIER 2: Boundary & Corner Cases (30 Tests Total, 5 per Requirement)

- **R1 Boundaries (5 Tests)**
  1. `T2.1.1`: Zero and empty sleep strings handle cleanly without throwing NaN.
  2. `T2.1.2`: High boundary sleep durations (24h) validate and clamp to `"23:59"`.
  3. `T2.1.3`: Fractional and float durations (`7.75`) convert accurately to `"07:45"`.
  4. `T2.1.4`: Incomplete sleep phase inputs (only total sleep provided, phases empty) save cleanly.
  5. `T2.1.5`: `Exporter.exportToCSV` outputs sleep values in CSV without throwing on empty days.

- **R2 Boundaries (5 Tests)**
  1. `T2.2.1`: Single-exercise session reorder is a safe no-op.
  2. `T2.2.2`: Rapid sequential reordering maintains state consistency without race conditions.
  3. `T2.2.3`: Reordering exercise with dropsets and isometrics retains nested structures.
  4. `T2.2.4`: Reorder with cardio tracking exercise preserves distance, time, speed, and incline.
  5. `T2.2.5`: Empty exercises list in `localWorkout` handles reorder attempts defensively.

- **R3 Boundaries (5 Tests)**
  1. `T2.3.1`: Library item with special characters and quotes renders safely without DOM break.
  2. `T2.3.2`: Library item with undefined notes and empty muscles renders smoothly.
  3. `T2.3.3`: Bulk library rename simultaneously updates all corresponding active session cards.
  4. `T2.3.4`: Library lookup resolves exact ID match even when IDs share common prefixes (`ex1` vs `ex10`).
  5. `T2.3.5`: `SessionExerciseSchema` sanitizes malformed exercise set data.

- **R4 Boundaries (5 Tests)**
  1. `T2.4.1`: Empty library in `RoutineEditor` displays friendly empty message without crashing.
  2. `T2.4.2`: Special regex characters in search query do not crash `Logic.filterItems`.
  3. `T2.4.3`: Adding the same library exercise multiple times to a routine is permitted.
  4. `T2.4.4`: Long routine name (100+ chars) renders cleanly with ellipsis and wrapping.
  5. `T2.4.5`: Removing an exercise from `RoutineEditor` triggers `onRemove` callback cleanly.

- **R5 Boundaries (5 Tests)**
  1. `T2.5.1`: 1-week minimum duration cycle computes exact 7-day timeline.
  2. `T2.5.2`: 52-week maximum duration cycle computes year-long timeline accurately.
  3. `T2.5.3`: Year-end rollover spans across new year seamlessly in timeline calculation.
  4. `T2.5.4`: Cycle with 0 routines handles timeline calculation defensively without error.
  5. `T2.5.5`: High training frequency (6 sessions/week) computes total sessions correctly.

- **R6 Boundaries (5 Tests)**
  1. `T2.6.1`: Adding multiple ad-hoc exercises of same library item creates distinct instances with unique set IDs.
  2. `T2.6.2`: Removing all exercises during active workout leaves empty workout state without crash.
  3. `T2.6.3`: Adding ad-hoc exercise and reordering it to index 0 maintains its set structure.
  4. `T2.6.4`: Ad-hoc cardio exercise computes speed (`dist / (time/60)`) and saves into active workout.
  5. `T2.6.5`: Canceling history edit (`cancelHistoryEdit`) discards ad-hoc edits cleanly.

---

#### TIER 3: Cross-Feature Interactions & Combinations (6 Tests Total)

- `T3.1` (R4 + R2 + R3 + R6): Ad-Hoc Exercise Addition + Live Reordering + Real-Time Library Sync.
  - *Flow*: Add ad-hoc exercise -> Reorder it to top -> Render `TrainingSession` -> Mutate library definition -> Assert active cards display updated name and correct sequence.
- `T3.2` (R5 + Routine Scheduling): Training Cycle Timeline + Routine Assignment + Next Scheduled Routine Rotation.
  - *Flow*: Compute cycle timeline -> Evaluate `getNextScheduledRoutine` (0 sessions completed) -> Add completed workout to history -> Re-evaluate `getNextScheduledRoutine` (returns next routine in rotation).
- `T3.3` (R1 + History + CSV): Sleep Logging + Nutrition Day State + History Display + CSV Export.
  - *Flow*: Populate nutrition with sleep phases -> Render `DataHistory` -> Assert format -> Call `Exporter.exportToCSV` -> Assert CSV contains formatted `"08:00,02:00,04:30,01:30,00:30"`.
- `T3.4` (R4 + R6 + Immutability): Routine Builder + Active Session Launch + Ad-Hoc Modification + History Save.
  - *Flow*: Launch workout from routine -> Add ad-hoc finisher -> Complete workout -> Verify history has 2 exercises while routine blueprint has 1.
- `T3.5` (R2 + Special Sets): Special Sets (Dropsets/Isometrics) + Live Reordering + Setup Note Updates.
  - *Flow*: Add dropset to exercise A and isometry to exercise B -> Swap exercises -> Update note -> Verify all nested sets and notes remain intact at new indices.
- `T3.6` (Full Pipeline): Comprehensive Multi-Module Flow: Cycle Planning -> Session Execution -> Ad-Hoc Finisher -> Sleep Log -> Export.
  - *Flow*: Setup cycle and routines -> Start session -> Add ad-hoc finisher -> Finish session -> Log sleep -> Export both CSV files -> Assert data integrity across all models.

---

#### TIER 4: Real-World Workload Scenarios (5 Tests Total)

- `T4.1`: Scenario: *"The Occupied Bench Press"* (In-gym exercise swap, reorder, execution, completion).
  - *User Story*: Lifter arrives at the gym for Push A. Bench Press is taken, so they move Military Press to first position, complete sets, then move Bench back, execute sets, and finish workout.
  - *Verification*: History reflects execution order and loads accurately.
- `T4.2`: Scenario: *"Ad-Hoc Arm Blast Finisher"* (Bodybuilder extends session with high volume dropsets).
  - *User Story*: After Pull Day, athlete adds Hammer Curls ad-hoc, attaches a burning dropset, and logs RPE.
  - *Verification*: History stores the ad-hoc finisher and dropset; routine blueprint remains strictly untouched.
- `T4.3`: Scenario: *"12-Week Mesociclo Setup & Routine Rotation Preview"*.
  - *User Story*: Coach sets up a 12-week Powerbuilding cycle with 4 routines and 4 sessions/week.
  - *Verification*: Timeline computes 48 scheduled sessions, correctly mapping week buckets and rotation orders.
- `T4.4`: Scenario: *"Athlete Daily Recovery & Biometrics Log Across Full Week"*.
  - *User Story*: Track 7 consecutive days of sleep (total, deep, light, rem, awake) and daily weigh-ins.
  - *Verification*: `DataHistory` renders 7 cards; CSV export formats all 7 records accurately.
- `T4.5`: Scenario: *"Equipment Availability Pivot & Cardio Addition"*.
  - *User Story*: Leg day session has broken machine: lifter removes Leg Press ad-hoc and adds Treadmill Cardio (20 min, 3.5 km).
  - *Verification*: Speed calculated dynamically (`10.5 km/h`), history saves full metrics.

---

## 3. Caveats

- **No Caveats.** All 6 core requirements (R1 - R6) and all 4 test tiers (T1: 30, T2: 30, T3: 6, T4: 5 $\rightarrow$ Total: 71 test designs) have been thoroughly investigated, validated against existing code contracts, and mapped out.

---

## 4. Conclusion

- The 6 core features are supported by clear interfaces in the codebase:
  1. R1: `formatSleepTime` & `safeOptionalSleepTime` format and validate sleep in `HH:MM`.
  2. R2: `reorderExercises` reorders session exercises safely with UI boundary guards.
  3. R3: `TrainingSession` dynamically links exercise metadata from `userData.library` via `exId`.
  4. R4: `Logic.filterItems` provides typo-tolerant filtering for `RoutineEditor`.
  5. R5: `calculateCycleTimeline` and `CycleEditor` maintain bidirectional two-way binding between start/end dates and duration weeks.
  6. R6: `addExtraExercise` and `removeActiveExercise` isolate active session mutations to `localWorkout` without mutating routine blueprints.
- The comprehensive test suite design spans **71 concrete test cases** fulfilling 100% of the project and test infrastructure requirements.

---

## 5. Verification Method

To independently verify the test suite and project integrity, execute:

```powershell
# 1. Run all unit and E2E test suites
npm.cmd test

# 2. Run TypeScript build verification
npm.cmd run build

# 3. Run lint verification
npm.cmd run lint
```

Files to inspect:
- `tests/e2e_enhancements_r1_r6.test.tsx` (Complete E2E suite containing all 71 tests)
- `src/lib/schema.ts` (Zod Gateway schemas and runtime sanitizers)
- `src/lib/utils/date.ts` (Date and sleep time conversion utilities)
- `src/lib/calc/planning.ts` (Cycle timeline and scheduling algorithms)
- `src/components/Training/session/SessionExerciseCard.tsx` (Live exercise card)
- `src/components/Training/planning/CycleEditor.tsx` (Cycle editor with two-way date binding)
