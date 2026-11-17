import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAppStore } from '../../../src/store/useAppStore';
import { captureSession } from '../../../src/lib/sync/session';
import { useWorkoutSetMutations } from '../../../src/hooks/workout/useWorkoutSetMutations';
import type { WorkoutSession } from '../../../src/types';

describe('Workout exercise reordering', () => {
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

        describe('R2: Riordino Esercizi in Sessione Live', () => {
            it('T1.2.1: useWorkoutSetMutations.reorderExercises moves exercise from index 0 down to index 1', () => {
                let localWorkout: WorkoutSession | null = {
                    id: 'w_active',
                    routineName: 'Push Day',
                    exercises: [
                        { exId: 'ex_bench', sessionNote: 'Bench', sets: [{ id: 's1', kg: '80', reps: '10' }] },
                        { exId: 'ex_incline', sessionNote: 'Incline', sets: [{ id: 's2', kg: '60', reps: '10' }] }
                    ]
                };

                const setLocalWorkout = (updater: any) => {
                    localWorkout = typeof updater === 'function' ? updater(localWorkout) : updater;
                };

                const { result } = renderHook(() =>
                    useWorkoutSetMutations({ setLocalWorkout, showConfirm: vi.fn().mockResolvedValue(true) })
                );

                act(() => {
                    result.current.reorderExercises(0, 1);
                });

                expect(localWorkout?.exercises[0].exId).toBe('ex_incline');
                expect(localWorkout?.exercises[1].exId).toBe('ex_bench');
            });

            it('T1.2.2: useWorkoutSetMutations.reorderExercises moves exercise from index 1 up to index 0', () => {
                let localWorkout: WorkoutSession | null = {
                    id: 'w_active',
                    routineName: 'Leg Day',
                    exercises: [
                        { exId: 'ex_squat', sessionNote: 'Squat', sets: [{ id: 's1', kg: '120', reps: '5' }] },
                        { exId: 'ex_legpress', sessionNote: 'Press', sets: [{ id: 's2', kg: '200', reps: '10' }] }
                    ]
                };

                const setLocalWorkout = (updater: any) => {
                    localWorkout = typeof updater === 'function' ? updater(localWorkout) : updater;
                };

                const { result } = renderHook(() =>
                    useWorkoutSetMutations({ setLocalWorkout, showConfirm: vi.fn().mockResolvedValue(true) })
                );

                act(() => {
                    result.current.reorderExercises(1, 0);
                });

                expect(localWorkout?.exercises[0].exId).toBe('ex_legpress');
                expect(localWorkout?.exercises[1].exId).toBe('ex_squat');
            });

            it('T1.2.3: Reordering in a 3-exercise workout swaps target positions while keeping other items intact', () => {
                let localWorkout: WorkoutSession | null = {
                    id: 'w_active',
                    exercises: [
                        { exId: 'ex1', sessionNote: '1', sets: [] },
                        { exId: 'ex2', sessionNote: '2', sets: [] },
                        { exId: 'ex3', sessionNote: '3', sets: [] }
                    ]
                };

                const setLocalWorkout = (updater: any) => {
                    localWorkout = typeof updater === 'function' ? updater(localWorkout) : updater;
                };

                const { result } = renderHook(() =>
                    useWorkoutSetMutations({ setLocalWorkout, showConfirm: vi.fn().mockResolvedValue(true) })
                );

                // Move ex1 (index 0) to index 2
                act(() => {
                    result.current.reorderExercises(0, 2);
                });

                expect(localWorkout?.exercises.map(e => e.exId)).toEqual(['ex2', 'ex3', 'ex1']);
            });

            it('T1.2.4: reorderExercises preserves all inner set data (kg, reps, done) on moved exercises', () => {
                let localWorkout: WorkoutSession | null = {
                    id: 'w_active',
                    exercises: [
                        {
                            exId: 'ex_curl',
                            sessionNote: 'Biceps',
                            sets: [
                                { id: 's1', kg: '14', reps: '12', done: true },
                                { id: 's2', kg: '16', reps: '10', done: false }
                            ]
                        },
                        {
                            exId: 'ex_pushdown',
                            sessionNote: 'Triceps',
                            sets: [{ id: 's3', kg: '25', reps: '15', done: true }]
                        }
                    ]
                };

                const setLocalWorkout = (updater: any) => {
                    localWorkout = typeof updater === 'function' ? updater(localWorkout) : updater;
                };

                const { result } = renderHook(() =>
                    useWorkoutSetMutations({ setLocalWorkout, showConfirm: vi.fn().mockResolvedValue(true) })
                );

                act(() => {
                    result.current.reorderExercises(0, 1);
                });

                expect(localWorkout?.exercises[1].exId).toBe('ex_curl');
                expect(localWorkout?.exercises[1].sets).toEqual([
                    { id: 's1', kg: '14', reps: '12', done: true },
                    { id: 's2', kg: '16', reps: '10', done: false }
                ]);
            });

            it('T1.2.5: reorderExercises preserves custom session notes on moved exercises', () => {
                let localWorkout: WorkoutSession | null = {
                    id: 'w_active',
                    exercises: [
                        { exId: 'ex1', sessionNote: 'Spalle calde, alzare peso', sets: [] },
                        { exId: 'ex2', sessionNote: 'Gomito ok', sets: [] }
                    ]
                };

                const setLocalWorkout = (updater: any) => {
                    localWorkout = typeof updater === 'function' ? updater(localWorkout) : updater;
                };

                const { result } = renderHook(() =>
                    useWorkoutSetMutations({ setLocalWorkout, showConfirm: vi.fn().mockResolvedValue(true) })
                );

                act(() => {
                    result.current.reorderExercises(0, 1);
                });

                expect(localWorkout?.exercises[1].sessionNote).toBe('Spalle calde, alzare peso');
                expect(localWorkout?.exercises[0].sessionNote).toBe('Gomito ok');
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

        describe('R2 Boundaries (Workout Reordering Edge Cases)', () => {
            it('T2.2: Adding an isometry set writes the current segment shape', () => {
                let localWorkout: WorkoutSession | null = {
                    id: 'w-isometry',
                    exercises: [{
                        id: 'se-hold',
                        exId: 'hold',
                        sessionNote: '',
                        sets: [],
                        defaultTechnique: 'isometrics',
                    } as WorkoutSession['exercises'][number]],
                };
                const setLocalWorkout = (updater: any) => {
                    localWorkout = typeof updater === 'function' ? updater(localWorkout) : updater;
                };
                const { result } = renderHook(() =>
                    useWorkoutSetMutations({ setLocalWorkout, showConfirm: vi.fn().mockResolvedValue(true) })
                );
                act(() => result.current.addSet(0));

                const set = localWorkout?.exercises[0].sets[0];
                expect(set?.segments).toEqual([
                    expect.objectContaining({ id: expect.any(String), kg: '', reps: '', time: '', technique: 'isometry' }),
                ]);
                expect(set).not.toHaveProperty('isometrics');
                expect(set).not.toHaveProperty('dropsets');
            });

            it('T2.2.1: Single-exercise session reorder is a safe no-op', () => {
                let localWorkout: WorkoutSession | null = {
                    id: 'w1',
                    exercises: [{ exId: 'ex1', sessionNote: '', sets: [] }]
                };

                const setLocalWorkout = (updater: any) => {
                    localWorkout = typeof updater === 'function' ? updater(localWorkout) : updater;
                };

                const { result } = renderHook(() =>
                    useWorkoutSetMutations({ setLocalWorkout, showConfirm: vi.fn().mockResolvedValue(true) })
                );

                act(() => {
                    result.current.reorderExercises(0, 0);
                });

                expect(localWorkout?.exercises.length).toBe(1);
                expect(localWorkout?.exercises[0].exId).toBe('ex1');
            });

            it('T2.2.2: Rapid sequential reordering maintains state consistency', () => {
                let localWorkout: WorkoutSession | null = {
                    id: 'w1',
                    exercises: [
                        { exId: 'exA', sessionNote: 'A', sets: [] },
                        { exId: 'exB', sessionNote: 'B', sets: [] },
                        { exId: 'exC', sessionNote: 'C', sets: [] }
                    ]
                };

                const setLocalWorkout = (updater: any) => {
                    localWorkout = typeof updater === 'function' ? updater(localWorkout) : updater;
                };

                const { result } = renderHook(() =>
                    useWorkoutSetMutations({ setLocalWorkout, showConfirm: vi.fn().mockResolvedValue(true) })
                );

                act(() => {
                    result.current.reorderExercises(0, 1); // B, A, C
                    result.current.reorderExercises(1, 2); // B, C, A
                    result.current.reorderExercises(0, 2); // C, A, B
                });

                expect(localWorkout?.exercises.map(e => e.exId)).toEqual(['exC', 'exA', 'exB']);
            });

            it('T2.2.3: Reordering exercise with dropsets and isometrics retains nested structures', () => {
                let localWorkout: WorkoutSession | null = {
                    id: 'w1',
                    exercises: [
                        {
                            exId: 'ex_complex',
                            sessionNote: 'Heavy',
                            sets: [
                                {
                                    id: 's1',
                                    kg: '100',
                                    reps: '6',
                                    segments: [
                                        { technique: 'dropset' as const, id: 'ds1', kg: '70', reps: '6' },
                                        { technique: 'isometry' as const, reps: '', id: 'iso1', kg: '50', time: '15' }
                                    ],
                                }
                            ]
                        },
                        { exId: 'ex_simple', sessionNote: '', sets: [{ id: 's2', kg: '20', reps: '10' }] }
                    ]
                };

                const setLocalWorkout = (updater: any) => {
                    localWorkout = typeof updater === 'function' ? updater(localWorkout) : updater;
                };

                const { result } = renderHook(() =>
                    useWorkoutSetMutations({ setLocalWorkout, showConfirm: vi.fn().mockResolvedValue(true) })
                );

                act(() => {
                    result.current.reorderExercises(0, 1);
                });

                const complexEx = localWorkout?.exercises[1];
                expect(complexEx?.exId).toBe('ex_complex');
                expect(complexEx?.sets[0].segments?.filter(segment => segment.technique === 'dropset')?.[0].kg).toBe('70');
                expect(complexEx?.sets[0].segments?.filter(segment => segment.technique === 'isometry')?.[0].time).toBe('15');
            });

            it('T2.2.4: Reorder with cardio tracking exercise preserves distance, time, speed, incline', () => {
                let localWorkout: WorkoutSession | null = {
                    id: 'w1',
                    exercises: [
                        {
                            exId: 'ex_treadmill',
                            sessionNote: 'Warmup',
                            sets: [{ id: 's_cardio', kg: '', reps: '', time: '20', distance: '3.5', speed: '10.5', incline: '2.0', kcal: '210' }]
                        },
                        { exId: 'ex_bench', sessionNote: '', sets: [] }
                    ]
                };

                const setLocalWorkout = (updater: any) => {
                    localWorkout = typeof updater === 'function' ? updater(localWorkout) : updater;
                };

                const { result } = renderHook(() =>
                    useWorkoutSetMutations({ setLocalWorkout, showConfirm: vi.fn().mockResolvedValue(true) })
                );

                act(() => {
                    result.current.reorderExercises(0, 1);
                });

                const cardioEx = localWorkout?.exercises[1];
                expect(cardioEx?.sets[0].distance).toBe('3.5');
                expect(cardioEx?.sets[0].speed).toBe('10.5');
                expect(cardioEx?.sets[0].incline).toBe('2.0');
            });

            it('T2.2.5: Empty exercises list in localWorkout handles reorder attempts safely without crashing', () => {
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

                expect(() => {
                    act(() => {
                        result.current.reorderExercises(0, 0);
                    });
                }).not.toThrow();

                expect(localWorkout?.exercises).toEqual([]);
            });
        });
    });
});
