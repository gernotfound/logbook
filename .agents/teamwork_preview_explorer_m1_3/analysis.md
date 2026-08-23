# Architectural Analysis: Strict LocalStorage Validation (R4) in `src/hooks/useLocalStorage.ts`

## 1. Executive Summary

This report provides a comprehensive architectural analysis and implementation plan for **Requirement R4: Strict LocalStorage Validation** in `src/hooks/useLocalStorage.ts`.

Currently, `useLocalStorage` only performs a raw `JSON.parse(item)` on data retrieved from `window.localStorage`. If the stored value is valid JSON syntax but does not conform to the application's domain model or expected schema (e.g. an unexpected object structure, out-of-range numbers, invalid enum values, or corrupted state), the hook blindly accepts the data and sets it in React state. This creates runtime vulnerabilities and violates the strict storage tiering and runtime defense rules specified in `AGENTS.md` (Section 2: Storage Tier 3 & LocalStorage Parse Strictness).

By enhancing `useLocalStorage` with an optional Zod schema parameter (`schema?: z.ZodType<T, any, any>`), we introduce runtime boundary validation (`schema.safeParse()`), logging warnings on schema violations while falling back to `initialValue`, preserving full backward compatibility for existing schema-less callers.

---

## 2. Codebase Audit & Callers Inventory

### 2.1 Direct Callers in `src/`
Inspection of `src/` via regex/grep search revealed that `useLocalStorage` is currently imported and used exclusively in `src/App.tsx` for tracking persistent navigation states:

| Location | Key Constant | Key Value | Initial Value | Intended Type / Shape |
| :--- | :--- | :--- | :--- | :--- |
| `src/App.tsx:28` | `LOCAL_STORAGE_ACTIVE_TAB` | `'logbook_activeTab'` | `'home'` | `'home' \| 'training' \| 'nutrition' \| 'data' \| 'settings'` |
| `src/App.tsx:29` | `LOCAL_STORAGE_TRAINING_TAB` | `'logbook_trainingSubTab'` | `'session'` | `'session' \| 'routines' \| 'exercises' \| 'planning' \| 'history'` |
| `src/App.tsx:30` | `LOCAL_STORAGE_NUTRITION_TAB` | `'logbook_nutritionSubTab'` | `'meals'` | `'meals' \| 'foods' \| 'planning' \| 'measurements' \| 'history' \| 'supplements'` |
| `src/App.tsx:31` | `LOCAL_STORAGE_DATA_TAB` | `'logbook_dataSubTab'` | `'measurements'` | `'measurements' \| 'biometry' \| 'history'` |

All four current callers in `src/App.tsx` invoke `useLocalStorage(key, initialValue)` without a schema.

### 2.2 Existing Test Suites
The hook is currently tested in two test files:
1. `tests/use_local_storage.test.tsx` (11 unit tests):
   - Tests null key fallback, valid JSON retrieval for primitives, objects, and arrays.
   - Tests fallback on unquoted strings, malformed JSON syntax, and literal `'undefined'`.
   - Tests `JSON.stringify` serialization on save and resilience to `localStorage.setItem` exceptions (e.g. `QuotaExceededError`).
2. `tests/challenger_r2_r3_r4_adversarial.test.tsx` (Part 3: Adversarial Corruption Matrix):
   - Tests corruption matrix across unquoted strings, broken JSON structures, script/injection vectors, unicode surrogates, binary controls, and self-healing overwrites.

All 475 tests across 26 test files in the project currently pass.

---

## 3. Current Implementation vs. Architectural Constraints

### 3.1 Current Implementation (`src/hooks/useLocalStorage.ts`)
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

    useEffect(() => {
        try {
            window.localStorage.setItem(key, JSON.stringify(storedValue));
        } catch (error) {
            console.error(`Errore di salvataggio nel localStorage key "${key}":`, error);
        }
    }, [key, storedValue]);

    return [storedValue, setStoredValue];
}
```

### 3.2 Identified Deficiencies
1. **No Schema Validation on Valid JSON**: If `window.localStorage.getItem(key)` returns valid JSON that violates domain invariants (e.g. `{"foo": 123}` when an array or specific tab is expected, or `'malicious_tab'`), `JSON.parse` succeeds and returns the invalid payload without verification.
2. **Missing Zod Integration**: Zod is the required gateway across LogBook (`src/lib/schema.ts`). Storage Tier 3 (`localStorage`) lacked hook-level integration with Zod schemas.
3. **Absence of Differentiated Diagnostics**: Syntax errors during `JSON.parse` should be logged with `console.error`, whereas schema validation rejections should be logged with `console.warn` detailing the validation issues (per `AGENTS.md` and `ORIGINAL_REQUEST.md`).

---

## 4. Proposed Design & Signature

### 4.1 TypeScript Signature & Generics
To maintain total type safety and backward compatibility, the signature is defined as:

```typescript
import { useState, useEffect } from 'react';
import type { ZodType } from 'zod';

