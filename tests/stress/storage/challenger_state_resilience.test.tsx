import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import { useAppStore } from '../../../src/store/useAppStore';
import { DB } from '../../../src/lib/db';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict } from '../../../src/lib/sync/deviceStorage';
import { unwrapWorkoutDeviceSnapshot } from '../../../src/lib/sync/workoutDeviceIntent';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { draftRegistry } from '../../../src/lib/utils/draftRegistry';
import { renderWithProviders, defaultMockUserData } from '../../setup';
import CustomFoodForm from '../../../src/components/Nutrition/CustomFoodForm';
import { SessionRatings } from '../../../src/components/Training/session/SessionRatings';
import HomeView from '../../../src/components/Home/HomeView';
import type { UserData } from '../../../src/types';

describe('Challenger 2: State Persistence and UI Resilience', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        useAppStore.setState({
            userData: { ...defaultMockUserData, activePains: ['chest', 'back_lats'] },
            dataOwner: 'user:test-user-id',
            localWorkout: null,
            syncing: false,
            saveError: null,
        });
    });

    describe('4. Zustand Store Persistence, Error Rejection & Storage Tiering Stress', () => {
        beforeEach(async () => {
            // An authenticated workout cannot persist before the device vault
            // has been provisioned, including visibilitychange crash recovery.
            localStorage.setItem('logbook:v2:user:test-user-id:health-consent-generation', '1');
            await prepareUnlockedTestArchive('user:test-user-id');
        });
        it('4.1 saveUserData rejects Promise and sets saveError if DB.saveUserData throws', async () => {
            const store = useAppStore.getState();
            (DB.saveUserData as any).mockRejectedValueOnce(new Error('Firestore Network Quota Exceeded'));

            await expect(store.saveUserData((prev: any) => ({
                ...prev,
                activePains: ['nuovo_dolore']
            }))).rejects.toThrow('Firestore Network Quota Exceeded');

            const state = useAppStore.getState();
            expect(state.saveError).toBe('Firestore Network Quota Exceeded');
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

        it('4.3 visibilitychange to hidden seals localWorkout synchronously for recovery', () => {
            const mockWorkout = {
                id: 'sync_test_workout',
                routineName: 'Emergency Background Sync',
                exercises: []
            };

            // A last-second draft flush changes RAM from a known empty state.
            const flush = () => useAppStore.setState({ localWorkout: mockWorkout as any });
            draftRegistry.register(flush);
            try {
                Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true, configurable: true });
                document.dispatchEvent(new Event('visibilitychange'));
                const owner = 'user:test-user-id';
                const ciphertext = localStorage.getItem(protectedDeviceKey('workout', owner));
                expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
                expect(localStorage.getItem(deviceKey('workout', owner))).toBeNull();
                const raw = readDeviceValueStrict('workout', owner);
                expect(raw).not.toBeNull();
                expect(unwrapWorkoutDeviceSnapshot(JSON.parse(raw!), owner).workout).toEqual(mockWorkout);
            } finally { draftRegistry.unregister(flush); }
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

            // Emptying every macro field must restore the form's blank kcal state,
            // not silently persist a computed zero.
            fireEvent.change(carbsInput, { target: { value: '' } });
            fireEvent.change(proInput, { target: { value: '' } });
            fireEvent.change(fatInput, { target: { value: '' } });
            expect(kcalInput.value).toBe('');
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
                <HomeView onNavigate={vi.fn()} />,
                { userData: { ...defaultMockUserData, activePains: ['chest', 'back_lats'] } }
            );

            // Should display the Dolori / DOMS card
            const painHeading = screen.getByText(/Esposizione recente e dolori/i);
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
            expect(doloriBtn.getAttribute('aria-expanded')).toBe('false');
            expect(doloriBtn.getAttribute('aria-controls')).toBe('post-session-doms-panel');

            act(() => {
                fireEvent.click(doloriBtn);
            });

            expect(doloriBtn.getAttribute('aria-expanded')).toBe('true');
            expect(document.getElementById('post-session-doms-panel')).not.toBeNull();
            // Verify search input is displayed after expanding
            expect(screen.getByPlaceholderText(/cerca muscolo/i)).toBeDefined();
        });
    });
});
