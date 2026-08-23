# Comprehensive Analysis and Verification Report: R6 (Ad-Hoc Session Exercises & History Isolation)

**LogBook PWA — Milestone M3 (Explorer 2 Investigation)**  
**Author:** Explorer 2  
**Date:** 2026-08-20  
**Target Focus:** `WorkoutSession.tsx` / `TrainingSession.tsx`, `useWorkoutSession.ts`, `useWorkoutSetMutations.ts`, `createWorkoutSlice.ts`, `useAppStore.ts`, routine immutability invariant, and history/volume/fatigue statistics propagation.

---

## 1. Executive Summary

This investigation provides a comprehensive audit of **Requirement R6: Ad-Hoc Session Exercises & History Isolation** in the LogBook PWA application.

### Key Assessment
- **Blueprint Isolation Invariant:** **STRICTLY VERIFIED.** Adding or removing exercises during an active workout session mutates *only* the transient `localWorkout` object (stored in Zustand and debounced to `localStorage['logbook_local_workout']`). The underlying routine blueprint in `userData.routines` remains 100% immutable and untouched throughout the entire workout lifecycle.
- **History & Statistics Propagation:** **STRICTLY VERIFIED.** When a session is finished via `endWorkout()`, the completed workout object saved to `userData.history` contains all ad-hoc added exercises (and excludes removed exercises). Downstream consumers—including the weekly volume chart, 72-hour muscle fatigue heatmap (`useHomeView`), prior workout history badges (`exerciseHistoryMap`), and CSV data exports (`exportToCSV`)—correctly and immediately aggregate data from ad-hoc exercises.
- **Test Coverage:** Extensive test suites (`tests/e2e_enhancements_r1_r6.test.tsx`, `tests/workout_improvements.test.tsx`, `tests/challenger_r2_r3_r4_adversarial.test.tsx`) already validate ad-hoc addition, removal, reordering, volume computation, and blueprint isolation across Tier 1 (features), Tier 2 (boundaries), Tier 3 (cross-module interactions), and Tier 4 (real-world gym scenarios).

---

## 2. Architecture & File Inventory

| File Path | Role & Key Responsibilities |
|---|---|
| `src/store/slices/createWorkoutSlice.ts` | Manages `localWorkout` in Zustand store, debounces persistence to `localStorage['logbook_local_workout']`, and mirrors `userData.activeWorkout`. |
| `src/store/useAppStore.ts` | Integrates `WorkoutSlice`, attaches `visibilitychange` listener to synchronously flush `localWorkout` to `localStorage` on mobile suspension/app-switch. |
| `src/hooks/useWorkoutSession.ts` | Core session controller: `startWorkout`, `endWorkout`, `deleteWorkout`, `startEditHistoricalWorkout`, `saveHistoryEdit`, `cancelHistoryEdit`. |
| `src/hooks/workout/useWorkoutSetMutations.ts` | Granular atomic mutations for active session: `addExtraExercise`, `removeActiveExercise`, `reorderExercises`, `addSet`, `removeSet`, `removeLastSet`, `updateSet`, `addSpecialSet`, `updateSpecialSet`, `removeSpecialSet`, `updateSessionNote`. |
| `src/components/Training/TrainingSession.tsx` | Main workout session view: renders exercise list via `SessionExerciseCard`, timer, ratings (`SessionRatings`), and the "+ Aggiungi esercizio extra" section. |
| `src/components/Training/session/SessionExerciseCard.tsx` | Memoized card component rendering exercise name (resolved dynamically via `libDef`), sets list (`SessionSetRow`), remove exercise button (`🗑️`), setup notes, and historical set previews. |
| `src/hooks/useHomeView.ts` | Volume and fatigue aggregation engine: computes weekly completed sets (`volumeChartData`) and 72-hour muscle recovery heatmap (`muscleColors`) from `userData.history`. |
| `src/lib/export.ts` | CSV export engine (`Exporter.exportToCSV`) exporting full session sets, dropsets, and isometrics to `allenamenti.csv`. |

---

## 3. Deep-Dive: Invariant Verification (Blueprint Immutability vs. Local Workout)

