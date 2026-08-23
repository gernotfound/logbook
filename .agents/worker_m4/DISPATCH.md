## 2026-08-23T07:56:30Z
You are Worker for Milestone M4: Cloud Merge & Account Linking Integrity.
Working directory: C:\Users\gerar\Documents\GitHub\logbook\.agents\worker_m4
Original Request: C:\Users\gerar\Documents\GitHub\logbook\.agents\ORIGINAL_REQUEST.md
Architecture Bible: C:\Users\gerar\Documents\GitHub\logbook\AGENTS.md
Project Plan: C:\Users\gerar\Documents\GitHub\logbook\PROJECT.md
Survey Reports:
- C:\Users\gerar\Documents\GitHub\logbook\.agents\survey_explorer_1\handoff.md
- C:\Users\gerar\Documents\GitHub\logbook\.agents\survey_explorer_2\handoff.md
- C:\Users\gerar\Documents\GitHub\logbook\.agents\survey_explorer_3\handoff.md
Project Root: C:\Users\gerar\Documents\GitHub\logbook

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your mission:
Own and update the deterministic guest-to-cloud merge and user data detection:
Target Files:
- `src/lib/merge.ts`
- `teamwork_projects/logbook_public_release/src/merge.ts`
(and `src/contexts/AuthContext.tsx` if any merge integration adjustments are needed).

Key Requirements:
1. In `src/lib/merge.ts`:
   - In `mergeUserData(cloudData, guestData)`:
     - Merge `catalogOverrides` explicitly using `mergeCatalogOverrides(cloud.catalogOverrides, guest.catalogOverrides)` from `src/lib/catalog/deltaResolver`.
     - Filter out static catalog items from `guest.library` and `guest.customFoods` before merging with `cloud.library` and `cloud.customFoods` (using `isDefault !== true` / `isCustom === true` or checking against `getInMemoryCatalog().exercises` / `foods`), so that `rawMerged.library` and `rawMerged.customFoods` only contain true user custom items.
     - Ensure all fields in `UserData` (profile, routines, history, nutrition, planning, cycles, supplements, activeWorkout, activePains, catalogOverrides) are correctly merged.
   - In `hasUserData(data)`:
     - Must return `true` only if genuine user data exists (e.g. custom exercises where `isDefault === false`, custom foods where `isCustom === true`, `catalogOverrides` with non-empty overrides or hidden IDs, non-empty history, non-empty routines, non-empty nutrition days, non-empty trainingCycles, activeWorkout, non-empty supplements).
     - Must return `false` if `data` only contains static seed catalog items and default empty values.
2. Synchronize changes to `teamwork_projects/logbook_public_release/src/merge.ts`.
3. Verification:
   - `npx.cmd tsc --noEmit`
   - `npm.cmd test tests/e2e_guest_catalog.test.ts tests/guest_merge.test.ts` (All tests including `T4.1` must pass!)
   - `npm.cmd run lint`
4. Document all changes and verification outputs in `C:\Users\gerar\Documents\GitHub\logbook\.agents\worker_m4\handoff.md`.

Send a completion message when finished.
