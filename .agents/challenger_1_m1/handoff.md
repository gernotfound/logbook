# Challenger Handoff Report — Milestone M1: Catalog Resolution Pipeline

**Agent**: Challenger 1 (Critic, Specialist)  
**Milestone**: M1: Resolution Pipeline & Store Unification  
**Date**: 2026-08-23  
**Working Directory**: `C:\Users\gerar\Documents\GitHub\logbook\.agents\challenger_1_m1`  
**Verdict**: **`REQUEST_CHANGES`**

---

## 1. Observation

Adversarial property testing and stress-testing via `tests/adversarial_catalog_resolution.test.ts` evaluated `getInMemoryCatalog()`, `resolveEffectiveExercises()`, `resolveEffectiveFoods()`, `mergeCatalogOverrides()`, and legacy migration utilities under extreme inputs.

### 1.1 Verified Robust Behaviors
1. **Cold Start & Concurrency**: 50 concurrent invocations of `getCachedCatalog()` and `getInMemoryCatalog()` executed without race conditions, and `getInMemoryCatalog()` returned non-null seed data instantly.
2. **High Scale & Throughput**:
   - Resolving 1,000 global exercises with 500 overrides and 200 hidden IDs executed in `< 10ms`.
   - Resolving 2,000 global foods with 1,000 overrides and 500 hidden items executed in `< 15ms`.
3. **Collision & Normalization**:
   - Custom items colliding with global IDs are positioned first with `isDefault: false` / `isCustom: true`.
   - Numeric food IDs (e.g. `0`) and string IDs (`"0"`) are correctly normalized in hidden sets.
4. **Seed Immutability**: Modifying resolved collections does not mutate `getSeedCatalog()` or subsequent resolutions.

### 1.2 Identified Empirical Vulnerabilities

#### Vulnerability 1: Object Prototype Shadowing / Property Collision in Override Lookup
- **File & Line**: `src/lib/catalog/deltaResolver.ts:53` and `src/lib/catalog/deltaResolver.ts:124`
- **Code**:
  ```typescript
  // Line 53 in resolveEffectiveExercises:
  const override = exerciseOverrides[base.id];

  // Line 124 in resolveEffectiveFoods:
  const override = foodOverrides[foodIdStr];
  ```
- **Observed Behavior**:
  When `base.id` or `foodIdStr` equals any built-in `Object.prototype` property (e.g. `'toString'`, `'valueOf'`, `'constructor'`, `'hasOwnProperty'`), `exerciseOverrides[base.id]` retrieves the prototype function (e.g. `[Function: toString]`).
  Because `Function.prototype.name` exists and equals the function's name (e.g. `"toString"`), `override.name !== undefined` evaluates to `true`.
  Consequently, an exercise with `id: "toString"` has its name silently replaced with `"toString"`, and an exercise with `id: "constructor"` has its name replaced with `"Object"`.
- **Verbatim Test Failure**:
  ```
  AssertionError: expected 'toString' to be 'Exercise ToString'
  Expected: "Exercise ToString"
  Received: "toString"
  ```

#### Vulnerability 2: Non-Defensive Array Spread / `.map` in `mergeCatalogOverrides` on Malformed Data
- **File & Line**: `src/lib/catalog/deltaResolver.ts:368-375`
- **Code**:
  ```typescript
  hiddenExerciseIds: Array.from(new Set([
      ...(overridesA.hiddenExerciseIds || []),
      ...(overridesB.hiddenExerciseIds || []),
  ])),
  hiddenFoodIds: Array.from(new Set([
      ...(overridesA.hiddenFoodIds || []).map(String),
      ...(overridesB.hiddenFoodIds || []).map(String),
  ])),
  ```
- **Observed Behavior**:
  If `overridesA.hiddenExerciseIds` or `overridesA.hiddenFoodIds` is corrupted (e.g. string, number, or boolean from unvalidated/legacy payloads), `(val || [])` evaluates to the truthy non-array primitive, causing `.map` or `...` spread to throw an unhandled `TypeError`.
- **Verbatim Error**:
  ```
  TypeError: (overridesA.hiddenFoodIds || []).map is not a function or its return value is not iterable
  ```

---

## 2. Logic Chain

