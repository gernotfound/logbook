import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import { renderWithProviders } from './setup';
import { useAppStore } from '../src/store/useAppStore';
import { useWorkoutSetMutations } from '../src/hooks/workout/useWorkoutSetMutations';
import { useWorkoutSession } from '../src/hooks/useWorkoutSession';
import { SessionExerciseCard } from '../src/components/Training/session/SessionExerciseCard';
import TrainingSession from '../src/components/Training/TrainingSession';
import { Logic } from '../src/lib/logic';
import { SessionExerciseSchema, WorkoutSessionSchema } from '../src/lib/schema';
import { getInitialLocalWorkout } from '../src/store/slices/createWorkoutSlice';
import type { WorkoutSession, ExerciseLibraryItem } from '../src/types';

const mockLibrary: ExerciseLibraryItem[] = [
    {
        id: 'ex_bench',
        name: 'Panca piana con bilanciere',
        muscles: ['chest_upper', 'chest_lower'],
        secondaryMuscles: ['triceps', 'delts_front'],
        notes: 'Gomiti a 45 gradi',
        trackingType: 'weight_reps',
        setsCount: 3,
        sets: []
    },
    {
        id: 'ex_squat',
        name: 'Squat con bilanciere',
        muscles: ['quads', 'glutes'],
        secondaryMuscles: ['hamstrings', 'core'],
        notes: 'Accosciata profonda',
        trackingType: 'weight_reps',
        setsCount: 4,
        sets: []
    },
    {
        id: 'ex_pullup',
        name: 'Trazioni alla sbarra',
        muscles: ['back', 'lats'],
        secondaryMuscles: ['biceps'],
        notes: 'Presa prona',
        trackingType: 'weight_reps',
        setsCount: 3,
        sets: []
    }
];

