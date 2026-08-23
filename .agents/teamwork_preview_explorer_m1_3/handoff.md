# Handoff Report: Explorer M1-3 (Strict LocalStorage Validation - R4)

## 1. Observation

### File Paths & Code Structure
- **Target Hook**: `src/hooks/useLocalStorage.ts` (Lines 1–26)
  - Current implementation:
    ```typescript
    import { useState, useEffect } from 'react';

    export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
        const [storedValue, setStoredValue] = useState<T>(() => {
            const item = window.localStorage.getItem(key);
            if (item === null) return initialValue;

            try {
                return JSON.parse(item) as T;
            } catch (error) {
                console.error(`Errore di parsing del localStorage key "${key}":`, error);
                return initialValue;
            }
        });
        // ...
    ```
- **Callers in `src/`**:
  - `src/App.tsx:28`: `const [activeTab, setActiveTab] = useLocalStorage(LOCAL_STORAGE_ACTIVE_TAB, 'home');`
  - `src/App.tsx:29`: `const [trainingSubTab, setTrainingSubTab] = useLocalStorage(LOCAL_STORAGE_TRAINING_TAB, 'session');`
  - `src/App.tsx:30`: `const [nutritionSubTab, setNutritionSubTab] = useLocalStorage(LOCAL_STORAGE_NUTRITION_TAB, 'meals');`
  - `src/App.tsx:31`: `const [dataSubTab, setDataSubTab] = useLocalStorage(LOCAL_STORAGE_DATA_TAB, 'measurements');`
- **Existing Test Coverage**:
  - `tests/use_local_storage.test.tsx` (11 tests covering null key, primitives, object/array parsing, syntax errors, and setItem errors).
  - `tests/challenger_r2_r3_r4_adversarial.test.tsx` (Part 3: 16 tests covering corrupt payload matrices and self-healing).
- **Verification Baselines**:
  - `npm test`: 26 test files, 475 tests passed.
  - `npm run lint`: 0 errors.
  - `npm run build`: `tsc --noEmit && vite build` succeeded without errors.

---

## 2. Logic Chain

1. **Vulnerability Identification**:
   - In `src/hooks/useLocalStorage.ts`, raw `JSON.parse` does not validate payload shape. A stored value of `{"unexpectedKey": 123}` or `"invalid_tab_name"` parses successfully but corrupts the React component state relying on specific types.
2. **Architectural Alignment**:
   - `AGENTS.md` (Section 2, Storage Tier 3) dictates that `useLocalStorage` must support optional Zod validation (`schema.safeParse`). If validation fails, `initialValue` must be returned and a warning logged.
3. **Design Formulation**:
   - Extend signature to `export function useLocalStorage<T>(key: string, initialValue: T, schema?: ZodType<T, any, any>): [T, (value: T) => void]`.
   - In lazy initialization:
     - If `schema` is present, execute `schema.safeParse(parsed)`. On success, return `parseResult.data`. On failure, call `console.warn` and return `initialValue`.
     - If `schema` is absent, return `parsed as T` (preserving backward compatibility).
     - If `JSON.parse` throws, catch `SyntaxError`, log `console.error`, and return `initialValue`.
4. **Self-Healing Assurance**:
   - When invalid data causes fallback to `initialValue`, the existing `useEffect` serializes `initialValue` back to `localStorage`, repairing corrupted keys automatically.

---

## 3. Caveats

- **Scope Boundary**: The 4 existing callers in `src/App.tsx` currently do not pass a Zod schema. Adding schemas to `src/App.tsx` tab states can be considered in a subsequent refinement or left optional as designed.
- **Console Methods**: `JSON.parse` syntax errors log via `console.error` (matching existing unit tests in `tests/use_local_storage.test.tsx`), while Zod schema mismatch errors log via `console.warn` (matching `AGENTS.md` and `ORIGINAL_REQUEST.md`).

---

## 4. Conclusion

- The design for `src/hooks/useLocalStorage.ts` is fully specified, type-safe, and backward-compatible.
- The proposed implementation is documented in `analysis.md`.
- Comprehensive test cases covering Zod schema validation (valid data, schema mismatch, transformations, syntax error precedence, and missing keys) are ready for implementation in `tests/use_local_storage.test.tsx`.

---

## 5. Verification Method

1. **Type Check and Build**:
   ```bash
   npm run build
   ```
   *Expected*: Zero TypeScript compilation errors (`tsc --noEmit`) and successful Vite build.

2. **Linting**:
   ```bash
   npm run lint
   ```
   *Expected*: Zero oxlint errors.

3. **Unit Tests**:
   ```bash
   npx vitest run tests/use_local_storage.test.tsx
   ```
   *Expected*: All existing 11 tests plus newly added schema validation tests pass.

4. **Full Test Suite**:
   ```bash
   npm test
   ```
   *Expected*: All 26 test suites and 475+ tests pass cleanly.