### 3.1 Session Creation: Deep Clone from Blueprint
When a user launches a workout in `src/hooks/useWorkoutSession.ts` (lines 69–129):
```typescript
const startWorkout = useCallback(async (routineIdToStart?: string, cycleInfo?: { cycleId?: string; cycleName?: string }) => {
    ...
    const userData = useAppStore.getState().userData;
    const currentRoutines = userData?.routines || [];
    const routine = currentRoutines.find(r => r.id === targetId);
    ...
    const newActiveWorkout: WorkoutSession = {
        id: Logic.generateId('w'),
        routineId: routine.id,
        routineName: routine.name,
        cycleId: assignedCycleId,
        cycleName: assignedCycleName,
        date: Logic.getLocalDateString(),
        globalStartTime: new Date().getTime(),
        exercises: (routine.exercises || []).map((ex: any) => {
            const libDef = (userData?.library || []).find(l => l.id === ex.exId);
            const isCardio = libDef?.trackingType === 'cardio';
            const setsCount = isCardio ? 1 : (ex.setsCount || 3);
            const sets = [];
            for (let i = 0; i < setsCount; i++) {
                const setObj: any = { id: Logic.generateId('s'), kg: '', reps: '' };
                if (ex.defaultTechnique === 'dropset') {
                    setObj.dropsets = [{ id: Logic.generateId('ds'), kg: '', reps: '' }];
                } else if (ex.defaultTechnique === 'isometrics') {
                    setObj.isometrics = [{ id: Logic.generateId('iso'), kg: '', time: '' }];
                }
                sets.push(setObj);
            }
            const result: any = { exId: ex.exId, sets, sessionNote: '' };
            if (ex.defaultTechnique) result.defaultTechnique = ex.defaultTechnique;
            if (ex.minReps) result.minReps = ex.minReps;
            if (ex.maxReps) result.maxReps = ex.maxReps;
            return result;
        })
    };

    setLocalWorkout(newActiveWorkout);
}, ...);
```
- **Evidence:** `newActiveWorkout` creates new array and object instances for `exercises` and `sets`.
- `userData.routines` is only read (`currentRoutines.find`), never written.

### 3.2 Adding an Ad-Hoc Exercise (`addExtraExercise`)
In `src/hooks/workout/useWorkoutSetMutations.ts` (lines 12–25):
```typescript
const addExtraExercise = useCallback((exInput: string | { exId: string }) => {
    const exId = typeof exInput === 'string' ? exInput : exInput?.exId;
    if (!exId) return;
    setLocalWorkout((prev) => {
        if (!prev) return prev;
        return {
            ...prev,
            exercises: [
                ...prev.exercises,
                { exId, sets: [{ id: Logic.generateId('s'), kg: '', reps: '' }], sessionNote: '' }
            ]
        };
    });
}, [setLocalWorkout]);
```
- **Evidence:** Only `setLocalWorkout` is invoked.
- Appends a new exercise object to `prev.exercises` with a fresh unique set ID (`Logic.generateId('s')`).
- `saveUserData` is NOT called; `userData.routines` remains untouched.

### 3.3 Removing an Active Exercise (`removeActiveExercise`)
In `src/hooks/workout/useWorkoutSetMutations.ts` (lines 60–69):
```typescript
const removeActiveExercise = useCallback(async (exIndex: number, closePanelsCallback?: (index: number) => void) => {
    if (!(await showConfirm("Rimuovere questo esercizio dalla sessione corrente?"))) return;
    setLocalWorkout((prev) => {
        if (!prev) return prev;
        const updatedExercises = [...prev.exercises];
        updatedExercises.splice(exIndex, 1);
        return { ...prev, exercises: updatedExercises };
    });
    if (closePanelsCallback) closePanelsCallback(exIndex);
}, [showConfirm, setLocalWorkout]);
```
- **Evidence:** Prompts confirmation dialog via `showConfirm`.
- Splices `exIndex` from the shallow copy `updatedExercises` of `prev.exercises`.
- Calls `setLocalWorkout` to update the active session only.
- `userData.routines` remains untouched.

---

## 4. Workout Finalization & Downstream History/Stats Propagation

