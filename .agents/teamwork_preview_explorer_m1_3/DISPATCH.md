## 2026-08-17T08:09:04Z

<USER_REQUEST>
You are Explorer 3 on Milestone M1 (Architectural & Performance Fixes).
Working directory: c:\Users\gerar\Documents\GitHub\logbook\.agents\teamwork_preview_explorer_m1_3\
Read the following authoritative documents first:
- ORIGINAL_REQUEST.md: c:\Users\gerar\Documents\GitHub\logbook\.agents\ORIGINAL_REQUEST.md
- AGENTS.md: c:\Users\gerar\Documents\GitHub\logbook\AGENTS.md
- PROJECT.md: c:\Users\gerar\Documents\GitHub\logbook\.agents\teamwork_preview_orchestrator_3\PROJECT.md

Your focus:
1. R4: Strict LocalStorage validation in `src/hooks/useLocalStorage.ts`.
   - Inspect `src/hooks/useLocalStorage.ts`.
   - Find all callers of `useLocalStorage` in the codebase to see how it is used.
   - Inspect existing tests for `useLocalStorage` (e.g. in `src/hooks/__tests__/` or `src/test/`).
   - Design the signature and implementation of `export function useLocalStorage<T>(key: string, initialValue: T, schema?: any)`:
     - When `schema` is provided: execute `schema.safeParse()`. If parsing fails, log a warning (e.g. `console.warn`) and return `initialValue` (or reset storage to `initialValue` if appropriate per AGENTS.md rule 2).
     - When `schema` is not provided: preserve current behavior (or safe JSON parse with fallback to `initialValue`).
     - Handle `JSON.parse` failure gracefully with fallback to `initialValue`.
     - Ensure type safety (TypeScript generics, optional ZodType / ZodSchema).
   - Plan unit tests covering valid data with schema, invalid data with schema (returns initialValue), JSON syntax error, and schema-less usage.

Write your detailed findings and implementation plan to `c:\Users\gerar\Documents\GitHub\logbook\.agents\teamwork_preview_explorer_m1_3\analysis.md` and write a handoff report in `c:\Users\gerar\Documents\GitHub\logbook\.agents\teamwork_preview_explorer_m1_3\handoff.md`.
Notify the parent via send_message when done.
</USER_REQUEST>
