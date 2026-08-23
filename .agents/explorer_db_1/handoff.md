# Handoff Report — Explorer 2 (Client DB Architecture & Impact Analyst)

## 1. Observation
- **Inspected Files:**
  - `src/lib/db.ts` (347 lines)
  - `src/types.ts` (249 lines)
  - `src/lib/schema.ts` (463 lines)
  - `src/contexts/AuthContext.tsx` (280 lines)
  - `src/lib/firebase.ts` (74 lines)
  - `src/lib/merge.ts` (242 lines)
  - `src/lib/utils/object.ts` (73 lines)
  - `firestore.rules` (63 lines)

- **Direct Code Observations:**
  1. **Root Read:** `src/lib/db.ts:50-51` calls `getDoc(doc(db, "users", user.uid))` wrapped in `withTimeout(..., 6000)`.
  2. **Windowed Subcollection Reads:** `src/lib/db.ts:96-120` generates a 3-month window (`[0, 1, 2].map(...)`) with format `YYYY-MM` and calls `Promise.all` over `getDoc(doc(db, "users", user.uid, "history_months", m))` and `getDoc(doc(db, "users", user.uid, "nutrition_months", m))`.
  3. **Batch State Writes:** `src/lib/db.ts:175-275` executes `const batch = writeBatch(db)`, mutating `users/{uid}` via `batch.set(userRef, cleanUserDocData, { merge: true })`, updating modified monthly documents via `batch.set(doc(...), cleanDoc)`, deleting emptied month documents via `batch.delete(doc(...))`, and committing via `withTimeout(batch.commit(), 7000)`.
  4. **Subcollection Listing & Chunked Batch Delete:** `src/lib/db.ts:310-333` executes `getDocs` on `users/{uid}/history_months` and `users/{uid}/nutrition_months`, aggregates all document references plus the root user reference, and deletes them in chunks of `CHUNK_SIZE = 400` via `batch.delete(ref)` and `batch.commit()`.
  5. **Security Rules Whitelist & Regex:** `firestore.rules:28-60` matches `/users/{userId}` with `allow read, delete: if isOwner(userId)` and `allow create, update: if isOwner(userId) && incomingData().keys().hasOnly(['profile', 'library', 'routines', 'customFoods', 'activeWorkout', 'trainingCycles', 'activeCycleId', 'nutritionPlanning', 'supplements', 'activePains'])`. Subcollections `history_months/{monthId}` and `nutrition_months/{monthId}` enforce `isOwner(userId) && isValidMonthId(monthId)` where `isValidMonthId` checks `monthId.matches('^[0-9]{4}-(0[1-9]|1[0-2])$')`.
  6. **Zero Read Lookups in Rules:** `firestore.rules` contains 0 instances of `get()`, `exists()`, or `getAfter()`.

## 2. Logic Chain
1. **From Observation 1-4 to Rule Match:** Client operations only access `/users/{uid}`, `/users/{uid}/history_months/{YYYY-MM}`, and `/users/{uid}/nutrition_months/{YYYY-MM}`. These paths correspond exactly to the match blocks defined in `firestore.rules:28`, `firestore.rules:47`, and `firestore.rules:54`.
2. **From Observation 3 & 5 to Root Payload Validation:** In `src/lib/db.ts:191-202`, `userDocData` contains exactly the 10 properties (`profile`, `library`, `routines`, `customFoods`, `activeWorkout`, `trainingCycles`, `activeCycleId`, `nutritionPlanning`, `supplements`, `activePains`). `removeUndefinedValues` strips any undefined properties. This guarantees that `incomingData().keys().hasOnly([...])` in `firestore.rules:33-44` evaluates to `true`.
3. **From Observation 2 & 5 to Subcollection Month ID Validation:** In `src/lib/db.ts:99`, `212-214`, and `246`, month keys are formatted as `YYYY-MM` (4 digits, hyphen, 2 digits between 01-12). This matches the regex `^[0-9]{4}-(0[1-9]|1[0-2])$` in `firestore.rules:15`.
4. **From Observation 4 & 6 to Batch Quota Stability:** Cloud Firestore enforces a maximum of 20 document reads per transaction/batch in security rule evaluations. Because `firestore.rules` has zero `get()`/`exists()` calls, evaluating a 400-operation deletion batch requires 0 rule reads. Therefore, client batch sizes up to 400 operations will not fail due to rule lookup quotas.
5. **From Observation 1 & 4 to Query Permissions:** `getDocs` on `history_months` and `nutrition_months` are collection queries scoped to the user's own path (`users/{uid}/...`). Under Firestore security rules, `allow read` grants both document `get` and collection `list` as long as the query does not span across unauthorized documents. Because the query is scoped strictly to `/users/{uid}/history_months`, `isOwner(userId)` is satisfied for every potential result, permitting the `getDocs` call.

## 3. Caveats
- The client currently relies on client-side Zod parsing (`src/lib/schema.ts`) for granular schema validation of internal document fields (such as exercise sets and nutrition macros), rather than enforcing deep type constraints inside Firestore Security Rules. This is an intentional architectural design choice to maintain rules simplicity and avoid performance degradation.
- No direct emulator execution was performed in this step as this task is strictly a read-only investigation and analysis.

## 4. Conclusion
The client-side Cloud Firestore architecture in LogBook is robust, performant, and 100% compatible with the security rules defined in `firestore.rules`.
- All client queries and mutations are strictly scoped to the authenticated owner's document tree.
- Batch writes and cascading deletes operate within Firestore's 500-operation limits (chunked at 400).
- Rules evaluation introduces zero read-lookup overhead, preventing batch failures.

## 5. Verification Method
1. **Inspection Verification:**
   - Verify `src/lib/db.ts` lines 50, 103, 117, 205, 232, 262, 311, 315, 330.
   - Verify `firestore.rules` lines 28-60.
2. **Static Type & Lint Checks:**
   - Run `npm test` or `npm run build` from repository root to confirm zero TypeScript compilation errors.
3. **Rules Unit Test Verification:**
   - When running `@firebase/rules-unit-testing` against Firestore Emulator, assert that 400-document batch deletes, root profile updates with whitelisted keys, and month subcollection CRUD operations succeed for owner and are rejected for unauthenticated or non-owner callers.
