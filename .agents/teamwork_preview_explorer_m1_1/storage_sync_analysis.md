# LogBook Storage & Sync Engine — Deep Architectural Inspection Report

**Date:** 2026-08-16  
**Auditor:** Explorer 1 (Storage & Sync Engine Specialist)  
**Target:** 3-Tier Storage & Synchronization Engine (`src/lib/db.ts`, `src/store/useAppStore.ts`, `src/contexts/AuthContext.tsx`, `src/main.tsx`, `src/hooks/useLocalStorage.ts`, `src/lib/schema.ts`, `src/lib/firebase.ts`, `firestore.rules`)  
**Scope:** Production-readiness audit for high-concurrency cloud scaling (Firebase paid tier, hundreds of concurrent users, offline-first resilience, zero data-loss guarantees).

---

## Executive Summary

LogBook employs a **3-tier hybrid storage architecture** designed for offline-first operation, PWA background persistence, and fast initial rendering:
1. **Tier 1 (Cloud Persistence):** Google Cloud Firestore with monthly subcollection bucketing (`history_months/{YYYY-MM}`, `nutrition_months/{YYYY-MM}`) and multi-tab persistent local caching (`persistentLocalCache` + `persistentMultipleTabManager`).
2. **Tier 2 (Global Asynchronous Cache):** IndexedDB via `idb-keyval` (key: `'logbook_cached_user_data'`), storing the entire `UserData` tree to bypass the 5MB quota of `localStorage` and eliminate blank-screen flash on boot (`Fast Pre-render Bootstrap`).
3. **Tier 3 (Synchronous Volatile Storage):** Synchronous `localStorage` (key: `'logbook_local_workout'`) for real-time keystroke tracking during active workouts, shielded from OS thread suspension (iOS WebKit / Android PWA).

While this architecture provides snappy local UI updates and solid foundation for offline usage, this audit identified **5 critical architectural risks** that must be resolved prior to large-scale production rollout:
1. **Silent Error Swallowing in `DB.saveUserData` (Line 235 `src/lib/db.ts`):** `batch.commit()` errors (including permission denials, security rule rejections, and quota errors) are caught, suppressed, and `lastSavedStateStr` is updated regardless. This falsely reports success to Zustand promises and causes permanent desynchronization.
2. **Race Condition on Initial Cloud Load (`loadData` vs Optimistic Edits in `AuthContext.tsx` Lines 55–58):** Background fetch unconditionally overwrites in-memory Zustand state and IndexedDB with stale cloud data if the user interacts with the app before `DB.loadUserData()` resolves.
3. **Linear Read Cost Explosion on Monthly Collections (`src/lib/db.ts` Lines 85–105):** `DB.loadUserData()` performs unconstrained `getDocs()` across all historical months on every startup and tab focus (`visibilitychange`), causing $O(N)$ document reads per session.
4. **Cross-Device Overwrite Collision on Monthly Map Documents (`src/lib/db.ts` Lines 190, 220):** Monthly buckets are saved as monolithic document maps (`batch.set(doc, cleanDoc)` without granular field merging), meaning concurrent edits from two devices in the same calendar month will wipe out each other's entries (Last-Write-Wins document replacement).
5. **Main User Document Limit Threat (`src/lib/db.ts` Line 164 `checkDocSize < 950KB`):** `library` (exercises) and `customFoods` (food database) grow unbounded inside `users/{uid}`. Heavy users will eventually hit the 1MB Firestore limit, permanently locking out profile and routine saves.

---

## 1. 3-Tier Storage Architecture Deep Dive

