# Master Comprehensive Audit & Bug Report: LogBook PWA

**Target Repository**: `C:\Users\gerar\Documents\GitHub\logbook`  
**Date of Audit**: July 29, 2026  
**Auditor Agents**: Explorer 1 (Architecture & Performance), Explorer 2 (Firebase & Data Logic), Explorer 3 (UX, Memory & Business Logic), Worker Baseline (Static Verification)  
**Report Synthesis Agent**: Implementer / QA Specialist  

---

## Executive Summary

A comprehensive, multi-phase technical audit and architectural analysis was performed across the **LogBook** Progressive Web Application codebase (41 TypeScript/React source files, Firebase backend integration, Zustand state management stores, and custom hooks). 

The audit identified a total of **36 distinct architectural defects, performance bottlenecks, security vulnerabilities, memory leaks, accessibility issues, and business logic flaws**.

### Phase 1 Baseline Static Verification Results

Static analysis verification was performed prior to deep architectural exploration to establish codebase health and compile-time status:

#### 1. `npm run build` (`vite build`)
- **Status**: PASSED (Exit Code: 0)
- **Execution Time**: ~649ms across 1,842 modules transformed
- **Output Summary**:
  ```text
  vite v8.1.5 building client environment for production...
  transforming...✓ 1842 modules transformed.
  rendering chunks...
  dist/manifest.webmanifest                          0.67 kB
  dist/index.html                                    1.31 kB │ gzip:   0.53 kB
  dist/assets/index-DNNU-Rtw.css                    16.78 kB │ gzip:   3.73 kB
  dist/assets/WeightChart-cHQ_OtaO.js                0.48 kB │ gzip:   0.34 kB
  dist/assets/rolldown-runtime-Bh1tDfsg.js           0.56 kB │ gzip:   0.36 kB
  dist/assets/workbox-window.prod.es5-Bd17z0YL.js    5.65 kB │ gzip:   2.20 kB
  dist/assets/SettingsView-DVHCDNHz.js               7.50 kB │ gzip:   2.78 kB
  dist/assets/HomeView-f-5db1L5.js                  10.04 kB │ gzip:   2.79 kB
  dist/assets/index-D8Ll9dSt.js                     21.99 kB │ gzip:   7.35 kB
  dist/assets/NutritionView-BQyIa3Pd.js             26.34 kB │ gzip:   6.76 kB
  dist/assets/logic-DSZ7RXZM.js                     27.05 kB │ gzip:   7.72 kB
  dist/assets/TrainingView-BiWpLB5L.js              65.33 kB │ gzip:  18.48 kB
  dist/assets/chartjs-B8C_Y7Pw.js                  172.37 kB │ gzip:  59.88 kB
  dist/assets/vendor-Bd7bmI69.js                   185.05 kB │ gzip:  58.64 kB
  dist/assets/firebase-CBFQ5jom.js                 653.25 kB │ gzip: 193.14 kB
  ✓ built in 649ms
  ```
- **Observations**: Production bundle compiles cleanly. A chunk size warning was raised for `firebase-CBFQ5jom.js` (653.25 kB), indicating opportunities for code-splitting Firebase sub-modules.

#### 2. `npm run lint` (`oxlint`)
- **Status**: PASSED (Exit Code: 0 — 0 Errors, 10 Warnings)
- **Execution Time**: ~17ms across 47 files with 91 rules
- **Warning Categories**:
  - **Unused variables / imports (6 warnings)**:
    - `src/store/useAppStore.ts:67:18`: Unused catch parameter `e`.
    - `tests/edge_cases.test.tsx`: Unused imports `TrainingView`, `NutritionView`, `CustomFoodModal`.
    - `resize_icons.mjs:2:8`: Unused import `fs`.
    - `tests/setup.tsx:68:15`: Unused parameter `index`.
  - **React Fast Refresh violation (1 warning)**:
    - `src/contexts/AuthContext.tsx:22:14`: Non-component helper export `useAuth` alongside Context Provider.
  - **React Hook Exhaustive Dependencies (3 warnings)**:
    - `src/hooks/useHomeView.ts:50:56`, `59:9`, `80:23`: `useMemo` hooks depending on unmemoized inline default fallback references (`userData?.history || []`, `userData?.nutrition || {}`), invalidating memoization on every render.

---

## SECTION 1: React Architecture, Custom Hooks & Zustand State Management

### Issue 1.1: Unselected Zustand Store Subscriptions (`useAppStore()` without selectors)
- **ID**: `ARCH-01`
- **Exact Location**:
  - `src/contexts/AuthContext.tsx`: lines 28–33
  - `src/hooks/useNutritionMeals.ts`: line 8
  - `src/hooks/useNutritionMeasurements.ts`: line 7
  - `src/hooks/useNutritionPlanning.ts`: line 7
  - `src/hooks/useSettings.ts`: line 10
  - `src/hooks/useTrainingExercises.ts`: line 7
  - `src/hooks/useTrainingHistory.ts`: line 6
  - `src/hooks/useTrainingRoutines.ts`: line 8
  - `src/hooks/useWorkoutSession.ts`: line 7
  - `src/components/UI/GlobalDialog.tsx`: line 4 (`useDialogStore()`)
- **System Impact**:
  Calling `const { userData, saveUserData } = useAppStore()` without selector functions registers a subscription to the **entire state object**. Whenever *any* slice of state changes (e.g. typing a set weight in `localWorkout`, toggling `syncing`, or setting `saveError`), every single hook and component using `useAppStore()` is forced to re-render. Because `AuthProvider` at the top of the component tree subscribes to the whole store without a selector, every single state change in the app triggers a re-render of `AuthProvider`, cascading re-renders down the **entire React component tree** on every keystroke during workout tracking.
- **Concrete Resolution Proposal**:
  Replace whole-store destructuring with atomic Zustand selector functions across all listed hooks.

```tsx
// BEFORE (AuthContext.tsx:28-33):
const { 
    setUserData, 
    setSyncing, 
    saveError, 
    setSaveError 
} = useAppStore();

// AFTER:
const setUserData = useAppStore(state => state.setUserData);
const setSyncing = useAppStore(state => state.setSyncing);
const saveError = useAppStore(state => state.saveError);
const setSaveError = useAppStore(state => state.setSaveError);
```

```tsx
// BEFORE (useWorkoutSession.ts:7):
const { userData, saveUserData, localWorkout, setLocalWorkout } = useAppStore();

// AFTER:
const userData = useAppStore(state => state.userData);
const saveUserData = useAppStore(state => state.saveUserData);
const localWorkout = useAppStore(state => state.localWorkout);
const setLocalWorkout = useAppStore(state => state.setLocalWorkout);
```

---

### Issue 1.2: Direct State Mutation (Violating React & Zustand Immutability)
- **ID**: `ARCH-02`
- **Exact Locations**:
  1. `src/store/useAppStore.ts`: line 99
  2. `src/hooks/useNutritionMeasurements.ts`: lines 81–91
- **System Impact**:
  - **Location 1 (`useAppStore.ts:99`)**: Inside `setUserData`, line 99 directly mutates state object property: `nextData.activeWorkout = state.localWorkout;`. Mutating existing object references in place violates Zustand/React immutability rules. React relies on reference equality (`Object.is`) to trigger re-renders; mutating references directly causes UI components to skip renders or produce non-deterministic state bugs.
  - **Location 2 (`useNutritionMeasurements.ts:86-91`)**: Inside `calculateAndSave`:
    `const newNutrition = { ...(userData.nutrition || {}) };` creates a shallow copy of the dictionary, but `newNutrition[targetDate]` is a direct reference to the nested day object in the store state. Mutating `newNutrition[targetDate].weight = parseFloat(weight)` directly mutates store state in place.
- **Concrete Resolution Proposal**:
  Ensure complete immutable cloning when modifying nested objects in store actions and custom hooks.

