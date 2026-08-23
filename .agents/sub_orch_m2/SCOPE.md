# Scope: Milestone M2 - Active Session Live Experience (R2 & R3)

## Architecture
- Live session workout management in `src/views/TrainingSession.tsx` and `src/components/workout/SessionExerciseCard.tsx`.
- State mutation hook `src/hooks/workout/useWorkoutSetMutations.ts` handling exercise reordering (`reorderExercises`, `moveExercise`).
- Data contracts: `SessionExercise` in `src/types.ts` and `src/lib/schema.ts`.
- Real-time muscle group resolution from `userData.library` definitions via `Logic.MUSCLES`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| R2 | Riordino esercizi in sessione live | Move exercises up/down in active session with boundary safety, accordion index sync, and stable keys | M2 | Survey R2 & ORIGINAL_REQUEST |
| R3 | Sincronizzazione in tempo reale degli esercizi | Live exercise muscle badges and metadata resolution from library definition | M2 | Survey R3 & ORIGINAL_REQUEST |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M2 | Active Session Live Experience (R2 & R3) | Reordering buttons/logic + muscle badge resolution + memo safety + tests | M1 | IN_PROGRESS |

## Interface Contracts
### SessionExerciseCard ↔ TrainingSession / useWorkoutSetMutations
- `onMoveExercise?: (fromIndex: number, toIndex: number) => void` or `(index: number, direction: 'up' | 'down') => void`
- `exIndex: number`, `totalExercises: number`
- Up button disabled if `exIndex === 0`, Down button disabled if `exIndex === totalExercises - 1`
- Accordion states in `TrainingSession.tsx` (expanded history, setup) must sync when exercises shift indices.
- `SessionExercise`: `id?: string` in `src/types.ts` and `src/lib/schema.ts` (`safeOptionalString`).

### SessionExerciseCard ↔ Library / Logic.MUSCLES
- Dynamically look up `libDef = library.find(e => e.id === exercise.exerciseId)`
- Render primary muscles (`libDef.muscles`) and secondary muscles (`libDef.secondaryMuscles`) with names from `Logic.MUSCLES`.
- Memoization comparator must handle muscle changes or `libDef` changes gracefully.

## Code Layout
- `src/types.ts`: `SessionExercise` interface (`id?: string`).
- `src/lib/schema.ts`: `SessionExerciseSchema` (`id: safeOptionalString`).
- `src/hooks/workout/useWorkoutSetMutations.ts`: `reorderExercises`, `moveExercise`.
- `src/components/workout/SessionExerciseCard.tsx`: Reorder buttons, muscle badges, React.memo.
- `src/views/TrainingSession.tsx`: Wire `onMoveExercise`, `totalExercises`, accordion state synchronization.
- `tests/`: Unit and integration tests verifying R2 and R3.