1. **Root Cause Analysis (Vulnerability 1)**:
   - Plain JavaScript objects (`{}`) inherit from `Object.prototype`.
   - Indexing `exerciseOverrides[base.id]` does not distinguish between own properties and inherited prototype methods.
   - Using `Object.prototype.hasOwnProperty.call(exerciseOverrides, base.id)` or `Object.hasOwn(exerciseOverrides, base.id)` guarantees that only explicit user overrides are evaluated.
2. **Root Cause Analysis (Vulnerability 2)**:
   - In `mergeCatalogOverrides`, `overridesA.hiddenExerciseIds || []` only guards against `null`/`undefined`/`""`/`0`/`false`. If the property contains a non-empty string or integer, it attempts to spread or call `.map` on a non-array, violating defensive programming guidelines in `AGENTS.md`.
   - Applying `Array.isArray(overridesA.hiddenExerciseIds) ? overridesA.hiddenExerciseIds : []` prevents crashes on malformed data.

---

## 3. Caveats

1. **Downstream Integration**:
   - `catalogService.ts` and `deltaResolver.ts` are ready for Milestone M2/M3/M4 integration once these 2 small fixes are applied.
2. **Override Merging Semantics**:
   - `mergeCatalogOverrides` performs a shallow merge of the `exercises` and `foods` dictionaries (i.e. `b`'s override object for an item replaces `a`'s entire override object for that same item). This is standard for map merges, but downstream code should be aware that property-level merging within the same exercise is not performed.

---

## 4. Conclusion & Actionable Fixes

**Verdict**: **`REQUEST_CHANGES`**

The implementation is high quality, highly performant, and correctly architected. Applying the following two concise fixes will make it completely bulletproof:

### Recommended Fix 1: Guard override lookups in `src/lib/catalog/deltaResolver.ts`
```typescript
// In resolveEffectiveExercises (line 53):
const override = Object.prototype.hasOwnProperty.call(exerciseOverrides, base.id)
    ? exerciseOverrides[base.id]
    : undefined;

// In resolveEffectiveFoods (line 124):
const override = Object.prototype.hasOwnProperty.call(foodOverrides, foodIdStr)
    ? foodOverrides[foodIdStr]
    : undefined;
```

### Recommended Fix 2: Defensive array checks in `mergeCatalogOverrides` (`src/lib/catalog/deltaResolver.ts:352-377`)
```typescript
export function mergeCatalogOverrides(
    a?: CatalogOverrides | null,
    b?: CatalogOverrides | null
): CatalogOverrides {
    const overridesA = a || {};
    const overridesB = b || {};

    const hiddenExA = Array.isArray(overridesA.hiddenExerciseIds) ? overridesA.hiddenExerciseIds : [];
    const hiddenExB = Array.isArray(overridesB.hiddenExerciseIds) ? overridesB.hiddenExerciseIds : [];
    const hiddenFoodA = Array.isArray(overridesA.hiddenFoodIds) ? overridesA.hiddenFoodIds : [];
    const hiddenFoodB = Array.isArray(overridesB.hiddenFoodIds) ? overridesB.hiddenFoodIds : [];

    return {
        exercises: {
            ...(overridesA.exercises && typeof overridesA.exercises === 'object' ? overridesA.exercises : {}),
            ...(overridesB.exercises && typeof overridesB.exercises === 'object' ? overridesB.exercises : {}),
        },
        foods: {
            ...(overridesA.foods && typeof overridesA.foods === 'object' ? overridesA.foods : {}),
            ...(overridesB.foods && typeof overridesB.foods === 'object' ? overridesB.foods : {}),
        },
        hiddenExerciseIds: Array.from(new Set([...hiddenExA, ...hiddenExB])),
        hiddenFoodIds: Array.from(new Set([...hiddenFoodA.map(String), ...hiddenFoodB.map(String)])),
    };
}
```

---

## 5. Verification Method

### Test Commands
Run the complete unit and adversarial test suites:
```powershell
npx.cmd vitest run tests/catalog_resolution_pipeline.test.ts tests/adversarial_catalog_resolution.test.ts
```

### Invalidation Conditions
- Any test in `tests/adversarial_catalog_resolution.test.ts` throwing unhandled type errors or misinterpreting `Object.prototype` properties as user overrides.