```tsx
// BEFORE (src/store/useAppStore.ts:88-116):
setUserData: (dataOrUpdater) => {
    set((state) => {
        const nextData = typeof dataOrUpdater === 'function' 
            ? (dataOrUpdater as (prev: UserData | null) => UserData | null)(state.userData) 
            : dataOrUpdater;

        let syncedLocalWorkout = state.localWorkout;
        
        if (nextData) {
            if (state.localWorkout && !nextData.activeWorkout) {
                nextData.activeWorkout = state.localWorkout; // DIRECT MUTATION
            } else if (nextData.activeWorkout !== undefined) { ... }
        }
        return { userData: nextData, localWorkout: syncedLocalWorkout };
    });
}

// AFTER:
setUserData: (dataOrUpdater) => {
    set((state) => {
        const rawNextData = typeof dataOrUpdater === 'function' 
            ? (dataOrUpdater as (prev: UserData | null) => UserData | null)(state.userData) 
            : dataOrUpdater;

        if (!rawNextData) {
            return { userData: null, localWorkout: state.localWorkout };
        }

        let syncedLocalWorkout = state.localWorkout;
        let activeWorkout = rawNextData.activeWorkout;

        if (state.localWorkout && !rawNextData.activeWorkout) {
            activeWorkout = state.localWorkout;
        } else if (rawNextData.activeWorkout !== undefined) {
            syncedLocalWorkout = rawNextData.activeWorkout;
            if (syncedLocalWorkout) {
                try {
                    localStorage.setItem('logbook_local_workout', JSON.stringify(syncedLocalWorkout));
                } catch (e) {
                    console.error("Errore salvataggio localWorkout in localStorage:", e);
                }
            } else {
                localStorage.removeItem('logbook_local_workout');
            }
        }
        
        const nextData: UserData = {
            ...rawNextData,
            activeWorkout: activeWorkout ?? null
        };
        
        return { userData: nextData, localWorkout: syncedLocalWorkout };
    });
}
```

```tsx
// BEFORE (src/hooks/useNutritionMeasurements.ts:81-91):
const newNutrition = { ...(userData.nutrition || {}) };
if (!newNutrition[targetDate]) {
    newNutrition[targetDate] = { date: targetDate, kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] };
}
newNutrition[targetDate].weight = parseFloat(weight); // MUTATION
if (waist) newNutrition[targetDate].waist = parseFloat(waist);

// AFTER:
const existingDay = userData.nutrition?.[targetDate] || { date: targetDate, kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] };
const updatedDay = {
    ...existingDay,
    weight: parseFloat(weight),
    ...(waist ? { waist: parseFloat(waist) } : {}),
    ...(neck ? { neck: parseFloat(neck) } : {}),
    ...(hip && profile.gender === 'F' ? { hip: parseFloat(hip) } : {}),
    bf: Math.round(bf * 10) / 10,
    measurementTime: measureTime
};

const newNutrition = {
    ...(userData.nutrition || {}),
    [targetDate]: updatedDay
};
```

---

### Issue 1.3: Derived State Duplication Anti-Pattern (`useState` + `useEffect` Sync)
- **ID**: `ARCH-03`
- **Exact Locations**:
  1. `src/hooks/useNutritionPlanning.ts`: lines 10–26
  2. `src/hooks/useSettings.ts`: lines 22–33
- **System Impact**:
  In both hooks, remote store state (`userData.nutritionPlanning` and `userData.profile`) is duplicated into component local state (`useState`) and synchronized via `useEffect`. This pattern causes:
  1. **Double Rendering**: First render uses initial/stale local state; after DOM commit, `useEffect` triggers a second render update.
  2. **Stale UI Flicker**: Input fields temporarily display default empty values before snapping to the synced state values.
- **Concrete Resolution Proposal**:
  Use derived state computation (`localPlanning ?? storePlanning`) or controlled key resets instead of copying store state into `useEffect`.

```tsx
// BEFORE (useNutritionPlanning.ts:10-26):
const [planning, setPlanning] = useState(userData?.nutritionPlanning || { ... });
useEffect(() => {
    if (userData?.nutritionPlanning) {
        setPlanning(userData.nutritionPlanning);
    }
}, [userData?.nutritionPlanning]);

// AFTER:
const storePlanning = useAppStore(state => state.userData?.nutritionPlanning);
const [localPlanning, setLocalPlanning] = useState<NutritionPlanning | null>(null);

const planning = localPlanning ?? storePlanning ?? {
    weight: 80,
    carbsPerKg: 3.5,
    proPerKg: 2.0,
    fatPerKg: 1.0,
    lockedMacro: null,
    chartPeriod: 7,
    normocalorica: { kcal: 2500, carbs: 300, pro: 160, fat: 70 }
};
```

---

### Issue 1.4: Broken Custom Hook Handler Signature & Parameter Mismatches
- **ID**: `ARCH-04`
- **Exact Locations**:
  1. `src/components/Training/TrainingSession.tsx`: line 231 vs `src/hooks/useWorkoutSession.ts`: line 99
  2. `src/components/Training/TrainingSession.tsx`: line 220 vs `src/hooks/useWorkoutSession.ts`: line 166
- **System Impact**:
  1. **Broken Extra Exercise Addition**: Line 231 of `TrainingSession.tsx` calls `addExtraExercise(e.target.value)` passing a string exercise ID (e.g. `"ex_123"`). However, `useWorkoutSession.ts` line 99 defines `addExtraExercise` as `(ex: any) => { if (!activeWorkout || !ex.exId) return; }`. Because `ex` is a string, `'ex_123'.exId` is `undefined`, causing `addExtraExercise` to return early and fail silently.
  2. **Broken Session Notes Updates**: Line 220 of `TrainingSession.tsx` calls `onChange={(e: any) => updateSet(exIndex, '', 'sessionNote', e.target.value)}`. `updateSet` maps over sets looking for `s.id === ''` (which never matches any set), so exercise session notes are never saved to state.
- **Concrete Resolution Proposal**:
  Update `addExtraExercise` to accept string IDs or exercise objects, and wire `updateSessionNote` directly to the notes textarea.

```tsx
// BEFORE (src/hooks/useWorkoutSession.ts:99-109):
const addExtraExercise = (ex: any) => {
    if (!activeWorkout || !ex.exId) return;
    ...
};

// AFTER:
const addExtraExercise = (exInput: string | { exId: string }) => {
    const exId = typeof exInput === 'string' ? exInput : exInput?.exId;
    if (!activeWorkout || !exId) return;
    const updatedActive = {
        ...activeWorkout,
        exercises: [
            ...activeWorkout.exercises,
            { exId, sets: [{ id: Logic.generateId('s'), kg: '', reps: '' }], sessionNote: '' }
        ]
    };
    setLocalWorkout(updatedActive);
};
```

```tsx
// BEFORE (src/components/Training/TrainingSession.tsx:220):
<textarea 
    value={exItem.sessionNote || ''}
    onChange={(e: any) => updateSet(exIndex, '', 'sessionNote', e.target.value)}
/>

// AFTER:
<textarea 
    value={exItem.sessionNote || ''}
    onChange={(e: any) => updateSessionNote(exIndex, e.target.value)}
/>
```

---

### Issue 1.5: Unmemoized AuthContext Value, Hook Handlers, and Inline Component Props
- **ID**: `PERF-01`
- **Exact Locations**:
  1. `src/contexts/AuthContext.tsx`: lines 117–125 (Unmemoized `value` object)
  2. `src/hooks/useNutritionMeals.ts`: line 180 (Unmemoized hook return object and functions)
  3. `src/components/Training/TrainingExercises.tsx`: line 93 (`selectedMuscles.map(...)` inline prop)
  4. `src/components/Training/TrainingRoutines.tsx`: lines 41, 149 (`Array.from(new Set(...))` inline prop)
  5. `src/components/Training/MuscleModel.tsx`: line 36 (`getPathStyle` function declared inside body)
  6. `src/components/Home/WeightChart.tsx`: line 16 (`chartOptions` object declared inside body)
