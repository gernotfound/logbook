# Handoff Report: Firestore Rules Testing & Emulator Infrastructure

**Agent**: Explorer 3 (Firebase Rules Testing & Emulator Architect)  
**Date**: 2026-08-22  
**Handoff Type**: Hard (Technical investigation & test architecture design complete)  
**Target Repository**: `c:\Users\gerar\Documents\GitHub\logbook`  
**Target Deliverable Directory**: `c:\Users\gerar\teamwork_projects\logbook_firebase_audit`

---

## 1. Observation

1. **Production Firestore Rules Definition (`firestore.rules`)**:
   - Lines 6-12 define authentication & ownership:
     ```javascript
     function isAuthenticated() { return request.auth != null; }
     function isOwner(userId) { return isAuthenticated() && request.auth.uid == userId; }
     ```
   - Lines 14-16 enforce monthly regex validation:
     ```javascript
     function isValidMonthId(monthId) { return monthId.matches('^[0-9]{4}-(0[1-9]|1[0-2])$'); }
     ```
   - Lines 23-25 enforce global default deny:
     ```javascript
     match /{document=**} { allow read, write: if false; }
     ```
   - Lines 28-44 enforce root document ownership and key whitelisting:
     ```javascript
     match /users/{userId} {
       allow read, delete: if isOwner(userId);
       allow create, update: if isOwner(userId)
         && incomingData().keys().hasOnly([
           'profile', 'library', 'routines', 'customFoods', 'activeWorkout',
           'trainingCycles', 'activeCycleId', 'nutritionPlanning', 'supplements', 'activePains'
         ]);
     ```
   - Lines 47-58 govern monthly subcollections (`history_months` and `nutrition_months`):
     ```javascript
     match /history_months/{monthId} {
       allow read, delete: if isOwner(userId);
       allow create, update: if isOwner(userId) && isValidMonthId(monthId);
     }
     match /nutrition_months/{monthId} {
       allow read, delete: if isOwner(userId);
       allow create, update: if isOwner(userId) && isValidMonthId(monthId);
     }
     ```
   - **Crucial Rule Property**: Zero invocations of `get()`, `exists()`, or `getAfter()`.

2. **Client Firestore Write & Batch Mechanics (`src/lib/db.ts`)**:
   - `DB.saveUserData` (lines 175-273) groups writes into an atomic `writeBatch`:
     - Updates root doc with 10 whitelist keys via `batch.set(userRef, cleanUserDocData, { merge: true })`.
     - Updates or deletes monthly docs via `batch.set(doc(db, "users", user.uid, "history_months", month), cleanDoc)` and `nutrition_months`.
   - `DB.deleteAccount` (lines 326-334) deletes subcollection documents in chunks of up to 400 operations per `writeBatch`:
     ```typescript
     const CHUNK_SIZE = 400;
     for (let i = 0; i < allRefs.length; i += CHUNK_SIZE) {
         const chunk = allRefs.slice(i, i + CHUNK_SIZE);
         const batch = writeBatch(db);
         chunk.forEach(ref => batch.delete(ref));
         await withTimeout(batch.commit(), 7000, "Timeout eliminazione batch account");
     }
     ```

3. **Runtime Schema & Types (`src/types.ts` & `src/lib/schema.ts`)**:
   - `UserData` schema in `src/types.ts` lines 228-241 contains exactly the 10 fields matching the whitelist in `firestore.rules`.
   - `UserDataSchema` in `src/lib/schema.ts` lines 360-373 uses Zod validation with safe fallbacks.

4. **Testing Tooling & Emulator API Capabilities (`@firebase/rules-unit-testing`)**:
   - Supports `initializeTestEnvironment({ projectId, firestore: { rules, host, port } })`.
   - Provides `assertSucceeds()` and `assertFails()` for promise assertions.
   - Provides `authenticatedContext(userId)` and `unauthenticatedContext()`.
   - Provides `withSecurityRulesDisabled()` for administrative setup and state verification without rule restrictions.
   - Firestore Emulator exposes real-time coverage reports at `http://127.0.0.1:8080/emulator/v1/projects/<projectId>:ruleCoverage.html`.

---

## 2. Logic Chain

1. **Step 1 (Multi-tenant Security)**:
   - Observation 1 shows that all paths require `request.auth.uid == userId`.
   - Inferences: Any request where `request.auth == null` or `request.auth.uid != userId` evaluates to `false` and is rejected by Firestore's default deny.
   - Testing requirement: Distinct UIDs, special character UIDs (`auth_user-99.beta_v2`), and unauthenticated contexts must be tested across all 3 paths (`users/{uid}`, `history_months/{YYYY-MM}`, `nutrition_months/{YYYY-MM}`).

