# Deep Investigation & Architectural Analysis: Firestore Serialization Optimization (R3)

## 1. Executive Summary

In Milestone M1, Requirement R3 addresses a major performance bottleneck and risk in `src/lib/db.ts`: the repeated invocation of `JSON.parse(JSON.stringify(...))` to strip `undefined` properties prior to committing batches to Google Cloud Firestore.

Firestore's Web SDK strictly rejects JavaScript `undefined` field values in `doc()` or `batch.set()` payloads, throwing unhandled exceptions (`Unsupported field value: undefined`). To prevent crashes, `src/lib/db.ts` previously serialized entire user documents and monthly subcollection buckets into JSON strings and parsed them back into new object graphs.

This deep investigation provides:
1. A complete inventory of all `JSON.parse(JSON.stringify(...))` occurrences across the codebase.
2. An in-depth inspection of the serialization call sites in `src/lib/db.ts` and the performance / correctness defects of JSON round-tripping.
3. The architectural design and exact implementation for a zero-string-allocation, high-performance recursive `removeUndefinedValues` utility in `src/lib/utils/object.ts` (re-exported via `src/lib/logic.ts`).
4. Exact code diffs and migration specifications for `src/lib/db.ts`.
5. An exhaustive unit test suite covering primitives, plain objects, arrays, nested collections, special types (`Date`, `FieldValue`), circular references, and edge cases.

---

## 2. Codebase Inventory of `JSON.parse(JSON.stringify(...))`

A full repository scan (`grep_search`) identified 5 occurrences of `JSON.parse(JSON.stringify(...))` across 2 files:

| File Path | Line(s) | Context / Purpose | Nature |
|-----------|---------|-------------------|--------|
| `src/lib/db.ts` | 183 | `const cleanUserDocData = JSON.parse(JSON.stringify(userDocData));` | Firestore payload sanitization for main user document `users/{uid}` |
| `src/lib/db.ts` | 210 | `const cleanDoc = JSON.parse(JSON.stringify(newHistMonths[month]));` | Firestore payload sanitization for history subcollection `users/{uid}/history_months/{YYYY-MM}` |
| `src/lib/db.ts` | 240 | `const cleanDoc = JSON.parse(JSON.stringify(newNutMonths[month]));` | Firestore payload sanitization for nutrition subcollection `users/{uid}/nutrition_months/{YYYY-MM}` |
| `src/components/Training/planning/CycleEditor.tsx` | 36 | `initialCycle?.routines ? JSON.parse(JSON.stringify(initialCycle.routines)) : []` | Deep cloning `routines` array in React component state initialization |
| `src/components/Training/planning/CycleEditor.tsx` | 53 | `setCycleRoutines(initialCycle.routines ? JSON.parse(JSON.stringify(initialCycle.routines)) : []);` | Deep cloning `routines` array on prop updates |

The 3 occurrences in `src/lib/db.ts` represent the hot-path persistence serialization pipeline.

---

## 3. Deep-Dive Inspection of `src/lib/db.ts`

### 3.1 Why Firestore Rejects `undefined`
Firebase Firestore SDK v12 rejects any `undefined` values anywhere in a document map. For instance:
- An optional field set to `undefined` (e.g. `{ notes: undefined }` or `{ rating: undefined }`)
- An optional property omitted or set to `undefined` in a nested exercise or workout set (e.g. `{ rpe: undefined }`)
- A measurement object where only some body metrics were recorded (e.g. `{ waist: 82, hips: undefined }`)

When Firestore encounters `undefined`, it fails immediately:
```
FirebaseError: Function WriteBatch.set() called with invalid data. Unsupported field value: undefined (found in field ...)
```

### 3.2 The 3 Call Sites in `src/lib/db.ts`

