import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, renderHook } from '@testing-library/react';
import { renderWithProviders, emptyUserData, idbStore } from '../../setup';
import { useAppStore } from '../../../src/store/useAppStore';
import { captureSession } from '../../../src/lib/sync/session';
import { initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { useWorkoutSetMutations } from '../../../src/hooks/workout/useWorkoutSetMutations';
import { useWorkoutSession } from '../../../src/hooks/useWorkoutSession';
import SessionExerciseCard from '../../../src/components/Training/session/SessionExerciseCard';
import type { WorkoutSession, WorkoutRoutine } from '../../../src/types';
import { protectedDeviceKey, readDeviceValueStrict } from '../../../src/lib/sync/deviceStorage';

describe('Ad-hoc workout exercises', () => {
    describe('Feature coverage', () => {
    beforeEach(async () => {
        window.localStorage.clear();
        localStorage.setItem(`logbook:v2:${captureSession().owner}:health-consent-generation`, '1');
        useAppStore.getState().resetStore();
        useAppStore.setState({ dataOwner: captureSession().owner });
        vi.clearAllMocks();
    });

    afterEach(() => {
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.restoreAllMocks();
    });

        describe('R6: Esercizi Ad-Hoc in Sessione', () => {
            it('T1.6.1: addExtraExercise adds an ad-hoc exercise to localWorkout without modifying routines blueprint', () => {
                let localWorkout: WorkoutSession | null = {
                    id: 'w1',
                    routineId: 'r1',
                    routineName: 'Push Blueprint',
                    exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '80', reps: '10' }] }]
                };

                const setLocalWorkout = (updater: any) => {
                    localWorkout = typeof updater === 'function' ? updater(localWorkout) : updater;
                };

                const { result } = renderHook(() =>
                    useWorkoutSetMutations({ setLocalWorkout, showConfirm: vi.fn().mockResolvedValue(true) })
                );

                act(() => {
                    result.current.addExtraExercise('ex_extra_lateral_raises');
                });

                expect(localWorkout?.exercises.length).toBe(2);
                expect(localWorkout?.exercises[1].exId).toBe('ex_extra_lateral_raises');
                expect(localWorkout?.exercises[1].sets.length).toBe(1);
            });

            it('T1.6.2: removeActiveExercise prompts confirmation and removes target exercise from localWorkout', async () => {
                let localWorkout: WorkoutSession | null = {
                    id: 'w1',
                    exercises: [
                        { id: 'se-ex1', exId: 'ex1', sessionNote: '', sets: [] },
                        { id: 'se-ex2', exId: 'ex2', sessionNote: '', sets: [] }
                    ]
                };

                useAppStore.setState({ localWorkout });
                const setLocalWorkout = (updater: any) => {
                    localWorkout = typeof updater === 'function' ? updater(localWorkout) : updater;
                    useAppStore.setState({ localWorkout });
                };

                const showConfirm = vi.fn().mockResolvedValue(true);
                const { result } = renderHook(() =>
                    useWorkoutSetMutations({ setLocalWorkout, showConfirm })
                );

                await act(async () => {
                    await result.current.removeActiveExercise(0);
                });

                expect(showConfirm).toHaveBeenCalledWith(
                    expect.stringContaining('Rimuovere questo esercizio')
                );
                expect(localWorkout?.exercises.length).toBe(1);
                expect(localWorkout?.exercises[0].exId).toBe('ex2');
            });

            it('T1.6.3: Ad-hoc exercise sets can be populated with weight and rep values', () => {
                let localWorkout: WorkoutSession | null = {
                    id: 'w1',
                    exercises: [
                        { exId: 'ex_adhoc', sessionNote: '', sets: [{ id: 's_adhoc_1', kg: '', reps: '' }] }
                    ]
                };

                const setLocalWorkout = (updater: any) => {
                    localWorkout = typeof updater === 'function' ? updater(localWorkout) : updater;
                };

                const { result } = renderHook(() =>
                    useWorkoutSetMutations({ setLocalWorkout, showConfirm: vi.fn().mockResolvedValue(true) })
                );

                act(() => {
                    result.current.updateSet(0, 's_adhoc_1', 'kg', '30');
                    result.current.updateSet(0, 's_adhoc_1', 'reps', '12');
                });

                expect(localWorkout?.exercises[0].sets[0].kg).toBe('30');
                expect(localWorkout?.exercises[0].sets[0].reps).toBe('12');
            });

            it('T1.6.4: Completing workout (endWorkout) saves ad-hoc exercises into history', async () => {
                await prepareUnlockedTestArchive('user:test-user-id');
                const initialRoutines: WorkoutRoutine[] = [
                    { id: 'r1', name: 'Upper Pure', exercises: [{ exId: 'ex_bench', setsCount: 3 }] }
                ];
                const activeSession: WorkoutSession = {
                    id: 'w_active_adhoc',
                    routineId: 'r1',
                    routineName: 'Upper Pure',
                    date: '2026-08-16',
                    globalStartTime: Date.now() - 3600000,
                    exercises: [
                        { exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '80', reps: '10' }] },
                        { exId: 'ex_adhoc_curl', sessionNote: 'Extra blast', sets: [{ id: 's2', kg: '16', reps: '12' }] }
                    ]
                };

                // Use the same owner and durable activeWorkout as the normal
                // encrypted session flow; a completion must not operate against
                // an empty/stale LocalEnvelope from a prior test.
                const owner = captureSession().owner;
                const initialData = {
                    ...emptyUserData, routines: initialRoutines,
                    history: [], activeWorkout: activeSession,
                };
                await initializeLocal(owner, initialData);
                useAppStore.setState({
                    userData: initialData, dataOwner: owner, localWorkout: activeSession,
                });

                const { result } = renderHook(() => useWorkoutSession());

                let completion!: Promise<unknown>;
                act(() => { completion = result.current.endWorkout(); });
                await vi.waitFor(() => {
                    expect(useAppStore.getState().userData?.history?.some(workout => workout.id === activeSession.id)).toBe(true);
                });
                await act(async () => {
                    // Drive the production flush boundary, rather than leaving
                    // a debounced cloud save pending inside React's async act.
                    await useAppStore.getState().flushPendingSyncs();
                    await completion;
                });

                const state = useAppStore.getState();
                expect(state.localWorkout).toBeNull();
                expect(state.userData?.history?.length).toBe(1);

                const savedWorkout = state.userData?.history?.[0];
                expect(savedWorkout?.exercises.length).toBe(2);
                expect(savedWorkout?.exercises[1].exId).toBe('ex_adhoc_curl');
                expect(savedWorkout?.exercises[1].sessionNote).toBe('Extra blast');
            const persisted = await readLocal(owner);
            expect(persisted?.data.history?.find(workout => workout.id === activeSession.id)?.exercises[1].exId).toBe('ex_adhoc_curl');
            });

            it('T1.6.5: Original routine blueprint in userData.routines remains strictly unchanged after session ends with ad-hoc exercises', async () => {
                await prepareUnlockedTestArchive('user:test-user-id');
                const originalRoutines: WorkoutRoutine[] = [
                    { id: 'r1', name: 'Upper Pure', exercises: [{ exId: 'ex_bench', setsCount: 3 }] }
                ];
                const activeSession: WorkoutSession = {
                    id: 'w_active_adhoc',
                    routineId: 'r1',
                    routineName: 'Upper Pure',
                    date: '2026-08-16',
                    globalStartTime: Date.now() - 3600000,
                    exercises: [
                        { exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '80', reps: '10' }] },
                        { exId: 'ex_adhoc_pushdown', sessionNote: '', sets: [{ id: 's2', kg: '25', reps: '15' }] }
                    ]
                };

                const owner = captureSession().owner;
                const initialData = {
                    ...emptyUserData, routines: originalRoutines,
                    history: [], activeWorkout: activeSession,
                };
                await initializeLocal(owner, initialData);
                useAppStore.setState({
                    userData: initialData, dataOwner: owner, localWorkout: activeSession,
                });

                const { result } = renderHook(() => useWorkoutSession());

                let completion!: Promise<unknown>;
                act(() => { completion = result.current.endWorkout(); });
                await vi.waitFor(() => {
                    expect(useAppStore.getState().userData?.history?.some(workout => workout.id === activeSession.id)).toBe(true);
                });
                await act(async () => {
                    // Drive the production flush boundary, rather than leaving
                    // a debounced cloud save pending inside React's async act.
                    await useAppStore.getState().flushPendingSyncs();
                    await completion;
                });

                const state = useAppStore.getState();
                expect(state.userData?.routines).toEqual(originalRoutines);
                expect(state.userData?.routines?.[0].exercises.length).toBe(1);
                expect(state.userData?.routines?.[0].exercises[0].exId).toBe('ex_bench');
            const persisted = await readLocal(owner);
            expect(persisted?.data.routines).toEqual(originalRoutines);
            });
        });
    });

    describe('Boundaries and corner cases', () => {
    beforeEach(async () => {
        window.localStorage.clear();
        localStorage.setItem(`logbook:v2:${captureSession().owner}:health-consent-generation`, '1');
        useAppStore.getState().resetStore();
        useAppStore.setState({ dataOwner: captureSession().owner });
        vi.clearAllMocks();
    });

    afterEach(() => {
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.restoreAllMocks();
    });

        describe('R6 Boundaries (Ad-Hoc Session Modifications)', () => {
            it('T2.6.1: Adding multiple ad-hoc exercises of the same library item creates distinct instances', () => {
                let localWorkout: WorkoutSession | null = {
                    id: 'w1',
                    exercises: []
                };

                const setLocalWorkout = (updater: any) => {
                    localWorkout = typeof updater === 'function' ? updater(localWorkout) : updater;
                };

                const { result } = renderHook(() =>
                    useWorkoutSetMutations({ setLocalWorkout, showConfirm: vi.fn().mockResolvedValue(true) })
                );

                act(() => {
                    result.current.addExtraExercise('ex_curl');
                    result.current.addExtraExercise('ex_curl');
                });

                expect(localWorkout?.exercises.length).toBe(2);
                expect(localWorkout?.exercises[0].exId).toBe('ex_curl');
                expect(localWorkout?.exercises[1].exId).toBe('ex_curl');
                expect(localWorkout?.exercises[0].sets[0].id).not.toBe(localWorkout?.exercises[1].sets[0].id);
            });

            it('T2.6.2: Removing all exercises during active workout leaves empty workout state without crash', async () => {
                let localWorkout: WorkoutSession | null = {
                    id: 'w1',
                    exercises: [{ id: 'se-ex1', exId: 'ex1', sessionNote: '', sets: [] }]
                };

                useAppStore.setState({ localWorkout });
                const setLocalWorkout = (updater: any) => {
                    localWorkout = typeof updater === 'function' ? updater(localWorkout) : updater;
                    useAppStore.setState({ localWorkout });
                };

                const { result } = renderHook(() =>
                    useWorkoutSetMutations({ setLocalWorkout, showConfirm: vi.fn().mockResolvedValue(true) })
                );

                await act(async () => {
                    await result.current.removeActiveExercise(0);
                });

                expect(localWorkout?.exercises).toEqual([]);
            });

            it('T2.6.3: Adding ad-hoc exercise and reordering it to index 0 maintains its set structure', () => {
                let localWorkout: WorkoutSession | null = {
                    id: 'w1',
                    exercises: [{ exId: 'ex_main', sessionNote: 'Main', sets: [{ id: 's1', kg: '100', reps: '5' }] }]
                };

                const setLocalWorkout = (updater: any) => {
                    localWorkout = typeof updater === 'function' ? updater(localWorkout) : updater;
                };

                const { result } = renderHook(() =>
                    useWorkoutSetMutations({ setLocalWorkout, showConfirm: vi.fn().mockResolvedValue(true) })
                );

                act(() => {
                    result.current.addExtraExercise('ex_adhoc_warmup');
                });

                expect(localWorkout?.exercises.length).toBe(2);

                act(() => {
                    result.current.reorderExercises(1, 0);
                });

                expect(localWorkout?.exercises[0].exId).toBe('ex_adhoc_warmup');
                expect(localWorkout?.exercises[1].exId).toBe('ex_main');
            });

            it('T2.6.4: Cardio input derives speed from stored distance and edited time', async () => {
                await prepareUnlockedTestArchive('user:test-user-id');
                localStorage.setItem(`logbook:v2:${captureSession().owner}:health-consent-generation`, '3');
                const libDef = { id: 'ex_bike', name: 'Cyclette', trackingType: 'cardio' as const };
                const exItem = {
                    exId: 'ex_bike',
                    sessionNote: '',
                    sets: [{ id: 's_cardio', kg: '', reps: '', time: '', distance: '3.5', speed: '' }]
                };

                const onUpdateSet = vi.fn();

                const { container } = renderWithProviders(
                    <SessionExerciseCard
                        exItem={exItem}
                        exIndex={0}
                        libDef={libDef}
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
                        onUpdateSet={onUpdateSet}
                        onAddSpecialSet={vi.fn()}
                        onUpdateSpecialSet={vi.fn()}
                        onRemoveSpecialSet={vi.fn()}
                        onToggleSpecialMenu={vi.fn()}
                    onUpdateSetTarget={vi.fn()}
                    onUpdateTechnicalStandard={vi.fn()}
                    />
                );

                const timeInput = container.querySelector('input[placeholder="es. 30"]') as HTMLInputElement;
                expect(timeInput).not.toBeNull();
                fireEvent.change(timeInput, { target: { value: '30' } });
                fireEvent.blur(timeInput);
                expect(onUpdateSet).toHaveBeenCalledWith(0, 's_cardio', 'time', '30');
                expect(onUpdateSet).toHaveBeenCalledWith(0, 's_cardio', 'speed', '7.00');
            });

            it('T2.6.5: Cancelling history edit (cancelHistoryEdit) discards ad-hoc edits cleanly', async () => {
                await prepareUnlockedTestArchive('user:test-user-id');
                const originalHistory: WorkoutSession[] = [
                    {
                        id: 'w_saved',
                        routineName: 'Original Workout',
                        exercises: [{ exId: 'ex1', sessionNote: 'Original', sets: [] }]
                    }
                ];

                const owner = captureSession().owner;
                const initialData = { ...emptyUserData, history: originalHistory, activeWorkout: null };
                if (owner.startsWith('user:')) {
                    localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
                }
                await initializeLocal(owner, initialData);
                const persistedHistoryBefore = (await readLocal(owner))?.data.history;
                useAppStore.setState({ userData: initialData, dataOwner: owner, localWorkout: null });

                const { result } = renderHook(() => useWorkoutSession());
                await act(async () => {
                    expect(await result.current.startEditHistoricalWorkout(originalHistory[0])).toBe(true);
                });
                const editing = useAppStore.getState().localWorkout;
                expect(editing?.isEditingHistory).toBe(true);
                expect(readDeviceValueStrict('history-editor-context', owner)).not.toBeNull();
                expect(localStorage.getItem(protectedDeviceKey('history-editor-context', owner)))
                    .toMatch(/^tlb-sealed:v1:/);

                // Ad-hoc changes are not a history save until explicitly confirmed.
                act(() => {
                    useAppStore.getState().setLocalWorkout({
                        ...editing!,
                        exercises: [
                            ...editing!.exercises,
                            { id: 'se_adhoc_added', exId: 'ex_adhoc_added', sessionNote: 'Added', sets: [] },
                        ],
                    });
                });
                await act(async () => {
                    expect(await result.current.cancelHistoryEdit()).toBe(true);
                });

                const state = useAppStore.getState();
                expect(state.localWorkout).toBeNull();
                expect(state.userData?.history?.[0].exercises.length).toBe(1);
                expect(state.userData?.history?.[0].exercises[0].exId).toBe('ex1');
                expect((await readLocal(owner))?.data.history).toEqual(persistedHistoryBefore);
                expect(readDeviceValueStrict('history-editor-context', owner)).toBeNull();
                expect(localStorage.getItem(protectedDeviceKey('history-editor-context', owner))).toBeNull();
                expect(idbStore['logbook:v2:' + owner]).toMatch(/^tlb-sealed:v1:/);
            });
        });
    });
});
