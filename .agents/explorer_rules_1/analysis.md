# Cloud Firestore Security and Stability Audit — Rules & Security Analysis

**Document**: `analysis.md`  
**Author**: Explorer 1 (Rules & Security Best Practices Analyst)  
**Target Architecture**: LogBook PWA — Single-User Personal Fitness & Nutrition Application  
**Repository**: `c:\Users\gerar\Documents\GitHub\logbook`  
**Date**: 2026-08-22  

---

## 1. Executive Summary & Audit Context

LogBook is an offline-first Personal Web Application (PWA) built with React 19, TypeScript, Vite, Zustand 5, Zod, and Firebase Modular SDK v12 (`firebase/firestore`, `firebase/auth`). It implements a 3-tier storage architecture:
1. **Tier 1 (Cloud - Firestore)**: Remote persistence with monthly bucketing (`users/{uid}`, `history_months/{YYYY-MM}`, `nutrition_months/{YYYY-MM}`).
2. **Tier 2 (Global Async Cache - IndexedDB `idb-keyval`)**: Complete `UserData` state cache (`logbook_cached_user_data`).
3. **Tier 3 (Local Synchronous Storage - `localStorage`)**: Live active workout (`logbook_local_workout`), guest flag (`logbook_is_guest`), and volatile UI states.

The application operates on a strict **single-user / personal sovereign tenancy model**: all data belongs exclusively to the authenticated user (`request.auth.uid == userId`), with zero cross-user sharing, zero public feeds, and zero role-based access delegation (RBAC).

This audit evaluates the current security rules in `firestore.rules`, examines the architectural necessity of avoiding document read functions (`get()`, `exists()`, `getAfter()`) to protect 400-doc `writeBatch` operations during `deleteAccount`, evaluates the division of responsibility between the client-side Zod Gateway and cloud rules, maps all security boundaries and threat vectors, and provides recommendations for the Emulator Suite testing phase.

---

## 2. Current Firestore Security Architecture & Rules Inventory

### 2.1 Full Code of `firestore.rules`

```rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Funzioni helper di sicurezza e autorizzazione
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

    // Default deny globale
    match /{document=**} {
      allow read, write: if false;
    }

    // Documento principale utente: users/{userId}
    match /users/{userId} {
      allow read, delete: if isOwner(userId);
      
      // Scrittura consentita solo con whitelist rigorosa dei campi consentiti
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
        
      // Subcollection Storico Allenamenti Mensile: users/{userId}/history_months/{YYYY-MM}
      match /history_months/{monthId} {
        allow read, delete: if isOwner(userId);
        allow create, update: if isOwner(userId) 
          && isValidMonthId(monthId);
      }
      
      // Subcollection Nutrizione & Misure Mensile: users/{userId}/nutrition_months/{YYYY-MM}
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

### 2.2 Path-by-Path Security Matrix

| Path / Pattern | Operations | Allowed Principal | Conditions & Guardrails |
| :--- | :--- | :--- | :--- |
| `/{document=**}` (Root Fallback) | `read`, `write` | **None** | Explicit `allow read, write: if false;` (Global Default Deny). |
| `/users/{userId}` | `read`, `delete` | Authenticated Owner (`request.auth.uid == userId`) | `isOwner(userId)` |
| `/users/{userId}` | `create`, `update` | Authenticated Owner (`request.auth.uid == userId`) | `isOwner(userId)` **AND** `incomingData().keys().hasOnly(['profile', 'library', 'routines', 'customFoods', 'activeWorkout', 'trainingCycles', 'activeCycleId', 'nutritionPlanning', 'supplements', 'activePains'])` |
| `/users/{userId}/history_months/{monthId}` | `read`, `delete` | Authenticated Owner (`request.auth.uid == userId`) | `isOwner(userId)` |
| `/users/{userId}/history_months/{monthId}` | `create`, `update` | Authenticated Owner (`request.auth.uid == userId`) | `isOwner(userId)` **AND** `monthId.matches('^[0-9]{4}-(0[1-9]|1[0-2])$')` |
| `/users/{userId}/nutrition_months/{monthId}` | `read`, `delete` | Authenticated Owner (`request.auth.uid == userId`) | `isOwner(userId)` |
| `/users/{userId}/nutrition_months/{monthId}` | `create`, `update` | Authenticated Owner (`request.auth.uid == userId`) | `isOwner(userId)` **AND** `monthId.matches('^[0-9]{4}-(0[1-9]|1[0-2])$')` |
| Any unmapped subcollection (e.g. `/users/{userId}/other/...`) | `read`, `write` | **None** | Denied (no match block, falls through to default deny). |
| Any outside collection (e.g. `/admin/...`, `/public/...`) | `read`, `write` | **None** | Denied by global default deny. |

---

### 2.3 Evaluation: Owner-Only Model vs Recursive Wildcard Model

In personal PWA architectures, two primary security rule designs exist:

#### Model A: Pure Recursive Wildcard Model
```rules
match /users/{userId}/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```
* **Pros**:
  - Extremely succinct (3 lines of rules).
  - Automatically covers all newly created subcollections without requiring rules deployment.
  - Zero performance overhead; evaluations are $O(1)$ string comparisons.
* **Cons / Vulnerabilities**:
  - Permits clients to create arbitrary rogue subcollections under their user document (e.g., `/users/{uid}/malicious_cache/junk`), polluting the database.
  - Allows arbitrary document IDs (e.g., non-date keys in monthly collections).
  - Allows arbitrary top-level fields on the root document (e.g., `isAdmin: true` or rogue payloads).

#### Model B: Current Granular Explicit Model (Implemented in `firestore.rules`)
```rules
match /users/{userId} { ... }
match /history_months/{monthId} { ... }
match /nutrition_months/{monthId} { ... }
```
* **Pros**:
  - **Closed World Assumption**: Only strictly permitted collections and subcollections exist.
  - **Document ID Validation**: `isValidMonthId(monthId)` guarantees document keys strictly follow the `YYYY-MM` schema, preventing traversal anomalies or malformed partition keys.
  - **Root Key Whitelist**: `keys().hasOnly(...)` ensures the root user document contains only the 10 authorized domain sub-trees, preventing field injection.
  - **Zero Read Functions**: Maintains $O(1)$ rule evaluation without any cloud read calls.
* **Verdict**: The current Granular Explicit Model is the **gold standard for personal PWAs**. It provides the strict isolation of the recursive wildcard model while eliminating collection pollution and field injection vectors.

---

## 3. Deep Dive: The Strict No-Read-Function Constraint (`get()`, `exists()`, `getAfter()`)

### 3.1 Cloud Firestore Resource Limits on Security Rules

Google Cloud Firestore enforces strict operational resource quotas on Security Rules execution:
1. **Rule Call Limit**: A maximum of **10 `get()` or `exists()` calls per individual rule evaluation**.
2. **Transaction / Batch Aggregate Limit**: A maximum of **20 total document read calls (`get()` or `exists()`) across ALL operations combined within a single atomic `writeBatch` or multi-document transaction**.

Reference: [Firebase Firestore Security Rules Limits Documentation](https://firebase.google.com/docs/firestore/security/rules-conditions#limits).

---

### 3.2 The Architectural Conflict with `DB.deleteAccount()`

In `src/lib/db.ts` (lines 305–345), account deletion is implemented as follows:

```typescript
// src/lib/db.ts:320-333
const allRefs: any[] = [];
histSnap.forEach((d: any) => allRefs.push(d.ref));
nutSnap.forEach((d: any) => allRefs.push(d.ref));
allRefs.push(doc(db, "users", user.uid));