describe('Workout Reorder (R2) and Live Sync & Badges (R3) Suite', () => {
    beforeEach(() => {
        localStorage.clear();
        useAppStore.setState({
            userData: {
                profile: {} as any,
                library: mockLibrary as any,
                routines: [
                    {
                        id: 'rot_1',
                        name: 'Scheda A',
                        exercises: [
                            { exId: 'ex_bench', setsCount: 3 },
                            { exId: 'ex_squat', setsCount: 4 }
                        ]
                    }
                ],
                trainingCycles: [],
                customFoods: [],
                supplements: [],
                history: [],
                nutrition: {},
                nutritionPlanning: {} as any,
                activeWorkout: null,
                activeCycleId: null
            },
            localWorkout: null,
            syncing: false,
            saveError: null
        });
    });

    // =========================================================================
    // SECTION 1: Schema & Data Model Integrity (SessionExercise ID)
    // =========================================================================
    describe('1. Schema & Data Model: SessionExercise ID Stability', () => {
        it('1.1: SessionExerciseSchema parses and preserves id', () => {
            const raw = {
                id: 'se_12345',
                exId: 'ex_bench',
                sessionNote: 'Note test',
                sets: [{ id: 's_1', kg: '100', reps: '5' }]
            };
            const parsed = SessionExerciseSchema.parse(raw);
            expect(parsed.id).toBe('se_12345');
            expect(parsed.exId).toBe('ex_bench');
        });

        it('1.2: SessionExerciseSchema gracefully handles missing id with undefined', () => {
            const raw = {
                exId: 'ex_bench',
                sessionNote: '',
                sets: []
            };
            const parsed = SessionExerciseSchema.parse(raw);
            expect(parsed.id).toBeUndefined();
            expect(parsed.exId).toBe('ex_bench');
        });

        it('1.3: startWorkout automatically generates stable id (se_...) for each exercise', async () => {
            const { result } = renderHook(() => useWorkoutSession());

            await act(async () => {
                await result.current.startWorkout('rot_1');
            });

            const active = useAppStore.getState().localWorkout;
            expect(active).not.toBeNull();
            expect(active?.exercises.length).toBe(2);
            expect(active?.exercises[0].id).toBeDefined();
            expect(active?.exercises[0].id).toMatch(/^se_/);
            expect(active?.exercises[1].id).toBeDefined();
            expect(active?.exercises[1].id).toMatch(/^se_/);
            expect(active?.exercises[0].id).not.toBe(active?.exercises[1].id);
        });

        it('1.4: addExtraExercise assigns new unique id (se_...)', () => {
            const initialWorkout: WorkoutSession = {
                id: 'ws_1',
                routineId: 'rot_1',
                routineName: 'Scheda A',
                date: '2026-08-20',
                exercises: [
                    { id: 'se_existing_1', exId: 'ex_bench', sessionNote: '', sets: [] }
                ]
            };
            useAppStore.setState({ localWorkout: initialWorkout });

            const { result } = renderHook(() => useWorkoutSession());

            act(() => {
                result.current.addExtraExercise('ex_pullup');
            });

            const updated = useAppStore.getState().localWorkout;
            expect(updated?.exercises.length).toBe(2);
            expect(updated?.exercises[0].id).toBe('se_existing_1');
            expect(updated?.exercises[1].id).toBeDefined();
            expect(updated?.exercises[1].id).toMatch(/^se_/);
            expect(updated?.exercises[1].id).not.toBe('se_existing_1');
        });

        it('1.5: startEditHistoricalWorkout ensures all exercises have id', async () => {
            const historicalWorkout: WorkoutSession = {
                id: 'w_hist_1',
                date: '2026-08-10',
                routineName: 'Storico',
                exercises: [
                    { exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '80', reps: '8' }] }
                ]
            };

            const { result } = renderHook(() => useWorkoutSession());

            await act(async () => {
                await result.current.startEditHistoricalWorkout(historicalWorkout);
            });

            const active = useAppStore.getState().localWorkout;
            expect(active?.isEditingHistory).toBe(true);
            expect(active?.exercises[0].id).toBeDefined();
            expect(active?.exercises[0].id).toMatch(/^se_/);
        });

        it('1.6: getInitialLocalWorkout assigns id fallback to legacy exercises without id', () => {
            const legacyWorkout = {
                id: 'w_legacy',
                routineName: 'Legacy',
                exercises: [
                    { exId: 'ex_bench', sessionNote: '', sets: [] },
                    { id: 'se_preserved', exId: 'ex_squat', sessionNote: '', sets: [] }
                ]
            };
            localStorage.setItem('logbook_local_workout', JSON.stringify(legacyWorkout));

            const initial = getInitialLocalWorkout();
            expect(initial).not.toBeNull();
            expect(initial?.exercises[0].id).toBeDefined();
            expect(initial?.exercises[0].id).toMatch(/^se_/);
            expect(initial?.exercises[1].id).toBe('se_preserved');
        });
    });

    // =========================================================================
    // SECTION 2: Exercise Reordering Logic & Boundary Guards (R2)
    // =========================================================================
    describe('2. Exercise Reordering Logic & Boundary Guards (useWorkoutSetMutations)', () => {
        it('2.1: moveExercise down swaps adjacent exercises correctly', () => {
            const initialWorkout: WorkoutSession = {
                id: 'w1',
                exercises: [
                    { id: 'se_1', exId: 'ex_bench', sessionNote: '', sets: [] },
                    { id: 'se_2', exId: 'ex_squat', sessionNote: '', sets: [] },
                    { id: 'se_3', exId: 'ex_pullup', sessionNote: '', sets: [] }
                ]
            };

            let workoutState: WorkoutSession | null = initialWorkout;
            const setLocalWorkout = vi.fn((updater: any) => {
                workoutState = typeof updater === 'function' ? updater(workoutState) : updater;
            });
            const showConfirm = vi.fn().mockResolvedValue(true);

            const { result } = renderHook(() => useWorkoutSetMutations({ setLocalWorkout, showConfirm }));

            act(() => {
                result.current.moveExercise(0, 'down');
            });

            expect(workoutState?.exercises[0].id).toBe('se_2');
            expect(workoutState?.exercises[1].id).toBe('se_1');
            expect(workoutState?.exercises[2].id).toBe('se_3');
        });

        it('2.2: moveExercise up swaps adjacent exercises correctly', () => {
            const initialWorkout: WorkoutSession = {
                id: 'w1',
                exercises: [
                    { id: 'se_1', exId: 'ex_bench', sessionNote: '', sets: [] },
                    { id: 'se_2', exId: 'ex_squat', sessionNote: '', sets: [] },
                    { id: 'se_3', exId: 'ex_pullup', sessionNote: '', sets: [] }
                ]
            };

            let workoutState: WorkoutSession | null = initialWorkout;
            const setLocalWorkout = vi.fn((updater: any) => {
                workoutState = typeof updater === 'function' ? updater(workoutState) : updater;
            });
            const showConfirm = vi.fn().mockResolvedValue(true);

            const { result } = renderHook(() => useWorkoutSetMutations({ setLocalWorkout, showConfirm }));

            act(() => {
                result.current.moveExercise(2, 'up');
            });

            expect(workoutState?.exercises[0].id).toBe('se_1');
            expect(workoutState?.exercises[1].id).toBe('se_3');
            expect(workoutState?.exercises[2].id).toBe('se_2');
        });

        it('2.3: Boundary Guard: moving index 0 up does nothing (no mutation)', () => {
            const initialWorkout: WorkoutSession = {
                id: 'w1',
                exercises: [
                    { id: 'se_1', exId: 'ex_bench', sessionNote: '', sets: [] },
                    { id: 'se_2', exId: 'ex_squat', sessionNote: '', sets: [] }
                ]
            };

            let workoutState: WorkoutSession | null = initialWorkout;
            const setLocalWorkout = vi.fn((updater: any) => {
                workoutState = typeof updater === 'function' ? updater(workoutState) : updater;
            });
            const showConfirm = vi.fn().mockResolvedValue(true);

            const { result } = renderHook(() => useWorkoutSetMutations({ setLocalWorkout, showConfirm }));

            act(() => {
                result.current.moveExercise(0, 'up'); // targetIndex = -1
            });

            expect(workoutState?.exercises[0].id).toBe('se_1');
            expect(workoutState?.exercises[1].id).toBe('se_2');
        });

        it('2.4: Boundary Guard: moving last index down does nothing (no mutation)', () => {
            const initialWorkout: WorkoutSession = {
                id: 'w1',
                exercises: [
                    { id: 'se_1', exId: 'ex_bench', sessionNote: '', sets: [] },
                    { id: 'se_2', exId: 'ex_squat', sessionNote: '', sets: [] }
                ]
            };

            let workoutState: WorkoutSession | null = initialWorkout;
            const setLocalWorkout = vi.fn((updater: any) => {
                workoutState = typeof updater === 'function' ? updater(workoutState) : updater;
            });
            const showConfirm = vi.fn().mockResolvedValue(true);

            const { result } = renderHook(() => useWorkoutSetMutations({ setLocalWorkout, showConfirm }));

            act(() => {
                result.current.moveExercise(1, 'down'); // targetIndex = 2 >= total 2
            });

            expect(workoutState?.exercises[0].id).toBe('se_1');
            expect(workoutState?.exercises[1].id).toBe('se_2');
        });

        it('2.5: reorderExercises with invalid indices returns original state immutably', () => {
            const initialWorkout: WorkoutSession = {
                id: 'w1',
                exercises: [
                    { id: 'se_1', exId: 'ex_bench', sessionNote: '', sets: [] }
                ]
            };

            let workoutState: WorkoutSession | null = initialWorkout;
            const setLocalWorkout = vi.fn((updater: any) => {
                workoutState = typeof updater === 'function' ? updater(workoutState) : updater;
            });
            const showConfirm = vi.fn().mockResolvedValue(true);

            const { result } = renderHook(() => useWorkoutSetMutations({ setLocalWorkout, showConfirm }));

            act(() => {
                result.current.reorderExercises(0, 0); // same index
                result.current.reorderExercises(-1, 0); // negative
                result.current.reorderExercises(0, 5); // out of bounds
            });

            expect(workoutState?.exercises.length).toBe(1);
            expect(workoutState?.exercises[0].id).toBe('se_1');
        });

        it('2.6: moveExercise works via useWorkoutSession hook', () => {
            const initialWorkout: WorkoutSession = {
                id: 'w1',
                exercises: [
                    { id: 'se_1', exId: 'ex_bench', sessionNote: '', sets: [] },
                    { id: 'se_2', exId: 'ex_squat', sessionNote: '', sets: [] }
                ]
            };
            useAppStore.setState({ localWorkout: initialWorkout });

            const { result } = renderHook(() => useWorkoutSession());

            act(() => {
                result.current.moveExercise(0, 'down');
            });

            const active = useAppStore.getState().localWorkout;
            expect(active?.exercises[0].id).toBe('se_2');
            expect(active?.exercises[1].id).toBe('se_1');
        });
    });

    // =========================================================================
    // SECTION 3: UI Card Controls, Badges & React.memo (R2 & R3)
    // =========================================================================
    describe('3. SessionExerciseCard UI Controls & Dynamic Muscle Badges', () => {
        const dummyPast = [{ date: '2026-08-15', sets: [{ kg: '90', reps: '6' }], note: 'Buone sensazioni' }];

        it('3.1: Position dropdown renders #N label, opens on click, and calls onMoveToPosition when a target is selected', () => {
            const onMove = vi.fn();
            const onMoveToPosition = vi.fn();
            const exItem = { id: 'se_1', exId: 'ex_bench', sets: [{ id: 's1', kg: '80', reps: '8' }], sessionNote: '' };
            const libDef = mockLibrary[0];

            // Render first item of 3
            render(
                <SessionExerciseCard
                    exItem={exItem}
                    exIndex={0}
                    totalExercises={3}
                    libDef={libDef}
                    pastWorkouts={dummyPast}
                    isHistoryOpen={false}
                    isSetupOpen={false}
                    openSpecialMenuId={null}
                    onMoveExercise={onMove}
                    onMoveToPosition={onMoveToPosition}
                    onToggleHistory={vi.fn()}
                    onToggleSetup={vi.fn()}
                    onRemoveExercise={vi.fn()}
                    onUpdateSetupNote={vi.fn()}
                    onUpdateSessionNote={vi.fn()}
                    onAddSet={vi.fn()}
                    onRemoveSet={vi.fn()}
                    onUpdateSet={vi.fn()}
                    onAddSpecialSet={vi.fn()}
                    onUpdateSpecialSet={vi.fn()}
                    onRemoveSpecialSet={vi.fn()}
                    onToggleSpecialMenu={vi.fn()}
                />
            );

            // Position dropdown button shows current index
            const posBtn = screen.getByRole('button', { name: 'Cambia posizione esercizio' }) as HTMLButtonElement;
            expect(posBtn).not.toBeNull();
            expect(posBtn.textContent?.trim()).toMatch(/#\s*1/);

            // Open dropdown
            fireEvent.click(posBtn);

            // Should show position options for 3 exercises
            const posOptions = screen.getAllByRole('button', { name: /posizione/i });
            // Current position shows checkmark, other positions are clickable targets
            expect(posOptions.length).toBeGreaterThanOrEqual(3);

            // Click "2ª posizione" (index 1) to move exercise from 0 to 1
            const targetBtn = posOptions.find(b => b.textContent?.includes('2ª posizione'));
            expect(targetBtn).not.toBeNull();
            fireEvent.click(targetBtn!);
            expect(onMoveToPosition).toHaveBeenCalledWith(0, 1);
        });


        it('3.3: Gracefully handles missing libDef without crashing', () => {
            const exItem = { id: 'se_deleted', exId: 'ex_deleted_id', sets: [], sessionNote: '' };

            const { container } = render(
                <SessionExerciseCard
                    exItem={exItem}
                    exIndex={0}
                    totalExercises={1}
                    libDef={undefined}
                    pastWorkouts={[]}
                    isHistoryOpen={false}
                    isSetupOpen={false}
                    openSpecialMenuId={null}
                    onToggleHistory={vi.fn()}
                    onToggleSetup={vi.fn()}
                    onRemoveExercise={vi.fn()}
                    onUpdateSetupNote={vi.fn()}
                    onUpdateSessionNote={vi.fn()}
                    onAddSet={vi.fn()}
                    onRemoveSet={vi.fn()}
                    onUpdateSet={vi.fn()}
                    onAddSpecialSet={vi.fn()}
                    onUpdateSpecialSet={vi.fn()}
                    onRemoveSpecialSet={vi.fn()}
                    onToggleSpecialMenu={vi.fn()}
                />
            );

            expect(container.textContent).toContain('Esercizio rimosso');
            const badges = container.querySelectorAll('.badge');
            expect(badges.length).toBe(0);
        });

        it('3.4: React.memo custom comparator correctly re-evaluates when totalExercises or exIndex changes', () => {
            const exItem = { id: 'se_1', exId: 'ex_bench', sets: [], sessionNote: '' };
            const libDef = mockLibrary[0];
            let renderCount = 0;

            const WrappedCard: React.FC<any> = (props) => {
                renderCount++;
                return <SessionExerciseCard {...props} />;
            };

            const initialProps = {
                exItem,
                exIndex: 0,
                totalExercises: 2,
                libDef,
                pastWorkouts: [],
                isHistoryOpen: false,
                isSetupOpen: false,
                openSpecialMenuId: null,
                onToggleHistory: () => {},
                onToggleSetup: () => {},
                onRemoveExercise: () => {},
                onUpdateSetupNote: () => {},
                onUpdateSessionNote: () => {},
                onAddSet: () => {},
                onRemoveSet: () => {},
                onUpdateSet: () => {},
                onAddSpecialSet: () => {},
                onUpdateSpecialSet: () => {},
                onRemoveSpecialSet: () => {},
                onToggleSpecialMenu: () => {}
            };

            const { rerender } = render(<WrappedCard {...initialProps} />);
            expect(renderCount).toBe(1);

            // Re-render with new callback references but SAME props -> Memo should prevent inner re-render
            rerender(<WrappedCard {...initialProps} onToggleHistory={() => {}} />);
            expect(renderCount).toBe(2); // WrappedCard renders, but SessionExerciseCard memo skips inner render

            // Re-render with changed totalExercises (e.g. 3) -> Memo detects change
            rerender(<WrappedCard {...initialProps} totalExercises={3} />);
            expect(renderCount).toBe(3);
        });
    });

    // =========================================================================
    // SECTION 4: TrainingSession View Integration & Accordion Sync (R2)
    // =========================================================================
    describe('4. TrainingSession View Integration & Accordion Synchronization', () => {
        it('4.1: Moving an exercise updates its position in TrainingSession UI', async () => {
            const activeWorkout: WorkoutSession = {
                id: 'ws_active_1',
                routineId: 'rot_1',
                routineName: 'Scheda A',
                date: '2026-08-20',
                globalStartTime: Date.now(),
                exercises: [
                    { id: 'se_1', exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '80', reps: '8' }] },
                    { id: 'se_2', exId: 'ex_squat', sessionNote: '', sets: [{ id: 's2', kg: '120', reps: '5' }] }
                ]
            };

            const { container } = renderWithProviders(<TrainingSession />, {
                localWorkout: activeWorkout,
                userData: {
                    ...useAppStore.getState().userData!,
                    library: mockLibrary as any
                }
            });

            // Exercise headings in order
            const headings = container.querySelectorAll('h2');
            expect(headings[0].textContent).toBe('Panca piana con bilanciere');
            expect(headings[1].textContent).toBe('Squat con bilanciere');

            // Click position dropdown of first exercise and move to position 2
            const posBtns = screen.getAllByRole('button', { name: 'Cambia posizione esercizio' });
            fireEvent.click(posBtns[0]); // open dropdown for exercise #1
            const posOption2 = screen.getAllByRole('button', { name: /2ª posizione/i })[0];
            fireEvent.click(posOption2);

            // Workout state in store should now have Squat first, Bench second
            const state = useAppStore.getState();
            expect(state.localWorkout?.exercises[0].id).toBe('se_2');
            expect(state.localWorkout?.exercises[1].id).toBe('se_1');
        });

        it('4.2: Accordion panel (Storico/Setup) index synchronizes when exercise is moved', async () => {
            const activeWorkout: WorkoutSession = {
                id: 'ws_active_1',
                routineId: 'rot_1',
                routineName: 'Scheda A',
                date: '2026-08-20',
                globalStartTime: Date.now(),
                exercises: [
                    { id: 'se_1', exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '80', reps: '8' }] },
                    { id: 'se_2', exId: 'ex_squat', sessionNote: '', sets: [{ id: 's2', kg: '120', reps: '5' }] }
                ]
            };

            const { container } = renderWithProviders(<TrainingSession />, {
                localWorkout: activeWorkout,
                userData: {
                    ...useAppStore.getState().userData!,
                    library: mockLibrary as any
                }
            });

            // Open Setup on first exercise (Bench at index 0)
            const setupBtns = screen.getAllByRole('button', { name: /Setup/i });
            fireEvent.click(setupBtns[0]);

            // Setup input should be visible for ex_bench
            const setupInput = container.querySelector('#setup-ex_bench') as HTMLInputElement;
            expect(setupInput).not.toBeNull();
            expect(setupInput.defaultValue).toBe('Gomiti a 45 gradi');

            // Now move index 0 to position 2 via dropdown
            const posBtns2 = screen.getAllByRole('button', { name: 'Cambia posizione esercizio' });
            fireEvent.click(posBtns2[0]); // open dropdown for exercise #1
            const posOption2b = screen.getAllByRole('button', { name: /2ª posizione/i })[0];
            fireEvent.click(posOption2b);

            // After move, Setup panel should remain open on ex_bench (now at index 1)
            const setupInputAfter = container.querySelector('#setup-ex_bench') as HTMLInputElement;
            expect(setupInputAfter).not.toBeNull();
            expect(setupInputAfter.defaultValue).toBe('Gomiti a 45 gradi');

            // Setup for ex_squat should NOT be open
            const squatSetupInput = container.querySelector('#setup-ex_squat');
            expect(squatSetupInput).toBeNull();
        });
    });
});
