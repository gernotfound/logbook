# Changes Log — Milestone M1: Architectural & Performance Fixes

## 1. Overview of Changes
This milestone implemented 4 architectural and performance fixes identified in the code audit to ensure stability, scalability, and strict compliance with `AGENTS.md`.

---

## 2. Detailed File Modifications

### 2.1 `vite.config.ts` (R1: Dynamic PWA Base Path)
- **Change**: Replaced hardcoded `'/logbook/'` base path with `const basePath = process.env.VITE_BASE_PATH || '/';`.
- **Details**: Updated `base: basePath` and inside `VitePWA({ manifest: { start_url: basePath, scope: basePath } })`.
- **Rationale**: Supports root deployments (e.g. Firebase Hosting, custom domains, local preview) by default with `'/'` while allowing subpath deployments (GitHub Pages) by setting the `VITE_BASE_PATH` environment variable.

### 2.2 `src/components/UI/ErrorBoundary.tsx` (R2: ErrorBoundary Dialog Hardening)
- **Change**: Replaced blocking native `window.confirm` with non-blocking global dialog `useDialogStore.getState().showConfirm(...)`.
- **Details**: 
  - Included `<GlobalDialog />` within the fallback UI of `ErrorBoundary` so the dialog is rendered and functional even when the main `<App />` component tree is unmounted.
  - Implemented async handler `handleHardReset = async () => { ... }`.
  - Updated button and dialog label text to strictly adhere to Italian Sentence case: `"⚠️ Hard reset (dati corrotti)"` and `"Attenzione"`.
- **Rationale**: Compliance with `AGENTS.md` Rule 7 (prohibition of native blocking dialogs) and Rule 11 (Italian Sentence case).

### 2.3 `src/lib/utils/object.ts` (R3: Object Sanitization Utility)
- **Change**: Created a dedicated module exporting `isPlainObject(value: unknown): value is Record<string, any>` and `removeUndefinedValues<T>(value: T, seen?: WeakSet<object>): T`.
- **Details**: 
  - Recursively traverses objects and arrays without JSON string allocations.
  - Omits keys with `undefined` values in plain objects (`Object.prototype` or `Object.create(null)`).
  - Converts `undefined` array elements to `null` to preserve index positions for Firestore.
  - Preserves non-plain objects (`Date`, Firestore `FieldValue`, `DocumentReference`, `Uint8Array`, `Blob`, `RegExp`, `Map`, `Set`) intact.
  - Prevents call stack overflows on circular references using a `WeakSet`.

### 2.4 `src/lib/logic.ts` (R3: Logic Re-export Layer)
- **Change**: Imported and re-exported `removeUndefinedValues` and `isPlainObject` as named exports and as properties on the aggregated `Logic` object.
- **Rationale**: Provides ergonomic and backward-compatible access across the application.

### 2.5 `src/lib/db.ts` (R3: Optimized Firestore Serialization)
- **Change**: Imported `removeUndefinedValues` from `./utils/object` and replaced all 3 occurrences of `JSON.parse(JSON.stringify(...))` in `saveUserData`:
  - Main user document (`cleanUserDocData`)
  - Monthly history document (`cleanDoc` in `newHistMonths`)
  - Monthly nutrition document (`cleanDoc` in `newNutMonths`)
- **Rationale**: Eliminates CPU bottlenecks, reduces GC pressure on mobile devices, and prevents serialization corruption of `Date` and `FieldValue` instances.

### 2.6 `src/hooks/useLocalStorage.ts` (R4: Strict LocalStorage Validation)
- **Change**: Extended function signature to accept optional Zod schema `schema?: ZodType<T, any, any>`.
- **Details**:
  - In lazy initializer, retrieves item from `localStorage`.
  - If `item === null`, returns `initialValue`.
  - Parses JSON syntax; on syntax error, logs `console.error` and returns `initialValue`.
  - If schema is provided, executes `schema.safeParse(parsed)`. If validation fails, logs `console.warn` detailing schema errors and returns `initialValue`.
  - If schema is omitted or validation succeeds, returns parsed data.
  - Maintains 100% backward compatibility for existing callers.

### 2.7 Test Suites Added / Updated
- **`tests/object_sanitization.test.ts`**: 18 unit tests verifying primitives, objects, nested collections, arrays, special types (`Date`, `FieldValue`), circular references, `Logic` re-exports, and full Firestore payload simulation.
- **`tests/use_local_storage.test.tsx`**: Added 8 tests covering Zod schema validation (enum, complex objects, schema mismatches, syntax errors, transformations, state updates).
- **`tests/error_boundary.test.tsx`**: 6 unit tests covering fallback rendering, `<GlobalDialog />` integration, "Ricarica pagina" reload, and async hard reset confirmation/cancellation lifecycle.

---

## 3. Verification Commands & Results

| Verification Step | Command | Result |
| :--- | :--- | :--- |
| **Unit & Integration Tests** | `npm.cmd test` | **28 test files passed (507 tests total, 0 failed)** |
| **TypeScript Compilation & Build** | `npm.cmd run build` | **Clean build (0 errors)** |
| **Linter** | `npm.cmd run lint` | **0 errors** |
| **Grep `window.confirm`** | `grep -r "window.confirm" src/` | **0 results** |
| **Grep `JSON.parse(JSON.stringify`** | `grep -r "JSON.parse(JSON.stringify" src/lib/db.ts` | **0 results** |
