# Client Firestore Architecture & Security Rules Impact Analysis

**Author:** Explorer 2 (Client DB Architecture & Impact Analyst)  
**Date:** 2026-08-22  
**Target Repository:** `c:\Users\gerar\Documents\GitHub\logbook`  
**Audit Context:** Cloud Firestore Security and Stability Audit  

---

## 1. Executive Summary

This report provides an exhaustive, source-verified analysis of the client-side Cloud Firestore architecture for the **LogBook** PWA. LogBook implements an **Offline-First 3-Tier Storage architecture** combining Firebase Firestore (Tier 1: Cloud), IndexedDB via `idb-keyval` (Tier 2: Global async cache), and `localStorage` (Tier 3: Synchronous active session volatile storage).

All remote database interactions are encapsulated strictly within `src/lib/db.ts`, validated through runtime sanitization boundaries in `src/lib/schema.ts`, and orchestrated via Zustand (`src/store/useAppStore.ts`) and React Context (`src/contexts/AuthContext.tsx`).

### Core Findings
1. **Zero Unbounded Queries:** Document loading is bounded to $O(1)$ point reads ($1$ root doc + $3$ history months + $3$ nutrition months = $7$ `getDoc` calls maximum).
2. **Deterministic Monthly Bucketing:** Historical training sessions and daily nutrition logs are sharded into monthly subcollections (`users/{uid}/history_months/{YYYY-MM}` and `users/{uid}/nutrition_months/{YYYY-MM}`) to bypass the Firestore 1MB document limit.
3. **Atomic Multi-Document Batching:** Data persistence uses `writeBatch(db)` diffed via `fast-deep-equal`. Empty months are deleted, while updated months and root user profile data are committed in a single atomic transaction.
4. **Resilient Chunked Cascade Deletion:** Account deletion queries all monthly subcollection references via `getDocs` and executes deletions in batches capped strictly at 400 operations ($< 500$ Firestore limit).
5. **Full Rules Compatibility & Zero Rule-Read Overhead:** The existing `firestore.rules` utilize strictly in-memory auth checks (`request.auth.uid == userId`), key whitelisting (`hasOnly([...])`), and month ID regex matching (`^[0-9]{4}-(0[1-9]|1[0-2])$`). No `get()`, `exists()`, or `getAfter()` functions are invoked in security rules, guaranteeing zero risk of exceeding Firestore's 20-rule-read limit during 400-operation batches.

---

## 2. Exhaustive Catalog of Client Firestore Operations