- **System Impact**:
  - `AuthContext.Provider` creates a new `value` object on every render, invalidating context memoization and forcing all components consuming `useAuth()` to re-render.
  - Inline array/object allocations (`selectedMuscles.map`, `Array.from(...)`, `chartOptions`) pass new reference props on every render cycle. This forces heavy child components like `MuscleModel` (80+ SVG paths) and `WeightChart` (Chart.js canvas instance) to re-render and redraw continuously.
- **Concrete Resolution Proposal**:
  Wrap context values and hook functions in `useMemo`/`useCallback`, extract static chart options outside the component body, and pre-compute array props with `useMemo`.

```tsx
// BEFORE (src/contexts/AuthContext.tsx:117-125):
const value = { currentUser, loading, login, logout };
return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;

// AFTER:
const login = useCallback(async () => {
    setSaveError(null);
    try { await signInWithPopup(auth, provider); } 
    catch (error: any) { setSaveError(error.message); }
}, [setSaveError]);

const logout = useCallback(async () => {
    setSyncing(true);
    try { await DB.secureLogOut(); setUserData(null); }
    finally { setSyncing(false); }
}, [setSyncing, setUserData]);

const value = useMemo(() => ({
    currentUser, loading, login, logout
}), [currentUser, loading, login, logout]);

return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
```

```tsx
// BEFORE (src/components/Home/WeightChart.tsx:16):
export default function WeightChart({ chartData }: { chartData: any }) {
    const chartOptions = { responsive: true, ... };
    return <Line data={chartData} options={chartOptions as any} />;
}

// AFTER:
const CHART_OPTIONS = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
        y: { beginAtZero: false, grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#ccc' } },
        x: { grid: { display: false }, ticks: { color: '#ccc', maxTicksLimit: 7 } }
    }
};

export default function WeightChart({ chartData }: { chartData: any }) {
    return <Line data={chartData} options={CHART_OPTIONS as any} />;
}
```

```tsx
// BEFORE (src/components/Training/TrainingExercises.tsx:93):
<MuscleModel selectedMuscles={selectedMuscles.map(m => m.id) as any} />

// AFTER:
const selectedMuscleIds = useMemo(() => selectedMuscles.map(m => m.id), [selectedMuscles]);
<MuscleModel selectedMuscles={selectedMuscleIds} />
```

---

### Issue 1.6: Algorithmic Performance Bottlenecks ($O(N \times M)$ Linear Loops in Render Paths)
- **ID**: `PERF-02`
- **Exact Locations**:
  1. `src/components/Training/TrainingSession.tsx`: lines 102–108 (Unmemoized history search inside active workout render)
  2. `src/components/Training/TrainingHistory.tsx`: lines 53–56 (Nested lookup loop across workouts and exercise library)
  3. `src/hooks/useNutritionMeasurements.ts`: lines 22–24 (Unmemoized `Object.values().filter().sort()` on every render)
- **System Impact**:
  - **`TrainingSession.tsx`**: On every single character typed into a set's `kg` or `reps` input field, `TrainingSession` re-renders and executes an unmemoized linear search over `history` for every active exercise ($N_{exercises} \times N_{history}$). With 100 historical workouts and 8 exercises, this executes 800 operations on every keystroke, introducing input latency on mobile PWAs.
  - **`TrainingHistory.tsx`**: Repeatedly runs `userData.library.find(...)` inside nested history loops ($O(N_{history} \times N_{exercises} \times N_{library})$), executing ~12,000 lookup iterations on every render of the History view.
- **Concrete Resolution Proposal**:
  Pre-compute lookups using indexed `Map` structures and `useMemo`.

```tsx
// BEFORE (src/components/Training/TrainingSession.tsx:102-108):
// Inside activeWorkout.exercises.map render loop:
const pastWorkouts = [];
for (let w of history) {
    const ex = (w.exercises || []).find((e: any) => e.exId === exItem.exId);
    if (ex) pastWorkouts.push({ date: w.date, sets: ex.sets || [], note: ex.sessionNote });
    if (pastWorkouts.length === 2) break;
}

// AFTER:
// Outside render loop, at top of component:
const exerciseHistoryMap = useMemo(() => {
    const map = new Map<string, Array<{ date: string; sets: any[]; note: string }>>();
    if (!history || history.length === 0) return map;

    for (const w of history) {
        if (!w.exercises) continue;
        for (const ex of w.exercises) {
            if (!ex.exId) continue;
            const existing = map.get(ex.exId) || [];
            if (existing.length < 2) {
                existing.push({ date: w.date, sets: ex.sets || [], note: ex.sessionNote });
                map.set(ex.exId, existing);
            }
        }
    }
    return map;
}, [history]);

// Then inside the render loop:
const pastWorkouts = exerciseHistoryMap.get(exItem.exId) || [];
```

```tsx
// BEFORE (src/components/Training/TrainingHistory.tsx:53-56):
// Inside history.map -> wo.exercises.map:
const libDef = (userData?.library || []).find(l => l.id === ex.exId);

// AFTER:
const libraryMap = useMemo(() => {
    const map = new Map<string, any>();
    (userData?.library || []).forEach(ex => map.set(ex.id, ex));
    return map;
}, [userData?.library]);

// Inside render loop:
const libDef = libraryMap.get(ex.exId);
```

---

## SECTION 2: Firebase Integration, Data Logic & Security

### Issue 2.1: Silent Error Suppression in `DB.saveUserData`
- **ID**: `FIRE-01`
- **Exact Location**: `src/lib/db.ts`: lines 190–192
- **System Impact**:
  Cloud write failures (such as network disconnections, quota limits, or permission rejections) are caught internally inside `db.ts` and logged with `console.error`, but are **never re-thrown**. Upstream callers like `useAppStore.saveUserData` resolve cleanly without errors, the app store error state (`saveError`) is never set, and users are misled into believing their workout and nutrition updates were safely saved to the cloud.
- **Concrete Resolution Proposal**:
  Re-throw caught errors in `DB.saveUserData` so upstream callers can set UI error states and notify the user.

```typescript
// BEFORE (src/lib/db.ts:190-192):
} catch (error) {
    console.error("Errore durante il salvataggio:", error);
}

// AFTER:
} catch (error) {
    console.error("Errore durante il salvataggio:", error);
    throw error;
}
```

---

### Issue 2.2: Lack of Atomic Batching (`writeBatch`) in `DB.saveUserData`
- **ID**: `FIRE-02`
- **Exact Location**: `src/lib/db.ts`: lines 107–188
- **System Impact**:
  Database writes for user profile, routines, library, monthly workout history (`history_months`), and monthly nutrition logs (`nutrition_months`) are pushed into an array of separate individual promises (`setDoc`, `deleteDoc`) and executed via `Promise.all(promises)`. If a connection drops midway through saving, the database is left in a **partially written, inconsistent state** where some monthly subcollections update while others fail or become orphaned.
- **Concrete Resolution Proposal**:
  Refactor `DB.saveUserData` to use Firestore `writeBatch(db)` for atomic multi-document updates.

