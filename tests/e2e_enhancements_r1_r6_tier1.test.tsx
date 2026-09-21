import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, act, fireEvent, renderHook } from '@testing-library/react';
import { renderWithProviders, emptyUserData } from './setup';
import { useAppStore } from '../src/store/useAppStore';
import { Logic } from '../src/lib/logic';
import { NutritionDaySchema, TrainingCycleSchema } from '../src/lib/schema';
import { useSleepMeasurements } from '../src/hooks/useSleepMeasurements';
import { useWorkoutSetMutations } from '../src/hooks/workout/useWorkoutSetMutations';
import { useWorkoutSession } from '../src/hooks/useWorkoutSession';
import DataSleep from '../src/components/Data/DataSleep';
import DataHistory from '../src/components/Data/DataHistory';
import { RoutineEditor } from '../src/components/Training/routines/RoutineEditor';
import { CycleEditor } from '../src/components/Training/planning/CycleEditor';
import TrainingSession from '../src/components/Training/TrainingSession';
import SessionExerciseCard from '../src/components/Training/session/SessionExerciseCard';
import type { WorkoutSession, WorkoutRoutine, Exercise } from '../src/types';

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
     * TIER 1: FEATURE COVERAGE (>=5 tests per requirement R1 - R6)
     * ========================================================================= */
    describe('Tier 1: Feature Coverage', () => {

        // ---------------------------------------------------------------------
        // Requirement R1: Formato Sonno in HH:MM
        // ---------------------------------------------------------------------
        describe('R1: Formato Sonno in HH:MM', () => {
            it('T1.1.1: useSleepMeasurements sets and persists sleep duration into userData.nutrition[date] in canonical HH:MM format', async () => {
                const today = Logic.getLocalDateString();
                useAppStore.setState({
                    userData: {
                        ...emptyUserData,
                        nutrition: {}
                    }
                });

                const { result } = renderHook(() => useSleepMeasurements());

                act(() => {
                    result.current.setSleepHours('08:00');
                    result.current.setSleepDeep('02:00');
                });

                await act(async () => {
                    await result.current.saveSleep();
                });

                const state = useAppStore.getState();
                const dayData = state.userData?.nutrition?.[today];
                expect(dayData).toBeDefined();
                expect(dayData?.sleepHours).toBe('08:00');
                expect(dayData?.sleepDeep).toBe('02:00');
            });

            it('T1.1.2: DataSleep renders inputs for total sleep, deep, light, rem, and awake phases', () => {
                const mockSleepHook = {
                    editingDate: null,
                    sleepHours: '07:30',
                    setSleepHours: vi.fn(),
                    sleepDeep: '01:30',
                    setSleepDeep: vi.fn(),
                    sleepLight: '04:00',
                    setSleepLight: vi.fn(),
                    sleepRem: '01:30',
                    setSleepRem: vi.fn(),
                    sleepAwake: '00:30',
                    setSleepAwake: vi.fn(),
                    saveSleep: vi.fn(),
                    setEditingDate: vi.fn(),
                };

                const { container } = renderWithProviders(<DataSleep sleepHook={mockSleepHook} />);

                expect(container.querySelector('#sleep-hours')).not.toBeNull();
                expect(container.querySelector('#sleep-deep')).not.toBeNull();
                expect(container.querySelector('#sleep-light')).not.toBeNull();
                expect(container.querySelector('#sleep-rem')).not.toBeNull();
                expect(container.querySelector('#sleep-awake')).not.toBeNull();
                expect(container.textContent).toContain('🌙 Dati sonno (' + Logic.getLocalDateString() + ')');
            });

            it('T1.1.3: DataSleep user interaction triggers setter callbacks and saves', () => {
                const mockSleepHook = {
                    editingDate: null,
                    sleepHours: '',
                    setSleepHours: vi.fn(),
                    sleepDeep: '',
                    setSleepDeep: vi.fn(),
                    sleepLight: '',
                    setSleepLight: vi.fn(),
                    sleepRem: '',
                    setSleepRem: vi.fn(),
                    sleepAwake: '',
                    setSleepAwake: vi.fn(),
                    saveSleep: vi.fn(),
                    setEditingDate: vi.fn(),
                };

                const { container } = renderWithProviders(<DataSleep sleepHook={mockSleepHook} />);

                const hoursInput = container.querySelector('#sleep-hours') as HTMLInputElement;
                fireEvent.change(hoursInput, { target: { value: '08:30' } });
                expect(mockSleepHook.setSleepHours).toHaveBeenCalledWith('08:30');

                const saveBtn = screen.getByText(/Salva sonno/i);
                fireEvent.click(saveBtn);
                expect(mockSleepHook.saveSleep).toHaveBeenCalledTimes(1);
            });

            it('T1.1.4: DataHistory rehydrates and displays recorded sleep metrics in history list formatted in HH:MM', () => {
                const historyDays = [
                    { date: '2026-08-10', sleepHours: '07:30', weight: 75.0 },
                    { date: '2026-08-11', sleepHours: '08:00', weight: 75.2 }
                ];
                const onSelectEdit = vi.fn();

                const { container } = renderWithProviders(
                    <DataHistory
                        measurementsHistory={historyDays}
                        editingDate={null}
                        onSelectEdit={onSelectEdit}
                    />
                );

                expect(container.textContent).toContain('🌙 Sonno: 07:30');
                expect(container.textContent).toContain('🌙 Sonno: 08:00');

                // Clicking 'Modifica' from ContextMenu invokes onSelectEdit
                const optionsTriggers = screen.getAllByRole('button', { name: 'Opzioni' });
                expect(optionsTriggers.length).toBeGreaterThan(0);
                fireEvent.click(optionsTriggers[0]);
                
                const editItem = screen.getByRole('menuitem', { name: 'Modifica' });
                expect(editItem).not.toBeNull();
                fireEvent.click(editItem);
                
                expect(onSelectEdit).toHaveBeenCalledWith(historyDays[0]);
            });

            it('T1.1.5: NutritionDaySchema validates and canonicalizes all sleep fields into standard HH:MM', () => {
                const rawNutrition = {
                    date: '2026-08-15',
                    kcal: 2200,
                    carbs: 250,
                    pro: 150,
                    fat: 60,
                    sleepHours: '07:30',
                    sleepDeep: '01:30',
                    sleepLight: '04:00',
                    sleepRem: '01:30',
                    sleepAwake: '00:30'
                };

                const parsed = NutritionDaySchema.parse(rawNutrition);
                expect(parsed.sleepHours).toBe('07:30');
                expect(parsed.sleepDeep).toBe('01:30');
                expect(parsed.sleepLight).toBe('04:00');
                expect(parsed.sleepRem).toBe('01:30');
                expect(parsed.sleepAwake).toBe('00:30');
            });
        });

        // ---------------------------------------------------------------------
        // Requirement R2: Riordino Esercizi in Sessione Live
        // ---------------------------------------------------------------------
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

        // ---------------------------------------------------------------------
        // Requirement R3: Sincronizzazione in Tempo Reale Esercizi
        // ---------------------------------------------------------------------
        describe('R3: Sincronizzazione in Tempo Reale Esercizi', () => {
            it('T1.3.1: TrainingSession resolves exercise name dynamically from userData.library via exId', () => {
                const mockLibrary: Exercise[] = [
                    { id: 'ex_bench', name: 'Panca Piana Bilanciere', setsCount: 3, sets: [] }
                ];
                const activeSession: WorkoutSession = {
                    id: 'w1',
                    routineName: 'Push A',
                    exercises: [{ exId: 'ex_bench', sessionNote: '', sets: [{ id: 's1', kg: '80', reps: '8' }] }]
                };

                const { container } = renderWithProviders(<TrainingSession />, {
                    userData: { ...emptyUserData, library: mockLibrary } as any,
                    localWorkout: activeSession
                });

                expect(container.textContent).toContain('Panca Piana Bilanciere');
            });

            it('T1.3.2: Updating library exercise name in store immediately reflects in active workout UI', () => {
                const initialLibrary: Exercise[] = [
                    { id: 'ex_squat', name: 'Squat Classico', setsCount: 3, sets: [] }
                ];
                const activeSession: WorkoutSession = {
                    id: 'w1',
                    routineName: 'Legs A',
                    exercises: [{ exId: 'ex_squat', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '5' }] }]
                };

                const { container } = renderWithProviders(<TrainingSession />, {
                    userData: { ...emptyUserData, library: initialLibrary } as any,
                    localWorkout: activeSession
                });

                expect(container.textContent).toContain('Squat Classico');

                // Update library in store
                act(() => {
                    useAppStore.setState({
                        userData: {
                            ...emptyUserData,
                            library: [{ id: 'ex_squat', name: 'Squat con Bilanciere Olimpico', setsCount: 3, sets: [] }]
                        } as any
                    });
                });

                expect(container.textContent).toContain('Squat con Bilanciere Olimpico');
                expect(container.textContent).not.toContain('Squat Classico');
            });

            it('T1.3.3: Updating library notes reflects when opening Setup panel in SessionExerciseCard', () => {
                const libDef = { id: 'ex_lat', name: 'Lat Machine', notes: 'Altezza cuscino 3, presa prona' };
                const exItem = { exId: 'ex_lat', sessionNote: '', sets: [] };

                const { container } = renderWithProviders(
                    <SessionExerciseCard
                        exItem={exItem}
                        exIndex={0}
                        libDef={libDef}
                        pastWorkouts={[]}
                        isHistoryOpen={false}
                        isSetupOpen={true}
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

                const setupInput = container.querySelector('#setup-ex_lat') as HTMLInputElement;
                expect(setupInput).not.toBeNull();
                expect(setupInput.defaultValue).toBe('Altezza cuscino 3, presa prona');
            });

            it('T1.3.4: Deleted or missing library item gracefully falls back to "Esercizio rimosso"', () => {
                const exItem = { exId: 'non_existent_ex_id', sessionNote: '', sets: [] };

                const { container } = renderWithProviders(
                    <SessionExerciseCard
                        exItem={exItem}
                        exIndex={0}
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
            });

            it('T1.3.5: Multiple exercises in workout each independently resolve from library mapping', () => {
                const mockLibrary: Exercise[] = [
                    { id: 'ex1', name: 'Trazioni alla Sbarra', setsCount: 3, sets: [] },
                    { id: 'ex2', name: 'Military Press', setsCount: 3, sets: [] }
                ];
                const activeSession: WorkoutSession = {
                    id: 'w1',
                    routineName: 'Upper Day',
                    exercises: [
                        { exId: 'ex1', sessionNote: '', sets: [] },
                        { exId: 'ex2', sessionNote: '', sets: [] }
                    ]
                };

                const { container } = renderWithProviders(<TrainingSession />, {
                    userData: { ...emptyUserData, library: mockLibrary } as any,
                    localWorkout: activeSession
                });

                expect(container.textContent).toContain('Trazioni alla Sbarra');
                expect(container.textContent).toContain('Military Press');
            });
        });

        // ---------------------------------------------------------------------
        // Requirement R4: Ricerca Intelligente Aggiunta Scheda
        // ---------------------------------------------------------------------
        describe('R4: Ricerca Intelligente Aggiunta Scheda', () => {
            it('T1.4.1: RoutineEditor renders exercise list and triggers onAddExercise when selecting from library', () => {
                const library: Exercise[] = [
                    { id: 'ex_dip', name: 'Dip alle Parallele', setsCount: 3, sets: [] }
                ];
                const onAddExercise = vi.fn();

                const { container } = renderWithProviders(
                    <RoutineEditor
                        routineName="Scheda Spinta"
                        setRoutineName={vi.fn()}
                        editingRoutineId={null}
                        routineExercises={[]}
                        library={library}
                        editMuscles={[]}
                        editSecMuscles={[]}
                        onAddExercise={onAddExercise}
                        onMoveExercise={vi.fn()}
                        onRemoveExercise={vi.fn()}
                        onUpdateSetsCount={vi.fn()}
                        onUpdateReps={vi.fn()}
                        onUpdateTechnique={vi.fn()}
                        onSave={vi.fn()}
                        onCancel={vi.fn()}
                    />
                );

                const searchInput = (container.querySelector('input[placeholder="🔍 Cerca esercizio da aggiungere..."]') ||
                    container.querySelector('input[role="combobox"]')) as HTMLInputElement;
                expect(searchInput).not.toBeNull();
                act(() => {
                    fireEvent.focus(searchInput);
                    fireEvent.click(searchInput);
                });
                const dropdownItem = container.querySelector('.exercise-dropdown-item') as HTMLElement;
                expect(dropdownItem).not.toBeNull();
                act(() => {
                    fireEvent.click(dropdownItem);
                });
                expect(onAddExercise).toHaveBeenCalledWith('ex_dip');
            });

            it('T1.4.2: Logic.filterItems performs exact name matching on exercises list', () => {
                const library: Exercise[] = [
                    { id: '1', name: 'Panca Piana', setsCount: 3, sets: [] },
                    { id: '2', name: 'Squat', setsCount: 3, sets: [] },
                    { id: '3', name: 'Stacco da Terra', setsCount: 3, sets: [] }
                ];

                const filtered = Logic.filterItems(library, 'Panca Piana');
                expect(filtered.length).toBe(1);
                expect(filtered[0].name).toBe('Panca Piana');
            });

            it('T1.4.3: Logic.filterItems performs case-insensitive substring matching across library', () => {
                const library: Exercise[] = [
                    { id: '1', name: 'Panca Inclinata Manubri', setsCount: 3, sets: [] },
                    { id: '2', name: 'Croci ai Cavi', setsCount: 3, sets: [] },
                    { id: '3', name: 'Panca Declinata', setsCount: 3, sets: [] }
                ];

                const matches = Logic.filterItems(library, 'panca');
                expect(matches.length).toBe(2);
                expect(matches.map(m => m.id)).toEqual(['1', '3']);
            });

            it('T1.4.4: Adding an exercise updates the displayed exercise count in RoutineEditor', () => {
                const routineExercises = [
                    { exId: 'ex1', setsCount: 4, minReps: 8, maxReps: 12 }
                ];
                const library: Exercise[] = [
                    { id: 'ex1', name: 'Panca Piana', setsCount: 3, sets: [] }
                ];

                const { container } = renderWithProviders(
                    <RoutineEditor
                        routineName="Test Routine"
                        setRoutineName={vi.fn()}
                        editingRoutineId="r1"
                        routineExercises={routineExercises}
                        library={library}
                        editMuscles={['chest']}
                        editSecMuscles={['triceps']}
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

                expect(container.textContent).toContain('Esercizi nella scheda (1)');
                expect(container.textContent).toContain('Panca Piana');
            });

            it('T1.4.5: Adding multiple distinct exercises to routine preserves their order and names', () => {
                const routineExercises = [
                    { exId: 'ex1', setsCount: 3 },
                    { exId: 'ex2', setsCount: 4 },
                    { exId: 'ex3', setsCount: 3 }
                ];
                const library: Exercise[] = [
                    { id: 'ex1', name: 'Pullup', setsCount: 3, sets: [] },
                    { id: 'ex2', name: 'Rematore', setsCount: 3, sets: [] },
                    { id: 'ex3', name: 'Curl', setsCount: 3, sets: [] }
                ];

                const { container } = renderWithProviders(
                    <RoutineEditor
                        routineName="Pull Day"
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

                expect(container.textContent).toContain('Esercizi nella scheda (3)');
                expect(container.textContent).toContain('1. Pullup');
                expect(container.textContent).toContain('2. Rematore');
                expect(container.textContent).toContain('3. Curl');
            });
        });

        // ---------------------------------------------------------------------
        // Requirement R5: Data di Fine nei Cicli di Allenamento
        // ---------------------------------------------------------------------
        describe('R5: Data di Fine nei Cicli di Allenamento', () => {
            it('T1.5.1: CycleEditor initializes with start date and duration weeks', () => {
                const routines: WorkoutRoutine[] = [
                    { id: 'r1', name: 'Upper A', exercises: [] }
                ];

                const { container } = renderWithProviders(
                    <CycleEditor
                        routines={routines}
                        onSave={vi.fn()}
                        onCancel={vi.fn()}
                    />
                );

                expect(screen.getByRole('heading', { name: /Crea ciclo di allenamento/i })).toBeDefined();
                const inputs = container.querySelectorAll('input');
                expect(inputs.length).toBeGreaterThan(0);
            });

            it('T1.5.2: Logic.calculateCycleTimeline computes formatted date range from start date and duration', () => {
                const timeline = Logic.calculateCycleTimeline({
                    id: 'c1',
                    name: 'Mesociclo Forza',
                    durationWeeks: 4,
                    sessionsPerWeek: 3,
                    startDate: '2026-08-01',
                    routines: [{ routineId: 'r1', frequencyPerWeek: 1 }]
                });

                expect(timeline.startDate).toBe('2026-08-01');
                expect(timeline.endDate).toBe('2026-08-28'); // 4 weeks = 28 days (01 to 28)
                expect(timeline.totalWeeks).toBe(4);
                expect(timeline.formattedRange).toContain('01/08/2026');
                expect(timeline.formattedRange).toContain('28/08/2026');
            });

            it('T1.5.3: Logic.calculateCycleSchedule distributes sessions across computed timeline', () => {
                const routines: WorkoutRoutine[] = [
                    { id: 'r1', name: 'Push', exercises: [] },
                    { id: 'r2', name: 'Pull', exercises: [] },
                    { id: 'r3', name: 'Legs', exercises: [] }
                ];

                const schedule = Logic.calculateCycleSchedule(
                    {
                        id: 'c1',
                        name: 'PPL 6 Settimane',
                        durationWeeks: 6,
                        sessionsPerWeek: 3,
                        startDate: '2026-09-01',
                        routines: [
                            { routineId: 'r1', frequencyPerWeek: 1 },
                            { routineId: 'r2', frequencyPerWeek: 1 },
                            { routineId: 'r3', frequencyPerWeek: 1 }
                        ]
                    },
                    routines
                );

                expect(schedule.totalSessions).toBe(18); // 6 weeks * 3 sessions/week
                expect(schedule.weeks.length).toBe(6);
                expect(schedule.weeks[0].sessions.length).toBe(3);
                expect(schedule.weeks[0].sessions[0].routineName).toBe('Push');
                expect(schedule.weeks[0].sessions[1].routineName).toBe('Pull');
                expect(schedule.weeks[0].sessions[2].routineName).toBe('Legs');
            });

            it('T1.5.4: Changing duration weeks in CycleEditor updates the timeline range display', () => {
                const routines: WorkoutRoutine[] = [{ id: 'r1', name: 'Full Body', exercises: [] }];

                const { container } = renderWithProviders(
                    <CycleEditor
                        routines={routines}
                        onSave={vi.fn()}
                        onCancel={vi.fn()}
                    />
                );

                const numberInputs = container.querySelectorAll('input[type="number"]');
                // First number input is durationWeeks (default 6)
                const durationInput = numberInputs[0] as HTMLInputElement;
                expect(durationInput).not.toBeNull();

                fireEvent.change(durationInput, { target: { value: '8' } });
                expect(container.textContent).toContain('8 settimane');
            });

            it('T1.5.5: Submitting CycleEditor form produces valid TrainingCycle conforming to schema', () => {
                const onSave = vi.fn();
                const routines: WorkoutRoutine[] = [{ id: 'r1', name: 'Scheda A', exercises: [] }];

                const { container } = renderWithProviders(
                    <CycleEditor
                        routines={routines}
                        onSave={onSave}
                        onCancel={vi.fn()}
                    />
                );

                // Fill name
                const nameInput = container.querySelector('input[type="text"]') as HTMLInputElement;
                fireEvent.change(nameInput, { target: { value: 'Mesociclo Autunno' } });

                // Add routine
                const select = container.querySelector('select') as HTMLSelectElement;
                fireEvent.change(select, { target: { value: 'r1' } });

                // Submit
                const submitBtn = screen.getByText(/Salva ciclo/i);
                fireEvent.click(submitBtn);

                expect(onSave).toHaveBeenCalledTimes(1);
                const savedCycle = onSave.mock.calls[0][0];
                expect(savedCycle.name).toBe('Mesociclo Autunno');
                expect(savedCycle.routines.length).toBe(1);

                // Verify schema validation passes
                const validated = TrainingCycleSchema.parse(savedCycle);
                expect(validated.name).toBe('Mesociclo Autunno');
            });
        });

        // ---------------------------------------------------------------------
        // Requirement R6: Esercizi Ad-Hoc in Sessione
        // ---------------------------------------------------------------------
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
                        { exId: 'ex1', sessionNote: '', sets: [] },
                        { exId: 'ex2', sessionNote: '', sets: [] }
                    ]
                };

                const setLocalWorkout = (updater: any) => {
                    localWorkout = typeof updater === 'function' ? updater(localWorkout) : updater;
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

                useAppStore.setState({
                    userData: {
                        ...emptyUserData,
                        routines: initialRoutines,
                        history: []
                    } as any,
                    localWorkout: activeSession
                });

                const { result } = renderHook(() => useWorkoutSession());

                await act(async () => {
                    await result.current.endWorkout();
                });

                const state = useAppStore.getState();
                expect(state.localWorkout).toBeNull();
                expect(state.userData?.history?.length).toBe(1);

                const savedWorkout = state.userData?.history?.[0];
                expect(savedWorkout?.exercises.length).toBe(2);
                expect(savedWorkout?.exercises[1].exId).toBe('ex_adhoc_curl');
                expect(savedWorkout?.exercises[1].sessionNote).toBe('Extra blast');
            });

            it('T1.6.5: Original routine blueprint in userData.routines remains strictly unchanged after session ends with ad-hoc exercises', async () => {
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

                useAppStore.setState({
                    userData: {
                        ...emptyUserData,
                        routines: originalRoutines,
                        history: []
                    } as any,
                    localWorkout: activeSession
                });

                const { result } = renderHook(() => useWorkoutSession());

                await act(async () => {
                    await result.current.endWorkout();
                });

                const state = useAppStore.getState();
                expect(state.userData?.routines).toEqual(originalRoutines);
                expect(state.userData?.routines?.[0].exercises.length).toBe(1);
                expect(state.userData?.routines?.[0].exercises[0].exId).toBe('ex_bench');
            });
        });
    });
});