export function useLocalStorage<T>(
    key: string,
    initialValue: T,
    schema?: ZodType<T, any, any>
): [T, (value: T) => void]
```

#### Why `ZodType<T, any, any>`?
- `z.ZodType<Output, Def, Input>` is the fundamental base type for all Zod schemas (`ZodString`, `ZodEnum`, `ZodObject`, `ZodArray`, `ZodEffects`, etc.).
- When `schema` is omitted, TypeScript infers `T` from `initialValue`.
- When `schema` is supplied (e.g. `z.enum(['home', 'training'])`), TypeScript aligns `T` with the schema output type.
- The return tuple `[T, (value: T) => void]` exactly matches existing callers and tests.

### 4.2 Detailed Runtime Control Flow

```
┌────────────────────────────────────────────────────────┐
│              Initial Mount / Lazy Init                 │
└──────────────────────────┬─────────────────────────────┘
                           │
             window.localStorage.getItem(key)
                           │
             ┌─────────────┴─────────────┐
        item === null               item !== null
             │                           │
     Return initialValue          JSON.parse(item)
                                         │
                         ┌───────────────┴───────────────┐
                    Syntax Error                   Valid JSON
                         │                               │
                 console.error(...)                Is schema provided?
                 Return initialValue                     │
                                           ┌─────────────┴─────────────┐
                                          Yes                          No
                                           │                           │
                                  schema.safeParse(parsed)       Return parsed as T
                                           │
                           ┌───────────────┴───────────────┐
                        Success                         Failure
                           │                               │
                    Return result.data             console.warn(...)
                                                   Return initialValue
```

### 4.3 Proposed Implementation Code (`src/hooks/useLocalStorage.ts`)

```typescript
import { useState, useEffect } from 'react';
import type { ZodType } from 'zod';