// Chunk in max 400 operations per batch to strictly adhere to Firestore 500 limit
const CHUNK_SIZE = 400;
for (let i = 0; i < allRefs.length; i += CHUNK_SIZE) {
    const chunk = allRefs.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    chunk.forEach(ref => batch.delete(ref));
    await withTimeout(batch.commit(), 7000, "Timeout eliminazione batch account");
}
```

#### The Failure Mechanism:
1. An active user who has used LogBook for 2–3 years accumulates 24–36 `history_months` documents, 24–36 `nutrition_months` documents, and 1 `user` document (total ~50–75 documents). For power users or test suites, this can easily scale up to 400 documents in a single chunk.
2. `DB.deleteAccount` chunks deletions into batches of up to **400 operations** (`CHUNK_SIZE = 400`), respecting Firestore's hard limit of 500 writes per batch.
3. If `firestore.rules` were to contain even **one single `get()` or `exists()` check** (for example, `allow delete: if isOwner(userId) && exists(/databases/$(database)/documents/users/$(userId))`), Firestore evaluates that rule condition for **every operation in the batch**.
4. Execution trace with 400 deletes:
   - Operation 1–20: 20 `exists()` calls executed $\rightarrow$ Limit reached (20/20).
   - Operation 21: The 21st rule lookup is attempted $\rightarrow$ **Firestore rejects the entire `batch.commit()` with `RESOURCE_EXHAUSTED` / `PERMISSION_DENIED` ("Quota exceeded for document lookups in security rules")**.
5. Result: The entire atomic batch is aborted. The account deletion fails completely, trapping the user and violating privacy/GDPR compliance.

---

### 3.3 Proof of Zero-Lookup Sufficiency

Because LogBook organizes data hierarchically under `/users/{userId}/...`, authorization is **purely relational to the path**:
- `request.auth.uid`: Decoded directly from the validated Google Auth JWT (cryptographically signed by Firebase Auth, available in rule context for free, 0 database reads).
- `userId`: Captured directly from the document path URL (`/users/{userId}/...`, 0 database reads).
- Comparison `request.auth.uid == userId` is a pure string equality check evaluated in CPU memory in microseconds with **zero network requests, zero database reads, and zero cost**.

**Conclusion**: Eliminating all `get()`, `exists()`, and `getAfter()` calls from `firestore.rules` is not merely an optimization; it is a **vital architectural invariant** required to guarantee that atomic bulk writes and `deleteAccount` chunking up to 400 documents will never encounter quota exhaustion.

---

## 4. Validation Strategy Evaluation: Client-Side Zod Gateway vs Cloud Schema-in-Rules

### 4.1 Client-Side Zod Gateway (`src/lib/schema.ts`)

LogBook implements an exhaustive runtime validation gateway in `src/lib/schema.ts` (463 lines of TypeScript/Zod code).

Key architectural characteristics:
1. **Defensive Sanitization & Type Coercion**:
   - `safeNumber`: Coerces numeric strings, handles empty strings, catches `NaN` and returns default value.
   - `safeOptionalSleepTime`: Formats sleep duration strings/numbers via `formatSleepTime`.
   - `safeString`, `safeBoolean`, `safeOptionalNullableNumber`: Strict sanitizers with `.catch()` fallbacks.
2. **Deep Domain Modeling**:
   - Models 15+ sub-schemas (`UserProfileSchema`, `ExerciseSchema`, `ExerciseSetSchema`, `SessionExerciseSchema`, `WorkoutSessionSchema`, `NutritionDaySchema`, `FoodSchema`, `TrainingCycleSchema`, `NutritionPlanningSchema`, etc.).
3. **DomainParsers**:
   - Array parsers (`parseHistory`, `parseLibrary`, `parseCustomFoods`, `parseRoutines`, `parseTrainingCycles`, `parseSupplements`) filter out individual corrupt elements with warnings rather than crashing the entire state.
   - Object parsers (`parseProfile`, `parseWorkoutSession`, `parseNutritionPlanning`) fall back gracefully to default schemas.
4. **Offline & Pre-Render Protection**:
   - Sanitizes data retrieved from IndexedDB (`getInitialUserData`) before the first React render in `main.tsx`.
   - Sanitizes data loaded from Firestore (`DB.loadUserData`) before committing to Zustand store.

---

### 4.2 Trade-off Analysis: Zod-on-Client vs Schema-in-Rules

| Dimension | Client-Side Zod Gateway (`schema.ts`) | Cloud Schema-in-Rules (`firestore.rules`) | Evaluation / Verdict |
| :--- | :--- | :--- | :--- |
| **Expression Capability** | Full TypeScript / JavaScript power: regex, array filtering, custom transforms, math, recursive reduction, type coercion. | Firestore Rules language: No loops, no custom functions with recursion, limited map/list operators, no transforms/coercion. | **Zod wins decisively**. Complex fitness domain trees cannot be validated cleanly in rules. |
| **Error Handling & Resilience** | Graceful degradation: Corrupt sets/meals are sanitized or filtered; app continues functioning without crash. | Binary decision: `allow` or `deny`. A single malformed field in a 50KB session rejects the entire write/batch, causing sync failure and data loss. | **Zod wins**. Rules rejection causes sync loops and blocked offline queues. |
| **Offline-First Compatibility** | Operates in-memory inside service worker / browser thread. Validates IndexedDB and offline writes immediately. | Executes only when contacting Firestore cloud servers. Does not protect IndexedDB or offline state. | **Zod wins**. Crucial for offline PWA lifecycle. |
| **Evolution & Version Skew** | Progressive: New fields (e.g. `sleepDeep`, `activePains`) can be deployed in client updates. Older schemas parse seamlessly with `.passthrough()`. | Rigid: Rule changes require cloud deployment. If rules are updated before client or vice-versa, writes from older cached PWA versions fail. | **Zod wins**. Prevents version skew breakage across PWA service workers. |
| **Multi-Tenancy Threat Model** | In a multi-tenant shared app, a malicious user could write bad data to affect other users. | In LogBook, each user writes ONLY to `/users/{request.auth.uid}`. A user writing bad data only affects their own partition. | **Zod is sufficient**. No cross-user poisoning is possible. |
| **Rule Size & Complexity Limits** | No bundle constraint for rules; parsed during client build. | Firestore rules file limit is 256 KB, with expression complexity limits. Deep schema rules quickly exceed limits. | **Zod wins**. Keeps rules lean and lightning fast. |

---

### 4.3 Optimal Boundary Division

The optimal security architecture for LogBook is a **Hybrid Perimeter Defense**:
- **Firestore Rules (Cloud Boundary)**:
  - Enforce **Tenancy & Authorization** (`isOwner(userId)`).
  - Enforce **Path Invariants** (`isValidMonthId(monthId)`).
  - Enforce **Top-Level Root Document Keys** (`keys().hasOnly([...])`).
  - Strict global **Default Deny** on unmapped collections.
- **Zod Gateway (Client Boundary)**:
  - Enforce **Deep Structural Validation** (nested arrays, objects, sets, reps, nutrients).
  - Enforce **Sanitization & Coercion** (type casting, `NaN` mitigation, string trimming).
  - Enforce **Graceful Degradation** (DomainParsers item-by-item recovery).

---

## 5. Security Boundaries & Threat Vector Analysis

### 5.1 Comprehensive Threat Matrix

| Threat / Attack Vector | Attack Description | Mitigation Mechanism | Effectiveness |
| :--- | :--- | :--- | :--- |
| **T1: Cross-Tenant Read** | Authenticated User A (`uid_A`) attempts `getDoc(doc(db, "users", "uid_B"))` or reads victim's subcollections. | `isOwner(userId)` evaluates `request.auth.uid == "uid_B"` $\rightarrow$ `false`. | **100% Blocked** by Firestore Rules. |
| **T2: Cross-Tenant Write / Overwrite** | Authenticated User A attempts `setDoc` / `updateDoc` / `deleteDoc` on `/users/uid_B/...`. | `isOwner(userId)` evaluates `request.auth.uid == "uid_B"` $\rightarrow$ `false`. | **100% Blocked** by Firestore Rules. |
| **T3: Unauthenticated / Guest Read or Write** | Non-authenticated client or anonymous scraper attempts to read or write any document. | `isAuthenticated()` evaluates `request.auth != null` $\rightarrow$ `false`. All rules deny. | **100% Blocked** by Firestore Rules. |
| **T4: Mixed-Tenant Batch Poisoning** | Attacker creates a `writeBatch` containing 1 valid write to `/users/uid_A` and 1 malicious write to `/users/uid_B`. | Firestore evaluates rules for all operations in the batch atomically. Operation B fails $\rightarrow$ entire batch is rolled back. No partial writes occur. | **100% Blocked** (Atomic Transaction Invariant). |
| **T5: Rogue Collection Injection** | Attacker attempts to write to `/admin`, `/public`, `/config`, or `/system_data`. | Global fallback `match /{document=**} { allow read, write: if false; }` rejects all non-matched paths. | **100% Blocked** by Default Deny. |
| **T6: Rogue Subcollection Creation** | Attacker attempts to write to `/users/uid_A/malicious_subcol/doc1`. | Rules under `/users/{userId}` only define `history_months` and `nutrition_months`. Unmatched subcollections fall through to global deny. | **100% Blocked**. |
| **T7: Subcollection Path Traversal / Malformed Month ID** | Attacker attempts to create `/users/uid_A/history_months/../../../admin` or invalid month `history_months/2026-99`. | `isValidMonthId(monthId)` enforces `^[0-9]{4}-(0[1-9]|1[0-2])$`. Non-conforming IDs are denied. | **100% Blocked**. |
| **T8: Root Document Field Injection** | Attacker attempts to inject `{ isAdmin: true, role: 'root', balance: 999999 }` into `/users/uid_A`. | `incomingData().keys().hasOnly(['profile', 'library', 'routines', 'customFoods', 'activeWorkout', 'trainingCycles', 'activeCycleId', 'nutritionPlanning', 'supplements', 'activePains'])` rejects any payload with unrecognized keys. | **100% Blocked**. |
| **T9: Document Size Denial-of-Service** | Attacker attempts to store a massive 50MB payload to exhaust Firestore storage. | 1. Client-side guard `checkDocSize` throws if JSON size > 950KB.<br>2. Cloud Firestore strictly enforces a hard 1MB document size limit natively. | **100% Blocked**. |
| **T10: Local State Injection (Guest Mode)** | Unauthenticated user attempts to trigger cloud synchronization. | `src/store/useAppStore.ts` and `src/contexts/AuthContext.tsx` do not invoke `DB.saveUserData` unless `auth.currentUser` is present. | **100% Mitigated** in application architecture. |

---

## 6. Client SDK vs Firebase Admin SDK / IAM Boundary

It is essential to distinguish the scope and jurisdiction of Cloud Firestore Security Rules:

1. **Client SDK (`firebase/firestore`)**:
   - Used by the LogBook React PWA frontend in the user's browser.
   - Every single read, write, query, and batch operation initiated by the Client SDK is **strictly evaluated and governed by `firestore.rules`**.
   - Client requests carry the user's Firebase Auth JWT (`request.auth`).
2. **Admin SDK (`firebase-admin`) / Google Cloud IAM**:
   - Used exclusively in backend server environments (e.g. Google Cloud Functions, Cloud Run, server-side migration scripts).
   - **Bypasses Security Rules entirely**. Access permissions are governed by Google Cloud IAM roles (e.g. `roles/datastore.user`, `roles/firebase.admin`).
   - LogBook currently has **no server-side Admin SDK** (it is a 100% serverless static PWA hosted on Vercel connecting directly to Firebase).
   - Therefore, `firestore.rules` is the **sole and ultimate security perimeter** protecting the database against unauthorized access or tampering.

---

## 7. Rules Deployment, Rollback, and Lifecycle Recommendations

### 7.1 Separation from Vercel Continuous Deployment

- **Vercel Deployment**: LogBook uses zero-config CI/CD on Vercel triggered by `git push` to `main`. This builds and serves the static frontend assets (`dist/`).
- **Firebase Rules Deployment**: Security rules (`firestore.rules`) are **NOT** automatically deployed by Vercel. They reside in Google Cloud Firestore infrastructure and must be managed via the Firebase CLI.

---

### 7.2 Safe Deployment Protocol

To deploy security rules safely without disrupting production users:

```bash
# 1. Validate rules syntax and run Emulator Suite tests locally
npm run test:rules   # (or firebase emulators:exec)

