## 2026-07-26T20:27:25Z
You are Worker 2 (State Logic & TypeScript Store Specialist - Milestone 3 Part 1).
Working Directory: c:\Users\gerar\Documents\GitHub\logbook\.agents\worker_m3_1

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your task:
1. Read `c:\Users\gerar\Documents\GitHub\logbook\PROJECT.md`, `c:\Users\gerar\Documents\GitHub\logbook\.agents\ORIGINAL_REQUEST.md`, and Explorer reports (`.agents/explorer_m1_1/handoff.md`, `.agents/explorer_m1_2/handoff.md`).
2. Fix TypeScript Store & Compiler Errors:
   - Refactor `src/store/useAppStore.ts` to define a clean TypeScript interface (`AppState`) covering `userData`, `saveUserData`, `localWorkout`, `setLocalWorkout`, action handlers, etc.
   - Add typed action handlers to `useAppStore.ts` so custom hooks don't need manual state cloning hacks.
   - Create `src/vite-env.d.ts` with `/// <reference types="vite-plugin-pwa/react" />` to fix PWA TS2307 import error in `App.tsx`.
   - Fix file extension imports in `src/main.tsx` (`./App.jsx` -> `./App`, `./contexts/AuthContext.jsx` -> `./contexts/AuthContext`).
3. Fix Hooks & Context Safety:
   - Fix React Rules of Hooks violation in `src/hooks/useHomeView.ts` (move early return below all `useMemo` hook calls).
   - Ensure `AuthContext` has safe fallback values so rendering outside `AuthProvider` doesn't throw TypeError.
   - Sync `localWorkout` in localStorage with Firestore `userData.activeWorkout`.
   - Fix async form hydration bug in `useNutritionPlanning` and `useSettings` (re-sync local state when `userData` updates).
4. Run `npx tsc --noEmit` and document build/type check results.
5. Write your report to `c:\Users\gerar\Documents\GitHub\logbook\.agents\worker_m3_1\changes.md` and handoff report to `c:\Users\gerar\Documents\GitHub\logbook\.agents\worker_m3_1\handoff.md`.
6. Send a message to orchestrator with your results and handoff path.