#### Call Site 1: Main User Document (`users/{uid}`) — Line 183
```typescript
// Line 172-185:
const userDocData = {
    profile: state.profile || {},
    library: state.library || [],
    routines: state.routines || [],
    customFoods: state.customFoods || [],
    activeWorkout: state.activeWorkout || null,
    trainingCycles: state.trainingCycles || [],
    activeCycleId: state.activeCycleId !== undefined ? state.activeCycleId : null,
    nutritionPlanning: state.nutritionPlanning || null,
    supplements: state.supplements || []
};
const cleanUserDocData = JSON.parse(JSON.stringify(userDocData));
checkDocSize(cleanUserDocData, "User Profile");
batch.set(userRef, cleanUserDocData, { merge: true });
```
- **Volume & Content**: Contains the full exercise library (dozens of exercises with muscles, categories, equipment, notes), all routine blueprints, active cycles, food items, and nutrition targets.
- **Problem**: In a mature user profile, `userDocData` contains hundreds of nested objects. Stringifying and re-parsing this entire tree every time an exercise, profile field, or routine is updated consumes significant CPU time and creates major memory garbage.

#### Call Site 2: Monthly Workout History Subcollection (`history_months/{YYYY-MM}`) — Line 210
```typescript
// Line 208-215:
Object.keys(newHistMonths).forEach(month => {
    if (!deepEqual(newHistMonths[month], oldHistMonths[month])) {
        const cleanDoc = JSON.parse(JSON.stringify(newHistMonths[month]));
        checkDocSize(cleanDoc, `History ${month}`);
        batch.set(doc(db, "users", user.uid, "history_months", month), cleanDoc);
        hasWrites = true;
    }
});
```
- **Volume & Content**: Contains up to 31 workout sessions per month, each containing multiple exercises, sets, dropsets, isometries, notes, and metrics.
- **Problem**: Nested sets and sessions frequently have optional fields (`rpe`, `restTime`, `comment`, `targetReps`) that evaluate to `undefined`. Stringifying the entire monthly dictionary of sessions on each save is inefficient.

#### Call Site 3: Monthly Nutrition Subcollection (`nutrition_months/{YYYY-MM}`) — Line 240
```typescript
// Line 238-245:
Object.keys(newNutMonths).forEach(month => {
    if (!deepEqual(newNutMonths[month], oldNutMonths[month])) {
        const cleanDoc = JSON.parse(JSON.stringify(newNutMonths[month]));
        checkDocSize(cleanDoc, `Nutrition ${month}`);
        batch.set(doc(db, "users", user.uid, "nutrition_months", month), cleanDoc);
        hasWrites = true;
    }
});
```
- **Volume & Content**: Contains up to 31 days per month, each with meals, foods, supplement logs, weight, body fat, and body circumference measurements.
- **Problem**: Daily logs have numerous optional measurements (`neck`, `waist`, `hips`, `shoulders`, `chest`, `thighs`, etc.). Unrecorded measurements evaluate to `undefined`.

### 3.3 Bottlenecks & Pitfalls of `JSON.parse(JSON.stringify(...))`

1. **CPU Overhead**: JSON stringification requires traversing the object graph, formatting numbers and strings into valid JSON syntax, and allocating large contiguous strings. JSON parsing then scans the string, runs a lexical tokenizer, parses the grammar, and allocates a duplicate object graph.
2. **Garbage Collection Pressure**: Because LogBook auto-saves with a 1000ms debounce on user keystrokes and logging actions, stringifying tens or hundreds of kilobytes of data creates thousands of short-lived strings and AST allocations, triggering frequent Garbage Collection pauses on mobile devices (iOS Safari & Android).
3. **Data Corruption of Non-JSON Types**:
   - `Date` instances are permanently converted to ISO 8601 strings, losing their `Date` type.
   - Firestore `FieldValue` tokens (such as `serverTimestamp()`, `deleteField()`, `arrayUnion()`, `increment()`) are instances of internal SDK classes. `JSON.stringify` turns them into `{}` or throws, destroying their Firestore functionality.
   - `Uint8Array`, `Blob`, `DocumentReference`, `GeoPoint` are similarly broken by JSON stringification.
   - Values like `BigInt` throw a `TypeError: Do not know how to serialize a BigInt`.

