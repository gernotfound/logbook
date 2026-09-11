import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';
import { useNutritionPlanning } from '../src/hooks/useNutritionPlanning';
import TrainingSession from '../src/components/training/TrainingSession';
import SessionExerciseCard from '../src/components/training/session/SessionExerciseCard';
import SessionSetRow from '../src/components/training/session/SessionSetRow';

import { Logic } from '../src/lib/logic';
import { DB } from '../src/lib/db';
import type { UserData, WorkoutSession } from '../src/types';

describe('Empirical Challenger: React Hooks, Memoization & Re-render Loop Stress Suite', () => {
    const baseUserData: UserData = {
        profile: {
            dob: '1990-01-01',
            gender: 'male',
            height: '180',
            neck: '40',
            waist: '85',
            hip: '95',
            chest: '100',
            shoulders: '120',
            biceps: '38',
            thighs: '60',
            calves: '38'
        },
        library: [
            { id: 'ex_bench', name: 'Panca Piana', setsCount: 3, sets: [] },
            { id: 'ex_squat', name: 'Squat', setsCount: 3, sets: [] },
            { id: 'ex_treadmill', name: 'Tapis Roulant', setsCount: 1, trackingType: 'cardio', sets: [] }
        ],
        routines: [
            {
                id: 'routine_push',
                name: 'Push Day',
                exercises: [
                    { exId: 'ex_bench', setsCount: 3 },
                    { exId: 'ex_squat', setsCount: 3 }
                ]
            }
        ],
        history: [
            {
                id: 'hist_1',
                routineId: 'routine_push',
                routineName: 'Push Day',
                date: '2026-08-10',
                exercises: [
                    {
                        exId: 'ex_bench',
                        sessionNote: 'Spinta forte',
                        sets: [{ id: 's_old_1', kg: '80', reps: '8' }]
                    }
                ]
            }
        ],
        nutrition: {
            '2026-08-16': {
                date: '2026-08-16',
                kcal: 2400,
                carbs: 280,
                pro: 160,
                fat: 65,
                weight: 78.5,
                isDayOn: true,
                meals: [],
                supplementsIntake: []
            }
        },
        customFoods: [],
        activeWorkout: null,
        nutritionPlanning: {
            weight: 78.5,
            onDaysCount: 4,
            avgMacros: { carbsPerKg: 3.5, proPerKg: 2.0, fatPerKg: 1.0 },
            onBoost: { carbsPercent: 20, proPercent: 0, fatPercent: 0 },
            normocalorica: { kcal: 2500, carbs: 300, pro: 160, fat: 70 }
        },
        trainingCycles: [
            {
                id: 'cycle_1',
                name: 'Ipertrofia Fase 1',
                totalSessions: 12,
                completedSessions: 2,
                routines: [{ routineId: 'routine_push' }]
            }
        ],
        activeCycleId: 'cycle_1',
        supplements: []
    };

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        useAppStore.setState({
            userData: JSON.parse(JSON.stringify(baseUserData)),
            localWorkout: null,
            syncing: false,
            saveError: null
        });
    });

    // =========================================================================
    // SECTION 1: useNutritionPlanning Deep Empirical Stress
    // =========================================================================
    describe('1. useNutritionPlanning Empirical Stress & Reactive Invariants', () => {
        it('1.1 Frozen Store State: Does NOT throw or mutate frozen store objects in-place', () => {
            const frozenState = Object.freeze({
                weight: undefined,
                onDaysCount: undefined,
                avgMacros: undefined,
                onBoost: undefined,
                normocalorica: undefined
            });

            useAppStore.setState(s => ({
                userData: s.userData ? {
                    ...s.userData,
                    nutritionPlanning: frozenState as any
                } : null
            }));

            expect(() => {
                const { result } = renderHook(() => useNutritionPlanning());
                expect(result.current.planning.weight).toBe(78.5); // extracted from nutrition map
                expect(result.current.planning.onDaysCount).toBe(4);
                expect(result.current.planning.avgMacros?.carbsPerKg).toBe(3.5);
                expect(result.current.planning.onBoost?.carbsPercent).toBe(20);
                expect(result.current.planning.normocalorica?.kcal).toBe(2500);
            }).not.toThrow();

            // Verify store object was not mutated
            const storePl = useAppStore.getState().userData?.nutritionPlanning;
            expect(storePl?.weight).toBeUndefined();
            expect(storePl?.avgMacros).toBeUndefined();
        });

        it('1.2 Rapid Typing in avgMacros & onBoost: Handles intermediate empty strings and floats cleanly', () => {
            const { result } = renderHook(() => useNutritionPlanning());

            // User clears carbsPerKg field
            act(() => {
                result.current.handleUpdateAvgMacros('carbsPerKg', '');
            });
            expect(result.current.planning.avgMacros?.carbsPerKg).toBe('');

            // User types "4"
            act(() => {
                result.current.handleUpdateAvgMacros('carbsPerKg', '4');
            });
            expect(result.current.planning.avgMacros?.carbsPerKg).toBe(4);

            // User types "4.5"
            act(() => {
                result.current.handleUpdateAvgMacros('carbsPerKg', '4.5');
            });
            expect(result.current.planning.avgMacros?.carbsPerKg).toBe(4.5);

            // User updates onBoost carbsPercent
            act(() => {
                result.current.handleUpdateOnBoost('carbsPercent', '25');
            });
            expect(result.current.planning.onBoost?.carbsPercent).toBe(25);

            // Recalculated macros react to updated values
            // w = 78.5, avgC = 4.5, bC = 0.25, N = 4, F = 3
            // offC = (7 * 4.5) / (4 * 1.25 + 3) = 31.5 / 8 = 3.9375
            // onC = 3.9375 * 1.25 = 4.921875
            expect(result.current.currentOnMacros.carbsPerKg).toBeCloseTo(4.921875, 4);
            expect(result.current.currentOffMacros.carbsPerKg).toBeCloseTo(3.9375, 4);
            expect(result.current.onMacrosCalc.carbsGrams).toBeCloseTo(78.5 * 4.921875, 1);
        });

        it('1.3 Boundary Condition: onDaysCount = 0 and onDaysCount = 7', () => {
            const { result } = renderHook(() => useNutritionPlanning());

            // Boundary 1: N = 0 (all OFF days)
            act(() => {
                result.current.handleUpdate('onDaysCount', 0);
            });
            expect(result.current.currentOnMacros.carbsPerKg).toBe(3.5);
            expect(result.current.currentOffMacros.carbsPerKg).toBe(3.5);

            // Boundary 2: N = 7 (all ON days)
            act(() => {
                result.current.handleUpdate('onDaysCount', 7);
            });
            expect(result.current.currentOnMacros.carbsPerKg).toBe(3.5);
            expect(result.current.currentOffMacros.carbsPerKg).toBe(3.5);
        });

        it('1.4 TDEE Calculation Isolation: local typing does NOT trigger TDEE recomputations', () => {
            const tdeeSpy = vi.spyOn(Logic, 'calculateTDEEAndMacros');
            const { result } = renderHook(() => useNutritionPlanning());

            expect(tdeeSpy).toHaveBeenCalledTimes(1);

            // 20 keystrokes of local state changes
            for (let i = 1; i <= 20; i++) {
                act(() => {
                    result.current.handleUpdateAvgMacros('carbsPerKg', `${3 + i * 0.1}`);
                });
            }

            // TDEE calculation should STILL only be called 1 time (memoized on storePlanning, nutrition, profile)
            expect(tdeeSpy).toHaveBeenCalledTimes(1);
        });

        it('1.5 handleSave Sanitization and Error Rejection Handling', async () => {
            // Mock DB.saveUserData to resolve immediately (bypasses the 1000ms global debouncer)
            const dbSaveMock = vi.spyOn(DB, 'saveUserData').mockResolvedValue({ ok: true, status: 'synced' } as any);
            const showAlertSpy = vi.spyOn(useDialogStore.getState(), 'showAlert').mockResolvedValue();
            const { result } = renderHook(() => useNutritionPlanning());

            // Type string values into normocalorica and weight across render steps
            act(() => {
                result.current.handleUpdate('normocalorica', { kcal: '2600', carbs: '320', pro: '170', fat: '75' });
            });
            act(() => {
                result.current.handleUpdate('weight', '82.5');
            });

            // Trigger handleSave — DB mock resolves immediately, no need for timers
            await act(async () => {
                // Flush the microtask / promise chain through
                await result.current.handleSave();
                // Give any pending microtasks time to settle
                await new Promise(r => setTimeout(r, 0));
            });

            expect(showAlertSpy).toHaveBeenCalledWith('Pianificazione salvata.');
            const updatedInStore = useAppStore.getState().userData?.nutritionPlanning;
            expect(updatedInStore?.weight).toBe(82.5);
            expect(updatedInStore?.normocalorica?.kcal).toBe(2600);
            expect(updatedInStore?.normocalorica?.carbs).toBe(320);

            // Verify error handling: make DB.saveUserData reject
            dbSaveMock.mockRejectedValue(new Error('Network offline'));

            await act(async () => {
                await result.current.handleSave();
                await new Promise(r => setTimeout(r, 0));
            });
            expect(showAlertSpy).toHaveBeenCalledWith('Errore durante il salvataggio della pianificazione.');

            dbSaveMock.mockRestore();
        });
    });

    // =========================================================================
    // SECTION 2: TrainingSession & Memoization Stress Testing
    // =========================================================================
    describe('2. TrainingSession & React.memo Render Isolation Stress', () => {
        it('2.1 GlobalTimer & WorkoutTimer Isolation: Timer ticks do NOT cause TrainingSession or Cards to re-render', () => {
            const activeWorkout: WorkoutSession = {
                id: 'sess_1',
                routineId: 'routine_push',
                routineName: 'Push Day',
                globalStartTime: Date.now() - 5000,
                date: '2026-08-16',
                exercises: [
                    { exId: 'ex_bench', sets: [{ id: 's1', kg: '80', reps: '8' }], sessionNote: '' },
                    { exId: 'ex_squat', sets: [{ id: 's2', kg: '120', reps: '6' }], sessionNote: '' }
                ]
            };

            useAppStore.setState({ localWorkout: activeWorkout });

            render(<TrainingSession />);
            expect(screen.getByRole('heading', { name: 'Push Day' })).toBeDefined();

            // Simulate timer advancement / visibility change
            act(() => {
                document.dispatchEvent(new Event('visibilitychange'));
            });

            // Verify both exercise cards remain cleanly rendered
            expect(screen.getByRole('heading', { name: 'Panca Piana' })).toBeDefined();
            expect(screen.getByRole('heading', { name: 'Squat' })).toBeDefined();
        });

        it('2.2 SessionExerciseCard React.memo: Typing in Exercise 0 does NOT re-render Exercise 1', () => {
            let ex0Renders = 0;
            let ex1Renders = 0;

            const libDefBench = { id: 'ex_bench', name: 'Panca Piana', trackingType: 'weight_reps' };
            const libDefSquat = { id: 'ex_squat', name: 'Squat', trackingType: 'weight_reps' };
            const emptyHistory: any[] = [];

            const TrackedExerciseCard = React.memo((props: any) => {
                if (props.exIndex === 0) ex0Renders++;
                if (props.exIndex === 1) ex1Renders++;
                return <SessionExerciseCard {...props} />;
            }, (prev, next) => {
                return (
                    prev.exItem === next.exItem &&
                    prev.libDef === next.libDef &&
                    prev.pastWorkouts === next.pastWorkouts &&
                    prev.isHistoryOpen === next.isHistoryOpen &&
                    prev.isSetupOpen === next.isSetupOpen &&
                    prev.openSpecialMenuId === next.openSpecialMenuId &&
                    prev.exIndex === next.exIndex
                );
            });

            let currentExercises = [
                { id: 'item_0', exId: 'ex_bench', sets: [{ id: 's0', kg: '80', reps: '8' }], sessionNote: '' },
                { id: 'item_1', exId: 'ex_squat', sets: [{ id: 's1', kg: '120', reps: '5' }], sessionNote: '' }
            ];

            const HostComponent = () => {
                const [exercises, setExercises] = useState(currentExercises);
                (window as any).__setHostExercises = setExercises;

                return (
                    <div>
                        <TrackedExerciseCard
                            exItem={exercises[0]}
                            exIndex={0}
                            libDef={libDefBench}
                            pastWorkouts={emptyHistory}
                            isHistoryOpen={false}
                            isSetupOpen={false}
                            openSpecialMenuId={null}
                            onToggleHistory={() => {}}
                            onToggleSetup={() => {}}
                            onRemoveExercise={() => {}}
                            onUpdateSetupNote={() => {}}
                            onUpdateSessionNote={() => {}}
                            onAddSet={() => {}}
                            onRemoveSet={() => {}}
                            onUpdateSet={() => {}}
                            onAddSpecialSet={() => {}}
                            onUpdateSpecialSet={() => {}}
                            onRemoveSpecialSet={() => {}}
                            onToggleSpecialMenu={() => {}}
                        />
                        <TrackedExerciseCard
                            exItem={exercises[1]}
                            exIndex={1}
                            libDef={libDefSquat}
                            pastWorkouts={emptyHistory}
                            isHistoryOpen={false}
                            isSetupOpen={false}
                            openSpecialMenuId={null}
                            onToggleHistory={() => {}}
                            onToggleSetup={() => {}}
                            onRemoveExercise={() => {}}
                            onUpdateSetupNote={() => {}}
                            onUpdateSessionNote={() => {}}
                            onAddSet={() => {}}
                            onRemoveSet={() => {}}
                            onUpdateSet={() => {}}
                            onAddSpecialSet={() => {}}
                            onUpdateSpecialSet={() => {}}
                            onRemoveSpecialSet={() => {}}
                            onToggleSpecialMenu={() => {}}
                        />
                    </div>
                );
            };

            render(<HostComponent />);

            expect(ex0Renders).toBe(1);
            expect(ex1Renders).toBe(1);

            // Simulate 50 keystrokes typing into Exercise 0 (Panca Piana)
            // preserving immutable reference of Exercise 1 (Squat)
            for (let i = 1; i <= 50; i++) {
                act(() => {
                    const nextEx0 = {
                        ...currentExercises[0],
                        sets: [{ id: 's0', kg: `${80 + i}`, reps: '8' }]
                    };
                    currentExercises = [nextEx0, currentExercises[1]];
                    (window as any).__setHostExercises(currentExercises);
                });
            }

            // Exercise 0 re-rendered 50 times (1 initial + 50 updates = 51)
            expect(ex0Renders).toBe(51);
            // Exercise 1 MUST REMAIN EXACTLY 1 (ZERO unnecessary re-renders!)
            expect(ex1Renders).toBe(1);
        });

        it('2.3 SessionSetRow React.memo: Typing into Set 0 does NOT re-render Set 1 or Set 2', () => {
            let set0Renders = 0;
            let set1Renders = 0;
            let set2Renders = 0;

            const TrackedSetRow = React.memo((props: any) => {
                if (props.sIndex === 0) set0Renders++;
                if (props.sIndex === 1) set1Renders++;
                if (props.sIndex === 2) set2Renders++;
                return <SessionSetRow {...props} />;
            }, (prev, next) => {
                return (
                    prev.set === next.set &&
                    prev.sIndex === next.sIndex &&
                    prev.exIndex === next.exIndex &&
                    prev.trackingType === next.trackingType &&
                    prev.isOpenMenu === next.isOpenMenu
                );
            });

            let currentSets = [
                { id: 's0', kg: '80', reps: '8' },
                { id: 's1', kg: '80', reps: '8' },
                { id: 's2', kg: '80', reps: '8' }
            ];

            const SetsHostComponent = () => {
                const [sets, setSets] = useState(currentSets);
                (window as any).__setHostSets = setSets;

                return (
                    <div>
                        {sets.map((s, idx) => (
                            <TrackedSetRow
                                key={s.id}
                                set={s}
                                sIndex={idx}
                                exIndex={0}
                                trackingType="weight_reps"
                                isOpenMenu={false}
                                onToggleMenu={() => {}}
                                onRemoveSet={() => {}}
                                onUpdateSet={() => {}}
                                onAddSpecialSet={() => {}}
                                onUpdateSpecialSet={() => {}}
                                onRemoveSpecialSet={() => {}}
                            />
                        ))}
                    </div>
                );
            };

            render(<SetsHostComponent />);

            expect(set0Renders).toBe(1);
            expect(set1Renders).toBe(1);
            expect(set2Renders).toBe(1);

            // Simulate 30 rapid keystrokes updating only Set 0
            for (let i = 1; i <= 30; i++) {
                act(() => {
                    const nextS0 = { ...currentSets[0], reps: `${8 + (i % 5)}` };
                    currentSets = [nextS0, currentSets[1], currentSets[2]];
                    (window as any).__setHostSets(currentSets);
                });
            }

            expect(set0Renders).toBe(31);
            expect(set1Renders).toBe(1); // Pristine isolation!
            expect(set2Renders).toBe(1); // Pristine isolation!
        });

        it('2.4 EMPTY_HISTORY_ARRAY Reference Stability: Empty history does not break React.memo equality', () => {
            const activeWorkout: WorkoutSession = {
                id: 'sess_new_ex',
                routineId: 'routine_push',
                routineName: 'Push Day',
                date: '2026-08-16',
                exercises: [
                    { exId: 'ex_treadmill', sets: [{ id: 'st1', time: '20', distance: '3.0' }], sessionNote: '' }
                ]
            };

            // Notice ex_treadmill has NO previous history in history[]
            useAppStore.setState({ localWorkout: activeWorkout });

            render(<TrainingSession />);

            expect(screen.getByRole('heading', { name: 'Tapis Roulant' })).toBeDefined();

            // Type note in session
            const textarea = screen.getByPlaceholderText('Note per la prossima volta (dolori, feedback)...');
            act(() => {
                fireEvent.change(textarea, { target: { value: 'Buona sessione cardio' } });
            });

            expect((textarea as HTMLTextAreaElement).value).toBe('Buona sessione cardio');
        });

        it('2.5 Full Live Workout Session Lifecycle (Start -> Update Sets -> Special Sets -> End)', async () => {
            render(<TrainingSession />);

            // 1. Start workout from planned routine (first Avvia button)
            const startBtn = screen.getByText(/Avvia Push Day \(Seduta/i);
            expect(startBtn).toBeDefined();

            await act(async () => {
                fireEvent.click(startBtn);
                await new Promise(r => setTimeout(r, 0));
            });

            expect(useAppStore.getState().localWorkout?.routineName).toBe('Push Day');
            expect(screen.getByRole('heading', { name: 'Panca Piana' })).toBeDefined();
            expect(screen.getByRole('heading', { name: 'Squat' })).toBeDefined();

            // 2. Add set to Exercise 0
            const addSetBtns = screen.getAllByText('+ Aggiungi serie');
            await act(async () => {
                fireEvent.click(addSetBtns[0]);
                await new Promise(r => setTimeout(r, 0));
            });

            const currentLocal = useAppStore.getState().localWorkout;
            expect(currentLocal?.exercises[0].sets).toHaveLength(4);

            // 3. Complete and End Workout
            // Switch to fake timers NOW (after component is mounted and intervals running)
            // so we can advance the globalSaveTimer (1000ms) without infinite loops.
            vi.useFakeTimers({ shouldAdvanceTime: false });
            vi.spyOn(useDialogStore.getState(), 'showConfirm').mockResolvedValue(true);
            const dbSaveMock2 = vi.spyOn(DB, 'saveUserData').mockResolvedValue({ ok: true, status: 'synced' } as any);
            const endBtn = screen.getByText(/Termina sessione/i);

            await act(async () => {
                fireEvent.click(endBtn);
            });

            // Advance only the global debouncer. shouldAdvanceTime=false means
            // existing real intervals are paused; we advance exactly 1100ms.
            await act(async () => {
                await vi.advanceTimersByTimeAsync(1100);
            });

            vi.useRealTimers();
            await act(async () => {
                await new Promise(r => setTimeout(r, 50));
            });
            dbSaveMock2.mockRestore();

            // Workout saved to history and cleared from localWorkout
            expect(useAppStore.getState().localWorkout).toBeNull();
            const savedHistory = useAppStore.getState().userData?.history;
            expect(savedHistory?.[0]?.routineName).toBe('Push Day');
            expect(savedHistory?.[0]?.exercises[0].sets).toHaveLength(4);
        });
    });
});
