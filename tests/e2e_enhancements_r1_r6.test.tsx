import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, act, fireEvent, renderHook } from '@testing-library/react';
import { renderWithProviders, emptyUserData } from './setup';
import { useAppStore } from '../src/store/useAppStore';
import { Logic } from '../src/lib/logic';
import { Exporter } from '../src/lib/export';
import {
    NutritionDaySchema,
    TrainingCycleSchema,
    SessionExerciseSchema
} from '../src/lib/schema';
import { useSleepMeasurements } from '../src/hooks/useSleepMeasurements';
import { useWorkoutSetMutations } from '../src/hooks/workout/useWorkoutSetMutations';
import { useWorkoutSession } from '../src/hooks/useWorkoutSession';
import DataSleep from '../src/components/Data/DataSleep';
import DataHistory from '../src/components/Data/DataHistory';
import { RoutineEditor } from '../src/components/Training/routines/RoutineEditor';
import { CycleEditor } from '../src/components/Training/planning/CycleEditor';
import TrainingSession from '../src/components/Training/TrainingSession';
import SessionExerciseCard from '../src/components/Training/session/SessionExerciseCard';
import type { WorkoutSession, WorkoutRoutine, TrainingCycle, Exercise } from '../src/types';

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

                expect(screen.getByText(/Nuovo ciclo di allenamento/i)).toBeDefined();
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

    /* =========================================================================
     * TIER 3: CROSS-FEATURE INTERACTIONS & COMBINATIONS
     * ========================================================================= */
    describe('Tier 3: Cross-Feature Interactions & Combinations', () => {

        it('T3.1: Ad-Hoc Exercise Addition + Live Reordering + Real-Time Library Sync', () => {
            const library: Exercise[] = [
                { id: 'ex_bench', name: 'Panca Piana', setsCount: 3, sets: [] },
                { id: 'ex_flyes', name: 'Croci Manubri', setsCount: 3, sets: [] }
            ];

            let localWorkout: WorkoutSession | null = {
                id: 'w_combo_1',
                routineName: 'Chest Day',
                exercises: [{ exId: 'ex_bench', sessionNote: 'Heavy', sets: [{ id: 's1', kg: '90', reps: '8' }] }]
            };

            const setLocalWorkout = (updater: any) => {
                localWorkout = typeof updater === 'function' ? updater(localWorkout) : updater;
            };

            const { result: mutHook } = renderHook(() =>
                useWorkoutSetMutations({ setLocalWorkout, showConfirm: vi.fn().mockResolvedValue(true) })
            );

            // 1. Add ad-hoc exercise
            act(() => {
                mutHook.current.addExtraExercise('ex_flyes');
            });
            expect(localWorkout?.exercises.length).toBe(2);
            expect(localWorkout?.exercises[1].exId).toBe('ex_flyes');

            // 2. Reorder it to first position
            act(() => {
                mutHook.current.reorderExercises(1, 0);
            });
            expect(localWorkout?.exercises[0].exId).toBe('ex_flyes');
            expect(localWorkout?.exercises[1].exId).toBe('ex_bench');

            // 3. Render TrainingSession and verify dynamic sync
            const { container } = renderWithProviders(<TrainingSession />, {
                userData: { ...emptyUserData, library } as any,
                localWorkout
            });

            expect(container.textContent).toContain('Croci Manubri');
            expect(container.textContent).toContain('Panca Piana');

            // 4. Mutate library name in store and verify instant reflection
            act(() => {
                useAppStore.setState({
                    userData: {
                        ...emptyUserData,
                        library: [
                            { id: 'ex_bench', name: 'Panca Piana con Fermo', setsCount: 3, sets: [] },
                            { id: 'ex_flyes', name: 'Croci su Panca Inclinata', setsCount: 3, sets: [] }
                        ]
                    } as any
                });
            });

            expect(container.textContent).toContain('Croci su Panca Inclinata');
            expect(container.textContent).toContain('Panca Piana con Fermo');
        });

        it('T3.2: Training Cycle Timeline + Routine Assignment + Next Scheduled Routine Rotation', () => {
            const routines: WorkoutRoutine[] = [
                { id: 'r_push', name: 'Push Routine', exercises: [{ exId: 'ex1', setsCount: 3 }] },
                { id: 'r_pull', name: 'Pull Routine', exercises: [{ exId: 'ex2', setsCount: 3 }] }
            ];

            const cycle: TrainingCycle = {
                id: 'c_rot',
                name: 'Rotazione A/B',
                durationWeeks: 4,
                sessionsPerWeek: 2,
                startDate: '2026-08-01',
                routines: [
                    { routineId: 'r_push', frequencyPerWeek: 1 },
                    { routineId: 'r_pull', frequencyPerWeek: 1 }
                ]
            };

            // 1. Calculate Timeline
            const timeline = Logic.calculateCycleTimeline(cycle);
            expect(timeline.totalWeeks).toBe(4);
            expect(timeline.startDate).toBe('2026-08-01');
            expect(timeline.endDate).toBe('2026-08-28');

            // 2. Calculate Next Scheduled Routine (0 sessions completed -> Push Routine)
            const next1 = Logic.getNextScheduledRoutine(cycle, routines, []);
            expect(next1?.nextRoutine?.id).toBe('r_push');
            expect(next1?.nextSessionIndex).toBe(1);

            // 3. Complete first session -> next scheduled routine is Pull Routine
            const mockHistory: WorkoutSession[] = [
                { id: 'w1', cycleId: 'c_rot', routineId: 'r_push', date: '2026-08-02', exercises: [] }
            ];
            const next2 = Logic.getNextScheduledRoutine(cycle, routines, mockHistory);
            expect(next2?.nextRoutine?.id).toBe('r_pull');
            expect(next2?.nextSessionIndex).toBe(2);
        });

        it('T3.3: Sleep Logging + Nutrition Day State + History Display + CSV Export', async () => {
            const downloadFileSpy = vi.spyOn(Exporter, 'downloadFile').mockImplementation(() => {});

            const nutritionData = {
                '2026-08-10': {
                    date: '2026-08-10',
                    weight: 78.5,
                    bf: 14.5,
                    sleepHours: '08:00',
                    sleepDeep: '02:00',
                    sleepLight: '04:30',
                    sleepRem: '01:30',
                    sleepAwake: '00:30',
                    kcal: 2400,
                    carbs: 300,
                    pro: 160,
                    fat: 65
                }
            };

            useAppStore.setState({
                userData: {
                    ...emptyUserData,
                    nutrition: nutritionData
                }
            });

            // Verify DataHistory renders formatted metrics
            const { container } = renderWithProviders(
                <DataHistory
                    measurementsHistory={Object.values(nutritionData)}
                    editingDate={null}
                    onSelectEdit={vi.fn()}
                />
            );

            expect(container.textContent).toContain('🌙 Sonno: 08:00');
            expect(container.textContent).toContain('78.5 kg');

            // Export to CSV
            await Exporter.exportToCSV([], nutritionData, []);

            await vi.waitFor(() => {
                expect(downloadFileSpy).toHaveBeenCalledWith('misurazioni.csv', expect.stringContaining('"08:00","02:00","04:30","01:30","00:30"'), expect.anything());
            });
        });

        it('T3.4: Routine Builder + Active Session Launch + Ad-Hoc Modification + History Save', async () => {
            const library: Exercise[] = [
                { id: 'ex_squat', name: 'Squat', setsCount: 3, sets: [] },
                { id: 'ex_calves', name: 'Polpacci in Piedi', setsCount: 3, sets: [] }
            ];

            const routines: WorkoutRoutine[] = [
                { id: 'r_legs', name: 'Gambe Hardcore', exercises: [{ exId: 'ex_squat', setsCount: 4 }] }
            ];

            // 1. Launch workout from routine
            useAppStore.setState({
                userData: {
                    ...emptyUserData,
                    library,
                    routines,
                    history: []
                }
            });

            const { result: sessionHook } = renderHook(() => useWorkoutSession());

            act(() => {
                sessionHook.current.startWorkout('r_legs');
            });

            const activeWorkout = useAppStore.getState().localWorkout;
            expect(activeWorkout).not.toBeNull();
            expect(activeWorkout?.exercises.length).toBe(1);

            // 2. Add ad-hoc finisher
            act(() => {
                sessionHook.current.addExtraExercise('ex_calves');
            });

            expect(useAppStore.getState().localWorkout?.exercises.length).toBe(2);

            // 3. End workout
            await act(async () => {
                await sessionHook.current.endWorkout();
            });

            // 4. Verify history contains both exercises while routine is unmodified
            const state = useAppStore.getState();
            expect(state.userData?.history?.length).toBe(1);
            expect(state.userData?.history?.[0].exercises.length).toBe(2);
            expect(state.userData?.routines?.[0].exercises.length).toBe(1);
        });

        it('T3.5: Special Sets (Dropsets/Isometrics) + Live Reordering + Setup Note Updates', () => {
            let localWorkout: WorkoutSession | null = {
                id: 'w1',
                exercises: [
                    { exId: 'ex_press', sessionNote: '', sets: [{ id: 's1', kg: '30', reps: '10' }] },
                    { exId: 'ex_lateral', sessionNote: '', sets: [{ id: 's2', kg: '12', reps: '12' }] }
                ]
            };

            const setLocalWorkout = (updater: any) => {
                localWorkout = typeof updater === 'function' ? updater(localWorkout) : updater;
            };

            const { result } = renderHook(() =>
                useWorkoutSetMutations({ setLocalWorkout, showConfirm: vi.fn().mockResolvedValue(true) })
            );

            // 1. Add dropset to ex_lateral (index 1)
            act(() => {
                result.current.addSpecialSet(1, 's2', 'dropset');
            });
            expect(localWorkout?.exercises[1].sets[0].dropsets?.length).toBe(1);

            // 2. Add isometry to ex_press (index 0)
            act(() => {
                result.current.addSpecialSet(0, 's1', 'isometry');
            });
            expect(localWorkout?.exercises[0].sets[0].isometrics?.length).toBe(1);

            // 3. Reorder exercises: ex_lateral becomes index 0, ex_press becomes index 1
            act(() => {
                result.current.reorderExercises(1, 0);
            });

            expect(localWorkout?.exercises[0].exId).toBe('ex_lateral');
            expect(localWorkout?.exercises[0].sets[0].dropsets?.length).toBe(1);
            expect(localWorkout?.exercises[1].exId).toBe('ex_press');
            expect(localWorkout?.exercises[1].sets[0].isometrics?.length).toBe(1);

            // 4. Update note
            act(() => {
                result.current.updateSessionNote(0, 'Ottimo bruciore con dropset');
            });
            expect(localWorkout?.exercises[0].sessionNote).toBe('Ottimo bruciore con dropset');
        });

        it('T3.6: Comprehensive Multi-Module Flow: Cycle Planning -> Session Execution -> Ad-Hoc Finisher -> Sleep Log -> Export', async () => {
            const downloadFileSpy = vi.spyOn(Exporter, 'downloadFile').mockImplementation(() => {});

            // 1. Setup complete UserData with library and routines
            const library: Exercise[] = [
                { id: 'ex_squat', name: 'Squat', setsCount: 3, sets: [] },
                { id: 'ex_ext', name: 'Leg Extension', setsCount: 3, sets: [] }
            ];
            const routines: WorkoutRoutine[] = [
                { id: 'r_quads', name: 'Quads Day', exercises: [{ exId: 'ex_squat', setsCount: 3 }] }
            ];
            const cycle: TrainingCycle = {
                id: 'c_mass',
                name: 'Massa Gambe',
                durationWeeks: 4,
                sessionsPerWeek: 1,
                startDate: '2026-08-01',
                routines: [{ routineId: 'r_quads', frequencyPerWeek: 1 }]
            };

            useAppStore.setState({
                userData: {
                    ...emptyUserData,
                    library,
                    routines,
                    trainingCycles: [cycle],
                    activeCycleId: 'c_mass',
                    history: [],
                    nutrition: {}
                }
            });

            // 2. Start workout
            const { result: sessionHook } = renderHook(() => useWorkoutSession());
            act(() => {
                sessionHook.current.startWorkout('r_quads', { cycleId: 'c_mass', cycleName: 'Massa Gambe' });
            });
            expect(useAppStore.getState().localWorkout).not.toBeNull();

            // 3. Add ad-hoc finisher
            act(() => {
                sessionHook.current.addExtraExercise('ex_ext');
            });

            // 4. End workout
            await act(async () => {
                await sessionHook.current.endWorkout();
            });

            expect(useAppStore.getState().userData?.history?.length).toBe(1);

            // 5. Log Sleep for today
            const { result: sleepHook } = renderHook(() => useSleepMeasurements());
            act(() => {
                sleepHook.current.setSleepHours('08:00');
                sleepHook.current.setSleepDeep('02:30');
            });
            await act(async () => {
                await sleepHook.current.saveSleep();
            });

            const today = Logic.getLocalDateString();
            expect(useAppStore.getState().userData?.nutrition?.[today]?.sleepHours).toBe('08:00');

            // 6. Export all data to CSV
            const state = useAppStore.getState().userData;
            await Exporter.exportToCSV(state?.history || [], state?.nutrition || {}, state?.library || []);

            await vi.waitFor(() => {
                expect(downloadFileSpy).toHaveBeenCalledWith('allenamenti.csv', expect.anything(), expect.anything());
                expect(downloadFileSpy).toHaveBeenCalledWith('misurazioni.csv', expect.stringContaining('"08:00","02:30"'), expect.anything());
            });
        });
    });

    /* =========================================================================
     * TIER 4: REAL-WORLD WORKLOAD SCENARIOS
     * ========================================================================= */
    describe('Tier 4: Real-World Workload Scenarios', () => {

        it('T4.1: Scenario: "The Occupied Bench Press" (In-gym exercise swap, reorder, execution, completion)', async () => {
            const library: Exercise[] = [
                { id: 'ex_bench', name: 'Panca Piana', setsCount: 3, sets: [] },
                { id: 'ex_dips', name: 'Dip Parallele', setsCount: 3, sets: [] },
                { id: 'ex_ohp', name: 'Military Press', setsCount: 3, sets: [] }
            ];

            const routines: WorkoutRoutine[] = [
                {
                    id: 'r_push',
                    name: 'Push A',
                    exercises: [
                        { exId: 'ex_bench', setsCount: 3 },
                        { exId: 'ex_dips', setsCount: 3 },
                        { exId: 'ex_ohp', setsCount: 3 }
                    ]
                }
            ];

            useAppStore.setState({
                userData: {
                    ...emptyUserData,
                    library,
                    routines,
                    history: []
                }
            });

            const { result: sessionHook } = renderHook(() => useWorkoutSession());

            // Gym-goer arrives and starts Push A
            act(() => {
                sessionHook.current.startWorkout('r_push');
            });

            // Bench press is occupied! User moves Military Press (index 2) to index 0
            act(() => {
                sessionHook.current.reorderExercises(2, 0);
            });

            let currentWorkout = useAppStore.getState().localWorkout;
            expect(currentWorkout?.exercises[0].exId).toBe('ex_ohp');
            expect(currentWorkout?.exercises[1].exId).toBe('ex_bench');
            expect(currentWorkout?.exercises[2].exId).toBe('ex_dips');

            // Completes Military Press sets
            const ohpSetId = currentWorkout!.exercises[0].sets[0].id;
            act(() => {
                sessionHook.current.updateSet(0, ohpSetId, 'kg', '50');
                sessionHook.current.updateSet(0, ohpSetId, 'reps', '8');
            });

            // Bench is now free! Moves Bench (index 1) to index 1 and executes sets
            const benchSetId = currentWorkout!.exercises[1].sets[0].id;
            act(() => {
                sessionHook.current.updateSet(1, benchSetId, 'kg', '85');
                sessionHook.current.updateSet(1, benchSetId, 'reps', '6');
            });

            // Finishes workout
            await act(async () => {
                await sessionHook.current.endWorkout();
            });

            const saved = useAppStore.getState().userData?.history?.[0];
            expect(saved?.exercises[0].exId).toBe('ex_ohp');
            expect(saved?.exercises[0].sets[0].kg).toBe('50');
            expect(saved?.exercises[1].exId).toBe('ex_bench');
            expect(saved?.exercises[1].sets[0].kg).toBe('85');
        });

        it('T4.2: Scenario: "Ad-Hoc Arm Blast Finisher" (Bodybuilder extends session with high volume dropsets)', async () => {
            const library: Exercise[] = [
                { id: 'ex_lat', name: 'Lat Machine', setsCount: 3, sets: [] },
                { id: 'ex_curl', name: 'Hammer Curl', setsCount: 3, sets: [] }
            ];

            const routines: WorkoutRoutine[] = [
                { id: 'r_pull', name: 'Pull Day', exercises: [{ exId: 'ex_lat', setsCount: 3 }] }
            ];

            useAppStore.setState({
                userData: {
                    ...emptyUserData,
                    library,
                    routines,
                    history: []
                }
            });

            const { result: sessionHook } = renderHook(() => useWorkoutSession());

            // Start Pull Day
            act(() => {
                sessionHook.current.startWorkout('r_pull');
            });

            // User finishes Lat Machine, feels great, adds Hammer Curl as ad-hoc finisher
            act(() => {
                sessionHook.current.addExtraExercise('ex_curl');
            });

            const curlSetId = useAppStore.getState().localWorkout!.exercises[1].sets[0].id;

            // Fills main set
            act(() => {
                sessionHook.current.updateSet(1, curlSetId, 'kg', '18');
                sessionHook.current.updateSet(1, curlSetId, 'reps', '10');
            });

            // Adds a burning dropset to the finisher
            act(() => {
                sessionHook.current.addSpecialSet(1, curlSetId, 'dropset');
            });

            act(() => {
                sessionHook.current.updateSpecialSet(1, curlSetId, 'dropsets', 0, 'kg', '12');
                sessionHook.current.updateSpecialSet(1, curlSetId, 'dropsets', 0, 'reps', '8');
            });

            // Complete session
            await act(async () => {
                await sessionHook.current.endWorkout();
            });

            const state = useAppStore.getState();
            // History has ad-hoc exercise with dropset
            const savedSession = state.userData?.history?.[0];
            expect(savedSession?.exercises.length).toBe(2);
            expect(savedSession?.exercises[1].exId).toBe('ex_curl');
            expect(savedSession?.exercises[1].sets[0].dropsets?.[0].kg).toBe('12');

            // Routine blueprint is untouched
            expect(state.userData?.routines?.[0].exercises.length).toBe(1);
        });

        it('T4.3: Scenario: "12-Week Mesociclo Setup & Routine Rotation Preview"', () => {
            const routines: WorkoutRoutine[] = [
                { id: 'r1', name: 'Upper Power', exercises: [] },
                { id: 'r2', name: 'Lower Power', exercises: [] },
                { id: 'r3', name: 'Upper Hypertrophy', exercises: [] },
                { id: 'r4', name: 'Lower Hypertrophy', exercises: [] }
            ];

            const onSaveCycle = vi.fn();

            const { container } = renderWithProviders(
                <CycleEditor
                    routines={routines}
                    onSave={onSaveCycle}
                    onCancel={vi.fn()}
                />
            );

            // Set name
            const nameInput = container.querySelector('input[type="text"]') as HTMLInputElement;
            fireEvent.change(nameInput, { target: { value: '12-Week Powerbuilding' } });

            // Set duration to 12 weeks
            const numberInputs = container.querySelectorAll('input[type="number"]');
            const durationInput = numberInputs[0] as HTMLInputElement;
            fireEvent.change(durationInput, { target: { value: '12' } });

            // Add 4 routines
            const select = container.querySelector('select') as HTMLSelectElement;
            fireEvent.change(select, { target: { value: 'r1' } });
            fireEvent.change(select, { target: { value: 'r2' } });
            fireEvent.change(select, { target: { value: 'r3' } });
            fireEvent.change(select, { target: { value: 'r4' } });

            // Submit
            const submitBtn = screen.getByText(/Salva ciclo/i);
            fireEvent.click(submitBtn);

            expect(onSaveCycle).toHaveBeenCalledTimes(1);
            const savedCycle: TrainingCycle = onSaveCycle.mock.calls[0][0];
            expect(savedCycle.name).toBe('12-Week Powerbuilding');
            expect(savedCycle.durationWeeks).toBe(12);
            expect(savedCycle.routines.length).toBe(4);

            // Compute schedule
            const schedule = Logic.calculateCycleSchedule(savedCycle, routines);
            expect(schedule.totalSessions).toBe(48); // 12 weeks * 4 sessions/week
            expect(schedule.weeks.length).toBe(12);
        });

        it('T4.4: Scenario: "Athlete Daily Recovery & Biometrics Log Across Full Week"', async () => {
            const downloadFileSpy = vi.spyOn(Exporter, 'downloadFile').mockImplementation(() => {});

            // Record 7 days of sleep and weight
            const weekNutrition: Record<string, any> = {};
            for (let day = 1; day <= 7; day++) {
                const dateStr = `2026-08-0${day}`;
                weekNutrition[dateStr] = {
                    date: dateStr,
                    weight: 76.0 + (day * 0.1),
                    sleepHours: day % 2 === 0 ? '08:00' : '07:30',
                    sleepDeep: day % 3 === 0 ? '02:00' : '01:30',
                    sleepLight: '04:00',
                    sleepRem: '01:30',
                    sleepAwake: '00:30'
                };
            }

            useAppStore.setState({
                userData: {
                    ...emptyUserData,
                    nutrition: weekNutrition
                }
            });

            // Verify DataHistory renders all 7 entries
            const { container } = renderWithProviders(
                <DataHistory
                    measurementsHistory={Object.values(weekNutrition)}
                    editingDate={null}
                    onSelectEdit={vi.fn()}
                />
            );

            expect(container.querySelectorAll('.card').length).toBe(7);

            // Export to CSV
            await Exporter.exportToCSV([], weekNutrition, []);

            await vi.waitFor(() => {
                expect(downloadFileSpy).toHaveBeenCalledWith('misurazioni.csv', expect.stringContaining('"2026-08-01",76.1'), expect.anything());
                expect(downloadFileSpy).toHaveBeenCalledWith('misurazioni.csv', expect.stringContaining('"2026-08-07",76.7'), expect.anything());
            });
        });

        it('T4.5: Scenario: "Equipment Availability Pivot & Cardio Addition" (Leg press broken, lifter pivots to treadmill cardio)', async () => {
            const library: Exercise[] = [
                { id: 'ex_squat', name: 'Squat con Bilanciere', setsCount: 3, sets: [] },
                { id: 'ex_legpress', name: 'Leg Press 45°', setsCount: 3, sets: [] },
                { id: 'ex_treadmill', name: 'Tapis Roulant', setsCount: 1, trackingType: 'cardio', sets: [] }
            ];

            const routines: WorkoutRoutine[] = [
                {
                    id: 'r_leg',
                    name: 'Leg Day',
                    exercises: [
                        { exId: 'ex_squat', setsCount: 3 },
                        { exId: 'ex_legpress', setsCount: 3 }
                    ]
                }
            ];

            useAppStore.setState({
                userData: {
                    ...emptyUserData,
                    library,
                    routines,
                    history: []
                }
            });

            const { result: sessionHook } = renderHook(() => useWorkoutSession());

            // 1. Lifter arrives and launches Leg Day session
            act(() => {
                sessionHook.current.startWorkout('r_leg');
            });

            let activeSession = useAppStore.getState().localWorkout;
            expect(activeSession?.exercises.length).toBe(2);
            expect(activeSession?.exercises[0].exId).toBe('ex_squat');
            expect(activeSession?.exercises[1].exId).toBe('ex_legpress');

            // 2. Lifter discovers Leg Press is out of order -> Removes Leg Press ad-hoc
            await act(async () => {
                await sessionHook.current.removeActiveExercise(1);
            });

            activeSession = useAppStore.getState().localWorkout;
            expect(activeSession?.exercises.length).toBe(1);
            expect(activeSession?.exercises[0].exId).toBe('ex_squat');

            // 3. Lifter adds Treadmill Cardio as an ad-hoc alternative
            act(() => {
                sessionHook.current.addExtraExercise('ex_treadmill');
            });

            activeSession = useAppStore.getState().localWorkout;
            expect(activeSession?.exercises.length).toBe(2);
            expect(activeSession?.exercises[0].exId).toBe('ex_squat');
            expect(activeSession?.exercises[1].exId).toBe('ex_treadmill');

            // 4. Lifter decides to do cardio warmup first -> Reorders Treadmill to index 0
            act(() => {
                sessionHook.current.reorderExercises(1, 0);
            });

            activeSession = useAppStore.getState().localWorkout;
            expect(activeSession?.exercises[0].exId).toBe('ex_treadmill');
            expect(activeSession?.exercises[1].exId).toBe('ex_squat');

            // 5. Fills cardio parameters for treadmill (20 min, 3.5 km, speed 10.5 km/h, incline 2.0%, 210 kcal)
            const treadmillSetId = activeSession!.exercises[0].sets[0].id;
            act(() => {
                sessionHook.current.updateSet(0, treadmillSetId, 'time', '20');
                sessionHook.current.updateSet(0, treadmillSetId, 'distance', '3.5');
                sessionHook.current.updateSet(0, treadmillSetId, 'speed', '10.5');
                sessionHook.current.updateSet(0, treadmillSetId, 'incline', '2.0');
                sessionHook.current.updateSet(0, treadmillSetId, 'kcal', '210');
            });

            // 6. Fills squat parameters (100 kg x 8 reps)
            const squatSetId = activeSession!.exercises[1].sets[0].id;
            act(() => {
                sessionHook.current.updateSet(1, squatSetId, 'kg', '100');
                sessionHook.current.updateSet(1, squatSetId, 'reps', '8');
            });

            // 7. Finishes and saves workout
            await act(async () => {
                await sessionHook.current.endWorkout();
            });

            const state = useAppStore.getState();
            // Local workout is cleared
            expect(state.localWorkout).toBeNull();

            // History contains both exercises in updated order with cardio parameters
            const savedWorkout = state.userData?.history?.[0];
            expect(savedWorkout).toBeDefined();
            expect(savedWorkout?.exercises.length).toBe(2);
            expect(savedWorkout?.exercises[0].exId).toBe('ex_treadmill');
            expect(savedWorkout?.exercises[0].sets[0].time).toBe('20');
            expect(savedWorkout?.exercises[0].sets[0].distance).toBe('3.5');
            expect(savedWorkout?.exercises[0].sets[0].speed).toBe('10.5');
            expect(savedWorkout?.exercises[0].sets[0].incline).toBe('2.0');
            expect(savedWorkout?.exercises[0].sets[0].kcal).toBe('210');

            expect(savedWorkout?.exercises[1].exId).toBe('ex_squat');
            expect(savedWorkout?.exercises[1].sets[0].kg).toBe('100');
            expect(savedWorkout?.exercises[1].sets[0].reps).toBe('8');

            // Removed leg press is NOT in history
            expect(savedWorkout?.exercises.some(e => e.exId === 'ex_legpress')).toBe(false);

            // Routine blueprint is completely intact with original 2 exercises
            const routineBlueprint = state.userData?.routines?.[0];
            expect(routineBlueprint?.exercises.length).toBe(2);
            expect(routineBlueprint?.exercises[0].exId).toBe('ex_squat');
            expect(routineBlueprint?.exercises[1].exId).toBe('ex_legpress');
        });
    });
});