# 2. Deploy rules to Firestore production project
firebase deploy --only firestore:rules --project <PROJECT_ID>
```

---

### 7.3 Instant Rollback Strategy

Firebase maintains an immutable, versioned release history of Firestore Security Rules in the Firebase Console (*Firestore Database* $\rightarrow$ *Rules* $\rightarrow$ *Rules release history*).
- If an unexpected rule regression occurs:
  1. Navigate to Firebase Console $\rightarrow$ Firestore $\rightarrow$ Rules.
  2. Select the previous stable release timestamp.
  3. Click **"Rollback to this version"** to instantly revert (propagation occurs globally within seconds).

---

## 8. Summary & Input to Emulator Testing Matrix

Based on this audit, the upcoming **Emulator Suite Test Matrix** (Requirement R3) must verify:

1. **Owner CRUD Matrix**:
   - `get`, `list`, `create`, `update`, `delete` allowed on `/users/{uid}`, `/users/{uid}/history_months/{YYYY-MM}`, and `/users/{uid}/nutrition_months/{YYYY-MM}` for owner (`auth.uid == uid`).
2. **Adversarial Non-Owner & Anonymous Matrix**:
   - All CRUD operations strictly denied for unauthenticated users (`auth == null`).
   - All CRUD operations strictly denied for cross-tenant users (`auth.uid == uid_B` accessing `/users/uid_A/...`).
   - Mixed UID tokens tested (e.g. `user-123_abc.xyz`).
3. **Root Key Whitelist Enforcement**:
   - Write to `/users/{uid}` with valid keys passes.
   - Write to `/users/{uid}` with unauthorized key (e.g. `isAdmin`, `extraField`) is rejected.
4. **Subcollection Month ID Regex Enforcement**:
   - Month IDs matching `YYYY-MM` (e.g. `2026-08`, `2024-01`, `2025-12`) pass.
   - Invalid month IDs (e.g. `2026-13`, `2026-00`, `invalid_month`, `2026-8`) are rejected.
5. **Outside Path Deny**:
   - Writes/reads to `/admin`, `/public`, `/users/{uid}/other_col` are rejected.
6. **Atomic Batch Integrity & 400-Doc Capacity**:
   - Verify that 400 document deletes in a single `writeBatch` succeed with 0 rule resource errors (confirming 0 `get()`/`exists()` invocations).
   - Verify that a batch with 1 cross-tenant write fails atomically with 0 partial writes.
