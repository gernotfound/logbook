import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { renderWithProviders, emptyUserData } from './setup';
import { useAppStore } from '../src/store/useAppStore';
import { Logic } from '../src/lib/logic';
import { Exporter } from '../src/lib/export';
import { useSleepMeasurements } from '../src/hooks/useSleepMeasurements';
import { useWorkoutSetMutations } from '../src/hooks/workout/useWorkoutSetMutations';
import { useWorkoutSession } from '../src/hooks/useWorkoutSession';
import DataHistory from '../src/components/Data/DataHistory';
import TrainingSession from '../src/components/Training/TrainingSession';
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
                globalStartTime: 1,
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
                globalStartTime: 1,
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
            expect(localWorkout?.exercises[1].sets[0].segments?.length).toBe(1);

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
            expect(localWorkout?.exercises[0].sets[0].segments?.length).toBe(1);
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
});
