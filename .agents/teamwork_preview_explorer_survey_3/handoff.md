# Investigation Report: Requirement R4 & Architectural Compliance Survey

**Date**: 2026-08-20  
**Author**: Explorer 3  
**Working Directory**: `C:\Users\gerar\Documents\GitHub\logbook\.agents\teamwork_preview_explorer_survey_3`  
**Target Focus**:
1. **Requirement R4**: Ricerca intelligente per l'aggiunta in Scheda (Fuzzy search input with dropdown in `RoutineEditor` to add exercises from library).
2. **Architectural & AGENTS.md Compliance Survey**: 5-step property checklist, test framework setup (`vitest`), build/lint pipelines (`tsc`, `vite build`, `oxlint`), mobile UX / dark glassmorphism styling conventions.

---

## 1. Observation

### 1.1 R4: Current Routine Editor & Exercise Adder Implementation
- **File**: `src/components/Training/routines/RoutineEditor.tsx` (lines 70–84)
  ```tsx
  70:                 <div className="mb-15">
  71:                     <select 
  72:                         onChange={(e) => {
  73:                             onAddExercise(e.target.value);
  74:                             e.target.value = '';
  75:                         }}
  76:                         className="w-full p-10 bg-surface text-white border-b rounded-8"
  77:                         style={{ fontSize: '16px' }}
  78:                     >
  79:                         <option value="">+ Aggiungi esercizio dalla libreria</option>
  80:                         {library.map(l => (
  81:                             <option key={l.id} value={l.id}>{l.name}</option>
  82:                         ))}
  83:                     </select>
  84:                 </div>
  ```
  - The routine editor uses a native HTML `<select>` with `<option>` tags.
  - Adding an exercise calls `onAddExercise(exId: string)`, which is passed down from `TrainingRoutines.tsx` (line 43) via `useTrainingRoutines.ts` (lines 118–121):
    ```ts
    const handleAddExerciseToRoutine = (exId: string) => {
        if (!exId) return;
        setRoutineExercises(prev => [...prev, { exId, setsCount: 3 }]);
    };
    ```
  - **Limitations observed**:
    - For large exercise libraries (50+ exercises), the native dropdown lacks search, typo tolerance, categorization, and metadata display (e.g. target muscles, tracking type).
    - It does not allow fuzzy query matching (e.g. typing "panca" or "spinta" or typo "pnc").

### 1.2 Existing Fuzzy Search & Dropdown Patterns in Codebase
- **Fuse.js General Utility** — `src/lib/calc/workout.ts` (lines 4–49):
  - `filterItems(items, query, searchFields = ['name'])`:
    - Direct substring matching + multi-token `Fuse.js` fuzzy search (`threshold: 0.38`, `minMatchCharLength: 2`, `ignoreLocation: true`).
    - Deduplicates items via `Set` preserving direct matches first.
- **Muscle Stemming & Fuse.js** — `src/hooks/useTrainingExercises.ts` (lines 1–50, 102–140):
  - `normalizeStem(str)` maps Italian plural/singular anatomical terms (e.g. `deltoidi` -> `deltoid`, `pettorali` -> `petto`, `bicipiti` -> `bicipit`).
  - `STATIC_MUSCLE_FUSE` with weights: `name` (0.6), `_stemmedName` (0.4), `threshold: 0.38`.
  - Merges direct matches and fuzzy matches, ranking exact and prefix matches first.
- **Glassmorphic Search UI Pattern 1 (Meal Search)** — `src/components/Nutrition/NutritionMeals.tsx` (lines 128–238):
  - Input field with 16px font-size, clear `✕` button on right.
  - Search results dropdown `#active-search-results`:
    - `maxHeight: '280px'`, `overflowY: 'auto'`, `background: 'var(--surface-light)'`, `border: '1px solid var(--glass-border)'`, `borderRadius: '12px'`, `boxShadow: '0 4px 16px rgba(0,0,0,0.5)'`.
    - Shows item name, metadata badges (e.g. `isCustom`, calories, macros), add actions, and an empty state message if no items match.
- **Glassmorphic Search UI Pattern 2 (Muscle Selector)** — `src/components/Training/TrainingExercises.tsx` (lines 100–165):
  - Relative input box with clear button and scrollable result list (`maxHeight: '220px'`, `background: 'rgba(0, 0, 0, 0.35)'`, `border: '1px solid var(--glass-border)'`).

### 1.3 Architectural & AGENTS.md Compliance Survey
- **Checklist 5-Passaggi (AGENTS.md Sezione 3)**:
  1. `src/types.ts`: `UserData`, `WorkoutRoutine`, `RoutineExercise`, `Exercise`, `WorkoutSession`, `NutritionDay`, `NutritionPlanning`, `TrainingCycle`, `Supplement`.
  2. `src/lib/schema.ts`: Zod gateway (`safeString`, `safeNumber`, `safeOptional...`, `.passthrough()`, `UserDataSchema`, `DomainParsers`, `defaultUserDataFallback`).
  3. `src/lib/db.ts`: `loadUserData` with `DomainParsers` mapping, `saveUserData` with `deepEqual` diffing, `removeUndefinedValues`, and `writeBatch(db)` chunking (max 400 operations per batch).
  4. `src/contexts/AuthContext.tsx`: `defaultUserData` fallback and deterministic `mergeUserData` (per-collection union deduplicating by ID).
  5. `src/lib/export.ts`: `Exporter.exportToCSV` outputs `allenamenti.csv` and `misurazioni.csv` with UTF-8 BOM (`\uFEFF`).