```
+-----------------------------------------------------------------------------------+
|                                 USER INTERFACE                                    |
|   (React 19 Components, Forms, Real-Time Workout Sets, Nutrition Macro Inputs)   |
+-----------------------------------------------------------------------------------+
       | (Keystrokes / Set updates)                       | (Routines, Foods, History, Profile)
       v                                                  v
+-----------------------------+                  +-----------------------------------+
|           TIER 3            |                  |         ZUSTAND STORE             |
|   Synchronous LocalStorage  |                  |       (src/store/useAppStore.ts)  |
|  'logbook_local_workout'    |<---------------->|   In-Memory Single Source of Truth|
|  (300ms Debounce + Sync     |   (Bi-directional|   - userData: UserData            |
|   flush on visibilitychange)|    shielding)    |   - localWorkout: WorkoutSession  |
+-----------------------------+                  +-----------------------------------+
                                                          |              |
                          (Eager IDB Cache Write)         |              | (1000ms Debouncer)
                          v                               |              v
+------------------------------------+                    |   +-----------------------+
|               TIER 2               |                    |   |        TIER 1         |
|         Async IndexedDB            |                    |   |  Firebase Cloud DB    |
|       (idb-keyval storage)         |                    |   |   (src/lib/db.ts)     |
|   'logbook_cached_user_data'       |                    |   |                       |
|   - Full UserData Tree             |                    |   | - users/{uid} (950KB) |
|   - Fast Pre-render Bootstrap      |                    |   | - history_months/YYYY |
|   - Offline resilience fallback    |                    |   | - nutrition_months/YY |
+------------------------------------+                    |   +-----------------------+
```

### 1.1 Tier 1: Cloud Firestore Persistence
- **Implementation:** `src/lib/db.ts` (Lines 24–289) and `src/lib/firebase.ts` (Lines 64–66).
- **Configuration:** Initialized with multi-tab persistent cache:
  ```ts
  const db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
  ```
- **Data Partitioning:**
  - Root document: `users/{uid}` (profile, library, routines, customFoods, activeWorkout, trainingCycles, activeCycleId, nutritionPlanning, supplements).
  - Subcollections: `users/{uid}/history_months/{YYYY-MM}` and `users/{uid}/nutrition_months/{YYYY-MM}`.
- **Diffing Engine:** `fast-deep-equal` compares the in-memory state with `lastSavedStateStr` (cached JSON string of the last known saved state). If a sub-section is unchanged, it is excluded from the Firestore `writeBatch`.
- **Size Safeguards:** `checkDocSize(data, docName)` calculates byte length via `new Blob([JSON.stringify(data)]).size` and throws if $> 950,000$ bytes ($~950$ KB).

### 1.2 Tier 2: Global Asynchronous Cache (IndexedDB `idb-keyval`)
- **Implementation:** `src/main.tsx` (Lines 18–29), `src/store/useAppStore.ts` (Lines 59–73).
- **Key:** `'logbook_cached_user_data'`.
- **Fast Pre-render Bootstrap:**
  - `initApp()` in `src/main.tsx` executes before `createRoot(rootElement).render(...)`:
    ```ts
    const cached = await get<UserData>('logbook_cached_user_data');
    window.__INITIAL_USER_DATA__ = cached || null;
    const initialData = getInitialUserData();
    if (initialData && !useAppStore.getState().userData) {
      useAppStore.setState({ userData: initialData });
    }
    ```
  - **Strength:** Prevents empty screen flashing on startup and protects guest data from being overwritten with empty defaults on slow connections.
- **Cache Invalidation & Cleanup:** `resetStore()` in `useAppStore.ts` (Line 235) calls `idbDel('logbook_cached_user_data')` upon user logout.

### 1.3 Tier 3: Synchronous Volatile Storage (`localStorage`)
- **Implementation:** `src/hooks/useLocalStorage.ts` (Lines 1–26), `src/store/useAppStore.ts` (Lines 31–44, 81–103, 248–261).
- **Key:** `'logbook_local_workout'`, `'logbook_is_guest'`, `'logbook_activeTab'`, `'logbook_trainingSubTab'`, `'logbook_nutritionSubTab'`, `'logbook_dataSubTab'`.
- **Strict JSON Parsing:**
  - `useLocalStorage.ts` strictly validates parsed JSON, logging a `SyntaxError` and returning `initialValue` if parsing fails, preventing corrupted state from propagating.