---

## 4. Architecture & Design of `removeUndefinedValues`

### 4.1 Placement in Codebase

Looking at the module structure in `src/lib/`:
- `src/lib/utils/date.ts` -> Date and calendar utilities
- `src/lib/utils/timer.ts` -> Timer calculations
- `src/lib/calc/` -> Domain calculation modules (`bodyFat.ts`, `nutrition.ts`, `planning.ts`, `workout.ts`)
- `src/lib/logic.ts` -> Central aggregation and backward-compatibility export layer

**Decision**: Create `src/lib/utils/object.ts` as a dedicated utility module for object manipulation and sanitization. Re-export `removeUndefinedValues` and `isPlainObject` from `src/lib/logic.ts` (both as named exports and on the `Logic` object) for consistent ergonomics across the application.

### 4.2 Algorithm & Structural Handling

The recursive utility must adhere to the following contract:

```typescript
export function removeUndefinedValues<T>(value: T, seen?: WeakSet<object>): T
```

#### Specification by Data Type:

1. **Primitives & Falsy Values**:
   - `null` -> return `null` immediately.
   - `undefined` -> return `undefined` (if passed as top-level value).
   - `number` (including `0`, `NaN`, `Infinity`), `string` (including `""`), `boolean` (including `false`), `symbol`, `bigint` -> return `value` unchanged.
   - `typeof value !== 'object'` -> return `value` immediately.

2. **Plain Objects (`isPlainObject`)**:
   - Defined as objects whose prototype is `Object.prototype` or `null` (`Object.create(null)`).
   - Create a fresh object `const result: Record<string, any> = {};`.
   - Iterate over own enumerable keys (`Object.keys(value)`).
   - For each key:
     - If `value[key] !== undefined`:
       - Recursively clean: `result[key] = removeUndefinedValues(value[key], visited);`.
     - If `value[key] === undefined`:
       - Key is omitted from `result` (`!(key in result)`).

3. **Arrays**:
   - If `Array.isArray(value)`:
     - Allocate a new array of matching length: `const len = value.length; const result = new Array(len);`.
     - Iterate through indices `0` to `len - 1`:
       - If `value[i] === undefined`: set `result[i] = null` (Firestore arrays cannot contain `undefined`, mapping to `null` prevents array deserialization errors while preserving index positions).
       - Else: `result[i] = removeUndefinedValues(value[i], visited);`.
     - Returns `result`.

4. **Special & Non-Plain Objects (Preserved Intact)**:
   - `Date` instances (`value instanceof Date`): preserved as `Date` references.
   - Firestore `FieldValue`, `DocumentReference`, `Timestamp`, `GeoPoint`: prototype is not `Object.prototype`, so `isPlainObject(value)` is `false`. Returned as-is without modification.
   - `Blob`, `Uint8Array`, `RegExp`, `Map`, `Set`: returned as-is.

5. **Circular Reference Protection**:
   - An optional `seen: WeakSet<object>` tracks visited objects in the current traversal.
   - If `visited.has(value)`, return `value` to immediately break cycles and prevent `RangeError: Maximum call stack size exceeded`.

---

## 5. Complete Implementation Specification

### 5.1 New File: `src/lib/utils/object.ts`