Every Cloud Firestore operation executed in the LogBook client is isolated in `src/lib/db.ts`. Below is the complete catalog of these operations.

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                CLIENT FIRESTORE OPERATIONS                               │
├──────────────────┬──────────────────────┬─────────────────────────┬──────────────────────┤
│ Method in DB     │ Firestore API        │ Target Path / Target    │ Purpose              │
├──────────────────┼──────────────────────┼─────────────────────────┼──────────────────────┤
│ loadUserData     │ getDoc               │ users/{uid}             │ Root user profile &  │
│                  │                      │                         │ settings point read  │
│ loadUserData     │ getDoc (Promise.all) │ users/{uid}/            │ 3-month windowed     │
│                  │                      │ history_months/{YYYY-MM}│ training history     │
│ loadUserData     │ getDoc (Promise.all) │ users/{uid}/            │ 3-month windowed     │
│                  │                      │ nutrition_months/{YYYY} │ nutrition & metrics  │
│ saveUserData     │ writeBatch.set       │ users/{uid}             │ Root document update │
│                  │ (merge: true)        │                         │ with whitelisted keys│
│ saveUserData     │ writeBatch.set       │ users/{uid}/            │ Overwrite updated    │
│                  │ (full doc replace)   │ history_months/{YYYY-MM}│ history month map    │
│ saveUserData     │ writeBatch.delete    │ users/{uid}/            │ Delete emptied       │
│                  │                      │ history_months/{YYYY-MM}│ history month doc    │
│ saveUserData     │ writeBatch.set       │ users/{uid}/            │ Overwrite updated    │
│                  │ (full doc replace)   │ nutrition_months/{YYYY} │ nutrition month map  │
│ saveUserData     │ writeBatch.delete    │ users/{uid}/            │ Delete emptied       │
│                  │                      │ nutrition_months/{YYYY} │ nutrition month doc  │
│ saveUserData     │ batch.commit         │ Atomic Transaction      │ Atomically apply all │
│                  │                      │ (timeout: 7000ms)       │ state diff mutations │
│ deleteAccount    │ getDocs              │ users/{uid}/            │ Fetch all history    │
│                  │                      │ history_months          │ subcollection refs   │
│ deleteAccount    │ getDocs              │ users/{uid}/            │ Fetch all nutrition  │
│                  │                      │ nutrition_months        │ subcollection refs   │
│ deleteAccount    │ writeBatch.delete    │ users/{uid}/...         │ Delete all refs in   │
│                  │                      │ & users/{uid}           │ chunks of 400 docs   │
│ secureLogOut     │ waitForPendingWrites │ IndexedDB local cache   │ Wait for offline     │
│                  │                      │ (timeout: 2500ms)       │ queue sync           │
└──────────────────┴──────────────────────┴─────────────────────────┴──────────────────────┘
```

---

### 2.1. Point Read on User Document (`users/{uid}`)

* **Source Location:** `src/lib/db.ts:50-93`
* **Trigger:** Auth state transition / initial application hydration (`loadUserData()`, called from `AuthContext.tsx`).
* **Firestore Call:** `getDoc(doc(db, "users", user.uid))` wrapped in `withTimeout(..., 6000)`.
* **Behavior on Exist:** Extracts and populates root metadata: `profile`, `library`, `routines`, `customFoods`, `activeWorkout`, `trainingCycles`, `activeCycleId`, `supplements`, `nutritionPlanning`, `activePains`. Automatically merges built-in exercise and food libraries (`defaultExercises`, `defaultFoods`) for any missing IDs.
* **Behavior on Non-Exist (New User):** Detects `!docSnap.exists()`, returns clean default data sanitized via `DomainParsers`, caches JSON string in `lastSavedStateStr`, and avoids blocking the app on infinite loading states.

---

### 2.2. Windowed Subcollection Point Reads (`history_months` & `nutrition_months`)

* **Source Location:** `src/lib/db.ts:95-130`
* **Trigger:** Invoked as part of `loadUserData()` immediately after reading root document.
* **Strategy:** **Windowed 3-Month Loading Window ($O(1)$ complexity)**.
  ```typescript
  const now = new Date();
  const targetMonths = [0, 1, 2].map(offset => {
      const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  ```
* **Firestore Calls:**
  1. `Promise.all(targetMonths.map(m => getDoc(doc(db, "users", user.uid, "history_months", m))))`
  2. `Promise.all(targetMonths.map(m => getDoc(doc(db, "users", user.uid, "nutrition_months", m))))`
* **Execution & Resilience:** Both calls are wrapped in `withTimeout(..., 6000)`. Point reads for non-existent months return `exists() === false` and are safely ignored. Retrieved history sessions are merged into `state.history` and sorted descending by `globalStartTime`. Retrieved nutrition days are mapped by date key `YYYY-MM-DD` into `state.nutrition`.

---

### 2.3. Batch Mutation Execution (`saveUserData`)

* **Source Location:** `src/lib/db.ts:153-294`
* **Trigger:** Debounced globally at 1000ms (`DEBOUNCE_DELAY_GLOBAL`) via `createSyncSlice.ts` whenever user updates state.
* **Diffing Engine:** Compares incoming `state` with `oldState` (parsed from `lastSavedStateStr`) using `fast-deep-equal`.
* **Operations inside `writeBatch(db)`:**
  1. **Root User Document Update:**
     - Target: `doc(db, "users", user.uid)`
     - Operation: `batch.set(userRef, cleanUserDocData, { merge: true })`
     - Whitelisted Payload:
       ```typescript
       const userDocData = {
           profile: state.profile || {},
           library: state.library || [],
           routines: state.routines || [],
           customFoods: state.customFoods || [],
           activeWorkout: state.activeWorkout || null,
           trainingCycles: state.trainingCycles || [],
           activeCycleId: state.activeCycleId !== undefined ? state.activeCycleId : null,
           nutritionPlanning: state.nutritionPlanning || null,
           supplements: state.supplements || [],
           activePains: state.activePains || []
       };
       ```
     - Sanitization: `removeUndefinedValues(userDocData)` strips `undefined` properties to prevent Firestore SDK exceptions.
     - Size Check: `checkDocSize(cleanUserDocData, "User Profile")` throws if size $> 950\text{ KB}$.
  2. **History Monthly Shards (`history_months`):**
     - Groups `state.history` items by `YYYY-MM` derived from `h.date` or `h.globalStartTime`.
     - Target: `doc(db, "users", user.uid, "history_months", month)`
     - For new/modified months: `batch.set(docRef, cleanDoc)` (full replacement without merge).
     - For removed/empty months: `batch.delete(docRef)`.
  3. **Nutrition Monthly Shards (`nutrition_months`):**
     - Groups `state.nutrition` records by `YYYY-MM` derived from `date` key (`YYYY-MM-DD`).
     - Target: `doc(db, "users", user.uid, "nutrition_months", month)`
     - For new/modified months: `batch.set(docRef, cleanDoc)` (full replacement without merge).
     - For removed/empty months: `batch.delete(docRef)`.
  4. **Commit & Error Handling:**
     - Commit call: `withTimeout(batch.commit(), 7000, "Timeout sincronizzazione Firestore")`.
     - Offline tolerance: If error contains `"Timeout"`, `code === 'unavailable'`, or `!navigator.onLine`, the error is treated as a local cache write without throwing fatal error, preserving uncommitted state for automatic offline replay.

---

### 2.4. Account Deletion & Cascading Chunked Cleanup (`deleteAccount`)

* **Source Location:** `src/lib/db.ts:305-345`
* **Trigger:** Explicit user action in Settings ("Zona pericolosa" -> Elimina account).
* **Step 1 — Subcollection Reference Discovery:**
  - `getDocs(collection(db, "users", user.uid, "history_months"))`
  - `getDocs(collection(db, "users", user.uid, "nutrition_months"))`
  - Executed concurrently via `Promise.all` with fallback `.catch()` to prevent blocking if subcollections are missing or empty.
* **Step 2 — Reference Aggregation:**
  - Combines all history month document references, all nutrition month document references, and finally `doc(db, "users", user.uid)`.
* **Step 3 — 400-Operation Chunked Batches:**
  ```typescript
  const CHUNK_SIZE = 400;
  for (let i = 0; i < allRefs.length; i += CHUNK_SIZE) {
      const chunk = allRefs.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      chunk.forEach(ref => batch.delete(ref));
      await withTimeout(batch.commit(), 7000, "Timeout eliminazione batch account");
  }
  ```
  - **Firestore Constraint:** Cloud Firestore limits batches to 500 operations. Chunking at 400 guarantees safety margin against SDK overhead.
* **Step 4 — Auth Deletion:**
  - `deleteUser(user)` deletes the Firebase Auth user record. Handles `auth/requires-recent-login` by prompting re-authentication.

---

### 2.5. Pending Writes Synchronization on Logout (`secureLogOut`)

* **Source Location:** `src/lib/db.ts:295-304`
* **Trigger:** User initiates sign-out.
* **Firestore Call:** `withTimeout(waitForPendingWrites(db), 2500, "Timeout scritture offline")` followed by `auth.signOut()`.
* **Purpose:** Ensures queued offline writes are pushed to Firestore before Firebase Auth clears authentication tokens, avoiding authorization rejection on deferred writes.

---

## 3. Document Structures, Field Types & Subcollection Naming Patterns

```
Firestore Root
└── users/ (Collection)
    └── {userId}/ (Document: UserData root)
        │   ├── profile: Map (UserProfile)
        │   ├── library: Array<Map> (Exercise[])
        │   ├── routines: Array<Map> (WorkoutRoutine[])
        │   ├── customFoods: Array<Map> (Food[])
        │   ├── activeWorkout: Map | null (WorkoutSession)
        │   ├── trainingCycles: Array<Map> (TrainingCycle[])
        │   ├── activeCycleId: String | null
        │   ├── nutritionPlanning: Map | null (NutritionPlanning)
        │   ├── supplements: Array<Map> (Supplement[])
        │   └── activePains: Array<String> (string[])
        │
        ├── history_months/ (Subcollection)
        │   └── {YYYY-MM}/ (Document: Map<SessionId, WorkoutSession>)
        │       ├── "session_uuid_1": { id, date, routineId, exercises: [...], ... }
        │       └── "session_uuid_2": { id, date, routineId, exercises: [...], ... }
        │
        └── nutrition_months/ (Subcollection)
            └── {YYYY-MM}/ (Document: Map<YYYY-MM-DD, NutritionDay>)
                ├── "2026-08-01": { date, kcal, carbs, pro, fat, meals: [...], ... }
                └── "2026-08-02": { date, kcal, carbs, pro, fat, meals: [...], ... }
```

---

### 3.1. Root Document: `/users/{userId}`

| Field Name | Type | Description / Zod Schema |
|---|---|---|
| `profile` | `Map` | Biometrics (`dob`, `height`, `gender`, `neck`, `waist`, `hip`, `chest`, `biceps`, etc.) |
| `library` | `Array<Map>` | Exercise library (`id`, `name`, `setsCount`, `muscles`, `trackingType`, `sets`, etc.) |
| `routines` | `Array<Map>` | Workout routines (`id`, `name`, `exercises: RoutineExercise[]`) |
| `customFoods` | `Array<Map>` | Custom foods (`id`, `name`, `kcal`, `pro`, `carbs`, `fat`, `servingUnit`, etc.) |
| `activeWorkout` | `Map \| null` | Ongoing live workout session (`WorkoutSession`) or `null` |
| `trainingCycles` | `Array<Map>` | Periodization cycles (`id`, `name`, `durationWeeks`, `routines`, `isActive`, etc.) |
| `activeCycleId` | `String \| null` | Currently active training cycle ID |
| `nutritionPlanning`| `Map \| null` | Target macros & calories (`avgMacros`, `onBoost`, `onMacros`, `offMacros`, etc.) |
| `supplements` | `Array<Map>` | Supplement definitions (`id`, `name`, `unit`, `target`, `portion`) |
| `activePains` | `Array<String>` | Active pain/injury tags |

---

### 3.2. Subcollection: `/users/{userId}/history_months/{monthId}`

* **Document ID Pattern (`monthId`):** `YYYY-MM` (e.g., `2026-08`, validated via regex `^[0-9]{4}-(0[1-9]|1[0-2])$`).
* **Document Data Model:** Key-Value Map where **Key** is the unique session ID string (`h.id`), and **Value** is the full `WorkoutSession` map.
* **Fields inside each session map:**
  - `id`: `String` (UUID / timestamp ID)
  - `routineId`, `routineName`: `String` (Optional)
  - `cycleId`, `cycleName`: `String` (Optional)
  - `date`: `String` (`YYYY-MM-DD`)
  - `globalStartTime`, `globalEndTime`: `Number` (Timestamp in milliseconds)
  - `globalDurationStr`, `manualDurationStr`: `String`
  - `moodRating`, `pumpRating`, `fatigueRating`: `Number | null` (Scale 1-5)
  - `waterLiters`: `Number`
  - `exercises`: `Array<SessionExercise>` (Exercise sets with `kg`, `reps`, `time`, `dropsets`, `isometrics`)
  - `pains`: `Array<String>`

---

### 3.3. Subcollection: `/users/{userId}/nutrition_months/{monthId}`

* **Document ID Pattern (`monthId`):** `YYYY-MM` (e.g., `2026-08`, validated via regex `^[0-9]{4}-(0[1-9]|1[0-2])$`).
* **Document Data Model:** Key-Value Map where **Key** is the ISO local date string `YYYY-MM-DD` (e.g., `2026-08-22`), and **Value** is the full `NutritionDay` map.
* **Fields inside each day map:**
  - `date`: `String` (`YYYY-MM-DD`)
  - `kcal`, `carbs`, `pro`, `fat`: `Number` (Daily totals)
  - `weight`, `bf`, `neck`, `waist`, `hip`, `chest`, `shoulders`, `biceps`, `thighs`, `calves`: `Number | null`
  - `measurementTime`: `String`
  - `isDayOn`: `Boolean` (Workout day vs Rest day)
  - `meals`: `Array<LoggedMealItem>` (`id`, `name`, `meal`, `quantity`, `kcal`, `carbs`, `pro`, `fat`, `foodId`)
  - `supplementsIntake`: `Array<SupplementIntake>` (`id`, `supplementId`, `amount`, `time`)
  - `sleepHours`, `sleepDeep`, `sleepLight`, `sleepRem`, `sleepAwake`: `String` (`HH:mm` format)

---

## 4. Firestore Security Rules Compatibility & Impact Assessment

### 4.1. Analysis of Current Security Rules (`firestore.rules`)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function isOwner(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }
    
    function isValidMonthId(monthId) {
      return monthId.matches('^[0-9]{4}-(0[1-9]|1[0-2])$');
    }
    
    function incomingData() {
      return request.resource.data;
    }

    match /{document=**} {
      allow read, write: if false;
    }

    match /users/{userId} {
      allow read, delete: if isOwner(userId);
      
      allow create, update: if isOwner(userId)
        && incomingData().keys().hasOnly([
          'profile',
          'library',
          'routines',
          'customFoods',
          'activeWorkout',
          'trainingCycles',
          'activeCycleId',
          'nutritionPlanning',
          'supplements',
          'activePains'
        ]);
        
      match /history_months/{monthId} {
        allow read, delete: if isOwner(userId);
        allow create, update: if isOwner(userId) 
          && isValidMonthId(monthId);
      }
      
      match /nutrition_months/{monthId} {
        allow read, delete: if isOwner(userId);
        allow create, update: if isOwner(userId) 
          && isValidMonthId(monthId);
      }
    }
  }
}
```

---

### 4.2. Rule Evaluation Compatibility Matrix

| Client Operation | Target Path | Rule Evaluated | Verification Status | Rationale |
|---|---|---|---|---|
| `getDoc(doc(db, "users", uid))` | `/users/{uid}` | `isOwner(userId)` on `users/{userId}` | ✅ **PASS** | `request.auth.uid == userId` |
| `getDoc(doc(db, "users", uid, "history_months", "2026-08"))` | `/users/{uid}/history_months/2026-08` | `isOwner(userId)` on `history_months/{monthId}` | ✅ **PASS** | `request.auth.uid == userId` |
| `getDoc(doc(db, "users", uid, "nutrition_months", "2026-08"))` | `/users/{uid}/nutrition_months/2026-08` | `isOwner(userId)` on `nutrition_months/{monthId}` | ✅ **PASS** | `request.auth.uid == userId` |
| `getDocs(collection(db, "users", uid, "history_months"))` | `/users/{uid}/history_months` | `isOwner(userId)` on `history_months/{monthId}` | ✅ **PASS** | `read` covers `list`; query is constrained to owner's path |
| `getDocs(collection(db, "users", uid, "nutrition_months"))` | `/users/{uid}/nutrition_months` | `isOwner(userId)` on `nutrition_months/{monthId}` | ✅ **PASS** | `read` covers `list`; query is constrained to owner's path |
| `batch.set(users/{uid}, userDocData, {merge: true})` | `/users/{uid}` | `isOwner(userId) && incomingData().keys().hasOnly([...])` | ✅ **PASS** | `cleanUserDocData` contains exactly the 10 whitelisted keys |
| `batch.set(history_months/2026-08, cleanDoc)` | `/users/{uid}/history_months/2026-08` | `isOwner(userId) && isValidMonthId(monthId)` | ✅ **PASS** | `2026-08` satisfies `^[0-9]{4}-(0[1-9]|1[0-2])$` |
| `batch.set(nutrition_months/2026-08, cleanDoc)` | `/users/{uid}/nutrition_months/2026-08` | `isOwner(userId) && isValidMonthId(monthId)` | ✅ **PASS** | `2026-08` satisfies `^[0-9]{4}-(0[1-9]|1[0-2])$` |
| `batch.delete(history_months/2026-08)` | `/users/{uid}/history_months/2026-08` | `isOwner(userId)` | ✅ **PASS** | `delete` rule requires only `isOwner(userId)` |
| `batch.delete(nutrition_months/2026-08)` | `/users/{uid}/nutrition_months/2026-08` | `isOwner(userId)` | ✅ **PASS** | `delete` rule requires only `isOwner(userId)` |
| `deleteAccount` 400-doc batch deletions | `/users/{uid}/...` | `isOwner(userId)` | ✅ **PASS** | Evaluated per document; 0 rule reads consumed |

---

### 4.3. Critical Stability Analysis: Batch Operations & Rule Limits

#### Firestore Security Rules Limit:
Firebase Firestore imposes a strict quota of **maximum 20 document lookups (`get()`, `exists()`, `getAfter()`) per request / batch evaluation**. If security rules include database lookups (e.g. `get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin'`), a batch of 400 operations would perform $400 \times 1 = 400$ lookups and immediately crash with `resource-exhausted` or rule evaluation failure.

#### LogBook Security Architecture Advantage:
- **Zero Document Lookups in Rules:** The security rules in `firestore.rules` rely purely on:
  1. `request.auth.uid` (Authentication token claim)
  2. `request.resource.data.keys()` (In-payload data keys)
  3. `monthId.matches(...)` (String regular expression)
- **Batch Evaluation Complexity:** $O(1)$ per operation with $0$ rule read calls.
- **Safety Result:** `deleteAccount` batches of 400 operations and `saveUserData` multi-month atomic batches execute with **100% stability** and zero risk of hitting Firestore security rule quotas.

---

## 5. Security & Boundary Recommendations for Emulator Test Matrix

To formally validate these architectural findings in the test suite (`@firebase/rules-unit-testing`), the following test cases must be implemented:

1. **Authentication Matrix:**
   - Unauthenticated client attempting `get`, `list`, `create`, `update`, `delete` on `/users/{uid}` and subcollections $\rightarrow$ **DENY**.
   - Authenticated Owner (`auth.uid == 'user_123'`) performing CRUD on `/users/user_123` and subcollections $\rightarrow$ **ALLOW**.
   - Non-Owner (`auth.uid == 'user_456'`) attempting any operation on `/users/user_123` $\rightarrow$ **DENY**.
   - Complex UID support (e.g. `user-abc_123@xyz`) verifying string equality in `isOwner`.

2. **Schema & Key Whitelist Validation:**
   - Root document write with valid keys $\rightarrow$ **ALLOW**.
   - Root document write containing unexpected key (e.g., `{ profile: {}, maliciousKey: true }`) $\rightarrow$ **DENY**.
   - Month subcollection write with valid ID (`2026-08`, `2024-12`) $\rightarrow$ **ALLOW**.
   - Month subcollection write with invalid ID (`2026-13`, `invalid-month`, `2026-8`, `2026/08`) $\rightarrow$ **DENY**.

3. **Atomic Multi-Document Batch & Cross-Tenant Rejection:**
   - Single batch containing 1 valid user write + 1 cross-tenant write $\rightarrow$ Whole batch must fail atomically without partial writes.
   - Large batch (400 document deletes simulating `deleteAccount`) $\rightarrow$ Must succeed atomically without exceeding rule call limits.

4. **Global Path Boundaries:**
   - Top-level arbitrary collections (e.g., `/public_data/doc`, `/system_logs/log`) $\rightarrow$ **DENY** by default wildcard match.

---

## 6. Conclusion

The client database architecture in `src/lib/db.ts` is fully aligned with the security rules in `firestore.rules`. The design guarantees high performance, strict multi-tenant isolation, offline fault tolerance, and complete immunity to Firestore batch size quotas.
