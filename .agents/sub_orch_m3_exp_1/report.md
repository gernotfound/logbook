# Detailed Technical & UI/UX Investigation Report: Intelligent Exercise Search in RoutineEditor (R4)

**Milestone:** M3 (R4: Intelligent Builder in RoutineEditor)  
**Agent:** Explorer 1 (`sub_orch_m3_exp_1`)  
**Date:** 2026-08-20  

---

## 1. Executive Summary

This report delivers a thorough analysis of the routine exercise selection flow in LogBook, evaluating the current `<select>` mechanism in `src/components/Training/routines/RoutineEditor.tsx`, benchmarking existing search and Fuse.js implementations across the codebase, and specifying an exact, production-ready architecture and UI/UX design for the **Intelligent Search Dropdown** (`ExerciseSearchDropdown`).

### Key Highlights:
1. **Current State:** `RoutineEditor.tsx` lines 70–84 rely on a standard HTML `<select>` element. With growing exercise libraries (30+ items), this native control lacks search, typo tolerance, muscle visibility, and offers poor ergonomics on touch devices.
2. **Search Ecosystem:** The codebase already bundles `fuse.js` (v7.5.0) and provides battle-tested fuzzy search patterns (`Logic.filterItems` in `src/lib/calc/workout.ts`, `filteredMuscles` in `src/hooks/useTrainingExercises.ts`, and `searchFoods` in `src/lib/calc/nutrition.ts`).
3. **Proposed Solution:** A dedicated, accessible, and high-performance component `ExerciseSearchDropdown.tsx` (or integrated into `RoutineEditor.tsx`) featuring:
   - Multi-token and typo-tolerant search across exercise name, primary muscles, secondary muscles, notes, and muscle category labels.
   - Dark Glassmorphic dropdown popup (`--glass-bg`, `--glass-border`, blur backdrop, high z-index, max-height `260px` with smooth touch scrolling).
   - Instant mobile touch responsiveness, safe outside-click detection, `Escape` key dismissal, keyboard arrow navigation (`ArrowDown`/`ArrowUp`/`Enter`), and clear query button (`✕`).
   - Strict adherence to `font-size: 16px !important` to prevent iOS Safari auto-zoom and 100% Italian sentence case.

---

## 2. Investigation of Current RoutineEditor & Call Chain

### 2.1 Component Structure
- **File:** `src/components/Training/routines/RoutineEditor.tsx`
- **Parent Container:** `src/components/Training/TrainingRoutines.tsx`
- **State Management Hook:** `src/hooks/useTrainingRoutines.ts`

### 2.2 Current Exercise Addition Mechanism
In `RoutineEditor.tsx`:
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

In `useTrainingRoutines.ts`:
```ts
const handleAddExerciseToRoutine = (exId: string) => {
    if (!exId) return;
    setRoutineExercises(prev => [...prev, { exId, setsCount: 3 }]);
};
```

### 2.3 Shortcomings of Current Implementation
1. **Zero Search/Filter Capability:** User must scroll through an unsorted or long native picker without filtering by keyword or muscle group.
2. **No Muscle / Tracking Context:** The `<option>` only renders `l.name`. The user cannot see whether the exercise is cardio, timed, or targets specific muscle groups before adding it.
3. **Platform Inconsistency:** On iOS, `<select>` triggers a wheel-picker modal; on desktop/Android, it triggers native dropdowns that clash with LogBook's dark glassmorphic design system.

---

## 3. Fuzzy Search Utilities in the Codebase

### 3.1 `Logic.filterItems` (`src/lib/calc/workout.ts`)
- Configured with `Fuse.js`:
  ```ts
  const fuse = new Fuse(items, {
      keys: fields,
      threshold: 0.38,
      ignoreLocation: true,
      minMatchCharLength: 2,
  });
  ```
- Executes direct substring matching first, then multi-token Fuse.js searching, and deduplicates preserving direct matches at the top.

### 3.2 `filteredMuscles` (`src/hooks/useTrainingExercises.ts`)
- Features Italian linguistic stemming (`normalizeStem`), converting words like `deltoidi` $\rightarrow$ `deltoid`, `pettorali` $\rightarrow$ `petto`, `bicipiti` $\rightarrow$ `bicipit`.
- Scores exact matches first, `startsWith` second, base muscles third, and alphabetical fallback.

### 3.3 `searchFoods` (`src/lib/calc/nutrition.ts`)
- Multi-field search over `['name', 'brand', 'category', 'synonyms']` with custom field weights.

---

## 4. Intelligent Search Engine Design for Exercise Library

### 4.1 Exercise Library Item Model (`src/types.ts`)
```ts
export interface Exercise {
    id: string;
    name: string;
    notes?: string;
    setsCount: number;
    muscles?: string[];           // e.g. ["chest", "abs"]
    secondaryMuscles?: string[];  // e.g. ["triceps", "shoulders"]
    sets: ExerciseSet[];
    trackingType?: 'weight_reps' | 'time' | 'cardio';
    isDefault?: boolean;
}
```

