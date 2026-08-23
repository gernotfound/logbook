# Handoff Report: Milestone M3 Test Architecture & Coverage

## 1. Observation
- **Test Infrastructure**:
  - `package.json` specifies `"test": "vitest"`.
  - Executing `npm.cmd test` passes 40 test files and 746 tests in ~57s with zero failures.
- **RoutineEditor Implementation**:
  - `src/components/Training/routines/RoutineEditor.tsx` (lines 70–84) currently contains a static `<select>`:
    ```tsx
    <select 
        onChange={(e) => {
            onAddExercise(e.target.value);
            e.target.value = '';
        }}
        className="w-full p-10 bg-surface text-white border-b rounded-8"
        style={{ fontSize: '16px' }}
    >
        <option value="">+ Aggiungi esercizio dalla libreria</option>
        {library.map(l => (
            <option key={l.id} value={l.id}>{l.name}</option>
        ))}
    </select>
    ```
- **Existing Test in `tests/e2e_enhancements_r1_r6.test.tsx`**:
  - Lines 494–498 query this select:
    ```ts
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    fireEvent.change(select, { target: { value: 'ex_dip' } });
    expect(onAddExercise).toHaveBeenCalledWith('ex_dip');
    ```
- **Ad-Hoc Session Mutations & Immutability**:
  - `src/hooks/workout/useWorkoutSetMutations.ts` lines 12–25 (`addExtraExercise`) and lines 60–69 (`removeActiveExercise`) mutate only `setLocalWorkout`.
  - `src/hooks/useWorkoutSession.ts` lines 240–270 (`endWorkout`) prepends `localWorkout` to `userData.history` without modifying `userData.routines`.
  - `src/hooks/useHomeView.ts` lines 121–185 aggregates volume and fatigue by iterating over `history` and resolving exercise definitions from `libraryMap.get(ex.exId)`.

## 2. Logic Chain
1. **Observation 1 & 2 $\rightarrow$ R4 Refactoring Impact**: Replacing the `<select>` in `RoutineEditor.tsx` with a Fuse.js fuzzy search input will break tests expecting `container.querySelector('select')`. Therefore, existing tests in `e2e_enhancements_r1_r6.test.tsx` must be updated, and a dedicated test suite for fuzzy typo tolerance, outside-click, and mobile keyboard interaction must be added.
2. **Observation 3 & 4 $\rightarrow$ R6 Immutability & Persistence Safety**: Because `useWorkoutSetMutations` touches only `localWorkout` and `endWorkout` only prepends to `history`, `userData.routines` is naturally shielded against blueprint pollution. The tests must empirically verify reference equality and content immutability of `userData.routines` before and after ad-hoc session modifications.
3. **Observation 4 $\rightarrow$ Volume & Fatigue Accuracy**: Because `useHomeView.ts` relies on `ex.exId` matching `userData.library`, ad-hoc exercises are immediately included in weekly volume and recovery heatmaps as long as valid completed sets exist. Tests must assert that both regular sets and dropsets from ad-hoc exercises increment the appropriate muscle category volume.

## 3. Caveats
- No changes to database schemas or Firestore subcollections are necessary since `WorkoutSession` and `WorkoutRoutine` data models already support variable `exercises` arrays.
- In `TrainingSession.tsx`, the extra exercise addition block (lines 424–436) should also be updated with the fuzzy search pattern for UI consistency.

## 4. Conclusion
The test architecture and implementation plan for Milestone M3 (R4 and R6) is fully verified and ready for Worker execution. All necessary test suites and edge cases have been catalogued in `report.md`.

## 5. Verification Method
1. Run test suite:
   ```powershell
   npm.cmd test
   ```
2. Build verification:
   ```powershell
   npm.cmd run build
   ```
3. Lint verification:
   ```powershell
   npm.cmd run lint
   ```
4. Key files to inspect:
   - `src/components/Training/routines/RoutineEditor.tsx`
   - `src/components/Training/TrainingSession.tsx`
   - `tests/e2e_enhancements_r1_r6.test.tsx`
   - `.agents/sub_orch_m3_exp_3/report.md`