- **Test Framework (`vitest`) Setup**:
  - `vitest.config.ts`: React plugin, `VitePWA({ registerType: 'prompt' })`, `environment: 'jsdom'`, `setupFiles: ['./tests/setup.tsx']`.
  - `tests/setup.tsx`: Mocks `window.scrollTo`, `window.alert`, `window.confirm`, `ResizeObserver`, `useDialogStore`, `HTMLCanvasElement`, `localStorage`, `idb-keyval`, `virtual:pwa-register/react`, Firebase auth/firestore, and exports `renderWithProviders`.
  - **Baseline test execution result (`npm.cmd test`)**: **31 passed (31 files), 556 passed (556 tests)** in 86.43s.
- **Lint Setup**:
  - Script: `npm.cmd run lint` -> `oxlint`.
  - **Baseline lint execution result**: **0 errors**, 25 warnings (in unused test mock variables).
- **Build Setup**:
  - Script: `npm.cmd run build` -> `tsc --noEmit && vite build`.
  - **Baseline build execution result**: Built cleanly in 2.62s (`dist/assets/index-*.js`, `dist/assets/TrainingView-*.js`, etc.).
- **UI & Mobile UX Constraints (`src/styles/global.css`)**:
  - Dark glassmorphism custom properties: `--bg-color: #000000;`, `--surface-color: #0d0d0d;`, `--surface-light: #1a1a1a;`, `--primary-color: #00e5ff;`, `--glass-bg: rgba(13, 13, 13, 0.85);`, `--glass-border: rgba(255, 255, 255, 0.1);`.
  - iOS Safari Auto-Zoom Prevention: `input, select, textarea { font-size: 16px !important; }`.
  - Flexbox overflow prevention: direct children have `min-width: 0`.
  - Italian Sentence Case convention strictly enforced across all labels and section headings.
  - Dialog rule: native `window.alert` / `window.confirm` prohibited; use `useDialogStore.getState().showAlert(...)` and `useDialogStore.getState().showConfirm(...)`.

---

## 2. Logic Chain

1. **R4 Root Cause & Opportunity**:
   - `RoutineEditor.tsx` uses `<select>` which forces the user to manually scroll through an unsorted/alphabetical list without search or fuzzy tolerance.
   - Replacing this with a dedicated search component utilizing `filterItems` / `Fuse.js` adheres to Acceptance Criteria R4: *"Il componente di ricerca esercizi usa una logica simile a `filteredMuscles` per tollerare errori di battitura e mostra un menu a comparsa per la selezione."*
   - Because `onAddExercise(exId: string)` interface in `RoutineEditorProps` is already decoupled, swapping the `<select>` with the search input requires no changes to `useTrainingRoutines.ts` or database persistence layers.

2. **Integration Design for R4**:
   - In `RoutineEditor.tsx`:
     - Maintain local state `exerciseSearch` (`useState('')`) and dropdown visibility / focus state.
     - Memoize filtered results against `library` using `filterItems` (or `Fuse.js` with weights on `name` and muscle labels).
     - When an item is clicked in the dropdown:
       1. Call `onAddExercise(ex.id)`.
       2. Clear `exerciseSearch` (`setExerciseSearch('')`).
     - Render clear button `✕` when `exerciseSearch.length > 0`.
     - Render floating glassmorphic results container with muscle tags (`lib.muscles`), tracking type indicators, and empty state feedback ("Nessun esercizio trovato per...").

3. **Architectural Stability**:
   - The project is fully covered with 556 passing tests across 31 test suites.
   - Code changes for R4 will strictly touch presentation in `src/components/Training/routines/RoutineEditor.tsx`, with zero risk of breaking Zustand schemas or Firestore serialization.
   - Any new test for R4 should be placed in `tests/` and assert fuzzy matching tolerance and addition of exercises to the routine builder state.

---

## 3. Caveats

1. **Windows PowerShell Execution Policy**:
   - Running `npm test` directly in Windows PowerShell can fail due to `.ps1` execution policy restrictions (`PSSecurityException`). Always use `npm.cmd test`, `npm.cmd run build`, and `npm.cmd run lint`.
2. **Keyboard Focus & Mobile Touch in Dropdown**:
   - When tapping a result item in mobile Safari/Chrome, ensure `onMouseDown={(e) => e.preventDefault()}` or proper `onClick` handlers so that blur events do not close the dropdown prematurely before `onAddExercise` executes.
3. **Draft Routine Persistence**:
   - `useTrainingRoutines.ts` persists `draft_routine` in `localStorage`. Adding exercises via fuzzy search immediately appends to `routineExercises`, triggering the existing draft preservation effect without extra code.

