import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';
import { useNutritionPlanning } from '../src/hooks/useNutritionPlanning';
import TrainingSession from '../src/components/Training/TrainingSession';
import SessionExerciseCard from '../src/components/Training/session/SessionExerciseCard';
import SessionSetRow from '../src/components/Training/session/SessionSetRow';

import { Logic } from '../src/lib/logic';
import { DB } from '../src/lib/db';
import type { UserData, WorkoutSession } from '../src/types';
import { captureSession } from '../src/lib/sync/session';
import { initializeLocal, readLocal } from '../src/lib/sync/localRepository';
import { UserDataSchema } from '../src/lib/schema';
import { idbStore } from './setup';
import { prepareUnlockedTestArchive } from './secureVaultFixture';

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
                        id: 'se_hist_1_bench',
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
                durationWeeks: 4,
                sessionsPerWeek: 3,
                routines: [{ routineId: 'routine_push', frequencyPerWeek: 1 }]
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
            dataOwner: 'user:test-user-id',
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

            expect(showAlertSpy).not.toHaveBeenCalled();
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

        it('1.6 preserves unsaved edits when the domain operation reports a failed result', async () => {
            const originalDispatch = useAppStore.getState().dispatchDomainOperation;
            const showAlertSpy = vi.spyOn(useDialogStore.getState(), 'showAlert').mockResolvedValue();
            useAppStore.setState({
                dispatchDomainOperation: vi.fn(async () => ({ ok: false as const, status: 'rejected' as const, error: new Error('Rejected write') })),
            });
            try {
                const { result } = renderHook(() => useNutritionPlanning());
                act(() => { result.current.handleUpdate('weight', '92'); });
                expect(result.current.saveStatus).toBe('unsaved');
                await act(async () => { await result.current.handleSave(); });
                expect(result.current.saveStatus).toBe('unsaved');
                expect(result.current.planning.weight).toBe('92');
                expect(useAppStore.getState().userData?.nutritionPlanning?.weight).toBe(78.5);
                expect(showAlertSpy).toHaveBeenCalledWith('Errore durante il salvataggio della pianificazione.');
            } finally {
                useAppStore.setState({ dispatchDomainOperation: originalDispatch });
            }
        });
    });

    // =========================================================================
    // SECTION 2: TrainingSession & Memoization Stress Testing
    // =========================================================================
    describe('2. TrainingSession & React.memo Render Isolation Stress', () => {
        it('2.1 TrainingSession remains usable after visibility change during a workout', () => {
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

        it('2.2 Real SessionExerciseCard receives updated exercise props without disturbing its sibling', () => {
            const handlers = {
                onToggleHistory: vi.fn(), onToggleSetup: vi.fn(), onRemoveExercise: vi.fn(),
                onUpdateTechnicalStandard: vi.fn(), onUpdateSetTarget: vi.fn(),
                onUpdateSetupNote: vi.fn(), onUpdateSessionNote: vi.fn(), onAddSet: vi.fn(),
                onRemoveSet: vi.fn(), onUpdateSet: vi.fn(), onAddSpecialSet: vi.fn(),
                onUpdateSpecialSet: vi.fn(), onRemoveSpecialSet: vi.fn(),
                onToggleSpecialMenu: vi.fn()
            };
            const bench = { id: 'card-bench', exId: 'ex_bench', sessionNote: '', sets: [{ id: 'bench-set', kg: '80', reps: '8' }] };
            const squat = { id: 'card-squat', exId: 'ex_squat', sessionNote: '', sets: [{ id: 'squat-set', kg: '120', reps: '5' }] };
            const benchDef = { id: 'ex_bench', name: 'Panca Piana', setsCount: 1, sets: [] };
            const readSquatName = vi.fn(() => 'Squat');
            const squatDef = { id: 'ex_squat', get name() { return readSquatName(); }, setsCount: 1, sets: [] };
            const history: any[] = [];
            const Host = ({ first }: { first: typeof bench }) => (
                <div>
                    <SessionExerciseCard {...handlers} exItem={first} exIndex={0} libDef={benchDef}
                        pastWorkouts={history} isHistoryOpen={false} isSetupOpen={false} openSpecialMenuId={null} />
                    <SessionExerciseCard {...handlers} exItem={squat} exIndex={1} libDef={squatDef}
                        pastWorkouts={history} isHistoryOpen={false} isSetupOpen={false} openSpecialMenuId={null} />
                </div>
            );
            const { rerender } = render(<Host first={bench} />);
            expect(screen.getByDisplayValue('80')).toBeDefined();
            expect(screen.getByDisplayValue('120')).toBeDefined();
            const stableSiblingReads = readSquatName.mock.calls.length;
            expect(stableSiblingReads).toBeGreaterThan(0);
            rerender(<Host first={{ ...bench, sets: [{ ...bench.sets[0], kg: '85' }] }} />);
            expect(screen.getByDisplayValue('85')).toBeDefined();
            expect(screen.getByDisplayValue('120')).toBeDefined();
            expect(readSquatName).toHaveBeenCalledTimes(stableSiblingReads);
        });

        it('2.3 Real SessionSetRow updates one set without altering another set input', () => {
            const handlers = {
                onToggleMenu: vi.fn(), onRemoveSet: vi.fn(), onUpdateSet: vi.fn(),
                onUpdateSetTarget: vi.fn(),
                onAddSpecialSet: vi.fn(), onUpdateSpecialSet: vi.fn(),
                onRemoveSpecialSet: vi.fn()
            };
            const first = { id: 'set-0', kg: '80', reps: '8' };
            const readSecondWeight = vi.fn(() => '120');
            const second = { id: 'set-1', get kg() { return readSecondWeight(); }, reps: '5' };
            const Host = ({ current }: { current: typeof first }) => (
                <div>
                    <SessionSetRow {...handlers} set={current} exIndex={0} sIndex={0}
                        trackingType="weight_reps" isOpenMenu={false} />
                    <SessionSetRow {...handlers} set={second} exIndex={0} sIndex={1}
                        trackingType="weight_reps" isOpenMenu={false} />
                </div>
            );
            const { rerender } = render(<Host current={first} />);
            expect(screen.getByDisplayValue('80')).toBeDefined();
            expect(screen.getByDisplayValue('120')).toBeDefined();
            const stableSecondReads = readSecondWeight.mock.calls.length;
            expect(stableSecondReads).toBeGreaterThan(0);
            rerender(<Host current={{ ...first, kg: '90' }} />);
            expect(screen.getByDisplayValue('90')).toBeDefined();
            expect(screen.getByDisplayValue('120')).toBeDefined();
            expect(readSecondWeight).toHaveBeenCalledTimes(stableSecondReads);
        });

        it('2.4 Session without prior history preserves user-entered notes', () => {
            const activeWorkout: WorkoutSession = {
                id: 'sess_new_ex',
                routineId: 'routine_push',
                routineName: 'Push Day',
                date: '2026-08-16',
                globalStartTime: 1,
                exercises: [
                    { exId: 'ex_treadmill', sets: [{ id: 'st1', kg: '', reps: '', time: '20', distance: '3.0' }], sessionNote: '' }
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
            // Prepared and started sessions must be proven durable in the same
            // owner-scoped IndexedDB repository that production uses.
            const owner = captureSession().owner;
            await prepareUnlockedTestArchive(owner);
            const initial = UserDataSchema.parse(baseUserData) as UserData;
            await initializeLocal(owner, initial);
            const archiveKey = 'logbook:v2:' + owner;
            const initialCiphertext = idbStore[archiveKey];
            expect(initialCiphertext).toEqual(expect.stringMatching(/^tlb-sealed:v1:/));
            expect(initialCiphertext).not.toContain('Push Day');
            useAppStore.setState({ userData: initial, dataOwner: owner, localPersistenceBlocked: false });
            // Keep the real owner-scoped IndexedDB commit. Only the cloud
            // transport is offline; undefined is not a valid SyncResult.
            const cloudSave = vi.spyOn(DB, 'saveUserData').mockResolvedValue({
                ok: false, status: 'local-pending', error: new Error('Cloud offline'),
            } as any);
            render(<TrainingSession />);

            // 1. Start workout from planned routine (first Avvia button)
            const startBtn = screen.getByText(/Avvia Push Day \(Seduta/i);
            expect(startBtn).toBeDefined();

            await act(async () => {
                fireEvent.click(startBtn);
                await new Promise(r => setTimeout(r, 0));
            });

            expect(useAppStore.getState().localWorkout?.routineName).toBe('Push Day');
            expect(screen.getByRole('heading', { name: 'Come arrivi oggi?' })).toBeDefined();
            await act(async () => {
                fireEvent.click(screen.getByRole('button', { name: 'Salta check-in e inizia' }));
                await new Promise(r => setTimeout(r, 0));
            });
            await act(async () => { await useAppStore.getState().flushPendingSyncs(); });
            await waitFor(() => expect(screen.getByRole('heading', { name: 'Panca Piana' })).toBeDefined());
            expect(screen.getByRole('heading', { name: 'Squat' })).toBeDefined();
            const started = useAppStore.getState().localWorkout;
            expect((await readLocal(owner))?.data.activeWorkout?.globalStartTime).toBe(started?.globalStartTime);
            expect(useAppStore.getState().localPersistenceBlocked).toBe(false);

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
            // Cloud remains offline while the completion is committed to IndexedDB.
            cloudSave.mockResolvedValue({ ok: false, status: 'local-pending', error: new Error('Cloud offline') } as any);
            const endBtn = screen.getByText(/Termina allenamento/i);

            await act(async () => {
                fireEvent.click(endBtn);
            });
            expect(screen.getByRole('heading', { name: 'Com’è andato l’allenamento?' })).toBeDefined();
            await act(async () => {
                fireEvent.click(screen.getByRole('button', { name: 'Salva e termina' }));
                await vi.advanceTimersByTimeAsync(1100);
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
            cloudSave.mockRestore();

            // Workout saved to history and cleared from localWorkout
            expect(useAppStore.getState().localWorkout).toBeNull();
            const savedHistory = useAppStore.getState().userData?.history;
            expect(savedHistory?.[0]?.routineName).toBe('Push Day');
            expect(savedHistory?.[0]?.exercises[0].sets).toHaveLength(4);
            expect((await readLocal(owner))?.data.history?.[0]?.exercises[0].sets).toHaveLength(4);
            const finishedCiphertext = idbStore[archiveKey];
            expect(finishedCiphertext).toEqual(expect.stringMatching(/^tlb-sealed:v1:/));
            expect(finishedCiphertext).not.toBe(initialCiphertext);
            expect(finishedCiphertext).not.toContain('Push Day');
        });
    });
});
