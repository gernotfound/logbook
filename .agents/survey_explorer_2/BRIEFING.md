# BRIEFING — 2026-08-23T07:40:19Z

## Mission
Investigate bootstrap, catalog initialization, seed fallback, and guest mode login flow in LogBook.

## 🔒 My Identity
- Archetype: explorer
- Roles: [explorer, synthesis]
- Working directory: C:\Users\gerar\Documents\GitHub\logbook\.agents\survey_explorer_2
- Original parent: cdbdb363-4a02-4dfd-a363-8ae65d23773b
- Milestone: survey_bootstrap_catalog_investigation

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Work within .agents/survey_explorer_2 for artifacts
- Adhere to AGENTS.md architectural principles

## Current Parent
- Conversation ID: cdbdb363-4a02-4dfd-a363-8ae65d23773b
- Updated: not yet

## Investigation State
- **Explored paths**:
  - `src/main.tsx` (Pre-render bootstrap and initial state injection)
  - `src/contexts/AuthContext.tsx` (`loginAsGuest`, `defaultUserData`, unauthenticated reset, linking flow)
  - `src/store/useAppStore.ts` & `src/store/slices/createDataSlice.ts`, `createSyncSlice.ts`
  - `src/lib/catalog/catalogService.ts` (`getSeedCatalog`, `getCachedCatalog`, `syncGlobalCatalog`, `saveCatalogToCache`)
  - `src/lib/catalog/deltaResolver.ts` (`resolveEffectiveExercises`, `resolveEffectiveFoods`, migration and overrides)
  - `src/lib/db.ts` (`DB.loadUserData`, `DB.saveUserData`, delta migration on save)
  - `src/lib/merge.ts` (`mergeUserData`, `hasUserData`)
  - `src/lib/schema.ts` (`UserDataSchema`, catalog schemas)
  - UI Views & Hooks: `useTrainingExercises`, `NutritionFoodArchive`, `useNutritionMeals`
- **Key findings**:
  - `loginAsGuest` populates `userData` from `defaultUserData` where `library: []` and `customFoods: []` are hardcoded empty.
  - On landing page cold start, `onAuthStateChanged` triggers `resetStore()` for unauthenticated users, wiping out `main.tsx` initial seed synthesis.
  - `DB.loadUserData` provides resolved effective lists for authenticated users, but guest mode lacks this pipeline.
  - `mergeUserData` completely omits `catalogOverrides` during Google linking and blindly merges `library`/`customFoods` arrays.
  - `hasUserData` treats array length as user-created data, which can false-positive on static seed items.
- **Unexplored areas**: None. Complete flow traced from bootstrap to rendering and cloud synchronization.

## Key Decisions Made
- Documented clear architectural blueprint in `handoff.md` covering root cause, resolution pipeline, persistence separation, and merge safety.

## Artifact Index
- DISPATCH.md — incoming instructions and dispatch record
- BRIEFING.md — persistent working memory
- handoff.md — comprehensive 5-component survey report
