## 2026-08-17T08:08:39Z

Execute the implementation of the 4 architectural and performance fixes specified in ORIGINAL_REQUEST.md:
1. R1: PWA Base Path Dinamico in `vite.config.ts` (use env var e.g. `process.env.VITE_BASE_PATH || '/'` for `base` and `start_url`).
2. R2: Remove `window.confirm` in `src/components/UI/ErrorBoundary.tsx` and replace with `useDialogStore.getState().showConfirm(...)` handling reset asynchronously, strictly respecting Rule 7 of AGENTS.md.
3. R3: Optimize Firestore serialization in `src/lib/db.ts` by replacing `JSON.parse(JSON.stringify(...))` with a performant recursive sanitization utility `removeUndefinedValues` (e.g. in `src/lib/utils/` or `logic.ts`).
4. R4: Strict LocalStorage validation in `src/hooks/useLocalStorage.ts` accepting an optional Zod schema `(key: string, initialValue: T, schema?: any)` and validating with `schema.safeParse()`, returning `initialValue` on failure while maintaining backward compatibility with existing callers.

Acceptance Criteria:
- `npm run build` succeeds without TypeScript errors.
- `npm run lint` passes without additional warnings.
- `npm test` passes.
- `grep -r "window.confirm" src/` returns 0 results.
- `grep -r "JSON.parse(JSON.stringify" src/lib/db.ts` returns 0 results.
- `useLocalStorage` supports Zod schema validation cleanly without breaking callers.