- **Active Workout Shielding:**
  - `localWorkout` is initialized synchronously on store instantiation from `localStorage.getItem('logbook_local_workout')` and parsed via `WorkoutSessionSchema.parse()`.
  - When backgrounded (`visibilitychange` $\rightarrow$ `hidden`), the 300ms debounce timer is bypassed, executing immediate synchronous `localStorage.setItem('logbook_local_workout', JSON.stringify(state.localWorkout))` (Line 254).

---

## 2. Global Debouncer & Persistence Pipeline Inspection

### 2.1 Debouncer Mechanics (`useAppStore.ts`)
```ts
// src/store/useAppStore.ts Lines 26-29, 166-218
let globalSaveTimer: ReturnType<typeof setTimeout> | null = null;
type PendingPromise = { resolve: () => void; reject: (err: unknown) => void };
let pendingPromises: PendingPromise[] = [];

saveUserData: async (newDataOrUpdater) => {
    // 1. Compute optimistic state
    const finalData = { ...nextData, activeWorkout: nextData.activeWorkout ?? localWorkout };
    
    // 2. Eagerly write to Tier 2 (IndexedDB)
    saveUserDataToCache(finalData);
    set({ userData: finalData, saveError: null, syncing: true });

    // 3. Queue Promise and reset 1000ms timer
    return new Promise<void>((resolve, reject) => {
        pendingPromises.push({ resolve, reject });
        if (globalSaveTimer) clearTimeout(globalSaveTimer);
        globalSaveTimer = setTimeout(async () => {
            globalSaveTimer = null;
            const promisesToCall = [...pendingPromises];
            pendingPromises = [];
            try {
                const currentState = get().userData;
                if (currentState) {
                    await DB.saveUserData(currentState);
                }
                promisesToCall.forEach(p => p.resolve());
            } catch (error) {
                set({ saveError: "Errore sincronizzazione. Verifica la connessione." });
                promisesToCall.forEach(p => p.reject(error));
            } finally {
                if (!globalSaveTimer && pendingPromises.length === 0) {
                    set({ syncing: false });
                }
            }
        }, DEBOUNCE_DELAY_GLOBAL);
    });
}
```

### 2.2 Burst Update Analysis
- **Behavior:** If a user triggers 10 updates in 500ms (e.g. rapid meal logging or slider adjustments):
  - In-memory state and UI re-render optimistically on each update.
  - IndexedDB cache receives 10 sequential write requests.
  - The Firestore network call is deferred until 1000ms after the last update.
  - `fast-deep-equal` diffs the final aggregated state against the last saved cloud snapshot.
- **Verdict:** Highly efficient for reducing Firestore write billings and eliminating redundant network roundtrips.

### 2.3 Unload & Navigation Behavior (`beforeunload` vs `visibilitychange`)
- In `src/App.tsx` (Lines 75–86), a `beforeunload` listener prompts the user if `syncing === true`.
- **Limitation on Mobile/PWA:** iOS Safari and Android Chrome PWA frequently terminate apps or discard background tabs without firing `beforeunload`.
- `visibilitychange` in `useAppStore.ts` flushes `localWorkout` to `localStorage`, but **does NOT flush `globalSaveTimer` to `DB.saveUserData()`**.
- If a user modifies nutrition or routines and immediately swipes the app away, the pending Firestore save is aborted in memory.
- While the changes survive in IndexedDB locally, the cloud database remains stale until the next successful write.

---

## 3. Concurrency & Race Condition Analysis

### 3.1 🚨 High Risk: Stale Cloud Overwrite on Startup (`AuthContext.tsx`)
```ts
// src/contexts/AuthContext.tsx Lines 48-67
const loadData = useCallback(async (user: User) => {
    if (!user) return;
    const currentData = useAppStore.getState().userData;
    if (!currentData) {
        setSyncing(true);
    }
    try {
        const data = await DB.loadUserData(); // <-- Network delay (1-5s)
        if (data && data !== currentData) {
            setUserData(data); // <-- UNCONDITIONAL OVERWRITE
        }
    } catch (error: any) { ... }
    finally { setSyncing(false); }
}, [...]);
```
**Failure Scenario:**
1. User opens the app on a high-latency connection.
2. `main.tsx` instantly loads cached data from IndexedDB into Zustand.
3. User immediately navigates to Nutrition and logs Breakfast (`saveUserData` updates Zustand and starts 1000ms debounce).
4. `DB.loadUserData()` resolves with the older cloud snapshot (which does not contain Breakfast).
5. `loadData` invokes `setUserData(data)`.
6. `setUserData` preserves `state.localWorkout`, but **replaces `nutrition`, `library`, `routines`, and `customFoods` with the cloud snapshot**.
7. The user's newly logged Breakfast is wiped from Zustand and IndexedDB.
8. When the 1000ms debounce timer fires, `get().userData` is now the stale cloud state, so nothing is saved to Firestore.