### 4.1 Persistence to `userData.history` (`endWorkout`)
In `src/hooks/useWorkoutSession.ts` (lines 237–276):
```typescript
const endWorkout = useCallback(async () => {
    const currentWorkout = useAppStore.getState().localWorkout;
    if (!currentWorkout || !(await showConfirm("Terminare l'allenamento?"))) return;

    const valRes = Logic.validateWorkoutRatings(
        mood ? parseInt(mood) : null,
        pump ? parseInt(pump) : null,
        fatigue ? parseInt(fatigue) : null
    );

    const endTime = new Date().getTime();
    const startTime = currentWorkout.globalStartTime || endTime;
    const diff = Math.max(0, Math.floor((endTime - startTime) / 1000));
    const durationStr = Logic.formatDuration(diff);

    const finishedWorkout: WorkoutSession = {
        ...currentWorkout,
        globalEndTime: endTime,
        globalDurationStr: durationStr,
        moodRating: valRes.mood,
        pumpRating: valRes.pump,
        fatigueRating: valRes.fatigue,
        waterLiters: water ? parseFloat(water) : 0,
        date: currentWorkout.date || Logic.getLocalDateString()
    };

    delete finishedWorkout.isEditingHistory;
    delete finishedWorkout.originalHistoryId;

    try {
        await saveUserData((prev) => {
            if (!prev) return prev;
            return { ...prev, history: [finishedWorkout, ...(prev.history || [])], activeWorkout: null };
        });
        setLocalWorkout(null);
        resetGlobalWorkoutTimer();
    } catch {
        showAlert("Errore durante il salvataggio della sessione.");
    }
}, [mood, pump, fatigue, water, showConfirm, saveUserData, setLocalWorkout, showAlert]);
```
- **Observation:** `finishedWorkout` copies `currentWorkout.exercises` in their entirety (including any ad-hoc added exercises and omitting any removed exercises).
- `saveUserData` prepends `finishedWorkout` into `prev.history`.
- `prev.routines` is returned untouched by the updater function.
- `setLocalWorkout(null)` clears `localStorage['logbook_local_workout']`.

### 4.2 Volume & Muscle Heatmap Propagation (`useHomeView.ts`)
In `src/hooks/useHomeView.ts` (lines 121–185):
1. **Completed Sets Calculation:**
   - Iterates through `history` -> `w.exercises` -> `ex.sets`.
   - Counts a set as completed if it has non-empty values (`kg`, `reps`, `time`, or `done !== false`), and counts all nested `dropsets`.
2. **Weekly Volume Chart (`volumeChartData`):**
   - If workout date is within the last 7 days (`isRecent7d`), maps `ex.exId` to `libEx.muscles`.
   - Identifies muscle categories (`Petto`, `Dorso`, `Spalle`, `Gambe`, `Braccia`, `Addome`) and increments completed sets count.
3. **72-Hour Muscle Fatigue Heatmap (`muscleColors`):**
   - If workout is within 72 hours (`isRecent72h`), calculates `baseFatigue = 1 - (hoursPassed / 72)`.
   - Maps fatigue to primary muscles (`baseFatigue`) and secondary muscles (`baseFatigue * 0.5`).
   - Assigns color codes: `#ef4444` (high fatigue), `#f97316` (medium fatigue), `#eab308` (mild fatigue).
- **Result:** Because ad-hoc exercises contain valid `ex.exId` pointing to `userData.library`, their sets contribute 100% accurately to volume and fatigue metrics upon session completion.

### 4.3 Multi-Workout History Badge in Live Session (`TrainingSession.tsx`)
In `src/components/Training/TrainingSession.tsx` (lines 120–136):
- `exerciseHistoryMap` scans `history` to retrieve the last 2 workouts for each `exId`.
- When an ad-hoc exercise is added to a session, clicking "🕒 Storico" on `SessionExerciseCard` displays past performances of that exercise from earlier sessions.

### 4.4 CSV Export Integration (`src/lib/export.ts`)
In `src/lib/export.ts`:
- `Exporter.exportToCSV` processes `history` and writes all sets, dropsets, and isometrics of ad-hoc exercises into `allenamenti.csv` with accurate dates, routine names, exercise names, loads, and reps.

