## 2026-08-20T19:23:57Z

You are the Worker for Milestone M2 (Active Session Live Experience: R2 & R3) in the LogBook PWA project.
Working directory: C:\Users\gerar\Documents\GitHub\logbook\.agents\worker_m2_1\
Original Request: C:\Users\gerar\Documents\GitHub\logbook\.agents\ORIGINAL_REQUEST.md
Project Scope: C:\Users\gerar\Documents\GitHub\logbook\PROJECT.md
Sub-Orchestrator Scope: C:\Users\gerar\Documents\GitHub\logbook\.agents\sub_orch_m2\SCOPE.md
Explorer Reports:
- C:\Users\gerar\Documents\GitHub\logbook\.agents\explorer_m2_1\handoff.md
- C:\Users\gerar\Documents\GitHub\logbook\.agents\explorer_m2_2\handoff.md
- C:\Users\gerar\Documents\GitHub\logbook\.agents\explorer_m2_3\handoff.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Exclusive File Ownership:
- `src/types.ts`
- `src/lib/schema.ts`
- `src/hooks/workout/useWorkoutSetMutations.ts`
- `src/hooks/useWorkoutSession.ts`
- `src/components/Training/session/SessionExerciseCard.tsx`
- `src/components/Training/TrainingSession.tsx`
- `src/store/slices/createWorkoutSlice.ts`
- `tests/workout_reorder_and_live_sync_r2_r3.test.tsx`

Implementation Requirements:
1. Data Model & Schema (`src/types.ts` & `src/lib/schema.ts`):
   - Add `id?: string;` to `SessionExercise` interface in `src/types.ts`.
   - Add `id: safeOptionalString()` to `SessionExerciseSchema` in `src/lib/schema.ts`.
   - In `createWorkoutSlice.ts` and `useWorkoutSession.ts`, ensure `SessionExercise` receives `id: Logic.generateId('se')` when created in `startWorkout`, `addExtraExercise`, `startEditHistoricalWorkout`, and fallback in `getInitialLocalWorkout`.

2. Exercise Reordering Logic (`src/hooks/workout/useWorkoutSetMutations.ts` & `src/hooks/useWorkoutSession.ts`):
   - Harden `reorderExercises`:
     ```typescript
     const reorderExercises = useCallback((fromIndex: number, toIndex: number) => {
         setLocalWorkout((prev) => {
             if (!prev || !Array.isArray(prev.exercises)) return prev;
             const total = prev.exercises.length;
             if (fromIndex < 0 || fromIndex >= total || toIndex < 0 || toIndex >= total || fromIndex === toIndex) {
                 return prev;
             }
             const newExercises = [...prev.exercises];
             const [removed] = newExercises.splice(fromIndex, 1);
             newExercises.splice(toIndex, 0, removed);
             return { ...prev, exercises: newExercises };
         });
     }, [setLocalWorkout]);
     ```
   - Implement and export `moveExercise(index: number, direction: 'up' | 'down')`:
     ```typescript
     const moveExercise = useCallback((index: number, direction: 'up' | 'down') => {
         const targetIndex = direction === 'up' ? index - 1 : index + 1;
         reorderExercises(index, targetIndex);
     }, [reorderExercises]);
     ```
   - Export `moveExercise` and `reorderExercises` in `useWorkoutSession.ts`.

3. Exercise Card UI & Badges (`src/components/Training/session/SessionExerciseCard.tsx`):
   - In `SessionExerciseCardProps`, add `onMoveExercise?: (index: number, direction: 'up' | 'down') => void` and `totalExercises?: number`.
   - In the card header (beside the exercise title/header actions), add compact Up (⬆️) and Down (⬇️) buttons:
     - `disabled={exIndex === 0}` for Up.
     - `disabled={totalExercises !== undefined && exIndex >= totalExercises - 1}` for Down.
     - Use accessible `aria-label="Sposta esercizio su"` and `aria-label="Sposta esercizio giù"`.
     - Dark glassmorphism styling (`btn-icon` or matching `.btn-secondary`, touch targets >= 36-44px, opacity 0.3 when disabled).
   - Render dynamic primary muscle badges (`.badge.badge-primary` Cyan) and secondary muscle badges (`.badge` with Teal token `#4db6ac` / `var(--secondary-color, #4db6ac)`) mapped from `libDef?.muscles` and `libDef?.secondaryMuscles` via `Logic.MUSCLES` in Italian sentence case.
   - Guard against missing `libDef` gracefully (`"Esercizio rimosso"`, empty badges).
   - Update `React.memo` custom comparator to compare `prev.totalExercises === next.totalExercises` and `prev.exIndex === next.exIndex`.

4. Accordion Synchronization & View Integration (`src/components/Training/TrainingSession.tsx`):
   - In `TrainingSession.tsx`, implement `handleMoveExercise`:
     ```typescript
     const handleMoveExercise = useCallback((fromIndex: number, direction: 'up' | 'down') => {
         const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
         moveExercise(fromIndex, direction);
         setOpenHistoryExIndex(prev => {
             if (prev === null) return null;
             if (prev === fromIndex) return toIndex;
             if (prev === toIndex) return fromIndex;
             return prev;
         });
         setOpenSetupExIndex(prev => {
             if (prev === null) return null;
             if (prev === fromIndex) return toIndex;
             if (prev === toIndex) return fromIndex;
             return prev;
         });
     }, [moveExercise]);
     ```
   - Pass `onMoveExercise={handleMoveExercise}` and `totalExercises={workout.exercises.length}` to `SessionExerciseCard`.
   - Key each `SessionExerciseCard` with `key={exItem.id || `${exItem.exId}_${exIndex}`}`.

5. Unit Tests:
   - Create `tests/workout_reorder_and_live_sync_r2_r3.test.tsx` testing:
     - Reordering logic (`moveExercise` up/down, boundary guards: moving index 0 up, moving last index down, out of bounds, single item).
     - Accordion index synchronization on move.
     - React keys stability with `id`.
     - Dynamic muscle badges rendering (primary cyan, secondary teal, sentence case, fallback when libDef undefined).
     - React.memo prop comparison behavior.

6. Verification:
   - Run `npm.cmd test`
   - Run `npm.cmd run build`
   - Run `npm.cmd run lint`

Deliver a 5-component `handoff.md` in `C:\Users\gerar\Documents\GitHub\logbook\.agents\worker_m2_1\handoff.md` documenting your work and verification results, then send a message back.
