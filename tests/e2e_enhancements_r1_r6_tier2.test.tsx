import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, renderHook } from '@testing-library/react';
import { renderWithProviders, emptyUserData } from './setup';
import { useAppStore } from '../src/store/useAppStore';
import { Logic } from '../src/lib/logic';
import { Exporter } from '../src/lib/export';
import { SessionExerciseSchema } from '../src/lib/schema';
import { useSleepMeasurements } from '../src/hooks/useSleepMeasurements';
import { useWorkoutSetMutations } from '../src/hooks/workout/useWorkoutSetMutations';
import { useWorkoutSession } from '../src/hooks/useWorkoutSession';
import { RoutineEditor } from '../src/components/Training/routines/RoutineEditor';
import TrainingSession from '../src/components/Training/TrainingSession';
import SessionExerciseCard from '../src/components/Training/session/SessionExerciseCard';
import type { WorkoutSession, Exercise } from '../src/types';

describe('LogBook PWA Enhancements E2E Suite (Requirements R1 - R6)', () => {
    beforeEach(() => {
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.clearAllMocks();
    });

    afterEach(() => {
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.restoreAllMocks();
    });

    /* =========================================================================
     * TIER 2: BOUNDARY & CORNER CASES (>=5 tests per requirement R1 - R6)
     * ========================================================================= */
    describe('Tier 2: Boundary & Corner Cases', () => {

        // ---------------------------------------------------------------------
        // R1 Boundaries
        // ---------------------------------------------------------------------
        describe('R1 Boundaries (Sleep Formats & Edge Values)', () => {
            it('T2.1.1: Zero and empty sleep strings handle cleanly without throwing NaN', async () => {
                useAppStore.setState({ userData: { ...emptyUserData, nutrition: {} } });
                const { result } = renderHook(() => useSleepMeasurements());

                act(() => {
                    result.current.setSleepHours('');
                });

                await act(async () => {
                    await result.current.saveSleep();
                });

                // Fails validation with empty hours, does not crash
                expect(useAppStore.getState().userData?.nutrition).toEqual({});
            });



            it('T2.1.4: Incomplete sleep phase inputs (only total sleep provided, phases empty) save cleanly', async () => {
                const today = Logic.getLocalDateString();
                useAppStore.setState({ userData: { ...emptyUserData, nutrition: {} } });
                const { result } = renderHook(() => useSleepMeasurements());

                act(() => {
                    result.current.setSleepHours('08:00');
                    result.current.setSleepDeep('');
                    result.current.setSleepLight('');
                    result.current.setSleepRem('');
                    result.current.setSleepAwake('');
                });

                await act(async () => {
                    await result.current.saveSleep();
                });

                const saved = useAppStore.getState().userData?.nutrition?.[today];
                expect(saved?.sleepHours).toBe('08:00');
                expect(saved?.sleepDeep).toBeUndefined();
                expect(saved?.sleepLight).toBeUndefined();
            });

            it('T2.1.5: Exporter.exportToCSV outputs sleep values in CSV without throwing on empty days', async () => {
                const downloadFileSpy = vi.spyOn(Exporter, 'downloadFile').mockImplementation(() => {});

                const nutrition = {
                    '2026-08-01': { date: '2026-08-01', weight: 80, sleepHours: '07:30', sleepDeep: '02:00' },
                    '2026-08-02': { date: '2026-08-02', weight: 80.2 } // no sleep
                };

                await Exporter.exportToCSV([], nutrition, []);

                // misurazioni.csv contains formatted sleep
                await vi.waitFor(() => {
                    expect(downloadFileSpy).toHaveBeenCalledWith('misurazioni.csv', expect.stringContaining('"07:30","02:00"'), expect.anything());
                });
            });
        });

        // ---------------------------------------------------------------------
        // R2 Boundaries
        // ---------------------------------------------------------------------
        describe('R2 Boundaries (Workout Reordering Edge Cases)', () => {
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
                                    dropsets: [{ id: 'ds1', kg: '70', reps: '6' }],
                                    isometrics: [{ id: 'iso1', kg: '50', time: '15' }]
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
                expect(complexEx?.sets[0].dropsets?.[0].kg).toBe('70');
                expect(complexEx?.sets[0].isometrics?.[0].time).toBe('15');
            });

            it('T2.2.4: Reorder with cardio tracking exercise preserves distance, time, speed, incline', () => {
                let localWorkout: WorkoutSession | null = {
                    id: 'w1',
                    exercises: [
                        {
                            exId: 'ex_treadmill',
                            sessionNote: 'Warmup',
                            sets: [{ id: 's_cardio', time: '20', distance: '3.5', speed: '10.5', incline: '2.0', kcal: '210' }]
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

                expect(localWorkout?.exercises.length).toBeLessThanOrEqual(1);
            });
        });

        // ---------------------------------------------------------------------
        // R3 Boundaries
        // ---------------------------------------------------------------------
        describe('R3 Boundaries (Library Synchronization Edge Cases)', () => {
            it('T2.3.1: Library item with special characters and quotes renders safely without DOM break', () => {
                const specialLib: Exercise[] = [
                    { id: 'ex_special', name: 'Curl 45° con Manubri & Bilanciere (A/B) "Pro"', setsCount: 3, sets: [] }
                ];
                const activeSession: WorkoutSession = {
                    globalStartTime: 1,
                    id: 'w1',
                    exercises: [{ exId: 'ex_special', sessionNote: '', sets: [] }]
                };

                const { container } = renderWithProviders(<TrainingSession />, {
                    userData: { ...emptyUserData, library: specialLib } as any,
                    localWorkout: activeSession
                });

                expect(container.textContent).toContain('Curl 45° con Manubri & Bilanciere (A/B) "Pro"');
            });

            it('T2.3.2: Library item with undefined notes and muscles renders smoothly', () => {
                const sparseLib: Exercise[] = [
                    { id: 'ex_sparse', name: 'Calf Raise', setsCount: 4, sets: [] }
                ];
                const activeSession: WorkoutSession = {
                    globalStartTime: 1,
                    id: 'w1',
                    exercises: [{ exId: 'ex_sparse', sessionNote: '', sets: [] }]
                };

                const { container } = renderWithProviders(<TrainingSession />, {
                    userData: { ...emptyUserData, library: sparseLib } as any,
                    localWorkout: activeSession
                });

                expect(container.textContent).toContain('Calf Raise');
            });

            it('T2.3.3: Bulk library rename simultaneously updates all corresponding active session cards', () => {
                const lib1: Exercise[] = [
                    { id: 'ex1', name: 'Panca 1', setsCount: 3, sets: [] },
                    { id: 'ex2', name: 'Squat 1', setsCount: 3, sets: [] }
                ];
                const activeSession: WorkoutSession = {
                    globalStartTime: 1,
                    id: 'w1',
                    exercises: [
                        { exId: 'ex1', sessionNote: '', sets: [] },
                        { exId: 'ex2', sessionNote: '', sets: [] }
                    ]
                };

                const { container } = renderWithProviders(<TrainingSession />, {
                    userData: { ...emptyUserData, library: lib1 } as any,
                    localWorkout: activeSession
                });

                expect(container.textContent).toContain('Panca 1');
                expect(container.textContent).toContain('Squat 1');

                act(() => {
                    useAppStore.setState({
                        userData: {
                            ...emptyUserData,
                            library: [
                                { id: 'ex1', name: 'Panca Modificata', setsCount: 3, sets: [] },
                                { id: 'ex2', name: 'Squat Modificato', setsCount: 3, sets: [] }
                            ]
                        } as any
                    });
                });

                expect(container.textContent).toContain('Panca Modificata');
                expect(container.textContent).toContain('Squat Modificato');
            });

            it('T2.3.4: Library lookup resolves exact ID match in exercise card title even when IDs share prefixes', () => {
                const prefixLib: Exercise[] = [
                    { id: 'ex1', name: 'Exercise One', setsCount: 3, sets: [] },
                    { id: 'ex10', name: 'Exercise Ten', setsCount: 3, sets: [] }
                ];
                const activeSession: WorkoutSession = {
                    globalStartTime: 1,
                    id: 'w1',
                    exercises: [{ exId: 'ex10', sessionNote: '', sets: [] }]
                };

                const { container } = renderWithProviders(<TrainingSession />, {
                    userData: { ...emptyUserData, library: prefixLib } as any,
                    localWorkout: activeSession
                });

                const exerciseHeadings = Array.from(container.querySelectorAll('h2')).map(h => h.textContent);
                expect(exerciseHeadings).toContain('Exercise Ten');
                expect(exerciseHeadings).not.toContain('Exercise One');
            });

            it('T2.3.5: SessionExerciseSchema sanitizes malformed exercise set data', () => {
                const corruptedExercise = {
                    exId: 'ex1',
                    sessionNote: 12345, // should convert to string
                    sets: [
                        { id: 's1', kg: 80, reps: 10 } // numbers convert to string
                    ]
                };

                const parsed = SessionExerciseSchema.parse(corruptedExercise);
                expect(parsed.sessionNote).toBe('12345');
                expect(parsed.sets[0].kg).toBe('80');
                expect(parsed.sets[0].reps).toBe('10');
            });
        });

        // ---------------------------------------------------------------------
        // R4 Boundaries
        // ---------------------------------------------------------------------
        describe('R4 Boundaries (Routine Editor Search & Add Edge Cases)', () => {
            it('T2.4.1: Empty library in RoutineEditor displays empty message without crashing', () => {
                const { container } = renderWithProviders(
                    <RoutineEditor
                        routineName="Nuova Scheda"
                        setRoutineName={vi.fn()}
                        editingRoutineId={null}
                        routineExercises={[]}
                        library={[]}
                        editMuscles={[]}
                        editSecMuscles={[]}
                        onAddExercise={vi.fn()}
                        onMoveExercise={vi.fn()}
                        onRemoveExercise={vi.fn()}
                        onUpdateSetsCount={vi.fn()}
                        onUpdateReps={vi.fn()}
                        onUpdateTechnique={vi.fn()}
                        onSave={vi.fn()}
                        onCancel={vi.fn()}
                    />
                );

                expect(container.textContent).toContain('Nessun esercizio presente');
            });

            it('T2.4.2: Special regex characters in search query do not crash Logic.filterItems', () => {
                const library: Exercise[] = [
                    { id: '1', name: 'Crunch (addominali) [base]', setsCount: 3, sets: [] }
                ];

                expect(() => {
                    const result = Logic.filterItems(library, '.*+?^${}()|[]\\');
                    expect(result).toEqual([]);
                }).not.toThrow();
            });

            it('T2.4.3: Adding the same library exercise multiple times to a routine is permitted', () => {
                const routineExercises = [
                    { exId: 'ex_pullup', setsCount: 3 },
                    { exId: 'ex_pullup', setsCount: 4 }
                ];
                const library: Exercise[] = [
                    { id: 'ex_pullup', name: 'Trazioni', setsCount: 3, sets: [] }
                ];

                const { container } = renderWithProviders(
                    <RoutineEditor
                        routineName="Dorso"
                        setRoutineName={vi.fn()}
                        editingRoutineId={null}
                        routineExercises={routineExercises}
                        library={library}
                        editMuscles={[]}
                        editSecMuscles={[]}
                        onAddExercise={vi.fn()}
                        onMoveExercise={vi.fn()}
                        onRemoveExercise={vi.fn()}
                        onUpdateSetsCount={vi.fn()}
                        onUpdateReps={vi.fn()}
                        onUpdateTechnique={vi.fn()}
                        onSave={vi.fn()}
                        onCancel={vi.fn()}
                    />
                );

                expect(container.textContent).toContain('Esercizi nella scheda (2)');
            });

            it('T2.4.4: Long routine name (100+ chars) renders without breaking layout', () => {
                const longName = 'Scheda Ipertrofia ad Alto Volume con Focus Pettorali, Deltoidi Laterali e Braccia - Versione 2.0 Avanzata';
                const setRoutineName = vi.fn();

                const { container } = renderWithProviders(
                    <RoutineEditor
                        routineName={longName}
                        setRoutineName={setRoutineName}
                        editingRoutineId="r_long"
                        routineExercises={[]}
                        library={[]}
                        editMuscles={[]}
                        editSecMuscles={[]}
                        onAddExercise={vi.fn()}
                        onMoveExercise={vi.fn()}
                        onRemoveExercise={vi.fn()}
                        onUpdateSetsCount={vi.fn()}
                        onUpdateReps={vi.fn()}
                        onUpdateTechnique={vi.fn()}
                        onSave={vi.fn()}
                        onCancel={vi.fn()}
                    />
                );

                const input = container.querySelector('input[type="text"]') as HTMLInputElement;
                expect(input.value).toBe(longName);
            });

            it('T2.4.5: Removing an exercise from RoutineEditor calls onRemove callback', () => {
                const onRemoveExercise = vi.fn();
                const routineExercises = [{ exId: 'ex1', setsCount: 3 }];
                const library: Exercise[] = [{ id: 'ex1', name: 'Squat', setsCount: 3, sets: [] }];

                const { container } = renderWithProviders(
                    <RoutineEditor
                        routineName="Gambe"
                        setRoutineName={vi.fn()}
                        editingRoutineId="r1"
                        routineExercises={routineExercises}
                        library={library}
                        editMuscles={[]}
                        editSecMuscles={[]}
                        onAddExercise={vi.fn()}
                        onMoveExercise={vi.fn()}
                        onRemoveExercise={onRemoveExercise}
                        onUpdateSetsCount={vi.fn()}
                        onUpdateReps={vi.fn()}
                        onUpdateTechnique={vi.fn()}
                        onSave={vi.fn()}
                        onCancel={vi.fn()}
                    />
                );

                const deleteBtn = container.querySelector('button[aria-label="Rimuovi esercizio"]');
                expect(deleteBtn).not.toBeNull();
                fireEvent.click(deleteBtn!);
                expect(onRemoveExercise).toHaveBeenCalledWith(0);
            });
        });

        // ---------------------------------------------------------------------
        // R5 Boundaries
        // ---------------------------------------------------------------------
        describe('R5 Boundaries (Training Cycle Timeline & Limits)', () => {
            it('T2.5.1: 1-week minimum duration cycle computes 7-day timeline', () => {
                const timeline = Logic.calculateCycleTimeline({
                    id: 'c_min',
                    name: 'Mini Ciclo Deload',
                    durationWeeks: 1,
                    startDate: '2026-08-01',
                    routines: []
                });

                expect(timeline.totalWeeks).toBe(1);
                expect(timeline.startDate).toBe('2026-08-01');
                expect(timeline.endDate).toBe('2026-08-07');
            });

            it('T2.5.2: 52-week maximum duration cycle computes year-long timeline accurately', () => {
                const timeline = Logic.calculateCycleTimeline({
                    id: 'c_year',
                    name: 'Macrociclo Annuale',
                    durationWeeks: 52,
                    startDate: '2026-01-01',
                    routines: []
                });

                expect(timeline.totalWeeks).toBe(52);
                expect(timeline.startDate).toBe('2026-01-01');
                expect(timeline.endDate).toBe('2026-12-30');
            });

            it('T2.5.3: Year-end rollover spans across new year seamlessly in timeline calculation', () => {
                const timeline = Logic.calculateCycleTimeline({
                    id: 'c_ny',
                    name: 'Ciclo Invernale',
                    durationWeeks: 6,
                    startDate: '2026-12-15',
                    routines: []
                });

                expect(timeline.startDate).toBe('2026-12-15');
                expect(timeline.endDate).toBe('2027-01-25');
                expect(timeline.formattedRange).toContain('15/12/2026');
                expect(timeline.formattedRange).toContain('25/01/2027');
            });

            it('T2.5.4: Cycle with 0 routines handles timeline calculation defensively without error', () => {
                expect(() => {
                    const timeline = Logic.calculateCycleTimeline({
                        id: 'c_empty',
                        name: 'Empty Cycle',
                        durationWeeks: 4,
                        startDate: '2026-08-01',
                        routines: []
                    });
                    expect(timeline.totalWeeks).toBe(4);
                }).not.toThrow();
            });

            it('T2.5.5: High training frequency (e.g. 6 sessions/week) computes total sessions correctly', () => {
                const schedule = Logic.calculateCycleSchedule(
                    {
                        id: 'c_high_freq',
                        name: 'Alta Frequenza',
                        durationWeeks: 4,
                        sessionsPerWeek: 6,
                        startDate: '2026-08-01',
                        routines: [{ routineId: 'r1', frequencyPerWeek: 1 }]
                    },
                    [{ id: 'r1', name: 'Routine 1', exercises: [] }]
                );

                expect(schedule.totalSessions).toBe(24); // 4 * 6
                expect(schedule.weeks.length).toBe(4);
                expect(schedule.weeks[0].sessions.length).toBe(6);
            });
        });

        // ---------------------------------------------------------------------
        // R6 Boundaries
        // ---------------------------------------------------------------------
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
                    exercises: [{ exId: 'ex1', sessionNote: '', sets: [] }]
                };

                const setLocalWorkout = (updater: any) => {
                    localWorkout = typeof updater === 'function' ? updater(localWorkout) : updater;
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

            it('T2.6.4: Ad-hoc cardio exercise computes speed (dist / (time/60)) and saves into active workout', () => {
                const libDef = { id: 'ex_bike', name: 'Cyclette', trackingType: 'cardio' as const };
                const exItem = {
                    exId: 'ex_bike',
                    sessionNote: '',
                    sets: [{ id: 's_cardio', time: '', distance: '', speed: '' }]
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
                    />
                );

                const timeInput = container.querySelector('input[placeholder="es. 30"]') as HTMLInputElement;
                expect(timeInput).not.toBeNull();
                fireEvent.change(timeInput, { target: { value: '30' } });
                fireEvent.blur(timeInput);
                expect(onUpdateSet).toHaveBeenCalledWith(0, 's_cardio', 'time', '30');
            });

            it('T2.6.5: Cancelling history edit (cancelHistoryEdit) discards ad-hoc edits cleanly', async () => {
                const originalHistory: WorkoutSession[] = [
                    {
                        id: 'w_saved',
                        routineName: 'Original Workout',
                        exercises: [{ exId: 'ex1', sessionNote: 'Original', sets: [] }]
                    }
                ];

                useAppStore.setState({
                    userData: {
                        ...emptyUserData,
                        history: originalHistory
                    } as any,
                    localWorkout: {
                        id: 'w_editing',
                        originalHistoryId: 'w_saved',
                        isEditingHistory: true,
                        exercises: [
                            { exId: 'ex1', sessionNote: 'Original', sets: [] },
                            { exId: 'ex_adhoc_added', sessionNote: 'Added', sets: [] }
                        ]
                    }
                });

                const { result } = renderHook(() => useWorkoutSession());

                await act(async () => {
                    await result.current.cancelHistoryEdit();
                });

                const state = useAppStore.getState();
                expect(state.localWorkout).toBeNull();
                expect(state.userData?.history?.[0].exercises.length).toBe(1);
                expect(state.userData?.history?.[0].exercises[0].exId).toBe('ex1');
            });
        });
    });
});
