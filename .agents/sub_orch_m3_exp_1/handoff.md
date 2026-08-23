# Handoff Report — Explorer 1 (Milestone M3: R4 Intelligent Builder in RoutineEditor)

## 1. Observation
- **Current `<select>` in RoutineEditor:**
  In `src/components/Training/routines/RoutineEditor.tsx` (lines 70–84):
  ```tsx
  <div className="mb-15">
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
  </div>
  ```
- **Parent Routine Hook:**
  In `src/hooks/useTrainingRoutines.ts` (lines 118–121):
  ```ts
  const handleAddExerciseToRoutine = (exId: string) => {
      if (!exId) return;
      setRoutineExercises(prev => [...prev, { exId, setsCount: 3 }]);
  };
  ```
- **Existing Fuzzy Search Implementation:**
  In `src/lib/calc/workout.ts` (lines 4–49), `Logic.filterItems` uses `Fuse.js` with `threshold: 0.38`, `ignoreLocation: true`, `minMatchCharLength: 2`, and multi-token matching.
- **Muscle Linguistic Stemming & Fuzzy Search:**
  In `src/hooks/useTrainingExercises.ts` (lines 102–149), `filteredMuscles` stems Italian muscle keywords (`normalizeStem`) and ranks exact matches, prefix starts, base muscles, and alphabetical fallbacks.
- **Exercise Library Data Model:**
  In `src/types.ts` (lines 49–59), `Exercise` contains `id`, `name`, `notes`, `muscles` (array of primary muscle IDs), `secondaryMuscles` (array of secondary muscle IDs), `setsCount`, `sets`, `trackingType` (`'weight_reps' | 'time' | 'cardio'`).
- **Global CSS Theme:**
  In `src/styles/global.css`, theme variables include `--glass-bg: rgba(13, 13, 13, 0.85);`, `--glass-border: rgba(255, 255, 255, 0.1);`, `--surface-color: #0d0d0d;`, `--primary-color: #00e5ff;`, and input rule `font-size: 16px !important;`.

## 2. Logic Chain
1. **Observation Ref (RoutineEditor lines 70–84):** The static `<select>` requires full scrolling without search, cannot handle typos, and shows only exercise names without muscle tags or tracking badges.
2. **Observation Ref (Existing search in `workout.ts` and `useTrainingExercises.ts`):** `Fuse.js` is already integrated and active in the project bundle. We can combine direct substring searching, Italian muscle name lookup, and Fuse.js fuzzy scoring into an intelligent exercise filter (`searchExerciseLibrary`).
3. **Observation Ref (Types and Global CSS):** Exercises store muscle IDs that can be mapped to Italian labels via `Logic.MUSCLES` (`MUSCLE_NAMES_MAP`). The dropdown can be styled with dark glassmorphism (`--glass-bg`, `--glass-border`, blur backdrop, high z-index, max-height 260px) and rendered as a floating popup that does not disrupt form layout.
4. **Observation Ref (iOS Safari & AGENTS.md):** The search `<input>` must enforce `font-size: 16px !important` to prevent iOS viewport auto-zoom, and all placeholders/labels must use Italian sentence case (e.g. `"Cerca esercizio da aggiungere..."`, `"Nessun esercizio trovato"`).

## 3. Caveats
- When an exercise has no assigned muscle group, search falls back cleanly to name matching, notes, and tracking type.
- Dropdown should handle touch outside on mobile (`touchstart`) as well as mouse clicks (`mousedown`) to prevent sticky popups on iOS/Android.

## 4. Conclusion
Replacing the static `<select>` in `src/components/Training/routines/RoutineEditor.tsx` with a dedicated, dark glassmorphic `ExerciseSearchDropdown` powered by `searchExerciseLibrary` provides instant, typo-tolerant search across exercise names, primary muscles, secondary muscles, and tracking types while adhering to the LogBook design system and mobile constraints.

## 5. Verification Method
- Run `npm.cmd test` to verify logic and component test suites.
- Run `npm.cmd run build` to confirm TypeScript compiles with zero errors.
- Run `npm.cmd run lint` to verify zero linter warnings.
- Inspect `src/components/Training/routines/RoutineEditor.tsx` and `src/components/Training/routines/ExerciseSearchDropdown.tsx` to verify clean props integration, `font-size: 16px !important`, sentence case strings, and outside-click cleanup.