---

## 4. Conclusion & Proposed Implementation Strategy

### 4.1 Proposed R4 Code Snippet in `src/components/Training/routines/RoutineEditor.tsx`

```tsx
// Inside RoutineEditor component:
const [exerciseSearch, setExerciseSearch] = useState('');
const [isSearchFocused, setIsSearchFocused] = useState(false);

const filteredExercises = useMemo(() => {
    const q = exerciseSearch.trim();
    if (!q) return [];
    
    // Direct substring match on name or muscle groups
    const qLower = q.toLowerCase();
    const directMatches = library.filter(ex => 
        ex.name.toLowerCase().includes(qLower) ||
        (ex.muscles && ex.muscles.some(m => m.toLowerCase().includes(qLower)))
    );

    // Fuzzy search with Fuse.js for typo tolerance
    const fuse = new Fuse(library, {
        keys: [
            { name: 'name', weight: 0.7 },
            { name: 'muscles', weight: 0.3 }
        ],
        threshold: 0.38,
        ignoreLocation: true,
        minMatchCharLength: 2
    });
    const fuzzyMatches = fuse.search(q).map(res => res.item);

    // Deduplicate maintaining direct matches first
    const seen = new Set<string>();
    const merged: ExerciseLibraryItem[] = [];
    for (const ex of [...directMatches, ...fuzzyMatches]) {
        if (!seen.has(ex.id)) {
            seen.add(ex.id);
            merged.push(ex);
        }
    }
    return merged;
}, [library, exerciseSearch]);
```

**JSX Replacement for lines 70–84 in `RoutineEditor.tsx`:**
```tsx
<div className="mb-15" style={{ position: 'relative' }}>
    <label className="text-muted text-xs block mb-4">Aggiungi esercizio dalla libreria</label>
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <input 
            type="text" 
            placeholder="🔍 Cerca esercizio (es. Panca, Squat, Trazioni)..." 
            value={exerciseSearch} 
            onChange={e => setExerciseSearch(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
            style={{ 
                width: '100%', 
                margin: 0, 
                paddingRight: exerciseSearch ? '36px' : '14px',
                fontSize: '16px' 
            }}
        />
        {exerciseSearch && (
            <button
                type="button"
                onClick={() => setExerciseSearch('')}
                style={{
                    position: 'absolute',
                    right: '8px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    fontSize: '1rem',
                    cursor: 'pointer',
                    padding: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}
                aria-label="Cancella ricerca"
            >
                ✕
            </button>
        )}
    </div>

    {exerciseSearch.trim().length > 0 && isSearchFocused && (
        <div 
            style={{ 
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                marginTop: '6px',
                background: 'var(--surface-light)',
                border: '1px solid var(--glass-border)',
                borderRadius: '12px',
                maxHeight: '260px',
                overflowY: 'auto',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
                zIndex: 100
            }}
        >
            {filteredExercises.length === 0 ? (
                <div className="text-muted text-xs p-12 text-center">
                    Nessun esercizio trovato per "{exerciseSearch}"
                </div>
            ) : (
                filteredExercises.map((ex, idx) => (
                    <div 
                        key={ex.id}
                        onMouseDown={(e) => {
                            e.preventDefault(); // Prevents input blur before click
                            onAddExercise(ex.id);
                            setExerciseSearch('');
                            setIsSearchFocused(false);
                        }}
                        style={{
                            padding: '12px 14px',
                            cursor: 'pointer',
                            borderBottom: idx === filteredExercises.length - 1 ? 'none' : '1px solid var(--glass-border)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            transition: 'background 0.2s ease',
                            background: 'rgba(255, 255, 255, 0.02)'
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)')}
                    >
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.95rem' }}>
                                {ex.name}
                            </div>
                            {ex.muscles && ex.muscles.length > 0 && (
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                    {ex.muscles.join(', ')}
                                </div>
                            )}
                        </div>
                        <span style={{ fontSize: '1.1rem', color: 'var(--primary-color)', marginLeft: '10px' }}>
                            +
                        </span>
                    </div>
                ))
            )}
        </div>
    )}
</div>
```

---

## 5. Verification Method

To independently verify the findings and any future implementation:

1. **Unit & Integration Tests**:
   - Run command: `npm.cmd test`
   - Expected result: 31 test suites pass with 556+ tests passing.
   - Inspect test file: `tests/training_session_ui_improvements.test.tsx` or new `tests/routine_search.test.tsx`.
2. **Type Checking & Production Build**:
   - Run command: `npm.cmd run build`
   - Expected result: TypeScript passes with zero type errors (`tsc --noEmit`), Vite produces build artifacts in `dist/`.
3. **Static Lint Analysis**:
   - Run command: `npm.cmd run lint`
   - Expected result: `oxlint` returns 0 errors.
4. **Manual / Component Verification**:
   - Open Routine Editor in Training view.
   - Type partial or misspelled exercise names (e.g. "pnca" for "Panca").
   - Confirm dropdown appears with filtered exercises.
   - Click an exercise: verify it is immediately added to the routine list and search query is cleared.