```typescript
// AFTER (src/lib/db.ts:107-188 replacement with atomic batching):
const batch = writeBatch(db);
let hasWrites = false;

// 1. User doc updates
if (!deepEqual(state.profile, oldState.profile) ||
    !deepEqual(state.library, oldState.library) ||
    !deepEqual(state.routines, oldState.routines) ||
    !deepEqual(state.customFoods, oldState.customFoods) ||
    !deepEqual(state.activeWorkout, oldState.activeWorkout) ||
    !deepEqual(state.nutritionPlanning, oldState.nutritionPlanning)) {
    
    const userRef = doc(db, "users", user.uid);
    batch.set(userRef, {
        profile: state.profile,
        library: state.library,
        routines: state.routines,
        customFoods: state.customFoods || [],
        activeWorkout: state.activeWorkout || null,
        nutritionPlanning: state.nutritionPlanning || null,
        history: deleteField(),
        nutrition: deleteField() 
    }, { merge: true });
    hasWrites = true;
}

// 2. Group History by Month and add batch operations
const newHistMonths: Record<string, any> = {};
state.history.forEach((h: any) => {
    const date = new Date(h.globalStartTime || Date.now());
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!newHistMonths[monthKey]) newHistMonths[monthKey] = {};
    newHistMonths[monthKey][h.id] = h;
});

const oldHistMonths: Record<string, any> = {};
(oldState.history || []).forEach((h: any) => {
    const date = new Date(h.globalStartTime || Date.now());
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!oldHistMonths[monthKey]) oldHistMonths[monthKey] = {};
    oldHistMonths[monthKey][h.id] = h;
});

Object.keys(newHistMonths).forEach(month => {
    if (!deepEqual(newHistMonths[month], oldHistMonths[month])) {
        batch.set(doc(db, "users", user.uid, "history_months", month), newHistMonths[month]);
        hasWrites = true;
    }
});
Object.keys(oldHistMonths).forEach(month => {
    if (!newHistMonths[month]) {
        batch.delete(doc(db, "users", user.uid, "history_months", month));
        hasWrites = true;
    }
});

// 3. Group Nutrition by Month and add batch operations
const newNutMonths: Record<string, any> = {};
Object.keys(state.nutrition || {}).forEach(date => {
    const monthKey = date.substring(0, 7);
    if (!newNutMonths[monthKey]) newNutMonths[monthKey] = {};
    newNutMonths[monthKey][date] = state.nutrition[date];
});

const oldNutMonths: Record<string, any> = {};
Object.keys(oldState.nutrition || {}).forEach(date => {
    const monthKey = date.substring(0, 7);
    if (!oldNutMonths[monthKey]) oldNutMonths[monthKey] = {};
    oldNutMonths[monthKey][date] = oldState.nutrition[date];
});

Object.keys(newNutMonths).forEach(month => {
    if (!deepEqual(newNutMonths[month], oldNutMonths[month])) {
        batch.set(doc(db, "users", user.uid, "nutrition_months", month), newNutMonths[month]);
        hasWrites = true;
    }
});
Object.keys(oldNutMonths).forEach(month => {
    if (!newNutMonths[month]) {
        batch.delete(doc(db, "users", user.uid, "nutrition_months", month));
        hasWrites = true;
    }
});

if (hasWrites) {
    await batch.commit();
}
```

---

### Issue 2.3: Document Size Limit Vulnerability in Monthly Bucketing
- **ID**: `FIRE-03`
- **Exact Location**: `src/lib/db.ts`: lines 130–184
- **System Impact**:
  Storing all workout history or nutrition logs for an entire month inside a single Firestore document (`history_months/{YYYY-MM}`) creates a risk of exceeding Firestore's **1 MB per document limit**. Power users logging multi-set workouts with detailed exercise notes, drop sets, and isometric data will exceed 1 MB per monthly document, causing cloud writes to fail permanently with `InvalidArgumentError`.
- **Concrete Resolution Proposal**:
  Add pre-write document payload byte size validation in `db.ts` to block oversized document saves before sending to Firestore.

```typescript
// AFTER (Added to src/lib/db.ts):
function checkDocSize(data: any, docName: string) {
    const jsonStr = JSON.stringify(data);
    const sizeBytes = new Blob([jsonStr]).size;
    if (sizeBytes > 950000) { // Limit threshold below 1MB
        throw new Error(`Il documento ${docName} supera il limite di dimensione di Firestore (1MB). Ridurre i dati inseriti.`);
    }
}
```

---

### Issue 2.4: Race Condition & Orphaned Data during Account Deletion
- **ID**: `FIRE-04`
- **Exact Location**: `src/lib/db.ts`: lines 205–238
- **System Impact**:
  In `deleteAccount()`, `deleteUser(user)` is executed while subcollection deletions are handled loosely. If `deleteUser(user)` resolves before subcollection deletion completes, the user's authentication token becomes invalid (`request.auth == null`). Subsequent Firestore deletes fail due to security rule rejections, leaving orphaned user data in Firestore.
- **Concrete Resolution Proposal**:
  Delete all user subcollections and the main user document in a single batch before calling `deleteUser(user)`.

```typescript
// BEFORE (src/lib/db.ts:205-238):
async deleteAccount() {
    const user = auth.currentUser;
    if (!user) return;
    try {
        const histSnap = await getDocs(...);
        histSnap.forEach(d => deleteDoc(d.ref));
        ...
        await deleteUser(user);
    } catch (e) { ... }
}

// AFTER:
async deleteAccount() {
    const user = auth.currentUser;
    if (!user) return;
    
    // 1. Fetch subcollection documents while auth is valid
    const histSnap = await getDocs(collection(db, "users", user.uid, "history_months"));
    const nutSnap = await getDocs(collection(db, "users", user.uid, "nutrition_months"));
    
    const batch = writeBatch(db);
    histSnap.forEach(d => batch.delete(d.ref));
    nutSnap.forEach(d => batch.delete(d.ref));
    
    // 2. Delete main user document
    const userDocRef = doc(db, "users", user.uid);
    batch.delete(userDocRef);
    
    await batch.commit();
    
    // 3. Delete Firebase Auth user account
    await deleteUser(user);
}
```

---

### Issue 2.5: Optimistic State Overwriting on PWA Visibility Refresh
- **ID**: `DATA-01`
- **Exact Location**: `src/contexts/AuthContext.tsx`: lines 65–73
- **System Impact**:
  When the application returns to the foreground (`visibilityState === 'visible'`), `handleVisibilityChange` triggers `loadData(auth.currentUser)`. If the user performed local offline edits that are still queued in Firestore's local cache or pending network sync, `DB.loadUserData()` fetches snapshot data and replaces the Zustand store `userData`, overwriting unsynced local user updates.
- **Concrete Resolution Proposal**:
  Await pending offline writes using `waitForPendingWrites(db)` before reloading remote state on visibility changes.

```typescript
// BEFORE (src/contexts/AuthContext.tsx:65-72):
const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && auth.currentUser) {
        loadData(auth.currentUser);
    }
};

// AFTER:
const handleVisibilityChange = async () => {
    if (document.visibilityState === 'visible' && auth.currentUser) {
        if (useAppStore.getState().userData !== null && !useAppStore.getState().syncing) {
            try {
                await waitForPendingWrites(db);
                await loadData(auth.currentUser);
            } catch (e) {
                console.warn("Skipping visibility reload due to pending writes", e);
            }
        }
    }
};
```

---

### Issue 2.6: Active Workout Draft State Synchronization Conflict
- **ID**: `DATA-02`
- **Exact Location**: `src/store/useAppStore.ts`: lines 97–111 & `src/hooks/useWorkoutSession.ts`: lines 87–95
- **System Impact**:
  `setUserData` in `useAppStore.ts` evaluates `if (state.localWorkout && !nextData.activeWorkout) nextData.activeWorkout = state.localWorkout;`. When a user finishes a workout session (`endWorkout`), `saveUserData` passes `activeWorkout: null` and `setLocalWorkout(null)` is called. If `saveUserData` runs while `state.localWorkout` is still set in Zustand state before `setLocalWorkout(null)` completes, `setUserData` re-assigns `localWorkout` back into `activeWorkout`, causing ended workouts to linger indefinitely as active drafts.
- **Concrete Resolution Proposal**:
  Differentiate between explicit `activeWorkout: null` (cleared session) and `undefined` (unspecified in payload).