### 3.2 🚨 High Risk: Silent Failure on Firestore Rejection (`src/lib/db.ts`)
```ts
// src/lib/db.ts Lines 231-240
if (hasWrites) {
    try {
        await withTimeout(batch.commit(), 7000, "Timeout sincronizzazione Firestore");
        console.log(`Sincronizzazione DB completata.`);
    } catch (batchErr) {
        console.warn("Scrittura archiviata nella cache locale Firestore (offline):", batchErr);
    }
}
lastSavedStateStr = JSON.stringify(state); // <-- UPDATED REGARDLESS OF ERROR!
```
**Failure Scenario:**
1. A user's Firebase Auth token expires or Firestore Security Rules reject a write (`permission-denied` or `resource-exhausted`).
2. `batch.commit()` rejects with `FirebaseError`.
3. The `try/catch` catches `batchErr` and swallows it with `console.warn`.
4. `lastSavedStateStr = JSON.stringify(state)` is updated as if the write succeeded.
5. `DB.saveUserData` returns successfully to `useAppStore.ts`.
6. Zustand resolves all promises and sets `syncing: false`.
7. `saveError` remains `null`, giving the user a false sense of security.
8. Because `lastSavedStateStr` now matches `state`, all future `fast-deep-equal` comparisons see NO differences, permanently preventing this data from ever syncing to the cloud.

### 3.3 ⚠️ Medium Risk: Multi-Device Last-Write-Wins Document Replacement
- `history_months/{YYYY-MM}` and `nutrition_months/{YYYY-MM}` store all entries for an entire month in a single Firestore document.
- When `saveUserData` runs:
  ```ts
  // src/lib/db.ts Line 190, 220
  batch.set(doc(db, "users", user.uid, "history_months", month), cleanDoc);
  batch.set(doc(db, "users", user.uid, "nutrition_months", month), cleanDoc);
  ```
- If User modifies Day 1 on Phone and Day 2 on Tablet simultaneously:
  - Phone writes `{ "2026-08-01": data1, "2026-08-02": oldData2 }`.
  - Tablet writes `{ "2026-08-01": oldData1, "2026-08-02": data2 }`.
  - Whichever batch commits last completely replaces the monthly document, overwriting the other device's day log.

---

## 4. Bucketing, Limits & Scalability Analysis

| Metric / Constraint | Current Implementation | Threshold Limit | Production Scalability Risk |
|---|---|---|---|
| **Root User Document Size** | `users/{uid}` contains profile, library, routines, customFoods, trainingCycles, supplements | 950 KB check (`checkDocSize`) / 1 MB Firestore limit | **High:** Heavy users with $>300$ custom foods and $>200$ exercises will hit 950KB, causing permanent save lockouts. |
| **Monthly Subcollection Docs** | `history_months/{YYYY-MM}` and `nutrition_months/{YYYY-MM}` | 950 KB check / 1 MB Firestore limit | **Low:** 30 workouts/month is $~150$ KB; 31 nutrition days is $~125$ KB. |
| **Startup Read Operations** | `getDocs(collection(...))` across all historical months | Firestore read billing & network latency | **High:** After 3 years of usage, 73 document reads are executed on every startup/refresh/tab switch ($O(N)$ growth). |
| **WriteBatch Operation Limit** | Root doc + modified months in a single batch | 500 operations per `writeBatch` | **Low:** Standard sync consumes 2–5 operations per batch. |
| **Account Deletion Batch** | `deleteAccount()` deletes all monthly docs in 1 batch | 500 operations per `writeBatch` | **Medium:** Fails if user has $>249$ historical + nutrition months. Needs chunking in batches of 400. |