```typescript
/**
 * Object manipulation and sanitization utilities for LogBook.
 */

/**
 * Checks if a value is a plain JavaScript object (created via {} or Object.create(null)).
 * Custom class instances, Dates, RegExps, Firestore FieldValues, DocumentReferences, etc.,
 * return false so their prototype and instance methods are preserved.
 */
export function isPlainObject(value: unknown): value is Record<string, any> {
    if (value === null || typeof value !== 'object') {
        return false;
    }
    const proto = Object.getPrototypeOf(value);
    return proto === null || proto === Object.prototype;
}

/**
 * Recursively sanitizes data structures by removing properties with `undefined` values.
 * Designed for Firestore payloads to avoid "Unsupported field value: undefined" errors
 * without the CPU and GC overhead of JSON.parse(JSON.stringify(...)).
 * 
 * - Primitives (strings, numbers, booleans, null) are returned as-is.
 * - In plain objects, keys with `undefined` values are omitted entirely.
 * - In arrays, elements are recursively cleaned; `undefined` elements are converted to `null`.
 * - Non-plain objects (Date, Firestore FieldValue, RegExp, Blob, etc.) are preserved intact.
 * - Defends against circular references using a WeakSet.
 * 
 * @param value The value or data structure to sanitize.
 * @param seen Internal tracker to prevent infinite loops on circular references.
 * @returns A sanitized clone of the input with no `undefined` properties.
 */
export function removeUndefinedValues<T>(value: T, seen?: WeakSet<object>): T {
    if (value === null || typeof value !== 'object') {
        return value;
    }

    // Guard against circular references
    const visited = seen || new WeakSet<object>();
    if (visited.has(value)) {
        return value;
    }
    visited.add(value);

    // Arrays: recursively sanitize each element
    if (Array.isArray(value)) {
        const len = value.length;
        const result = new Array(len);
        for (let i = 0; i < len; i++) {
            const item = value[i];
            result[i] = item === undefined ? null : removeUndefinedValues(item, visited);
        }
        return result as unknown as T;
    }

    // Plain objects: omit undefined keys and recursively sanitize defined values
    if (isPlainObject(value)) {
        const result: Record<string, any> = {};
        const keys = Object.keys(value);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const val = (value as Record<string, any>)[key];
            if (val !== undefined) {
                result[key] = removeUndefinedValues(val, visited);
            }
        }
        return result as unknown as T;
    }

    // Non-plain objects (Date, FieldValue, RegExp, Blob, DocumentReference, etc.)
    return value;
}
```

### 5.2 Updates to `src/lib/logic.ts`

```typescript
// Add imports:
import { removeUndefinedValues, isPlainObject } from './utils/object';

// Export functions:
export {
    // ... existing exports ...
    removeUndefinedValues,
    isPlainObject
};

// Add to Logic object:
export const Logic = {
    // ... existing properties ...
    removeUndefinedValues,
    isPlainObject,
    // ...
};
```

### 5.3 Replacements in `src/lib/db.ts`

#### Import Addition (Top of `src/lib/db.ts`):
```typescript
import { removeUndefinedValues } from './utils/object';
```

#### Line 183: User Document
```typescript
<<<<
                const cleanUserDocData = JSON.parse(JSON.stringify(userDocData));
                checkDocSize(cleanUserDocData, "User Profile");
                batch.set(userRef, cleanUserDocData, { merge: true });
====
                const cleanUserDocData = removeUndefinedValues(userDocData);
                checkDocSize(cleanUserDocData, "User Profile");
                batch.set(userRef, cleanUserDocData, { merge: true });
>>>>
```

#### Line 210: History Month Document
```typescript
<<<<
                if (!deepEqual(newHistMonths[month], oldHistMonths[month])) {
                    const cleanDoc = JSON.parse(JSON.stringify(newHistMonths[month]));
                    checkDocSize(cleanDoc, `History ${month}`);
                    batch.set(doc(db, "users", user.uid, "history_months", month), cleanDoc);
                    hasWrites = true;
                }
====
                if (!deepEqual(newHistMonths[month], oldHistMonths[month])) {
                    const cleanDoc = removeUndefinedValues(newHistMonths[month]);
                    checkDocSize(cleanDoc, `History ${month}`);
                    batch.set(doc(db, "users", user.uid, "history_months", month), cleanDoc);
                    hasWrites = true;
                }
>>>>
```