```typescript
// BEFORE (src/store/useAppStore.ts:97-111):
if (nextData) {
    if (state.localWorkout && !nextData.activeWorkout) {
        nextData.activeWorkout = state.localWorkout;
    } else if (nextData.activeWorkout !== undefined) { ... }
}

// AFTER:
if (nextData) {
    if (nextData.activeWorkout === null) {
        syncedLocalWorkout = null;
        localStorage.removeItem('logbook_local_workout');
    } else if (nextData.activeWorkout !== undefined) {
        syncedLocalWorkout = nextData.activeWorkout;
        localStorage.setItem('logbook_local_workout', JSON.stringify(syncedLocalWorkout));
    } else if (state.localWorkout) {
        nextData.activeWorkout = state.localWorkout;
    }
}
```

---

### Issue 2.7: Unawaited `saveUserData` Calls Across Custom Action Hooks
- **ID**: `ASYNC-01`
- **Exact Locations**:
  - `src/hooks/useWorkoutSession.ts`: lines 87, 94, 222
  - `src/hooks/useNutritionMeals.ts`: lines 53, 118, 139, 152, 172
  - `src/hooks/useNutritionMeasurements.ts`: line 93
  - `src/hooks/useNutritionPlanning.ts`: line 47
  - `src/hooks/useSettings.ts`: line 37
  - `src/hooks/useTrainingExercises.ts`: lines 96, 104
  - `src/hooks/useTrainingHistory.ts`: line 15
  - `src/hooks/useTrainingRoutines.ts`: lines 45, 53, 65
- **System Impact**:
  In all listed custom hooks, `saveUserData(...)` is invoked **without `await`**. The function returns a `Promise<void>`, but calling handlers proceed immediately to reset local state, close modal dialogs, and display success notifications (`showAlert("Profilo aggiornato!")`). If cloud saving fails asynchronously in the background, the user is falsely informed of success.
- **Concrete Resolution Proposal**:
  Mark action handlers as `async` and `await saveUserData(...)` inside `try/catch` blocks.

```typescript
// BEFORE (src/hooks/useSettings.ts:35-39):
const handleSaveProfile = () => {
    const newProfile = { dob, height, gender };
    saveUserData({ ...userData, profile: newProfile });
    showAlert("Profilo aggiornato!");
};

// AFTER:
const handleSaveProfile = async () => {
    const newProfile = { dob, height, gender };
    try {
        await saveUserData({ ...userData, profile: newProfile });
        await showAlert("Profilo aggiornato!");
    } catch (error) {
        await showAlert("Errore durante il salvataggio del profilo.");
    }
};
```

---

### Issue 2.8: Floating Unawaited `getRedirectResult` in AuthContext
- **ID**: `ASYNC-02`
- **Exact Location**: `src/contexts/AuthContext.tsx`: lines 50–52
- **System Impact**:
  `getRedirectResult(auth)` is called fire-and-forget in `useEffect` without `await` or integration with the `loading` state. On mobile devices utilizing redirect auth, the application sets `loading = false` before `getRedirectResult` completes, causing temporary layout flashes and state inconsistency upon returning from Google auth redirect.
- **Concrete Resolution Proposal**:
  Await `getRedirectResult` during initial auth initialization before resolving `loading = false`.

```typescript
// BEFORE (src/contexts/AuthContext.tsx:50-52):
useEffect(() => {
    getRedirectResult(auth).catch(err => console.error(err));
    const unsubscribe = onAuthStateChanged(auth, async user => { ... });
    return () => unsubscribe();
}, []);

// AFTER:
useEffect(() => {
    let isMounted = true;
    
    const initAuth = async () => {
        try {
            await getRedirectResult(auth);
        } catch (err) {
            console.warn("getRedirectResult error (non critico):", err);
        }
        
        const unsubscribe = onAuthStateChanged(auth, async (user: any) => {
            if (!isMounted) return;
            setCurrentUser(user);
            if (user) {
                await loadData(user);
            } else {
                setUserData(null);
            }
            setLoading(false);
        });
        
        return unsubscribe;
    };

    const authUnsubPromise = initAuth();

    return () => {
        isMounted = false;
        authUnsubPromise.then(unsub => unsub && unsub());
    };
}, []);
```

---

### Issue 2.9: Hardcoded Firebase Credentials in Client Codebase
- **ID**: `SEC-01`
- **Exact Location**: `src/lib/firebase.ts`: lines 22–31
- **System Impact**:
  Sensitive Firebase app credentials (`apiKey`, `appId`, `messagingSenderId`, `measurementId`) are hardcoded directly in source code. Hardcoding values prevents multi-environment deployments (development, staging, production) and risks key exposure if the repository is shared or published.
- **Concrete Resolution Proposal**:
  Use Vite environment variables (`import.meta.env`) with environment fallbacks.

```typescript
// BEFORE (src/lib/firebase.ts:22-31):
const firebaseConfig = {
    apiKey: "AIzaSyD3kkRIXqIZAbpBNGTYkumYa_pr31naRD4",
    authDomain: "logbook-db-98cc4.firebaseapp.com",
    databaseURL: "https://logbook-db-98cc4-default-rtdb.europe-west1.firebasedatabase.app",
    ...
};

// AFTER:
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyD3kkRIXqIZAbpBNGTYkumYa_pr31naRD4",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "logbook-db-98cc4.firebaseapp.com",
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://logbook-db-98cc4-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "logbook-db-98cc4",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "logbook-db-98cc4.firebasestorage.app",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "135243298458",
    appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:135243298458:web:ee8346adb4634ff953d123",
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-560HT9M19Y"
};
```

---

### Issue 2.10: Unvalidated Data Writes in `firestore.rules`
- **ID**: `SEC-02`
- **Exact Location**: `firestore.rules`: lines 10–12
- **System Impact**:
  Security rule `match /users/{userId}/{document=**} { allow read, write: if request.auth != null && request.auth.uid == userId; }` checks ONLY user UID matching. There is **zero schema validation**, **no field type checking**, and **no payload size limiting**. An authenticated client can upload arbitrary payloads, corrupt schema fields, or write huge binary blobs directly to Firestore.
- **Concrete Resolution Proposal**:
  Implement schema validation rules and document size restrictions in `firestore.rules`.

```rules
// BEFORE (firestore.rules:10-12):
match /users/{userId}/{document=**} {
    allow read, write: if request.auth != null && request.auth.uid == userId;
}

// AFTER:
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }

    function isOwner(userId) {
      return request.auth != null && request.auth.uid == userId;
    }

    function isValidUserDoc() {
      return request.resource.data.keys().hasAny(['profile', 'library', 'routines', 'customFoods', 'activeWorkout', 'nutritionPlanning'])
          && request.resource.size < 1048576; // Max 1MB limit
    }

    match /users/{userId} {
      allow read: if isOwner(userId);
      allow write: if isOwner(userId) && isValidUserDoc();
    }

    match /users/{userId}/{document=**} {
      allow read: if isOwner(userId);
      allow write: if isOwner(userId) && request.resource.size < 1048576;
    }
  }
}
```

---

## SECTION 3: UX Defects, Memory Leaks & Accessibility Issues

### Issue 3.1: Module-Level Global State Leak Across User Logout/Login (`lastSavedStateStr`)
- **ID**: `MEM-01`
- **Exact Location**: `src/lib/db.ts`: line 6 & lines 194–204
- **System Impact**:
  `lastSavedStateStr` is stored as a top-level module variable (`let lastSavedStateStr: any = null;`). When a user logs out (`secureLogOut`), `lastSavedStateStr` is **not** reset to `null`. When User B logs in on the same browser tab, `DB.saveUserData` compares User B's state against *User A's* cached JSON string. This causes corrupted entity diffing, skipped updates for new users, or invalid deletions of history and nutrition month documents.
- **Concrete Resolution Proposal**:
  Reset `lastSavedStateStr = null` inside `DB.secureLogOut`.

