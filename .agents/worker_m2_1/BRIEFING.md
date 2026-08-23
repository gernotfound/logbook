# BRIEFING — 2026-08-20T19:24:00Z

## Mission
Implement Milestone M2 (Active Session Live Experience: R2 & R3) for LogBook PWA: exercise reordering with up/down controls, dynamic muscle badges (primary cyan / secondary teal in sentence case), stable session exercise IDs (`id?: string`), accordion index sync, memo optimization, and comprehensive tests.

## 🔒 My Identity
- Archetype: worker
- Roles: implementer, qa, specialist
- Working directory: C:\Users\gerar\Documents\GitHub\logbook\.agents\worker_m2_1\
- Original parent: c8025315-288a-4ea3-9d26-09fefa53d606
- Milestone: M2 - Active Session Live Experience: R2 & R3

## 🔒 Key Constraints
- Exclusive file ownership:
  - `src/types.ts`
  - `src/lib/schema.ts`
  - `src/hooks/workout/useWorkoutSetMutations.ts`
  - `src/hooks/useWorkoutSession.ts`
  - `src/components/Training/session/SessionExerciseCard.tsx`
  - `src/components/Training/TrainingSession.tsx`
  - `src/store/slices/createWorkoutSlice.ts`
  - `tests/workout_reorder_and_live_sync_r2_r3.test.tsx`
- Do not modify files outside ownership.
- Zero mock / fake implementations. Genuine logic only.
- Strict compliance with AGENTS.md: Sentence case for Italian UI texts, dark glassmorphism styling, Zod gateway sync, Zustand store hygiene, 16px touch targets, mobile resilience.

## Current Parent
- Conversation ID: c8025315-288a-4ea3-9d26-09fefa53d606
- Updated: 2026-08-20T19:24:00Z

## Task Summary
- **What to build**: Exercise reordering up/down with boundaries, session exercise stable `id`, dynamic primary/secondary muscle badges, accordion sync for history/setup modals, React.memo comparison updates, unit & integration tests.
- **Success criteria**: Full unit test coverage in `tests/workout_reorder_and_live_sync_r2_r3.test.tsx`, `npm test`, `npm run build`, and `npm run lint` all pass with 0 errors.
- **Interface contracts**: `PROJECT.md`, `SCOPE.md`, `AGENTS.md`

## Key Decisions Made
- Use `Logic.generateId('se')` for new `SessionExercise.id` generation.
- Reordering algorithm in `useWorkoutSetMutations` handles index bounds and swaps immutably.
- Accordion index synchronization updates `openHistoryExIndex` and `openSetupExIndex` when swapped.
- Badges use `.badge.badge-primary` (primary muscles) and `.badge` with `#4db6ac` / `var(--secondary-color, #4db6ac)` (secondary muscles), mapped through `Logic.MUSCLES` and displayed in sentence case.

## Change Tracker
- **Files modified**: [TBD]
- **Build status**: [Pending]
- **Pending issues**: None

## Quality Status
- **Build/test result**: [Pending]
- **Lint status**: [Pending]
- **Tests added/modified**: `tests/workout_reorder_and_live_sync_r2_r3.test.tsx`

## Loaded Skills
- None