---

## 5. Offline-First Resilience & Error Display Audit

### 5.1 Offline Queue Capabilities
- `src/lib/firebase.ts` activates `persistentLocalCache`, ensuring Firestore caches reads/writes in IndexedDB.
- Offline reads return immediately from cache.
- `withTimeout(..., 6000)` prevents promises from hanging indefinitely when network is in a semi-connected ("zombie") state.

### 5.2 UI Feedback & Error Categorization (`AuthContext.tsx` Lines 252–286)
- The global floating toast categorizes errors based on error strings:
  - `📶`: Offline local mode (`#0ea5e9` - Sky blue)
  - `quota` / `resource-exhausted`: Firebase quota limit (`#f97316` - Orange)
  - `auth` / `sessione` / `permission`: Session expired / Auth issue (`#8b5cf6` - Purple)
  - Default: General sync failure (`#ef4444` - Red)
- Automatically cleared on `window.addEventListener('online', ...)`.

---

## 6. Concrete Architectural Recommendations & Action Plan

### Proposal 1: Fix Error Handling & Selective Offline Suppression (`src/lib/db.ts`)
Distinguish between network timeouts (which can safely defer to Firestore's offline queue) and fatal authorization/schema/quota rejections:
```ts
// Proposed modification in src/lib/db.ts
if (hasWrites) {
    try {
        await withTimeout(batch.commit(), 7000, "Timeout sincronizzazione Firestore");
        lastSavedStateStr = JSON.stringify(state);
    } catch (batchErr: any) {
        // If it's a genuine offline timeout or network unavailable, keep in Firestore cache
        if (batchErr.message?.includes("Timeout") || batchErr.code === 'unavailable' || !navigator.onLine) {
            console.warn("Scrittura archiviata nella cache locale Firestore (offline):", batchErr);
            // Do NOT update lastSavedStateStr so future sync will re-diff and flush if needed
        } else {
            // Fatal Firestore rejection (permission-denied, quota, invalid data)
            console.error("Errore critico durante il salvataggio Firestore:", batchErr);
            throw batchErr; // Must throw to reject Zustand promise and notify user
        }
    }
}
```

### Proposal 2: Bidirectional Reconciliation in `loadUserData` (`src/contexts/AuthContext.tsx`)
Never blindly overwrite `userData` when local state has pending unsynced changes:
```ts
// Proposed modification in src/contexts/AuthContext.tsx
const currentData = useAppStore.getState().userData;
const isSyncing = useAppStore.getState().syncing;

if (data && data !== currentData) {
    if (isSyncing || hasLocalModifications(currentData, data)) {
        // Merge cloud with pending local changes deterministically
        const reconciled = mergeUserData(data, currentData);
        setUserData(reconciled);
    } else {
        setUserData(data);
    }
}
```

### Proposal 3: Windowed Monthly History Fetching ($O(1)$ Startup Reads)
Instead of querying all historical months with `getDocs(collection(...))`:
1. On initial load, fetch only the current month and previous 2 months ($~3-6$ reads total).
2. Lazy-load older months on demand when the user opens the History view or scrolls the calendar past the 3-month window.

### Proposal 4: Firestore Security Rules Hardening (`firestore.rules`)
Add payload size and schema guards to prevent compromised clients from corrupting data:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, delete: if request.auth != null && request.auth.uid == userId;
      allow write: if request.auth != null && request.auth.uid == userId 
                   && request.resource.data.size() < 1000000;
    }
    match /users/{userId}/history_months/{month} {
      allow read, delete: if request.auth != null && request.auth.uid == userId;
      allow write: if request.auth != null && request.auth.uid == userId 
                   && request.resource.data.size() < 1000000;
    }
    match /users/{userId}/nutrition_months/{month} {
      allow read, delete: if request.auth != null && request.auth.uid == userId;
      allow write: if request.auth != null && request.auth.uid == userId 
                   && request.resource.data.size() < 1000000;
    }
  }
}
```