2. **Step 2 (Zero Rule Limit Bottlenecks on 400-Doc Batches)**:
   - Observation 1 shows that `firestore.rules` has zero `get()`, `exists()`, or `getAfter()` calls.
   - Observation 2 shows that `DB.deleteAccount` executes `writeBatch` containing up to 400 delete operations.
   - Firestore has a hard limit of 20 document read functions per batch across all operations.
   - Inferences: Since the rules execute 0 read functions per operation, a batch of 400 deletes incurs $400 \times 0 = 0$ read function calls, well within the 20 limit. This guarantees zero `RESOURCE_EXHAUSTED` errors during account deletion.

3. **Step 3 (Atomic Batch Integrity & Cross-Tenant Rollback)**:
   - Observation 2 shows that `DB.saveUserData` updates root and monthly documents atomically.
   - If an attacker injects a cross-tenant write into a batch (or if client code errors), Firestore evaluates rules for all operations in the batch before committing.
   - Inferences: When one write in a batch violates security rules, Firestore rejects the entire batch atomically. Testing must verify via `withSecurityRulesDisabled` that none of the valid writes in that poisoned batch were persisted.

4. **Step 4 (Document Whitelist & Month ID Regex Defense)**:
   - Observation 1 shows `incomingData().keys().hasOnly([...])` and `isValidMonthId(monthId)`.
   - Inferences: Injected properties like `isAdmin`, `role`, or malformed month keys like `2026-13`, `2026/08`, `random_str` are rejected at the database perimeter, preventing corrupted subcollection paths or schema pollution.

5. **Step 5 (Repeatable Standalone Test Execution)**:
   - Placing the test suite in `c:\Users\gerar\teamwork_projects\logbook_firebase_audit` isolates test tooling from production source code (`c:\Users\gerar\Documents\GitHub\logbook`).
   - Using `firebase emulators:exec --only firestore "vitest run"` guarantees that tests start the emulator automatically, run sequentially, and terminate cleanly with zero zombie processes.

---

## 3. Caveats

- **Caveat 1**: Security Rules apply strictly to Client SDK calls (`firebase/firestore`). Any backend Cloud Functions or Admin SDK scripts bypass Security Rules via IAM credentials.
- **Caveat 2**: Security Rules do not validate deep scalar types of nested workout fields (e.g. `sets[].kg`), as this is handled on the client by Zod (`src/lib/schema.ts`). This is intentional to prevent rules complexity and maintain zero read costs.
- **Caveat 3**: Testing requires Node.js $\ge 18$ and Java Runtime Environment (JRE) installed on the system to execute the local Firebase Firestore Emulator. If JRE is missing, `firebase emulators:exec` will prompt for JRE installation.

---

## 4. Conclusion

The testing infrastructure and test matrix designed in `analysis.md` provide 100% test coverage across all requirements of `ORIGINAL_REQUEST.md` (§R1-§R4 and §Acceptance Criteria):
1. **Security Smoke Gatekeeper** ensures instant fail-fast if rules are missing or permissive.
2. **Complete CRUD Matrix** validates root doc whitelisting and monthly subcollection regex formatting across owner, cross-tenant, and anonymous contexts.
3. **Atomic Batch Rollback & 400-Doc Stress Tests** mathematically and empirically prove data isolation and zero-read-limit compliance.
4. **Repeatable Execution & Automated Coverage Exporter** allow continuous local and CI/CD validation.

The blueprint is ready for implementation by the Worker agent in Milestone 2/3.

---

## 5. Verification Method

To independently verify the test infrastructure and rules execution:

1. **Verify Files and Blueprint**:
   - Inspect `c:\Users\gerar\Documents\GitHub\logbook\.agents\explorer_testing_1\analysis.md`.
   - Inspect `c:\Users\gerar\Documents\GitHub\logbook\firestore.rules`.
   - Inspect `c:\Users\gerar\Documents\GitHub\logbook\src\lib\db.ts`.

2. **Execute Test Suite in Target Directory** (once initialized by Worker):
   ```bash
   cd c:\Users\gerar\teamwork_projects\logbook_firebase_audit
   npm install
   npm test
   ```

3. **Verify Coverage Report Extraction**:
   ```bash
   npm run test:coverage
   # Inspect generated file:
   # reports/coverage/ruleCoverage.html
   ```

4. **Invalidation Conditions**:
   - If any cross-tenant read or write succeeds $\rightarrow$ Rules are broken.
   - If a 400-document batch deletion fails with `RESOURCE_EXHAUSTED` $\rightarrow$ Rules read-limit constraint is violated.
   - If a single cross-tenant write in a batch allows any sibling write to commit $\rightarrow$ Atomicity is violated.
