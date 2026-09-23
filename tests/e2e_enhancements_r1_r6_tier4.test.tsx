import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, act, fireEvent, renderHook } from '@testing-library/react';
import { renderWithProviders, emptyUserData } from './setup';
import { useAppStore } from '../src/store/useAppStore';
import { Logic } from '../src/lib/logic';
import { Exporter } from '../src/lib/export';
import { useWorkoutSession } from '../src/hooks/useWorkoutSession';
import DataHistory from '../src/components/Data/DataHistory';
import { CycleEditor } from '../src/components/Training/planning/CycleEditor';
import type { WorkoutRoutine, TrainingCycle, Exercise } from '../src/types';

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

            // Add 4 routines and declare the new cycle strategy
            const select = screen.getByRole('combobox', { name: 'Aggiungi scheda alla sequenza' });
            fireEvent.change(select, { target: { value: 'r1' } });
            fireEvent.change(select, { target: { value: 'r2' } });
            fireEvent.change(select, { target: { value: 'r3' } });
            fireEvent.change(select, { target: { value: 'r4' } });
            fireEvent.click(screen.getByRole('button', { name: 'Sviluppo' }));
            fireEvent.click(screen.getByRole('button', { name: 'Performance' }));

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