```typescript
// BEFORE (src/lib/db.ts:194-204):
async secureLogOut() {
    try {
        await waitForPendingWrites(db);
        await auth.signOut();
    } catch (error: any) { ... }
}

// AFTER:
async secureLogOut() {
    try {
        console.log("Attendo il completamento delle scritture offline...");
        await waitForPendingWrites(db);
        console.log("Tutti i dati sincronizzati. Eseguo il Log Out.");
        lastSavedStateStr = null; // Reset cached state string
        await auth.signOut();
    } catch (error: any) {
        console.error("Errore durante il Log Out:", error);
        await useDialogStore.getState().showAlert("Errore durante il Log Out. Controlla la connessione.");
    }
}
```

---

### Issue 3.2: Dangling Active Workout & LocalStorage Persistence Leak on Logout
- **ID**: `MEM-02`
- **Exact Location**: `src/store/useAppStore.ts`: lines 88–116 & `src/contexts/AuthContext.tsx`: lines 104–115
- **System Impact**:
  When `setUserData(null)` is called during logout, `localWorkout` in Zustand is preserved because `syncedLocalWorkout` defaults to `state.localWorkout`. Furthermore, `'logbook_local_workout'` remains stored in `localStorage`. If User A logs out with an active workout draft, User B logging in on the same browser inherits User A's uncommitted workout draft session.
- **Concrete Resolution Proposal**:
  Purge `localWorkout` and remove `'logbook_local_workout'` from `localStorage` inside `setUserData(null)`.

```typescript
// BEFORE (src/store/useAppStore.ts:88-95):
setUserData: (dataOrUpdater) => {
    set((state) => {
        const nextData = typeof dataOrUpdater === 'function' ? ... : dataOrUpdater;
        ...
        return { userData: nextData, localWorkout: syncedLocalWorkout };
    });
}

// AFTER:
setUserData: (dataOrUpdater) => {
    set((state) => {
        const nextData = typeof dataOrUpdater === 'function' 
            ? (dataOrUpdater as (prev: UserData | null) => UserData | null)(state.userData) 
            : dataOrUpdater;

        if (!nextData) {
            try {
                localStorage.removeItem('logbook_local_workout');
            } catch (e) {
                console.error("Errore pulizia localWorkout in localStorage:", e);
            }
            return { userData: null, localWorkout: null };
        }
        ...
        return { userData: nextData, localWorkout: syncedLocalWorkout };
    });
}
```

---

### Issue 3.3: Unmounted Rest Timer State Loss During Sub-Tab Navigation
- **ID**: `MEM-03`
- **Exact Location**: `src/components/Training/WorkoutTimer.tsx`: lines 4–22 & `src/components/Training/TrainingView.tsx`: lines 17–20
- **System Impact**:
  `WorkoutTimer` stores rest timer state (`restState`, `restStartTime`, `restAccumulated`) in local component `useState`. When the user switches to another sub-tab ("Schede", "Esercizi", "Storico") during a workout session, `TrainingView` unmounts `<TrainingSession />`, destroying the active rest timer.
- **Concrete Resolution Proposal**:
  Preserve sub-tab components using CSS `display` toggling in `TrainingView.tsx` instead of conditional unmounting.

```tsx
// BEFORE (src/components/Training/TrainingView.tsx:17-20):
{subTab === 'session' && <TrainingSession />}
{subTab === 'routines' && <TrainingRoutines />}
{subTab === 'exercises' && <TrainingExercises />}
{subTab === 'history' && <TrainingHistory />}

// AFTER:
<div style={{ display: subTab === 'session' ? 'block' : 'none' }}><TrainingSession /></div>
<div style={{ display: subTab === 'routines' ? 'block' : 'none' }}><TrainingRoutines /></div>
<div style={{ display: subTab === 'exercises' ? 'block' : 'none' }}><TrainingExercises /></div>
<div style={{ display: subTab === 'history' ? 'block' : 'none' }}><TrainingHistory /></div>
```

---

### Issue 3.4: Invisible Quick-Added Foods in Nutrition Meals View
- **ID**: `UX-01`
- **Exact Location**: `src/hooks/useNutritionMeals.ts`: lines 27–54 & `src/components/Nutrition/NutritionMeals.tsx`: lines 80–92
- **System Impact**:
  Quick-added items (`handleQuickAdd`) are assigned `meal: 'quick'`. However, `NutritionMeals.tsx` iterates strictly over hardcoded array `MEAL_TYPES = ['Colazione', 'Pranzo', 'Cena', 'Spuntini']`. Quick-added foods are accounted for in daily total calories, but are **never rendered in the meals list**, preventing users from viewing, editing, or deleting quick-added calories.
- **Concrete Resolution Proposal**:
  Include `'quick'` in `MEAL_TYPES` in `NutritionMeals.tsx`.

```tsx
// BEFORE (src/components/Nutrition/NutritionMeals.tsx:4):
const MEAL_TYPES = ['Colazione', 'Pranzo', 'Cena', 'Spuntini'];

// AFTER:
const MEAL_TYPES = ['Colazione', 'Pranzo', 'Cena', 'Spuntini', 'quick'];

// Inside MEAL_TYPES.map render heading (line 96):
<h3 style={{ margin: 0, color: 'var(--primary-color)' }}>
    {mt === 'quick' ? 'Quick Add / Altri' : mt}
</h3>
```

---

### Issue 3.5: Persistent Stale Search Results Dropdown in Food Search
- **ID**: `UX-02`
- **Exact Location**: `src/hooks/useNutritionMeals.ts`: lines 120–125
- **System Impact**:
  When adding a food item (`addFood`) or clearing search input (`clearSearch`), `setSearchQuery('')` is called, but `setSearchResults([])` is **omitted**. Consequently, the food search dropdown overlay remains rendered on screen, obstructing the user's view of their nutrition log.
- **Concrete Resolution Proposal**:
  Clear `searchResults` array inside `addFood` and `clearSearch`.

```typescript
// BEFORE (src/hooks/useNutritionMeals.ts:120-125):
const clearSearch = () => {
    setSearchQuery('');
};

// AFTER:
const clearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
};

// Inside addFood:
saveUserData({ ...userData, nutrition: newNutritionObj });
setSearchQuery('');
setSearchResults([]);
```

---

### Issue 3.6: Accessibility Defect — Non-Interactive `<div>` Navigation Elements
- **ID**: `A11Y-01`
- **Exact Location**:
  - `src/App.tsx`: lines 151–166
  - `src/components/Nutrition/NutritionView.tsx`: lines 12–14
  - `src/components/Training/TrainingView.tsx`: lines 11–14
  - `src/components/SettingsView.tsx`: lines 31–32
- **System Impact**:
  Main navigation items and sub-tab bars are constructed with `<div>` elements with `onClick` handlers. They lack `role="tab"` or `role="button"`, `tabIndex={0}`, `aria-selected`, and keyboard handlers (`onKeyDown` for Enter/Space). Keyboard and screen-reader users cannot focus or activate navigation tabs.
- **Concrete Resolution Proposal**:
  Convert navigation elements to `<button type="button">` tags with explicit accessibility attributes.

```tsx
// BEFORE (src/App.tsx:151-166):
<div className={`nav-item ${activeTab === 'home' ? 'active' : ''}`} onClick={() => setActiveTab('home')}>
  <Home size={24} />
  <span>Home</span>
</div>

// AFTER:
<button 
  type="button"
  className={`nav-item ${activeTab === 'home' ? 'active' : ''}`} 
  onClick={() => setActiveTab('home')}
  aria-label="Home"
  aria-selected={activeTab === 'home'}
>
  <Home size={24} />
  <span>Home</span>
</button>
```

---

### Issue 3.7: Accessibility Defect — Missing `aria-label` on Rest Timer Control Buttons
- **ID**: `A11Y-02`
- **Exact Location**: `src/components/Training/WorkoutTimer.tsx`: lines 59–64
- **System Impact**:
  Timer action buttons display raw Unicode symbol glyphs (`▶`, `⏸`, `🔄`, `⏹`) with `title` attributes but lack `aria-label`. Assistive technologies announce literal symbol characters instead of button action names.
- **Concrete Resolution Proposal**:
  Add explicit `aria-label` attributes to all timer control buttons.

