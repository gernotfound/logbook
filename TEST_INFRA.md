# Test Infrastructure & Strategy: Guest Mode & Global Catalog Resolution

## 1. Test Philosophy & Architecture
LogBook employs an **opaque-box, multi-tiered End-to-End (E2E) testing methodology** for catalog resolution and guest mode lifecycle. The core testing tenets are:

1. **Opaque-Box Contract Verification**: Tests interact with public APIs (`catalogService`, `deltaResolver`, `mergeUserData`, `hasUserData`, `DB.saveUserData`, `useAppStore`) and observe deterministic inputs/outputs rather than mocking internal helper mutations.
2. **Offline-First & Zero-Flash Resilience**: Tests enforce that guest cold starts and catalog resolution resolve bundled seed data synchronously or instantaneously on the first frame, guaranteeing that views never transition through an empty list (`[]`).
3. **Strict Storage Delta Isolation**: Tests verify that Firestore personal user documents (`users/{uid}`) and user cache store **strictly deltas** (custom items, overrides, hidden IDs) and never serialize or duplicate the 176+ static bundled catalog items.
4. **Deterministic Merge Guarantee**: Tests prove that when a guest user links a Google account, custom data and overrides are non-destructively merged into the cloud document with guest priority on ID collision and zero seed duplicates.

---

## 2. 4-Tier Coverage Matrix (`tests/e2e_guest_catalog.test.ts`)

| Tier | Test ID | Description | Primary Invariants Verified |
|---|---|---|---|
| **Tier 1: Feature Coverage** | `T1.1` | Cold start guest session with empty storage | `getCachedCatalog()` immediately resolves bundled seed catalog (100+ exercises, 100+ foods, v1.0.0 manifest). |
| | `T1.2` | Specific known standard exercises verification | Exact existence of "Panca Piana Bilanciere", "Squat con Bilanciere", "Stacchi da Terra (Deadlift)" with muscle/tracking properties. |
| | `T1.3` | Specific known standard foods verification | Exact existence of "Petto di Pollo Crudo" (103 kcal, 23g pro, 1.2g fat), "Petto di Tacchino Crudo", "Vitello Magro Crudo". |
| | `T1.4` | Flat store contract resolution | `resolveEffectiveExercises` & `resolveEffectiveFoods` produce ready-to-consume flat arrays for views (`isDefault: true`, `isCustom: false`). |
| | `T1.5` | Zero-flash transition (Seed -> IDB -> Remote Sync) | Catalog items remain continuously available during local storage warm-up and Firestore manifest sync without empty list glitches. |
| | `T1.6` | Remote manifest version upgrade | Sync gracefully updates local cache when remote manifest increment (`v1.0.0` $\rightarrow$ `v1.1.0`) is detected. |
| **Tier 2: Boundary & Corner Cases** | `T2.1` | Corrupted IndexedDB catalog data | Invalid non-object data in IndexedDB is caught and automatically recovered via clean bundled seed fallback. |
| | `T2.2` | Missing or undefined `catalogOverrides` | `undefined`, `null`, or `{}` overrides resolve seamlessly with 100% standard catalog items. |
| | `T2.3` | Zero custom items | Full catalog returned with uniform default flags without crashing or generating synthetic items. |
| | `T2.4` | Partial & idempotent override operations | Unhiding non-hidden items, hiding non-existent items, and duplicate hide calls are safely handled without data corruption. |
| | `T2.5` | Partial macro/field overrides | Overrides that update only a subset of fields (e.g. carbs only) preserve all other base catalog properties. |
| | `T2.6` | Schema parsing resilience | `UserDataSchema` safely parses and sanitizes nested `catalogOverrides` structures. |
| **Tier 3: Cross-Feature Combinations** | `T3.1` | Custom exercise + Exercise override + Hidden exercise | Custom item is ordered first, base item has modified notes/weight, hidden item is excluded from effective library. |
| | `T3.2` | Custom food + Food override + Hidden food | Custom food is ordered first (`isCustom: true`), modified macros reflected, hidden food excluded from effective foods. |
| | `T3.3` | Routine & workout session with mixed exercise sources | Routine built with base + modified + custom exercises executes and saves into `history` with `activeWorkout: null`. |
| | `T3.4` | Meal logging with mixed food sources & macro math | Daily nutrition log sums macros from base, modified, and custom foods using exact `quantity / baseQty` ratios. |
| **Tier 4: Real-World Scenarios** | `T4.1` | Full guest lifecycle $\rightarrow$ Google account linking | Deterministic merge combines cloud profile, custom items, routines, history, nutrition, and preserves `catalogOverrides`. |
| | `T4.2` | Cloud persistence delta isolation | `DB.saveUserData` extracts and saves strictly 1 custom exercise and 1 custom food, preventing 176+ seed duplication in Firestore. |
| | `T4.3` | Fresh Google account linking with empty cloud doc | Guest deltas are written to fresh Firestore doc without bloating payload size (< 10 KB). |
| | `T4.4` | `hasUserData` precision | Returns `false` on pristine cold start with global catalog; returns `true` only when user creates real data. |
| | `T4.5` | Legacy migration utilities | Monolithic legacy `library` arrays are cleanly split into user custom exercises and `catalogOverrides`. |

---

## 3. Test Runner & Verification Commands

### Run Dedicated Guest Catalog E2E Suite:
```bash
npx.cmd vitest run tests/e2e_guest_catalog.test.ts
```

### Run Full Test Suite:
```bash
npm.cmd test
```

### Run Linter:
```bash
npx.cmd oxlint tests/e2e_guest_catalog.test.ts
```

---

## 4. Test Environment Details
- **Test Framework**: Vitest 4.1.10
- **Environment**: jsdom
- **Storage Emulation**:
  - IndexedDB: `idb-keyval` in-memory mock (`idbStore`)
  - LocalStorage: Mocked synchronous key-value store (`localStorageMock`)
- **Backend Emulation**: Firebase Firestore `writeBatch` spy & document snapshot mocks
- **Schema Validation**: Zod runtime parsing via `src/lib/schema.ts`
