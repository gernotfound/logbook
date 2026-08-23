# Project: Architectural and Performance Fixes (LogBook)

## Architecture
- React 19 + TypeScript + Vite + Zustand 5 + Zod + Firebase Firestore (3-Tier Storage).
- Rules and guidelines defined in `AGENTS.md`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | R1: Dynamic PWA Base Path | Configure `vite.config.ts` to use `process.env.VITE_BASE_PATH || '/'` for `base` and `start_url` in manifest | M1 | ORIGINAL_REQUEST.md § 2026-08-17T08:07:42Z |
| 2 | R2: ErrorBoundary Dialog Hardening | Replace `window.confirm` with `useDialogStore.getState().showConfirm(...)` and async reset logic in `ErrorBoundary.tsx` | M1 | ORIGINAL_REQUEST.md § 2026-08-17T08:07:42Z |
| 3 | R3: Optimized Firestore Serialization | Create recursive `removeUndefinedValues` utility and replace `JSON.parse(JSON.stringify(...))` in `src/lib/db.ts` | M1 | ORIGINAL_REQUEST.md § 2026-08-17T08:07:42Z |
| 4 | R4: Strict LocalStorage Validation | Update `useLocalStorage.ts` to accept optional Zod schema `(key, initialValue, schema?: any)` and use `schema.safeParse()`, returning `initialValue` on failure | M1 | ORIGINAL_REQUEST.md § 2026-08-17T08:07:42Z |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | M1: 4 Architectural & Performance Fixes | `vite.config.ts`, `src/components/UI/ErrorBoundary.tsx`, `src/lib/db.ts` (and utility), `src/hooks/useLocalStorage.ts`, and test verification | none | DONE |

## Interface Contracts & Code Layout
- `vite.config.ts`: `base: process.env.VITE_BASE_PATH || '/'`, PWA manifest `start_url: process.env.VITE_BASE_PATH || '/'`.
- `src/components/UI/ErrorBoundary.tsx`: Use `useDialogStore.getState().showConfirm({ title, message, confirmText, cancelText, variant, onConfirm })`.
- `src/lib/utils/object.ts`: Export `removeUndefinedValues<T>(obj: T): T` and re-export in `src/lib/logic.ts`.
- `src/hooks/useLocalStorage.ts`: `export function useLocalStorage<T>(key: string, initialValue: T, schema?: ZodType<T, any, any>): [T, (value: T) => void]` - safe parsing with schema validation and fallback to `initialValue`.
