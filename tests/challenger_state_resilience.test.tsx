import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import { UserDataSchema, ExerciseSchema, DomainParsers, defaultUserDataFallback } from '../src/lib/schema';
import { mergeUserData, hasUserData } from '../src/lib/merge';
import {
    calculateEffectiveSetWeight,

    calculateWorkoutVolume,
    getLatestUserWeight,
    autoHealPains,
    searchMuscles,
    getMuscleName
} from '../src/lib/calc/workout';
import { useAppStore } from '../src/store/useAppStore';
import { DB } from '../src/lib/db';
import { renderWithProviders, defaultMockUserData } from './setup';
import CustomFoodForm from '../src/components/Nutrition/CustomFoodForm';
import { SessionRatings } from '../src/components/Training/session/SessionRatings';
import HomeView from '../src/components/Home/HomeView';
import type { UserData, Exercise, WorkoutSession } from '../src/types';

describe('Challenger 2: Adversarial State Management, Schemas, Guest Merge & UI Resilience', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        useAppStore.setState({
            userData: { ...defaultMockUserData, activePains: ['chest', 'back_lats'] },
            localWorkout: null,
            syncing: false,
            saveError: null,
        });
    });

    describe('1. Zod Gateway & Defensive Schema Parsing Stress (R1-R6)', () => {
        it('1.1 UserDataSchema sanitizes corrupted activePains, library, and nested fields without crashing', () => {
            const corruptedPayload = {
                __proto__: { isAdmin: true },
                profile: { name: 12345, dob: null },
                activePains: ['chest', '   ', '', null, undefined, 42, { malicious: true }, '__proto__', 'back_lats_left'],
                library: [
                    {
                        id: 'ex_bw_1',
                        name: 'Trazioni alla sbarra',
                        isBodyweight: 'true', // string boolean coercion
                        equipmentWeight: 12.5,
                        setsCount: '4', // string number coercion
                        muscles: ['dorso', null, ''],
                    },
                    {
                        id: 'ex_bw_2',
                        name: 'Dip alle parallele',
                        isBodyweight: 1, // numeric 1 boolean coercion
                        equipmentWeight: null,
                        setsCount: -3,
                    },
                    {
                        // Fatal corruption item (missing id / name)
                        id: null,
                        name: null,
                    }
                ],
                history: 'invalid_history_string', // Should fallback to []
                nutrition: null, // Should fallback to {}
                customFoods: undefined, // Should fallback to []
            };

            const parsed = UserDataSchema.parse(corruptedPayload);
            expect(parsed).toBeDefined();
            expect(Array.isArray(parsed.activePains)).toBe(true);
            expect(parsed.activePains).toContain('chest');
            expect(parsed.activePains).toContain('back_lats_left');
            // Check library
            expect(Array.isArray(parsed.library)).toBe(true);
            const ex1 = parsed.library.find(e => e.id === 'ex_bw_1');
            expect(ex1).toBeDefined();
            expect(ex1?.isBodyweight).toBe(true);
            expect(typeof ex1?.setsCount).toBe('number');
            expect(parsed.history).toEqual([]);
            expect(parsed.nutrition).toEqual({});
        });

        it('1.2 ExerciseSchema correctly validates and coerces isBodyweight and equipmentWeight variations', () => {
            // Test boolean truthy variations
            const truthy1 = ExerciseSchema.parse({ id: 'e1', name: 'Pushups', isBodyweight: 'true' });
            expect(truthy1.isBodyweight).toBe(true);

            const truthy2 = ExerciseSchema.parse({ id: 'e2', name: 'Pushups', isBodyweight: '1' });
            expect(truthy2.isBodyweight).toBe(true);

            const truthy3 = ExerciseSchema.parse({ id: 'e3', name: 'Pushups', isBodyweight: 1 });
            expect(truthy3.isBodyweight).toBe(true);

            const falsy1 = ExerciseSchema.parse({ id: 'e4', name: 'Bench', isBodyweight: 'false' });
            expect(falsy1.isBodyweight).toBe(false);

            const falsy2 = ExerciseSchema.parse({ id: 'e5', name: 'Bench', isBodyweight: 0 });
            expect(falsy2.isBodyweight).toBe(false);

            const falsy3 = ExerciseSchema.parse({ id: 'e6', name: 'Bench', isBodyweight: null });
            expect(falsy3.isBodyweight).toBeUndefined();

            // Test equipmentWeight variations
            const eq1 = ExerciseSchema.parse({ id: 'e7', name: 'Belt Squat', equipmentWeight: 15 });
            expect(eq1.equipmentWeight).toBe(15);

            const eq2 = ExerciseSchema.parse({ id: 'e8', name: 'Belt Squat', equipmentWeight: '22.5' });
            expect(eq2.equipmentWeight).toBe(22.5);

            const eq3 = ExerciseSchema.parse({ id: 'e9', name: 'Belt Squat', equipmentWeight: 'invalid' });
            expect(eq3.equipmentWeight).toBeUndefined();

            const eq4 = ExerciseSchema.parse({ id: 'e10', name: 'Belt Squat', equipmentWeight: NaN });
            expect(eq4.equipmentWeight).toBeUndefined();
        });

        it('1.3 DomainParsers.parseActivePains cleanly filters corrupt values and whitespace', () => {
            const rawPains = ['chest', '', '   ', null, undefined, 123, {}, 'back_lats_left', 'quadriceps'];
            const cleaned = DomainParsers.parseActivePains(rawPains);
            expect(cleaned).toEqual(['chest', 'back_lats_left', 'quadriceps']);

            // Non-array input fallback
            expect(DomainParsers.parseActivePains(null)).toEqual([]);
            expect(DomainParsers.parseActivePains('chest')).toEqual([]);
            expect(DomainParsers.parseActivePains({})).toEqual([]);
        });

        it('1.4 DomainParsers.parseLibrary preserves valid records with defensive fallbacks', () => {
            const rawLib = [
                { id: 'ex1', name: 'Panca', isBodyweight: false },
                'corrupted_string',
                null,
                { id: 'ex2', name: 'Dip', isBodyweight: true, equipmentWeight: 0 },
                { random: 'data_without_id_name' }
            ];

            const parsed = DomainParsers.parseLibrary(rawLib);
            expect(parsed.length).toBe(2); // 2 valid items preserved, 3 ghosts filtered
            expect(parsed.find(e => e.id === 'ex1')?.name).toBe('Panca');
            expect(parsed.find(e => e.id === 'ex2')?.isBodyweight).toBe(true);
        });
    });

    describe('2. Deterministic Guest-to-Cloud Merge Resilience (R1-R6)', () => {
        it('2.1 mergeUserData correctly performs union and deduplication of activePains', () => {
            const cloudData: UserData = {
                ...defaultUserDataFallback,
                activePains: ['chest', 'biceps_left'],
            };

            const guestData: UserData = {
                ...defaultUserDataFallback,
                activePains: ['biceps_left', 'quadriceps', 'back_lats'],
            };

            const merged = mergeUserData(cloudData, guestData);
            expect(merged.activePains).toHaveLength(4);
            expect(merged.activePains).toContain('chest');
            expect(merged.activePains).toContain('biceps_left');
            expect(merged.activePains).toContain('quadriceps');
            expect(merged.activePains).toContain('back_lats');
        });

        it('2.2 mergeUserData preserves guest priority on library collisions with isBodyweight & equipmentWeight', () => {
            const cloudData: UserData = {
                ...defaultUserDataFallback,
                library: [
                    { id: 'ex_dip', name: 'Dip', setsCount: 3, isBodyweight: false, sets: [] },
                    { id: 'ex_squat', name: 'Squat', setsCount: 4, sets: [] }
                ]
            };

            const guestData: UserData = {
                ...defaultUserDataFallback,
                library: [
                    { id: 'ex_dip', name: 'Dip alle parallele (Guest)', setsCount: 4, isBodyweight: true, equipmentWeight: 10, sets: [] },
                    { id: 'ex_pullup', name: 'Pullup', setsCount: 3, isBodyweight: true, sets: [] }
                ]
            };

            const merged = mergeUserData(cloudData, guestData);
            expect(merged.library).toHaveLength(3);
            const dip = merged.library.find(e => e.id === 'ex_dip');
            expect(dip?.name).toBe('Dip alle parallele (Guest)');
            expect(dip?.isBodyweight).toBe(true);
            expect(dip?.equipmentWeight).toBe(10);
            expect(dip?.setsCount).toBe(4);

            expect(merged.library.some(e => e.id === 'ex_squat')).toBe(true);
            expect(merged.library.some(e => e.id === 'ex_pullup')).toBe(true);
        });

        it('2.3 hasUserData returns true when only activePains or bodyweight exercises exist', () => {
            expect(hasUserData(null)).toBe(false);
            // defaultUserDataFallback has pre-filled nutritionPlanning (weight:80, etc.), so hasUserData returns true for it.
            // Use a truly empty object to test the "no data" case:
            expect(hasUserData({} as any)).toBe(false);

            const dataWithPainOnly: UserData = {
                ...defaultUserDataFallback,
                activePains: ['shoulders_right']
            };
            expect(hasUserData(dataWithPainOnly)).toBe(true);

            const dataWithLibOnly: UserData = {
                ...defaultUserDataFallback,
                library: [{ id: 'ex1', name: 'Custom Pushup', setsCount: 3, isBodyweight: true, sets: [] }]
            };
            expect(hasUserData(dataWithLibOnly)).toBe(true);
        });

        it('2.4 High volume stress merge: merges 500 conflicting items rapidly without error', () => {
            const cloudLib: Exercise[] = [];
            const guestLib: Exercise[] = [];
            for (let i = 0; i < 500; i++) {
                cloudLib.push({ id: `ex_${i}`, name: `Cloud Ex ${i}`, setsCount: 3, sets: [] });
                guestLib.push({ id: `ex_${i}`, name: `Guest Ex ${i}`, setsCount: 4, isBodyweight: i % 2 === 0, equipmentWeight: i, sets: [] });
            }

            const cloudData: UserData = { ...defaultUserDataFallback, library: cloudLib, activePains: ['chest'] };
            const guestData: UserData = { ...defaultUserDataFallback, library: guestLib, activePains: ['back_lats'] };

            const start = performance.now();
            const merged = mergeUserData(cloudData, guestData);
            const duration = performance.now() - start;

            expect(duration).toBeLessThan(500); // sub-500ms
            expect(merged.library).toHaveLength(500);
            expect(merged.library[0].name).toBe('Guest Ex 0');
            expect(merged.library[0].isBodyweight).toBe(true);
            expect(merged.activePains).toEqual(['chest', 'back_lats']);
        });
    });

    describe('3. Pure Calculation & DOMS Auto-Healing Logic Stress (R1, R5, R6)', () => {
        it('3.1 calculateEffectiveSetWeight properly handles bodyweight, equipment, ballasts, and string commas', () => {
            const userWeight = 75;

            // 1. Standard non-bodyweight exercise
            expect(calculateEffectiveSetWeight('60', { isBodyweight: false }, userWeight)).toBe(60);

            // 2. Pure bodyweight (0 kg inserted -> effective weight = user weight)
            expect(calculateEffectiveSetWeight('0', { isBodyweight: true }, userWeight)).toBe(75);
            expect(calculateEffectiveSetWeight('', { isBodyweight: true }, userWeight)).toBe(75);

            // 3. Bodyweight + ballast
            expect(calculateEffectiveSetWeight('15', { isBodyweight: true }, userWeight)).toBe(90);
            expect(calculateEffectiveSetWeight('12,5', { isBodyweight: true }, userWeight)).toBe(87.5);

            // 4. Equipment base weight (e.g. 20kg bar or 15kg machine)
            expect(calculateEffectiveSetWeight('30', { equipmentWeight: 15 }, userWeight)).toBe(45);
            expect(calculateEffectiveSetWeight('0', { equipmentWeight: 20.5 }, userWeight)).toBe(20.5);

            // 5. Bodyweight + Equipment + Ballast
            expect(calculateEffectiveSetWeight('10', { isBodyweight: true, equipmentWeight: 5 }, userWeight)).toBe(90);

            // 6. Adversarial / Edge inputs
            expect(calculateEffectiveSetWeight(null, null, userWeight)).toBe(0);
            expect(calculateEffectiveSetWeight('invalid', { isBodyweight: true }, 0)).toBe(0);
            expect(calculateEffectiveSetWeight('-10', { isBodyweight: true }, userWeight)).toBe(65);
        });

        it('3.2 calculateWorkoutVolume correctly computes total volume for mixed regular, bodyweight, and equipment sets', () => {
            const userWeight = 80;
            const library: Exercise[] = [
                { id: 'lib_bench', name: 'Bench', setsCount: 3, sets: [] },
                { id: 'lib_dips', name: 'Dips', setsCount: 3, isBodyweight: true, equipmentWeight: 0, sets: [] },
                { id: 'lib_legpress', name: 'Leg Press', setsCount: 3, equipmentWeight: 45, sets: [] }
            ];

            const session: Partial<WorkoutSession> = {
                exercises: [
                    {
                        exId: 'lib_bench',
                        sets: [
                            { kg: '100', reps: '10' }, // 100 * 10 = 1000
                            { kg: '100', reps: '8', dropsets: [{ kg: '80', reps: '5' }] } // 100*8 + 80*5 = 800 + 400 = 1200
                        ]
                    },
                    {
                        exId: 'lib_dips',
                        sets: [
                            { kg: '0', reps: '10' }, // (0 + 80) * 10 = 800
                            { kg: '20', reps: '5' }   // (20 + 80) * 5 = 500
                        ]
                    },
                    {
                        exId: 'lib_legpress',
                        sets: [
                            { kg: '100', reps: '10' } // (100 + 45) * 10 = 1450
                        ]
                    }
                ]
            };

            const totalVol = calculateWorkoutVolume(session as any, library, userWeight);
            // Expected: 1000 + 1200 + 800 + 500 + 1450 = 4950
            expect(totalVol).toBe(4950);
        });

        it('3.3 getLatestUserWeight correctly prioritizes latest nutrition day weight -> planning weight -> 80 default', () => {
            // Case 1: Nutrition day with weight
            const nutrition = {
                '2026-08-01': { weight: 72 },
                '2026-08-15': { weight: 74.5 },
                '2026-08-10': { weight: 73 }
            };
            const planning = { weight: 78 };
            expect(getLatestUserWeight(nutrition, planning)).toBe(74.5);

            // Case 2: No valid nutrition weight, planning weight present
            expect(getLatestUserWeight({ '2026-08-01': { weight: '' } }, { weight: '82.5' })).toBe(82.5);

            // Case 3: Both empty -> 80 default
            expect(getLatestUserWeight(null, null)).toBe(80);
            expect(getLatestUserWeight({}, {})).toBe(80);
        });

        it('3.4 autoHealPains: Lateral variant, base variant, and secondary muscle auto-healing rules', () => {
            const library = [
                { id: 'ex_bench', muscles: ['chest'], secondaryMuscles: ['triceps', 'deltoids_front'] },
                { id: 'ex_squat', muscles: ['quadriceps', 'glutes'], secondaryMuscles: ['hamstrings'] },
                { id: 'ex_lat_raise', muscles: ['shoulders_left', 'shoulders_right'] }
            ];

            // Scenario A: Active pain has lateral variant 'chest_left'. Workout trains 'ex_bench' (muscles: ['chest']).
            // Session pains is empty -> 'chest_left' should heal!
            const activeA = ['chest_left', 'back_lats'];
            const resA = autoHealPains(activeA, [{ exId: 'ex_bench' }], library, []);
            expect(resA).toEqual(['back_lats']); // chest_left healed!

            // Scenario B: Active pain has base 'shoulders'. Workout trains 'ex_lat_raise' (muscles: ['shoulders_left', 'shoulders_right']).
            // Session pains is empty -> 'shoulders' should heal!
            const activeB = ['shoulders', 'biceps'];
            const resB = autoHealPains(activeB, [{ exId: 'ex_lat_raise' }], library, []);
            expect(resB).toEqual(['biceps']); // shoulders healed!

            // Scenario C: Active pain is on secondary muscle ('triceps'). Workout trains 'ex_bench' where triceps is ONLY secondary.
            // Session pains is empty -> 'triceps' MUST NOT heal (remains active)!
            const activeC = ['triceps'];
            const resC = autoHealPains(activeC, [{ exId: 'ex_bench' }], library, []);
            expect(resC).toEqual(['triceps']); // NOT healed because it was only secondary!

            // Scenario D: Active pain on 'chest'. Workout trains 'ex_bench', but user explicitly re-selects 'chest' in session pains.
            // Result: 'chest' remains active.
            const activeD = ['chest'];
            const resD = autoHealPains(activeD, [{ exId: 'ex_bench' }], library, ['chest']);
            expect(resD).toEqual(['chest']);

            // Scenario E: Untrained pain stays, new pain added in session is saved.
            const activeE = ['legs'];
            const resE = autoHealPains(activeE, [{ exId: 'ex_bench' }], library, ['abs']);
            expect(resE).toContain('legs');
            expect(resE).toContain('abs');
        });

        it('3.5 searchMuscles and getMuscleName handle lateral and accented muscle searches', () => {
            const results1 = searchMuscles('petto');
            expect(results1.length).toBeGreaterThan(0);
            expect(results1.some(m => m.id.includes('chest') || m.name.toLowerCase().includes('petto'))).toBe(true);

            const results2 = searchMuscles('quad');
            expect(results2.length).toBeGreaterThan(0);

            expect(getMuscleName('chest')).toBe('Petto');
            expect(getMuscleName('')).toBe('');
        });
    });

    describe('4. Zustand Store Persistence, Error Rejection & Storage Tiering Stress', () => {
        it('4.1 saveUserData rejects Promise and sets saveError if DB.saveUserData throws', async () => {
            const store = useAppStore.getState();
            (DB.saveUserData as any).mockRejectedValueOnce(new Error('Firestore Network Quota Exceeded'));

            await expect(store.saveUserData((prev: any) => ({
                ...prev,
                activePains: ['nuovo_dolore']
            }))).rejects.toThrow('Firestore Network Quota Exceeded');

            const state = useAppStore.getState();
            expect(state.saveError).toBe('I dati sono stati salvati con successo sul dispositivo. La sincronizzazione con il cloud riprenderà automaticamente al ripristino della connessione.');
            expect(state.syncing).toBe(false);
        });

        it('4.2 setUserData shields active localWorkout from remote network overwrites', () => {
            const mockLocalWorkout: any = {
                id: 'live_session_123',
                routineName: 'Live Session in Progress',
                exercises: [{ exId: 'ex1', sets: [{ id: 's1', kg: '90', reps: '8' }] }]
            };

            useAppStore.setState({ localWorkout: mockLocalWorkout });

            const remoteUserData: UserData = {
                ...defaultMockUserData,
                activeWorkout: null
            };

            useAppStore.getState().setUserData(remoteUserData);

            // localWorkout in store must still be intact
            expect(useAppStore.getState().localWorkout).toEqual(mockLocalWorkout);
        });

        it('4.3 visibilitychange to hidden immediately flushes localWorkout to localStorage synchronously', () => {
            const mockWorkout = {
                id: 'sync_test_workout',
                routineName: 'Emergency Background Sync',
                exercises: []
            };

            useAppStore.setState({ localWorkout: mockWorkout as any });

            // Simulate visibility change to hidden
            Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true, configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));

            const stored = localStorage.getItem('logbook_local_workout');
            expect(stored).toBeDefined();
            expect(JSON.parse(stored!)).toEqual(mockWorkout);
        });
    });

    describe('5. UI Rendering & Real-Time Interaction Resilience (R2, R3, R4, R5)', () => {
        it('5.1 CustomFoodForm calculates kcal in real time (4*C + 4*P + 9*F) on macro inputs', () => {
            const saveCustomFood = vi.fn().mockResolvedValue(undefined);

            const TestWrapper = () => {
                const [cfData, setCfData] = useState<any>({ name: '', carbs: '', pro: '', fat: '', kcal: '' });
                const [showCustomModal, setShowCustomModal] = useState(true);
                return (
                    <CustomFoodForm
                        cfData={cfData}
                        setCfData={setCfData}
                        saveCustomFood={saveCustomFood}
                        showCustomModal={showCustomModal}
                        setShowCustomModal={setShowCustomModal}
                    />
                );
            };

            renderWithProviders(<TestWrapper />);

            const nameInput = screen.getByPlaceholderText(/es\. petto di pollo/i);
            const carbsInput = screen.getByLabelText(/carbo/i);
            const proInput = screen.getByLabelText(/pro \(g\)/i);
            const fatInput = screen.getByLabelText(/grassi/i);
            const kcalInput = screen.getByLabelText(/kcal/i) as HTMLInputElement;

            act(() => {
                fireEvent.change(nameInput, { target: { value: 'Pasta e tonno' } });
                fireEvent.change(carbsInput, { target: { value: '50' } });
            });
            act(() => {
                fireEvent.change(proInput, { target: { value: '30' } });
            });
            act(() => {
                fireEvent.change(fatInput, { target: { value: '10' } });
            });

            // 50*4 + 30*4 + 10*9 = 200 + 120 + 90 = 410 kcal
            expect(kcalInput.value).toBe('410');
        });

        it('5.2 CustomFoodForm handles decimal macro inputs and updates kcal accurately', () => {
            const saveCustomFood = vi.fn().mockResolvedValue(undefined);

            const DecimalWrapper = () => {
                const [cfData, setCfData] = useState<any>({ name: 'Integratore', carbs: '', pro: '', fat: '', kcal: '' });
                const [showCustomModal, setShowCustomModal] = useState(true);
                return (
                    <CustomFoodForm
                        cfData={cfData}
                        setCfData={setCfData}
                        saveCustomFood={saveCustomFood}
                        showCustomModal={showCustomModal}
                        setShowCustomModal={setShowCustomModal}
                    />
                );
            };

            renderWithProviders(<DecimalWrapper />);

            const carbsInput = screen.getByLabelText(/carbo/i);
            const proInput = screen.getByLabelText(/pro \(g\)/i);
            const fatInput = screen.getByLabelText(/grassi/i);
            const kcalInput = screen.getByLabelText(/kcal/i) as HTMLInputElement;

            act(() => {
                fireEvent.change(carbsInput, { target: { value: '10.5' } });
            });
            act(() => {
                fireEvent.change(proInput, { target: { value: '10.5' } });
            });
            act(() => {
                fireEvent.change(fatInput, { target: { value: '10' } });
            });

            // 10.5*4 + 10.5*4 + 10*9 = 42 + 42 + 90 = 174 kcal
            expect(kcalInput.value).toBe('174');
        });

        it('5.3 HomeView renders active DOMS card and displays active muscles without error', () => {
            renderWithProviders(
                <HomeView onNavigateTab={vi.fn()} onStartRoutine={vi.fn()} />,
                { userData: { ...defaultMockUserData, activePains: ['chest', 'back_lats'] } }
            );

            // Should display the Dolori / DOMS card
            const painHeading = screen.getByText(/dolori muscolari/i);
            expect(painHeading).toBeDefined();

            // Petto badge should be displayed
            expect(screen.getByText('Petto')).toBeDefined();
        });

        it('5.4 SessionRatings renders interactive DOMS pain selector button and collapsible container', () => {
            const onTogglePain = vi.fn();
            const setWater = vi.fn();
            const setMood = vi.fn();
            const setPump = vi.fn();
            const setFatigue = vi.fn();

            renderWithProviders(
                <SessionRatings
                    water="1.5"
                    setWater={setWater}
                    mood="8"
                    setMood={setMood}
                    pump="9"
                    setPump={setPump}
                    fatigue="5"
                    setFatigue={setFatigue}
                    pains={['chest']}
                    onTogglePain={onTogglePain}
                />
            );

            expect(screen.getByText(/valuta sessione/i)).toBeDefined();
            // Find "Dolori" button
            const doloriBtn = screen.getByRole('button', { name: /dolori muscolari/i });
            expect(doloriBtn).toBeDefined();

            act(() => {
                fireEvent.click(doloriBtn);
            });

            // Verify search input is displayed after expanding
            expect(screen.getByPlaceholderText(/cerca muscolo/i)).toBeDefined();
        });
    });
});
