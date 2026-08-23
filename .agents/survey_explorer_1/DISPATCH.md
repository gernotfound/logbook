## 2026-08-23T07:34:42Z
Investigate the state management, schema, type contracts, and catalog resolution pipeline in the LogBook codebase:
1. Read ORIGINAL_REQUEST.md and AGENTS.md carefully.
2. Search and analyze src/store/useAppStore.ts, src/lib/schema.ts, src/types.ts, and any resolution functions (e.g. resolveEffectiveExercises, resolveEffectiveFoods, catalog selectors/helpers).
3. Investigate how `library` (exercises) and `customFoods` (foods) are defined in UserData and in the Zustand store.
4. Analyze how views/components currently consume exercises and foods: are they receiving resolved lists or raw lists? Where does resolution happen?
5. Determine what constitutes personal data vs global catalog data (e.g. custom items, catalogOverrides, hidden items).
6. Write a comprehensive survey report to `C:\Users\gerar\Documents\GitHub\logbook\.agents\survey_explorer_1\handoff.md`.