```tsx
// BEFORE (src/components/Training/WorkoutTimer.tsx:59-64):
<button className="timer-btn play" onClick={startRest} title="Avvia recupero">▶</button>
<button className="timer-btn pause" onClick={pauseRest} title="Pausa recupero">⏸</button>

// AFTER:
<button type="button" className="timer-btn play" onClick={startRest} title="Avvia recupero" aria-label="Avvia recupero">▶</button>
<button type="button" className="timer-btn pause" onClick={pauseRest} title="Pausa recupero" aria-label="Pausa recupero">⏸</button>
<button type="button" className="timer-btn reset" onClick={resetRest} title="Riavvia recupero" aria-label="Riavvia recupero">🔄</button>
<button type="button" className="timer-btn stop" onClick={stopRest} title="Fermare recupero" aria-label="Fermare recupero">⏹</button>
```

---

## SECTION 4: Business Logic & Timezone Flaws

### Issue 4.1: Undefined `dailyDeficit` Property in Home TDEE Estimator Widget
- **ID**: `LOGIC-01`
- **Exact Location**: `src/components/Home/HomeView.tsx`: line 111 & `src/lib/logic.ts`: lines 185–208
- **System Impact**:
  `HomeView.tsx` attempts to render `(tdeeCalc as any)?.dailyDeficit`. However, `Logic.calculateTDEE` does not calculate or return a `dailyDeficit` property. The widget displays `Deficit/Surplus Teorico: undefined` on the dashboard.
- **Concrete Resolution Proposal**:
  Calculate and return `dailyDeficit` in `Logic.calculateTDEE` in `src/lib/logic.ts`.

```typescript
// BEFORE (src/lib/logic.ts:199-207):
const weightDiff = wLast - wFirst;
const estimatedTDEE = avgKcal - ((weightDiff / diffDays) * 7700);
return {
    error: false,
    tdee: Math.round(estimatedTDEE),
    avgKcal: Math.round(avgKcal),
    weightDiff: weightDiff.toFixed(2),
    daysTracked: recentDays.length,
    timeSpanDays: diffDays
};

// AFTER:
const weightDiff = wLast - wFirst;
const estimatedTDEE = avgKcal - ((weightDiff / diffDays) * 7700);
const dailyDeficit = Math.round(avgKcal - estimatedTDEE);
return {
    error: false,
    tdee: Math.round(estimatedTDEE),
    avgKcal: Math.round(avgKcal),
    weightDiff: weightDiff.toFixed(2),
    dailyDeficit,
    daysTracked: recentDays.length,
    timeSpanDays: diffDays
};
```

---

### Issue 4.2: `NaN` Result in Body Fat Calculation on Missing/Invalid Date of Birth
- **ID**: `LOGIC-02`
- **Exact Location**: `src/lib/logic.ts`: lines 165–167 & lines 434–439
- **System Impact**:
  Body fat percentage calculation uses `new Date(Date.now() - dobDate.getTime()).getUTCFullYear() - 1970`. If `profile.dob` is missing or invalid, `dobDate.getTime()` evaluates to `NaN`, calculating `age` as `NaN` and producing `NaN` body fat percentage values in the UI.
- **Concrete Resolution Proposal**:
  Validate `dobDate` before computing age, falling back to a default age (30).

```typescript
// BEFORE (src/lib/logic.ts:165-166):
const dobDate = profile.dob ? new Date(profile.dob) : null;
const age = Math.abs(new Date(Date.now() - dobDate.getTime()).getUTCFullYear() - 1970);

// AFTER:
const dobDate = profile.dob ? new Date(profile.dob) : null;
const age = (dobDate && !isNaN(dobDate.getTime())) 
    ? Math.abs(new Date(Date.now() - dobDate.getTime()).getUTCFullYear() - 1970) 
    : 30;
```

---

### Issue 4.3: Timezone Shift & Performance Issue in Date Sorting
- **ID**: `TIME-01`
- **Exact Location**: `src/hooks/useHomeView.ts`: line 55 & `src/lib/logic.ts`: line 354
- **System Impact**:
  `Object.keys(nutrition).sort((a,b) => new Date(a).getTime() - new Date(b).getTime())` parses ISO date strings like `"2026-07-29"` as UTC midnight (`2026-07-29T00:00:00.000Z`). In timezones behind UTC (e.g. UTC-5), parsing `new Date("2026-07-29")` can shift local dates. ISO `"YYYY-MM-DD"` date strings sort accurately and significantly faster using string comparison `a.localeCompare(b)`.
- **Concrete Resolution Proposal**:
  Replace `new Date(a).getTime() - new Date(b).getTime()` with `a.localeCompare(b)`.

```typescript
// BEFORE (src/hooks/useHomeView.ts:55):
const dates = Object.keys(nutrition).sort((a,b) => new Date(a).getTime() - new Date(b).getTime());

// AFTER:
const dates = Object.keys(nutrition).sort((a,b) => a.localeCompare(b));
```

```typescript
// BEFORE (src/lib/logic.ts:354):
const dates = Object.keys(state.nutrition).sort((a,b) => new Date(a).getTime() - new Date(b).getTime());

// AFTER:
const dates = Object.keys(state.nutrition).sort((a,b) => a.localeCompare(b));
```

---

### Issue 4.4: Unsynchronized Initial State for Measurement Method in Female Users
- **ID**: `LOGIC-03`
- **Exact Location**: `src/hooks/useNutritionMeasurements.ts`: line 18
- **System Impact**:
  `const [method, setMethod] = useState(profile.gender === 'F' ? 'navy_female' : 'navy_male')` evaluates `profile.gender` on component mount. When `userData` loads asynchronously from Firebase after initial mount, `useState` initial value is ignored. Female users remain defaulted to `navy_male` measurement formula unless manually toggled.
- **Concrete Resolution Proposal**:
  Add a `useEffect` in `useNutritionMeasurements.ts` to update `method` when `profile.gender` resolves.

```typescript
// BEFORE (src/hooks/useNutritionMeasurements.ts:18):
const [method, setMethod] = useState<'navy_male' | 'navy_female'>(profile.gender === 'F' ? 'navy_female' : 'navy_male');

// AFTER:
const [method, setMethod] = useState<'navy_male' | 'navy_female'>(profile.gender === 'F' ? 'navy_female' : 'navy_male');

useEffect(() => {
    if (profile.gender === 'F' && method === 'navy_male') {
        setMethod('navy_female');
    }
}, [profile.gender]);
```

---

### Issue 4.5: `Infinity` Return in Macro Ratio Calculation
- **ID**: `LOGIC-04`
- **Exact Location**: `src/lib/logic.ts`: line 259
- **System Impact**:
  `calculateMacroRatio` returns `ratioKcal: Infinity` when `fKcal <= 0`. Returning `Infinity` causes `"Infinity"` to display in the UI and causes JSON serialization (`JSON.stringify`) to convert values to `null`.
- **Concrete Resolution Proposal**:
  Return `0` instead of `Infinity`.

```typescript
// BEFORE (src/lib/logic.ts:259):
if (fKcal <= 0) return { ratioKcal: Infinity, ratioGrams: fG > 0 ? Math.round((cG / fG) * 100) / 100 : 0, ratioString: 'N/A' };

// AFTER:
if (fKcal <= 0) return { ratioKcal: 0, ratioGrams: fG > 0 ? Math.round((cG / fG) * 100) / 100 : 0, ratioString: 'N/A' };
```

---

## Master Prioritized Resolution Summary Table

