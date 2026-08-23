# Handoff Report — Explorer 2 (Milestone M1: Requirement R3)

## 1. Observation

1. **Occurrences of `JSON.parse(JSON.stringify`**:
   - `src/lib/db.ts:183`: `const cleanUserDocData = JSON.parse(JSON.stringify(userDocData));`
   - `src/lib/db.ts:210`: `const cleanDoc = JSON.parse(JSON.stringify(newHistMonths[month]));`
   - `src/lib/db.ts:240`: `const cleanDoc = JSON.parse(JSON.stringify(newNutMonths[month]));`
   - `src/components/Training/planning/CycleEditor.tsx:36`: `initialCycle?.routines ? JSON.parse(JSON.stringify(initialCycle.routines)) : []`
   - `src/components/Training/planning/CycleEditor.tsx:53`: `setCycleRoutines(initialCycle.routines ? JSON.parse(JSON.stringify(initialCycle.routines)) : []);`

2. **Firestore Constraint (Rule 5 in `AGENTS.md`)**:
   - Firebase Firestore SDK throws `FirebaseError: Function WriteBatch.set() called with invalid data. Unsupported field value: undefined` whenever an object containing `undefined` is written.
   - In `src/lib/db.ts`, `saveUserData` runs on a 1000ms debounce loop. On every call, `userDocData`, `newHistMonths[month]`, and `newNutMonths[month]` were being deep-cloned via JSON stringification to strip `undefined` keys.

3. **Codebase Utility Organization**:
   - `src/lib/utils/` currently contains `date.ts` and `timer.ts`.
   - `src/lib/logic.ts` serves as the central aggregation and re-export point.
   - Build (`npm.cmd run build`), lint (`npm.cmd run lint`), and tests (`npm.cmd test`) are active and verified.

---

## 2. Logic Chain

1. *From Observation 1 & 2*: `JSON.parse(JSON.stringify(...))` was introduced in `src/lib/db.ts` to strip `undefined` properties before Firestore writes.
2. *From Observation 2*: While functional for basic POJOs, JSON serialization:
   - Imposes significant CPU and GC overhead on each auto-save cycle.
   - Destroys non-JSON types (e.g. converts `Date` to string, destroys `FieldValue` into `{}`).
   - Throws on `BigInt` or circular references.
3. *From Observation 3*: A dedicated utility `removeUndefinedValues` in `src/lib/utils/object.ts` (re-exported via `src/lib/logic.ts`) can traverse object graphs in $O(N)$ time with zero string allocation.
4. *From Implementation Design*:
   - Primitives and falsy values (`0`, `""`, `false`, `null`, `NaN`) are preserved unchanged.
   - Plain objects have `undefined` keys omitted and defined properties recursively cleaned.
   - Arrays have elements recursively cleaned, converting any bare `undefined` item to `null` to prevent Firestore array write failures.
   - Non-plain objects (`Date`, Firestore `FieldValue`, `Blob`, `DocumentReference`, `RegExp`) are preserved intact.
   - A `WeakSet` tracks visited object references to prevent stack overflow on circular data.
5. *From Acceptance Criteria*: Replacing lines 183, 210, and 240 in `src/lib/db.ts` with `removeUndefinedValues(...)` completely eliminates `JSON.parse(JSON.stringify` in `src/lib/db.ts` while satisfying all Firestore safety requirements.

---

## 3. Caveats

1. In `src/components/Training/planning/CycleEditor.tsx` (lines 36 and 53), `JSON.parse(JSON.stringify(...))` is used for local UI state cloning of `routines`. While outside `src/lib/db.ts`, replacing it with `structuredClone` or a helper is recommended during component refactoring.
2. `checkDocSize` in `src/lib/db.ts` uses `JSON.stringify` to calculate payload size in bytes (`new Blob([JSON.stringify(data)]).size`). This is intentional and necessary for Firestore document quota checking (< 950KB) and should be preserved.

---

## 4. Conclusion

Requirement R3 is fully analyzed and ready for implementation by the builder agent:
1. **New File**: `src/lib/utils/object.ts` exporting `removeUndefinedValues` and `isPlainObject`.
2. **Re-export**: Add `removeUndefinedValues` and `isPlainObject` to `src/lib/logic.ts` (named exports and `Logic` object).
3. **Database Migration**: In `src/lib/db.ts`:
   - Import `removeUndefinedValues` from `./utils/object`.
   - Replace line 183: `const cleanUserDocData = removeUndefinedValues(userDocData);`
   - Replace line 210: `const cleanDoc = removeUndefinedValues(newHistMonths[month]);`
   - Replace line 240: `const cleanDoc = removeUndefinedValues(newNutMonths[month]);`
4. **Testing**: Add `tests/object_sanitization.test.ts` to vitest suite.

Detailed specifications and code diffs are documented in:
`c:\Users\gerar\Documents\GitHub\logbook\.agents\teamwork_preview_explorer_m1_2\analysis.md`

---

## 5. Verification Method

1. **Grep Check**:
   ```powershell
   grep_search "JSON.parse(JSON.stringify" in "src/lib/db.ts"
   ```
   Must return 0 results.

2. **Unit Tests**:
   ```powershell
   npm.cmd run test -- tests/object_sanitization.test.ts
   npm.cmd test
   ```
   Must pass all tests.

3. **Typecheck & Build**:
   ```powershell
   npm.cmd run build
   ```
   Must compile cleanly with zero TypeScript errors (`tsc --noEmit && vite build`).

4. **Lint**:
   ```powershell
   npm.cmd run lint
   ```
   Must pass without errors.