#### Line 240: Nutrition Month Document
```typescript
<<<<
                if (!deepEqual(newNutMonths[month], oldNutMonths[month])) {
                    const cleanDoc = JSON.parse(JSON.stringify(newNutMonths[month]));
                    checkDocSize(cleanDoc, `Nutrition ${month}`);
                    batch.set(doc(db, "users", user.uid, "nutrition_months", month), cleanDoc);
                    hasWrites = true;
                }
====
                if (!deepEqual(newNutMonths[month], oldNutMonths[month])) {
                    const cleanDoc = removeUndefinedValues(newNutMonths[month]);
                    checkDocSize(cleanDoc, `Nutrition ${month}`);
                    batch.set(doc(db, "users", user.uid, "nutrition_months", month), cleanDoc);
                    hasWrites = true;
                }
>>>>
```

---

## 6. Comprehensive Unit Testing Strategy

To ensure absolute stability, create `tests/object_sanitization.test.ts` with test cases verifying:

1. **Primitives**:
   - `null` returns `null`
   - `undefined` returns `undefined`
   - `0`, `-0`, `NaN`, `Infinity`, `""`, `false`, `"valid string"` are preserved exactly.
2. **Plain Objects**:
   - Top-level `undefined` properties are removed (`!(key in result)`).
   - Deeply nested `undefined` properties in sub-objects are removed.
   - Properties with `null`, `0`, `false`, `""` are preserved.
   - Objects with `Object.create(null)` prototype are supported and sanitized.
3. **Arrays**:
   - Array of primitives `[1, "a", null, false]` is preserved.
   - Array with `undefined` items `[1, undefined, 2]` maps `undefined` to `null`: `[1, null, 2]`.
   - Array of objects `[{ id: '1', note: undefined }]` becomes `[{ id: '1' }]`.
   - Empty arrays `[]` return empty arrays.
4. **Special Types Preservation**:
   - `Date` instances are preserved as `Date` (not converted to strings).
   - Custom class instances and mock Firestore `FieldValue` objects retain their prototypes and are preserved.
5. **Circular References**:
   - Cyclic objects (e.g. `a.self = a`) do not cause recursion errors or stack overflows.
6. **Firestore Payload Simulation**:
   - Simulating a full `UserData` payload with exercises, sets, workouts, nutrition days, and verify that no `undefined` keys exist anywhere in the output.

---

## 7. Performance & Complexity Comparison

| Metric | `JSON.parse(JSON.stringify(x))` | `removeUndefinedValues(x)` |
|--------|----------------------------------|---------------------------|
| **Time Complexity** | $O(N)$ with large constant factor (string formatting + lexing + parsing) | $O(N)$ direct property traversal |
| **Memory Allocation** | Multiple intermediate string buffers + duplicate object graph | Single pass shallow copy only for objects/arrays containing properties |
| **Garbage Collection Impact** | High (tens of KB of strings per second on rapid inputs) | Minimal (only POJO allocations) |
| **Date Handling** | ❌ Converts `Date` $\rightarrow$ ISO String | ✅ Preserves `Date` instance |
| **FieldValue Handling** | ❌ Destroys Firestore `FieldValue` $\rightarrow$ `{}` | ✅ Preserves `FieldValue` instance |
| **Circular Ref Resilience**| ❌ Throws `TypeError: Converting circular structure to JSON` | ✅ Protected via `WeakSet` |

---

## 8. Verification & Acceptance Criteria Checklist

- [x] All occurrences of `JSON.parse(JSON.stringify` located across the codebase.
- [x] Clear architectural rationale and analysis of `src/lib/db.ts` call sites.
- [x] `removeUndefinedValues` utility designed with full handling of primitives, arrays, plain objects, non-plain objects, and circular references.
- [x] Placement in `src/lib/utils/object.ts` and re-export in `src/lib/logic.ts` defined.
- [x] Exact diffs for `src/lib/db.ts` verified against acceptance criteria (`grep -r "JSON.parse(JSON.stringify" src/lib/db.ts` will return 0 results after replacement).
