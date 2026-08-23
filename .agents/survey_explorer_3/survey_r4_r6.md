# Comprehensive Survey Report: R4 & R6
**LogBook PWA — Architecture & Implementation Survey**
*Author: Survey Explorer 3*
*Date: 2026-08-20*

---

## 1. Executive Summary

This report delivers an in-depth codebase analysis and architectural roadmap for two core user experience requirements in the LogBook application:
- **R4 (Ricerca intelligente per l'aggiunta in Scheda):** Replacing the legacy `<select>` dropdown in `RoutineEditor` with an intelligent, typo-tolerant fuzzy search input and dark glassmorphic popup dropdown menu powered by `fuse.js`.
- **R6 (Esercizi Ad-Hoc in sessione):** Auditing and perfecting the live workout session flow so users can add and remove exercises on the fly within `localWorkout` without mutating the blueprint `WorkoutRoutine`, ensuring all ad-hoc sets are correctly persisted to `history` and accounted for in weekly volume and fatigue metrics.

Both features are technically sound, respect the 3-Tier Storage & Offline-First architecture of LogBook, and require zero database schema migrations since `localWorkout`, `WorkoutRoutine`, and `WorkoutSession` models already accommodate dynamic exercise arrays.

---

## 2. Requirement R4: Intelligent Fuzzy Search in RoutineEditor

### 2.1 Current Implementation & Pain Points
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

**Identified Issues:**
1. **Scalability:** With 30+ exercises in the library, native mobile/desktop `<select>` elements become cumbersome and slow to scroll.
2. **Zero Typo Tolerance:** Native `<select>` has no built-in search or filtering capabilities, preventing quick keyboard navigation on mobile.
3. **Inconsistent UX:** The exercise creation view (`TrainingExercises.tsx`) and food archive (`FoodArchiveSearch.tsx` / `nutrition.ts`) already use fuzzy searching with Fuse.js, making the routine editor's static select feel dated and inconsistent.

### 2.2 Existing Fuzzy Search Ecosystem in Codebase
LogBook already includes `fuse.js` (v7.5.0) in `package.json` dependencies and utilizes two proven fuzzy matching patterns:

1. **`Logic.filterItems` (`src/lib/calc/workout.ts`):**
   - Direct substring matching combined with `Fuse.js` multi-token searching.
   - Configured with `threshold: 0.38`, `ignoreLocation: true`, `minMatchCharLength: 2`.
   - Tested in `src/lib/logic.test.ts` (lines 118–137) demonstrating successful typo tolerance (e.g. searching `"pancca"` resolves to `"Panca piana bilanciere"`, `"squatt"` resolves to `"Squat con bilanciere"`).

2. **`filteredMuscles` (`src/hooks/useTrainingExercises.ts`):**
   - Applies Italian linguistic stemming (e.g., `pettorali -> petto`, `bicipiti -> bicipit`) and ranks exact prefix matches ahead of fuzzy matches.

### 2.3 Proposed Architecture for R4

#### Component Design & Flow
In `RoutineEditor.tsx`:
1. **Search State:** Local state `searchTerm` (string) and `isDropdownOpen` (boolean).
2. **Fuzzy Filter:**
   - Filter `library` using `Logic.filterItems(library, searchTerm, ['name'])` or an enhanced Fuse search matching `name`, `notes`, and muscle names.
   - When `searchTerm` is empty, clicking/focusing the input shows the full library list (or top items) in alphabetical order.
   - When `searchTerm` is populated, shows matched exercises sorted by relevance.
3. **UI Elements:**
   - **Text Input:** `<input type="text" placeholder="🔍 Cerca esercizio da aggiungere..." ... />` styled with `font-size: 16px !important` (preventing iOS Safari auto-zoom) and a clear button (`✕`) when not empty.
   - **Floating / Inline Dropdown:** Rendered below the input, styled with Dark Glassmorphism:
     - Background: `var(--surface-color, #0d0d0d)` / `rgba(13, 13, 13, 0.95)`
     - Border: `1px solid var(--glass-border)`
     - Backdrop Filter: `blur(10px)`
     - Border Radius: `8px`
     - Maximum Height: `220px` with `overflow-y: auto`
     - Z-index: appropriate elevation so it floats cleanly without clipping.
   - **Dropdown Items:**
     - Exercise name in bold (`text-main`).
     - Muscle tags / tracking type badge (e.g., "🏃 Cardio", "⏱️ Tempo", "Pettorali").
     - On click: calls `onAddExercise(exercise.id)`, clears `searchTerm`, and closes dropdown.
   - **Empty State:** If query yields no matches, display `<div className="text-muted text-xs p-8 text-center">Nessun esercizio trovato</div>`.

---

## 3. Requirement R6: Ad-Hoc Exercises in Live Session

### 3.1 Architecture Overview & Call Chain
The workout session operates under an **Offline-First & Hybrid Storage Model**:

```
[Start Session] -> Routine Blueprint (routines[])
       │
       ▼ (Deep Clone)
[Active Session] -> localWorkout (localStorage: 'logbook_local_workout' + Zustand WorkoutSlice)
       │
       ├─► Add Extra Exercise (addExtraExercise) -> Appends to localWorkout.exercises ONLY
       ├─► Remove Exercise (removeActiveExercise) -> Slices from localWorkout.exercises ONLY
       │
       ▼ (End Session: endWorkout)
[Finished Session] -> history[] (IndexedDB Tier 2 + Firestore Tier 1)
       │
       └─► Volume / Heatmap Calculations (useHomeView.ts) -> Processes all sets in history[]
```

### 3.2 Immutability Verification: Blueprint vs. Live Instance
1. **Creation Phase (`useWorkoutSession.ts: startWorkout`):**
   - Extracts routine from `userData.routines.find(r => r.id === targetId)`.
   - Creates a new `WorkoutSession` object with deep-cloned exercises array:
     ```ts
     exercises: (routine.exercises || []).map((ex: any) => ({
         exId: ex.exId,
         sets: [...],
         sessionNote: ''
     }))
     ```
2. **Mutation Phase (`useWorkoutSetMutations.ts`):**
   - `addExtraExercise(exId)`: calls `setLocalWorkout(prev => ({ ...prev, exercises: [...prev.exercises, newEx] }))`.
   - `removeActiveExercise(exIndex)`: prompts `showConfirm("Rimuovere questo esercizio dalla sessione corrente?")`, then calls `setLocalWorkout(prev => ({ ...prev, exercises: prev.exercises.filter(...) }))`.
   - **Verification:** Both mutation functions call ONLY `setLocalWorkout`. Neither function touches `state.userData.routines`. Therefore, the blueprint `WorkoutRoutine` in `userData.routines` remains 100% untouched.
3. **Persistence Phase (`useWorkoutSession.ts: endWorkout`):**
   - Builds `finishedWorkout: WorkoutSession` from `currentWorkout` (`localWorkout`).
   - Calls `saveUserData(prev => ({ ...prev, history: [finishedWorkout, ...prev.history], activeWorkout: null }))`.
   - Resets `localWorkout = null` and clears `localStorage['logbook_local_workout']`.
   - The finished workout in `userData.history` contains all added ad-hoc exercises and omits any removed exercises.
4. **Volume & Fatigue Calculation Integrity (`useHomeView.ts: lines 113–185`):**
   - Volume calculation iterates over `history`:
     ```ts
     history.forEach(w => {
         (w.exercises || []).forEach(ex => {
             const libEx = libraryMap.get(ex.exId);
             if (!libEx) return;
             // Computes completedSets and maps to muscle categories...
         });
     });
     ```
   - Because ad-hoc exercises in `finishedWorkout` contain valid `exId` matching `userData.library`, their sets are immediately and accurately aggregated into weekly volume charts and 72-hour muscle recovery heatmaps.

### 3.3 Identified Opportunities for R6
- In `TrainingSession.tsx` (lines 424–436), the "Aggiungi esercizio extra" section currently uses a basic `<select>`. Upgrading this with the same fuzzy search component developed for R4 will give users a unified, fast experience when adding exercises mid-workout.

---

## 4. Codebase Reference Matrix

| Feature Area | File Path | Line References | Key Responsibilities |
|---|---|---|---|
| **Routine Editor** | `src/components/Training/routines/RoutineEditor.tsx` | 70–84 | Current `<select>` for adding exercises from library |
| **Routine Hook** | `src/hooks/useTrainingRoutines.ts` | 118–121 | `handleAddExerciseToRoutine` handler |
| **Fuzzy Search Logic** | `src/lib/calc/workout.ts` | 4–49 | `Logic.filterItems` fuzzy search with `Fuse.js` |
| **Fuzzy Search Pattern** | `src/hooks/useTrainingExercises.ts` | 102–149 | `filteredMuscles` fuzzy search and ranking implementation |
| **Session View** | `src/components/Training/TrainingSession.tsx` | 424–436 | Live session exercise list & "Aggiungi esercizio extra" |
| **Session Card** | `src/components/Training/session/SessionExerciseCard.tsx` | 122–128 | Remove exercise button (`🗑️`) |
| **Session Mutations** | `src/hooks/workout/useWorkoutSetMutations.ts` | 12–25, 60–69 | `addExtraExercise` and `removeActiveExercise` |
| **Session Flow** | `src/hooks/useWorkoutSession.ts` | 69–130, 237–277 | `startWorkout` (deep clone) and `endWorkout` (history save) |
| **Volume Calculation** | `src/hooks/useHomeView.ts` | 113–207 | Aggregation of completed sets per muscle group from `history` |
| **Zustand Workout Slice** | `src/store/slices/createWorkoutSlice.ts` | 61–75 | `localWorkout` store management and localStorage debounce |

---

## 5. UI/UX & Design System Guidelines

1. **Dark Glassmorphism Standards (`src/styles/global.css`):**
   - Backgrounds: `var(--surface-color, #0d0d0d)`, `rgba(0,0,0,0.35)`
   - Borders: `1px solid var(--glass-border)` (or `rgba(255, 255, 255, 0.1)`)
   - Highlights: `var(--primary-color, #00e5ff)`
   - Badges: `.badge-primary`, `.badge`
2. **Italian Sentence Case Standards:**
   - Placeholder: `"Cerca esercizio nella libreria..."`
   - Empty state: `"Nessun esercizio trovato"`
   - Confirmation: `"Rimuovere questo esercizio dalla sessione corrente?"`
   - Buttons: `"+ Aggiungi esercizio"`, `"- Rimuovi serie"`, `"Termina sessione"`
3. **Mobile & Safari Standards:**
   - All input fields must have `font-size: 16px !important`.
   - Never use native `<dialog>` elements for form inputs or dropdowns.
   - Use `useDialogStore.getState().showConfirm(...)` for destructive action confirmations.

---

## 6. Comprehensive Verification & Testing Plan

### 6.1 Unit Tests (`src/lib/logic.test.ts`)
- **Fuzzy Search Accuracy:**
  - Test exact matches (e.g. `"Panca"` -> `"Panca piana"`).
  - Test single-character and multiple typos (e.g. `"panca pianna"`, `"squatt bilancire"`).
  - Test multi-token matching (e.g. `"bilanciere panca"` matches `"Panca piana con bilanciere"`).
  - Test empty queries and non-matching queries.

### 6.2 Component & Integration Tests
- **R4 (RoutineEditor):**
  - Render `RoutineEditor` with sample library items.
  - Verify that typing in search input filters the dropdown list.
  - Verify that clicking an item calls `onAddExercise(id)` and clears search text.
  - Verify clear button `✕` resets search term.
- **R6 (WorkoutSession & Immutability):**
  - Initialize store with 1 routine having 2 exercises (`ex1`, `ex2`).
  - Start workout: verify `localWorkout` is initialized with `ex1`, `ex2`.
  - Add extra ad-hoc exercise `ex3`: verify `localWorkout.exercises.length === 3`.
  - Verify `userData.routines[0].exercises.length === 2` (blueprint unchanged).
  - Remove `ex1` from `localWorkout`: verify `localWorkout.exercises.length === 2` (`ex2`, `ex3`).
  - Verify `userData.routines[0].exercises.length === 2` (blueprint unchanged).
  - Complete workout: verify `userData.history[0].exercises` contains `ex2` and `ex3`.
  - Verify volume chart aggregation includes sets from `ex3`.

---

## 7. Conclusion
The architectural investigation confirms that R4 and R6 can be implemented cleanly, safely, and without breaking existing storage or data models. The planned changes will significantly improve routine customization speed and in-gym workout flexibility.