### 4.2 Multi-Field Search Preparation
Exercises in `library` store muscle IDs (e.g. `"chest"`, `"lats"`, `"delts_front"`). A user searching in Italian will type `"petto"`, `"pettorali"`, `"dorso"`, `"spalle"`, `"tricipiti"`.
To support rich search across all dimensions:
1. **Pre-calculate Search Tokens:**
   - `_searchMuscles`: Italian names of `primaryMuscles` (from `MUSCLE_NAMES_MAP` / `Logic.MUSCLES`) + category label (from `getDetailedMuscleCategory(mId).label`) + stemmed versions (`normalizeStem`).
   - `_searchSecMuscles`: Italian names of `secondaryMuscles` + category labels + stemmed versions.
   - `_searchNotes`: `notes || ''`
   - `_searchType`: `"cardio"` / `"tempo"` / `"peso"`
2. **Search Scoring Strategy:**
   - **Direct Name Match:** Matches appearing in exercise name ranked #1.
   - **Direct Muscle Match:** Matches appearing in primary muscle name ranked #2.
   - **Direct Secondary/Note Match:** Matches in secondary muscles or notes ranked #3.
   - **Fuzzy Fuse.js Match:** Typo matches (e.g. `"pancca"` $\rightarrow$ `"Panca piana bilanciere"`, `"squatt"` $\rightarrow$ `"Squat"`, `"trazzioni"` $\rightarrow$ `"Trazioni"`) with `threshold: 0.38`.

---

## 5. UI/UX Specification for Intelligent Search Dropdown

### 5.1 Component Props & State Interface
```tsx
interface ExerciseSearchDropdownProps {
    library: ExerciseLibraryItem[];
    onSelectExercise: (exId: string) => void;
    placeholder?: string;
    excludeIds?: string[]; // Optional: for filtering out already added exercises if needed
}
```

### 5.2 Dropdown Visual Specs (Dark Glassmorphism)
- **Container (`div.exercise-search-container`):**
  - `position: relative; width: 100%;`
- **Input Field (`input[type="text"]`):**
  - Placeholder: `"🔍 Cerca esercizio da aggiungere..."` (Sentence case)
  - `font-size: 16px !important` (Enforces iOS Safari zoom prevention)
  - Height: `44px` (or min 48px touch target)
  - Background: `rgba(0, 0, 0, 0.35)` with `border: 1px solid var(--glass-border)`
  - Padding: `10px 38px 10px 14px` (space for clear button)
  - Clear button: `✕` icon on right side when `query.length > 0`
- **Floating Dropdown Panel (`div.exercise-search-dropdown`):**
  - `position: absolute; top: calc(100% + 6px); left: 0; right: 0; width: 100%;`
  - `z-index: 100;` (Floats above subsequent form cards and buttons)
  - Background: `var(--surface-color, #0d0d0d)` / `rgba(13, 13, 13, 0.95)`
  - Backdrop-filter: `blur(12px); -webkit-backdrop-filter: blur(12px);`
  - Border: `1px solid var(--glass-border)`
  - Border-radius: `12px`
  - Box-shadow: `0 12px 36px rgba(0, 0, 0, 0.6)`
  - Max-height: `260px` with `overflow-y: auto`, smooth touch scroll (`touch-action: manipulation`)
- **Dropdown List Item (`div.exercise-search-item`):**
  - Padding: `10px 14px`
  - Border-bottom: `1px solid rgba(255, 255, 255, 0.05)`
  - Cursor: `pointer`
  - Layout: `flex-between items-center`
  - Title: Exercise name in bold (`font-weight: 600; color: var(--text-main);`)
  - Badges row:
    - Primary muscle pill: `.badge.badge-primary` (e.g. `Petto`, `Dorso`, `Quadricipiti`)
    - Secondary muscle pill: subtle badge (`rgba(255, 255, 255, 0.08)`)
    - Tracking type badge: `🏃 Cardio` or `⏱️ Tempo` (if not standard weight & reps)
  - Right Icon: `+` or `✓` icon
  - Highlighted / Active State: `background: rgba(0, 229, 255, 0.12); border-left: 3px solid var(--primary-color);`
- **Empty State:**
  - `<div className="text-muted text-sm p-15 text-center">Nessun esercizio trovato</div>`