---

## 5. Verification Test Matrix

The following test suites in the codebase specifically target and verify R6 functionality:

| Test File | Test Identifier | Covered Scenario | Result |
|---|---|---|---|
| `tests/e2e_enhancements_r1_r6.test.tsx` | `T1.6.1` | `addExtraExercise` adds ad-hoc exercise to `localWorkout` without mutating routine blueprint | PASSED |
| `tests/e2e_enhancements_r1_r6.test.tsx` | `T1.6.2` | `removeActiveExercise` prompts confirmation and removes target exercise from `localWorkout` | PASSED |
| `tests/e2e_enhancements_r1_r6.test.tsx` | `T1.6.3` | Ad-hoc exercise sets can be populated with weight and rep values | PASSED |
| `tests/e2e_enhancements_r1_r6.test.tsx` | `T1.6.4` | Completing workout (`endWorkout`) saves ad-hoc exercises into `userData.history` | PASSED |
| `tests/e2e_enhancements_r1_r6.test.tsx` | `T1.6.5` | Original routine blueprint in `userData.routines` remains strictly unchanged after session ends | PASSED |
| `tests/e2e_enhancements_r1_r6.test.tsx` | `T2.6.1` | Adding multiple ad-hoc exercises of the same library item creates distinct instances with unique set IDs | PASSED |
| `tests/e2e_enhancements_r1_r6.test.tsx` | `T2.6.2` | Removing all exercises during active workout leaves empty workout state without crash | PASSED |
| `tests/e2e_enhancements_r1_r6.test.tsx` | `T2.6.3` | Adding ad-hoc exercise and reordering it to index 0 maintains its set structure | PASSED |
| `tests/e2e_enhancements_r1_r6.test.tsx` | `T2.6.4` | Ad-hoc cardio exercise computes speed (`dist / (time / 60)`) and saves into active workout | PASSED |
| `tests/e2e_enhancements_r1_r6.test.tsx` | `T2.6.5` | Cancelling history edit (`cancelHistoryEdit`) discards ad-hoc edits cleanly | PASSED |
| `tests/e2e_enhancements_r1_r6.test.tsx` | `T3.1` | Combined: Ad-Hoc addition + Live reordering + Real-time library sync | PASSED |
| `tests/e2e_enhancements_r1_r6.test.tsx` | `T3.4` | Combined: Routine builder + Active session launch + Ad-hoc modification + History save | PASSED |
| `tests/e2e_enhancements_r1_r6.test.tsx` | `T4.1` | Real-world scenario: "The Occupied Bench Press" (swap, reorder, execute, finish) | PASSED |
| `tests/e2e_enhancements_r1_r6.test.tsx` | `T4.2` | Real-world scenario: "Ad-Hoc Arm Blast Finisher" (volume dropsets added mid-workout) | PASSED |
| `tests/workout_improvements.test.tsx` | Suite 6 | `useHomeView` volume and dropset calculation from historical sessions | PASSED |

---

## 6. Recommendations for Worker / Orchestrator

1. **UX Consistency Recommendation:**
   - In `src/components/Training/TrainingSession.tsx` (lines 424–436), the "Aggiungi esercizio extra" UI currently renders a standard HTML `<select>`.
   - When R4 (Fuzzy Search in RoutineEditor) is implemented, the same fuzzy search component or pattern can be utilized in `TrainingSession.tsx` so that users searching for extra exercises during a workout enjoy typo tolerance, instant filtering, and the Dark Glassmorphic dropdown.
2. **Mobile Dialog Invariant:**
   - Destructive exercise removal properly uses `useDialogStore.getState().showConfirm(...)` and respects the AGENTS.md rule prohibiting native `window.confirm()` or `<dialog>`.

---

## 7. Conclusion

Requirement R6 is robustly architected and thoroughly verified:
1. `addExtraExercise` and `removeActiveExercise` operate strictly within `localWorkout`.
2. `userData.routines` remains strictly immutable.
3. `finishWorkout` (`endWorkout`) persists all ad-hoc changes into `userData.history`.
4. Downstream analytics (volume, fatigue heatmap, history lookups, CSV export) automatically reflect ad-hoc sets.
