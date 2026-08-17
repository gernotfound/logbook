import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, render, screen } from '@testing-library/react';
import { useAppStore } from '../src/store/useAppStore';
import { useNutritionMeals } from '../src/hooks/useNutritionMeals';
import { useNutritionPlanning } from '../src/hooks/useNutritionPlanning';
import { Logic } from '../src/lib/logic';
import type { UserData, WorkoutSession } from '../src/types';

describe('Challenger 2: Zustand Fine-Grained Selectors & Background Render Isolation Stress', () => {
    const initialTestUserData: UserData = {
        profile: {
            dob: '1995-05-15',
            gender: 'male',
            height: '180',
            neck: '40',
            waist: '82',
            hip: '95',
            chest: '105',
            shoulders: '120',
            biceps: '38',
            thighs: '60',
            calves: '38'
        },
        library: [
            { id: 'ex_bench', name: 'Panca Piana', setsCount: 4, sets: [] }
        ],
        routines: [],
        history: [],
        nutrition: {
            '2026-08-16': {
                date: '2026-08-16',
                kcal: 2200,
                carbs: 250,
                pro: 160,
                fat: 60,
                weight: 79.5,
                isDayOn: true,
                meals: [
                    { id: 'm1', name: 'Riso e pollo', meal: 'pranzo', quantity: 150, kcal: 450, carbs: 60, pro: 35, fat: 5 }
                ],
                supplementsIntake: []
            },
            '2026-08-15': {
                date: '2026-08-15',
                kcal: 2500,
                carbs: 300,
                pro: 170,
                fat: 70,
                weight: 80.0,
                isDayOn: false,
                meals: [],
                supplementsIntake: []
            }
        },
        customFoods: [],
        activeWorkout: null,
        nutritionPlanning: {
            weight: 80,
            onDaysCount: 4,
            avgMacros: { carbsPerKg: 3.5, proPerKg: 2.0, fatPerKg: 1.0 },
            onBoost: { carbsPercent: 20, proPercent: 0, fatPercent: 0 },
            normocalorica: { kcal: 2500, carbs: 300, pro: 160, fat: 70 }
        },
        trainingCycles: [],
        activeCycleId: null,
        supplements: []
    };

    beforeEach(() => {
        vi.clearAllMocks();
        useAppStore.setState({
            userData: JSON.parse(JSON.stringify(initialTestUserData)),
            localWorkout: null,
            syncing: false,
            saveError: null
        });
    });

    describe('1. useNutritionMeals Hook Isolation during Live Workout Inputs', () => {
        it('does NOT re-render or re-sort nutrition dates when workout session updates occur', () => {
            let hookRenderCount = 0;
            const sortSpy = vi.spyOn(Array.prototype, 'sort');

            const { result } = renderHook(() => {
                hookRenderCount++;
                return useNutritionMeals('2026-08-16');
            });

            expect(hookRenderCount).toBe(1);
            expect(result.current.todayNutrition.kcal).toBe(2200);

            // Record baseline sort call count
            const initialSortCalls = sortSpy.mock.calls.length;

            // Simulate 50 rapid live keystrokes / set updates in TrainingSession
            for (let i = 1; i <= 50; i++) {
                act(() => {
                    const activeWorkout: WorkoutSession = {
                        id: 'live_sess_1',
                        routineName: 'Push Session',
                        date: '2026-08-16',
                        globalStartTime: 1723810000000,
                        exercises: [
                            {
                                exId: 'ex_bench',
                                sessionNote: `Note keystroke ${i}`,
                                sets: [
                                    { id: 's1', kg: `${80 + (i % 10)}`, reps: `${8 + (i % 3)}`, done: i % 2 === 0 }
                                ]
                            }
                        ]
                    };
                    useAppStore.getState().setLocalWorkout(activeWorkout);
                });
            }

            // Verify: hookRenderCount MUST REMAIN 1 because nutrition did not change!
            expect(hookRenderCount).toBe(1);
            // Verify: No additional array sorting calls were triggered by workout updates
            expect(sortSpy.mock.calls.length).toBe(initialSortCalls);
        });

        it('re-renders cleanly when actual nutrition entries are modified', () => {
            let hookRenderCount = 0;
            const { result } = renderHook(() => {
                hookRenderCount++;
                return useNutritionMeals('2026-08-16');
            });

            expect(hookRenderCount).toBe(1);

            // Mutate nutrition
            act(() => {
                useAppStore.setState((state) => ({
                    userData: state.userData ? {
                        ...state.userData,
                        nutrition: {
                            ...state.userData.nutrition,
                            '2026-08-16': {
                                ...state.userData.nutrition['2026-08-16'],
                                kcal: 2600
                            }
                        }
                    } : null
                }));
            });

            expect(hookRenderCount).toBe(2);
            expect(result.current.todayNutrition.kcal).toBe(2600);
        });
    });

    describe('2. useNutritionPlanning Hook Isolation & TDEE Calculation Insulation', () => {
        it('does NOT trigger TDEE recalculation or hook re-renders during active workout keystrokes', () => {
            let hookRenderCount = 0;
            const tdeeSpy = vi.spyOn(Logic, 'calculateTDEEAndMacros');

            const { result } = renderHook(() => {
                hookRenderCount++;
                return useNutritionPlanning();
            });

            expect(hookRenderCount).toBe(1);
            expect(tdeeSpy).toHaveBeenCalledTimes(1);

            // Simulate 50 live workout keystrokes
            for (let i = 1; i <= 50; i++) {
                act(() => {
                    useAppStore.getState().setLocalWorkout({
                        id: 'live_sess_planning_test',
                        routineName: 'Leg Day',
                        date: '2026-08-16',
                        exercises: [
                            {
                                exId: 'squat',
                                sessionNote: `Typing set ${i}`,
                                sets: [{ id: `s_${i}`, kg: '120', reps: '5' }]
                            }
                        ]
                    });
                });
            }

            // Hook render count and TDEE calc count MUST remain exactly 1
            expect(hookRenderCount).toBe(1);
            expect(tdeeSpy).toHaveBeenCalledTimes(1);
            expect(result.current.planning.weight).toBe(80);
        });

        it('re-evaluates TDEE calculation when planning or profile dependencies change', () => {
            const tdeeSpy = vi.spyOn(Logic, 'calculateTDEEAndMacros');
            let hookRenderCount = 0;

            renderHook(() => {
                hookRenderCount++;
                return useNutritionPlanning();
            });

            expect(hookRenderCount).toBe(1);
            expect(tdeeSpy).toHaveBeenCalledTimes(1);

            // Update profile weight/height in Zustand
            act(() => {
                useAppStore.setState((state) => ({
                    userData: state.userData ? {
                        ...state.userData,
                        profile: {
                            ...state.userData.profile,
                            waist: '78'
                        }
                    } : null
                }));
            });

            expect(hookRenderCount).toBe(2);
            expect(tdeeSpy).toHaveBeenCalledTimes(2);
        });

        it('does NOT mutate store nutritionPlanning in-place when resolving default properties', () => {
            const frozenStorePlanning = Object.freeze({
                weight: undefined,
                onDaysCount: undefined,
                avgMacros: undefined,
                onBoost: undefined,
                normocalorica: undefined
            });

            useAppStore.setState(state => ({
                userData: state.userData ? {
                    ...state.userData,
                    nutritionPlanning: frozenStorePlanning as any
                } : null
            }));

            // If useNutritionPlanning mutates storePlanning in-place, Object.freeze will throw a TypeError in strict mode
            expect(() => {
                const { result } = renderHook(() => useNutritionPlanning());
                expect(result.current.planning.onDaysCount).toBe(4);
                expect(result.current.planning.weight).toBe(79.5); // latest weight from nutritionMap
                expect(result.current.planning.avgMacros?.carbsPerKg).toBe(3.5);
                expect(result.current.planning.onBoost?.carbsPercent).toBe(20);
            }).not.toThrow();

            // Store state object remains untouched
            const currentStorePlanning = useAppStore.getState().userData?.nutritionPlanning;
            expect(currentStorePlanning?.onDaysCount).toBeUndefined();
            expect(currentStorePlanning?.avgMacros).toBeUndefined();
        });
    });

    describe('3. Multi-Tab Background Mount Simulation', () => {
        it('simulates both Training and Nutrition tabs mounted in DOM and verifies zero crosstalk', () => {
            let nutritionComponentRenders = 0;

            const MockNutritionComponent = React.memo(() => {
                nutritionComponentRenders++;
                const { todayNutrition } = useNutritionMeals('2026-08-16');
                return <div data-testid="nutrition-view">{todayNutrition.kcal} kcal</div>;
            });

            const MockTrainingActiveComponent = () => {
                const activeWorkout = useAppStore(state => state.localWorkout);
                return (
                    <div data-testid="training-view">
                        <span>{activeWorkout?.routineName || 'No Workout'}</span>
                        <span>{activeWorkout?.exercises?.[0]?.sessionNote || 'No Note'}</span>
                    </div>
                );
            };

            const MultiTabContainer = () => {
                return (
                    <div>
                        <div style={{ display: 'block' }}>
                            <MockTrainingActiveComponent />
                        </div>
                        <div style={{ display: 'none' }}>
                            <MockNutritionComponent />
                        </div>
                    </div>
                );
            };

            render(<MultiTabContainer />);

            expect(nutritionComponentRenders).toBe(1);
            expect(screen.getByTestId('nutrition-view').textContent).toContain('2200 kcal');

            // Simulate typing in active workout
            for (let i = 1; i <= 20; i++) {
                act(() => {
                    useAppStore.getState().setLocalWorkout({
                        id: 'w1',
                        routineName: 'Upper Body',
                        exercises: [{ exId: 'e1', sessionNote: `Char ${i}`, sets: [] }]
                    });
                });
            }

            // Nutrition component in background MUST NOT have re-rendered
            expect(nutritionComponentRenders).toBe(1);
            expect(screen.getByTestId('training-view').textContent).toContain('Char 20');
        });
    });
});