### 5.3 Interaction & Accessibility Architecture
1. **Focus / Open:** Clicking or focusing the search input immediately opens the dropdown. If query is empty, all library items are listed alphabetically for quick visual browsing.
2. **Type-Ahead Filtering:** As the user types, results update reactively with zero lag.
3. **Selection:** Clicking an item or pressing `Enter` calls `onSelectExercise(id)`, clears the search input, and closes the dropdown.
4. **Dismissal (Click-Outside & Escape):**
   - Click outside handler attached to `document` on `mousedown` and `touchstart` closes the dropdown safely.
   - `onKeyDown` handles `Escape` (closes dropdown and blurs), `ArrowDown` (increments active index), `ArrowUp` (decrements active index), and `Enter` (selects highlighted item).

---

## 6. Proposed Code Implementation Plan

### 6.1 Search Filter Helper (`src/lib/calc/workout.ts` or `src/lib/calc/exerciseSearch.ts`)
```ts
export function searchExerciseLibrary(library: ExerciseLibraryItem[], query: string): ExerciseLibraryItem[] {
    if (!Array.isArray(library)) return [];
    if (!query || !query.trim()) {
        return [...library].sort((a, b) => a.name.localeCompare(b.name, 'it'));
    }
    const q = query.trim().toLowerCase();
    const stemmedQ = normalizeStem(q);
    const tokens = stemmedQ.split(/\s+/).filter(Boolean);

    // Map muscles to Italian names
    const muscleMap = new Map(Logic.MUSCLES.map(m => [m.id, m.name.toLowerCase()]));

    const enriched = library.map(ex => {
        const pMuscles = (ex.muscles || []).map(mId => muscleMap.get(mId) || mId).join(' ');
        const sMuscles = (ex.secondaryMuscles || []).map(mId => muscleMap.get(mId) || mId).join(' ');
        return {
            ...ex,
            _searchName: ex.name.toLowerCase(),
            _searchMuscles: normalizeStem(pMuscles),
            _searchSecMuscles: normalizeStem(sMuscles),
            _searchNotes: (ex.notes || '').toLowerCase()
        };
    });

    // 1. Direct matches
    const directMatches = enriched.filter(item => {
        if (item._searchName.includes(q)) return true;
        if (item._searchMuscles.includes(stemmedQ)) return true;
        if (tokens.length > 1 && tokens.every(tok => 
            item._searchName.includes(tok) || 
            item._searchMuscles.includes(tok) || 
            item._searchSecMuscles.includes(tok)
        )) return true;
        return false;
    });

    // 2. Fuzzy matches with Fuse.js
    const fuse = new Fuse(enriched, {
        keys: [
            { name: '_searchName', weight: 0.6 },
            { name: '_searchMuscles', weight: 0.25 },
            { name: '_searchSecMuscles', weight: 0.15 }
        ],
        threshold: 0.38,
        ignoreLocation: true,
        minMatchCharLength: 2
    });

    const fuzzyMatches = fuse.search(query.trim()).map(r => r.item);

    const seen = new Set<string>();
    const results: ExerciseLibraryItem[] = [];
    for (const item of [...directMatches, ...fuzzyMatches]) {
        if (!seen.has(item.id)) {
            seen.add(item.id);
            const { _searchName, _searchMuscles, _searchSecMuscles, _searchNotes, ...orig } = item;
            results.push(orig as ExerciseLibraryItem);
        }
    }

    return results;
}
```

### 6.2 Component Integration in `RoutineEditor.tsx`
Replace lines 70–84 in `src/components/Training/routines/RoutineEditor.tsx` with:
```tsx
<div className="mb-15">
    <ExerciseSearchDropdown
        library={library}
        onSelectExercise={onAddExercise}
        placeholder="🔍 Cerca esercizio da aggiungere..."
    />
</div>
```

---

## 7. Verification and Testing Plan

1. **Unit Tests (`src/lib/logic.test.ts`):**
   - Exact search by exercise name: `"Panca"` $\rightarrow$ matches `"Panca Piana Bilanciere"`.
   - Typo tolerance search: `"pancca"` $\rightarrow$ matches `"Panca Piana Bilanciere"`.
   - Search by Italian muscle name: `"petto"` $\rightarrow$ matches chest exercises.
   - Search by secondary muscle: `"tricipiti"` $\rightarrow$ matches tricep exercises.
   - Multi-token combined search: `"petto bilanciere"` $\rightarrow$ matches `"Panca Piana Bilanciere"`.
   - Empty search: returns all exercises in alphabetical order.
2. **UI & Keyboard Navigation Verification:**
   - Dropdown opens on input focus / click.
   - Typing filters dropdown immediately.
   - Clear button (`✕`) clears input and resets list.
   - Clicking an item triggers `onAddExercise(id)`, clears input, and closes dropdown.
   - Pressing `Escape` or clicking outside closes dropdown cleanly.
3. **Build & Linter Compliance:**
   - `npm.cmd run build` (TypeScript check) compiles with 0 errors.
   - `npm.cmd run lint` (Oxlint) passes with 0 violations.
   - `npm.cmd test` passes all unit and integration test suites.
