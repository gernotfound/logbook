## 2026-08-17T08:12:24Z
You are Worker 1 for Milestone M1 (Architectural & Performance Fixes).
Working directory: c:\Users\gerar\Documents\GitHub\logbook\.agents\teamwork_preview_worker_m1_1\

Read the following authoritative documents first:
- ORIGINAL_REQUEST.md: c:\Users\gerar\Documents\GitHub\logbook\.agents\ORIGINAL_REQUEST.md
- AGENTS.md: c:\Users\gerar\Documents\GitHub\logbook\AGENTS.md
- PROJECT.md: c:\Users\gerar\Documents\GitHub\logbook\.agents\teamwork_preview_orchestrator_3\PROJECT.md
- Explorer 1 Analysis: c:\Users\gerar\Documents\GitHub\logbook\.agents\teamwork_preview_explorer_m1_1\analysis.md
- Explorer 2 Analysis: c:\Users\gerar\Documents\GitHub\logbook\.agents\teamwork_preview_explorer_m1_2\analysis.md
- Explorer 3 Analysis: c:\Users\gerar\Documents\GitHub\logbook\.agents\teamwork_preview_explorer_m1_3\analysis.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your Tasks:
1. **R1: Dynamic PWA Base Path** in `vite.config.ts`
   - Use `const basePath = process.env.VITE_BASE_PATH || '/';`
   - Update `base: basePath`
   - In `VitePWA({ manifest: { ... start_url: basePath, scope: basePath } })`

2. **R2: Remove `window.confirm` in `src/components/UI/ErrorBoundary.tsx`**
   - Replace `window.confirm` with `useDialogStore.getState().showConfirm(...)`.
   - Make sure `<GlobalDialog />` is rendered inside `ErrorBoundary`'s fallback UI so that dialog is visible even if the rest of `<App />` is unmounted.
   - Handle the reset logic asynchronously in `onConfirm: async () => { ... }` (clearing caches / local workout and reloading).
   - Ensure 0 occurrences of `window.confirm` in `src/`.

3. **R3: Optimize Firestore Serialization in `src/lib/db.ts`**
   - Create a clean, recursive utility `removeUndefinedValues<T>(value: T): T` (e.g. in `src/lib/utils/object.ts`, and re-export in `src/lib/logic.ts` or `src/lib/utils/index.ts`).
   - The utility must recursively strip `undefined` properties from objects and nested objects/arrays without converting everything to JSON strings. It should preserve Dates, Firestore FieldValues, and primitives.
   - Replace all 3 `JSON.parse(JSON.stringify(...))` calls in `src/lib/db.ts` (in `saveUserData` for `userDocData`, `historyData`, `nutritionData`) with `removeUndefinedValues(...)`.
   - Write comprehensive unit tests for `removeUndefinedValues` (e.g. `tests/object_sanitization.test.ts` or `src/lib/utils/__tests__/object.test.ts`).

4. **R4: Strict LocalStorage Validation in `src/hooks/useLocalStorage.ts`**
   - Update signature: `export function useLocalStorage<T>(key: string, initialValue: T, schema?: ZodType<T, any, any>): [T, (value: T) => void]` (or `z.ZodType<T>`).
   - Read logic:
     - Check `item === null` -> return `initialValue`.
     - `try { const parsed = JSON.parse(item); if (schema) { const result = schema.safeParse(parsed); if (result.success) return result.data; console.warn(\`[useLocalStorage] Schema validation failed for key "\${key}":\`, result.error); return initialValue; } return parsed as T; } catch (err) { console.error(\`[useLocalStorage] JSON parse error for key "\${key}":\`, err); return initialValue; }`
     - Maintain 100% backward compatibility for callers who do not provide a schema.
   - Write comprehensive unit tests in `src/hooks/__tests__/useLocalStorage.test.ts` testing: valid schema, schema mismatch (returns initialValue), corrupted JSON string (returns initialValue), and schema-less usage.

5. **Verification & Build Validation**:
   - Run `npm test` and ensure all existing and new tests pass.
   - Run `npm run build` (`tsc --noEmit` + Vite build) and ensure 0 TypeScript errors.
   - Run `npm run lint` and ensure 0 errors/warnings.
   - Run `grep -r "window.confirm" src/` and verify 0 results.
   - Run `grep -r "JSON.parse(JSON.stringify" src/lib/db.ts` and verify 0 results.

Write your report in `c:\Users\gerar\Documents\GitHub\logbook\.agents\teamwork_preview_worker_m1_1\changes.md` and your handoff in `c:\Users\gerar\Documents\GitHub\logbook\.agents\teamwork_preview_worker_m1_1\handoff.md`.
Notify parent via `send_message` with verification results.