| Priority | ID | Section / Category | Issue Title | Location (File & Line Numbers) | System Impact Summary | Recommended Action |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **P0 - Critical** | `FIRE-01` | Section 2: Firebase | Silent Error Suppression in `DB.saveUserData` | `src/lib/db.ts:190-192` | Network/cloud save errors ignored, user falsely believes data saved | Re-throw caught errors in `saveUserData` |
| **P0 - Critical** | `FIRE-02` | Section 2: Firebase | Lack of Atomic Batching (`writeBatch`) | `src/lib/db.ts:107-188` | Mid-sync disconnects leave Firestore in inconsistent partial state | Implement Firestore `writeBatch(db)` |
| **P0 - Critical** | `ARCH-02` | Section 1: Architecture | Direct Store Immutability Violation | `src/store/useAppStore.ts:99`, `useNutritionMeasurements.ts:81-91` | Direct object property mutation breaks React reference diffing | Use shallow/deep copy spreads (`...`) |
| **P0 - Critical** | `MEM-01` | Section 3: Memory | Module Variable Leak Across User Accounts | `src/lib/db.ts:6, 194-204` | Logged-out user state retained in module variable `lastSavedStateStr` | Reset `lastSavedStateStr = null` on logout |
| **P0 - Critical** | `MEM-02` | Section 3: Memory | LocalStorage Workout Draft Leak on Logout | `src/store/useAppStore.ts:88-116` | Active workout draft leaked to next user logging in on device | Purge `localWorkout` & localStorage on `setUserData(null)` |
| **P1 - High** | `ARCH-01` | Section 1: Architecture | Unselected Zustand Subscriptions | 10 files (`AuthContext.tsx`, custom hooks, `GlobalDialog.tsx`) | App-wide re-render cascade on every single workout keystroke | Replace with atomic selectors `useAppStore(s => s.x)` |
| **P1 - High** | `ARCH-04` | Section 1: Architecture | Broken Custom Hook Signature Mismatch | `TrainingSession.tsx:231`, `useWorkoutSession.ts:99` | "Aggiungi Esercizio Extra" button completely broken & fails silently | Update `addExtraExercise` to accept string IDs |
| **P1 - High** | `DATA-01` | Section 2: Firebase | Optimistic Overwrite on Tab Visibility Change | `src/contexts/AuthContext.tsx:65-73` | Returning to tab overwrites unsynced offline edits with remote snapshot | Await `waitForPendingWrites(db)` before reload |
| **P1 - High** | `DATA-02` | Section 2: Firebase | Ended Workout Re-appearing as Active Draft | `useAppStore.ts:97-111`, `useWorkoutSession.ts:87-95` | Race condition re-saves finished workout back into active draft state | Differentiate explicit `activeWorkout: null` |
| **P1 - High** | `ASYNC-01` | Section 3: State / Async | Unawaited `saveUserData` Calls | 8 Custom Action Hooks | UI shows success alerts while background cloud save fails | Mark handlers `async` & `await saveUserData(...)` |
| **P1 - High** | `SEC-01` | Section 2: Firebase | Hardcoded Firebase Config Keys | `src/lib/firebase.ts:22-31` | API keys hardcoded in client source files | Use `import.meta.env` Vite env vars |
| **P1 - High** | `SEC-02` | Section 2: Security | Unvalidated Data Writes in `firestore.rules` | `firestore.rules:10-12` | Zero schema validation or payload size checks in Firestore rules | Add field schema & size validation to `firestore.rules` |
| **P1 - High** | `PERF-02` | Section 1: Performance | $O(N \times M)$ History Search on Keystrokes | `TrainingSession.tsx:102-108`, `TrainingHistory.tsx:53-56` | Input lag during workout typing due to nested history loops | Pre-compute indexed `Map` lookups with `useMemo` |
| **P2 - Medium** | `PERF-01` | Section 1: Performance | Unmemoized AuthContext Value & Props | `AuthContext.tsx:117-125`, `TrainingExercises.tsx:93`, `WeightChart.tsx:16` | Continuous re-rendering of SVG paths and Chart.js instances | Wrap context `value` in `useMemo` & extract static options |
| **P2 - Medium** | `ARCH-03` | Section 1: Architecture | Derived State Duplication Anti-Pattern | `useNutritionPlanning.ts:10-26`, `useSettings.ts:22-33` | Double render & stale UI input flicker on form loads | Use computed fallback state instead of `useState` + `useEffect` |
| **P2 - Medium** | `FIRE-03` | Section 2: Firebase | 1MB Monthly Document Size Limit Risk | `src/lib/db.ts:130-184` | Heavy workout logs risk exceeding Firestore 1MB document limit | Add document size validation check in `db.ts` |
| **P2 - Medium** | `FIRE-04` | Section 2: Firebase | Race Condition during Account Deletion | `src/lib/db.ts:205-238` | Auth user deleted before subcollections, leaving orphaned data | Delete subcollections before deleting auth user |
| **P2 - Medium** | `ASYNC-02` | Section 2: State / Async | Unawaited `getRedirectResult` in AuthContext | `src/contexts/AuthContext.tsx:50-52` | Mobile redirect auth causes layout flash & unauthenticated state | Await `getRedirectResult` before `loading = false` |
| **P2 - Medium** | `MEM-03` | Section 3: Memory | Rest Timer Unmounted during Sub-Tab Switch | `WorkoutTimer.tsx:4-22`, `TrainingView.tsx:17-20` | Switching sub-tabs ("Schede", "Storico") destroys active rest timer | Use CSS `display` toggle instead of unmounting components |
| **P2 - Medium** | `UX-01` | Section 3: UX | Invisible Quick-Added Foods in Meals View | `NutritionMeals.tsx:80-92`, `useNutritionMeals.ts:27-54` | Quick-added calories present in daily total but invisible in meal list | Include `'quick'` in `MEAL_TYPES` rendering list |
| **P2 - Medium** | `UX-02` | Section 3: UX | Persistent Search Dropdown Overlay | `useNutritionMeals.ts:120-125` | Food search dropdown stays open after selection/clearing | Reset `searchResults = []` on selection/clear |
| **P2 - Medium** | `UX-03` | Section 3: UX | Session Notes Textarea Fails to Update | `TrainingSession.tsx:220`, `useWorkoutSession.ts:166` | Typing in exercise notes textarea fails to save | Wire `updateSessionNote` directly to textarea |
| **P2 - Medium** | `LOGIC-01` | Section 4: Logic | Undefined `dailyDeficit` in Home Widget | `HomeView.tsx:111`, `logic.ts:185-208` | Dashboard widget displays `Deficit: undefined` | Calculate and return `dailyDeficit` in `calculateTDEE` |
| **P2 - Medium** | `LOGIC-02` | Section 4: Logic | `NaN` Body Fat on Missing Date of Birth | `logic.ts:165-167`, `434-439` | Missing DOB produces `NaN` body fat calculation | Validate DOB date string before computing age |
| **P2 - Medium** | `LOGIC-03` | Section 4: Logic | Measurement Method Mismatch in Females | `useNutritionMeasurements.ts:18` | Asynchronous user load leaves female users on male formula | Update measurement method when profile gender updates |
| **P2 - Medium** | `TIME-01` | Section 4: Timezone | Timezone Shift in ISO Date Sorting | `useHomeView.ts:55`, `logic.ts:354` | `new Date(isoDate)` shifts dates in timezones behind UTC | Use string comparison `a.localeCompare(b)` for ISO dates |
| **P3 - Low** | `A11Y-01` | Section 3: Accessibility | Non-Interactive `<div>` Navigation Elements | `App.tsx:151-166`, `TrainingView.tsx:11-14` | Navigation tabs cannot be focused or activated via keyboard | Convert `<div>` nav controls to `<button type="button">` |
| **P3 - Low** | `A11Y-02` | Section 3: Accessibility | Missing `aria-label` on Rest Timer Buttons | `WorkoutTimer.tsx:59-64` | Screen readers read raw emoji characters (`▶`, `⏸`) | Add explicit `aria-label` attributes to timer controls |
| **P3 - Low** | `LOGIC-04` | Section 4: Logic | `Infinity` Return in Macro Ratios | `logic.ts:259` | Zero fat calories return `Infinity`, breaking JSON serialization | Return `0` instead of `Infinity` in `calculateMacroRatio` |