export function useLocalStorage<T>(
    key: string,
    initialValue: T,
    schema?: ZodType<T, any, any>
): [T, (value: T) => void] {
    const [storedValue, setStoredValue] = useState<T>(() => {
        const item = window.localStorage.getItem(key);
        if (item === null) return initialValue;

        try {
            const parsed = JSON.parse(item);

            if (schema) {
                const parseResult = schema.safeParse(parsed);
                if (!parseResult.success) {
                    console.warn(`Errore di validazione schema per localStorage key "${key}":`, parseResult.error);
                    return initialValue;
                }
                return parseResult.data;
            }

            return parsed as T;
        } catch (error) {
            console.error(`Errore di parsing del localStorage key "${key}":`, error);
            return initialValue;
        }
    });

    useEffect(() => {
        try {
            window.localStorage.setItem(key, JSON.stringify(storedValue));
        } catch (error) {
            console.error(`Errore di salvataggio nel localStorage key "${key}":`, error);
        }
    }, [key, storedValue]);

    return [storedValue, setStoredValue];
}
```

---

## 5. Architectural & Behavioral Compliance

### 5.1 Self-Healing Mechanism
When `window.localStorage` contains invalid JSON or schema-violating data:
1. `useState` initializes `storedValue` to `initialValue`.
2. On mount, `useEffect` executes `window.localStorage.setItem(key, JSON.stringify(storedValue))`.
3. The invalid entry in `window.localStorage` is automatically overwritten (repaired) with valid `JSON.stringify(initialValue)`.

### 5.2 Error Handling & Logging Matrix
| Condition | Trigger | Log Output | Return Value | Storage State |
| :--- | :--- | :--- | :--- | :--- |
| Key Missing | `item === null` | *None* | `initialValue` | Saved on mount (`JSON.stringify(initialValue)`) |
| Corrupt JSON | `JSON.parse` throws `SyntaxError` | `console.error('Errore di parsing...', error)` | `initialValue` | Self-healed on mount |
| Valid JSON, No Schema | `schema === undefined` | *None* | `parsed as T` | Preserved / Re-saved |
| Valid JSON, Valid Schema | `schema.safeParse` succeeds | *None* | `parseResult.data` | Preserved / Re-saved |
| Valid JSON, Schema Mismatch | `schema.safeParse` fails | `console.warn('Errore di validazione schema...', parseResult.error)` | `initialValue` | Self-healed on mount |
| Storage Quota Exceeded | `localStorage.setItem` throws | `console.error('Errore di salvataggio...', error)` | In-memory state maintained | Storage write fails safely |

---

## 6. Unit Test & Verification Plan

New unit tests must be added to `tests/use_local_storage.test.tsx` in a dedicated `describe('Zod Schema Validation')` block.

### Test Matrix to Add in `tests/use_local_storage.test.tsx`:
1. **Valid Data with Primitive Schema**:
   - Schema: `z.enum(['home', 'training', 'nutrition'])`
   - Stored in localStorage: `JSON.stringify('training')`
   - Expected: returns `'training'`, `console.warn` not called, `console.error` not called.
2. **Valid Data with Complex Object Schema**:
   - Schema: `z.object({ tab: z.string(), count: z.number().min(0) })`
   - Stored in localStorage: `JSON.stringify({ tab: 'settings', count: 5 })`
   - Expected: returns `{ tab: 'settings', count: 5 }`.
3. **Invalid Data with Primitive Schema (Returns `initialValue`)**:
   - Schema: `z.enum(['home', 'training', 'nutrition'])`
   - Stored in localStorage: `JSON.stringify('malicious_tab')`
   - Initial value: `'home'`
   - Expected: returns `'home'`, `console.warn` called with message containing key and `ZodError`.
4. **Invalid Data with Object Schema (Schema Mismatch / Missing Fields / Invalid Types)**:
   - Schema: `z.object({ tab: z.string(), count: z.number() })`
   - Stored in localStorage: `JSON.stringify({ tab: 'home', count: 'not_a_number' })`
   - Initial value: `{ tab: 'fallback', count: 0 }`
   - Expected: returns `{ tab: 'fallback', count: 0 }`, `console.warn` called.
5. **Schema with Transformation / Normalization**:
   - Schema: `z.string().transform(s => s.trim().toLowerCase())`
   - Stored in localStorage: `JSON.stringify('  PROFILE  ')`
   - Expected: returns `'profile'`.
6. **Syntax Error Precedence over Schema Validation**:
   - Schema: `z.object({ name: z.string() })`
   - Stored in localStorage: `'{ unquoted_broken_syntax'`
   - Expected: returns `initialValue`, `console.error` called (from JSON parse catch), `console.warn` NOT called.
7. **Missing Key with Schema**:
   - Schema provided, but key is `null` in localStorage.
   - Expected: returns `initialValue`, neither `console.warn` nor `console.error` called.
8. **Schema-less Usage Continuity**:
   - Verify that calls without `schema` continue to parse primitives, arrays, and objects without regressions.
9. **State Updates with Schema**:
   - Verify that updating state via the setter properly stores the new valid value into `localStorage`.

---

## 7. Implementation Checklist for Developer

1. Update `src/hooks/useLocalStorage.ts`:
   - Import `type { ZodType } from 'zod'`.
   - Update function signature to accept optional `schema?: ZodType<T, any, any>`.
   - In the lazy initializer, parse with `JSON.parse(item)`.
   - If `schema` is present, execute `schema.safeParse(parsed)`.
   - If `!parseResult.success`, call `console.warn` and return `initialValue`.
   - If `parseResult.success`, return `parseResult.data`.
   - If `schema` is undefined, return `parsed as T`.
   - Catch `JSON.parse` errors, log `console.error`, and return `initialValue`.
2. Update `tests/use_local_storage.test.tsx`:
   - Import `z` from `'zod'`.
   - Add the `describe('Zod Schema Validation')` suite covering all 9 test scenarios.
3. Verification:
   - Run `npx vitest run tests/use_local_storage.test.tsx` and all other test suites.
   - Run `npm run lint` (`oxlint`).
   - Run `npm run build` (`tsc --noEmit && vite build`).
