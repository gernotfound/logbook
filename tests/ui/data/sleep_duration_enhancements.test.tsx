import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, act, fireEvent, renderHook } from '@testing-library/react';
import { renderWithProviders, emptyUserData, idbStore } from '../../setup';
import { useAppStore } from '../../../src/store/useAppStore';
import { captureSession } from '../../../src/lib/sync/session';
import { initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { Logic } from '../../../src/lib/logic';
import { NutritionDaySchema } from '../../../src/lib/schema';
import { useSleepMeasurements } from '../../../src/hooks/useSleepMeasurements';
import DataSleep from '../../../src/components/Data/DataSleep';
import DataHistory from '../../../src/components/Data/DataHistory';
import { Exporter } from '../../../src/lib/export';

describe('Sleep duration and phases', () => {
    describe('Feature coverage', () => {
    beforeEach(async () => {
        window.localStorage.clear();
        localStorage.setItem(`logbook:v2:${captureSession().owner}:health-consent-generation`, '1');
        useAppStore.getState().resetStore();
        useAppStore.setState({ dataOwner: captureSession().owner });
        vi.clearAllMocks();
    });

    afterEach(() => {
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.restoreAllMocks();
    });

        describe('R1: Formato Sonno in HH:MM', () => {
            it('T1.1.1: useSleepMeasurements sets and persists sleep duration into userData.nutrition[date] in canonical HH:MM format', async () => {
                await prepareUnlockedTestArchive('user:test-user-id');
                const today = Logic.getLocalDateString();
                const owner = captureSession().owner;
                const initialData = { ...emptyUserData, nutrition: {} };
                await initializeLocal(owner, initialData);
                useAppStore.setState({ userData: initialData, dataOwner: owner });

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
                expect((await readLocal(owner))?.data.nutrition?.[today]?.sleepHours).toBe('08:00');
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
                    cancelEdit: vi.fn(() => true),
                };

                const { container } = renderWithProviders(<DataSleep sleepHook={mockSleepHook} />);

                expect(container.querySelector('#sleep-hours')).not.toBeNull();
                expect(container.querySelector('#sleep-deep')).not.toBeNull();
                expect(container.querySelector('#sleep-light')).not.toBeNull();
                expect(container.querySelector('#sleep-rem')).not.toBeNull();
                expect(container.querySelector('#sleep-awake')).not.toBeNull();
                expect(container.textContent).toContain('Dati sonno');
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
                    cancelEdit: vi.fn(() => true),
                };

                const { container } = renderWithProviders(<DataSleep sleepHook={mockSleepHook} />);

                const hoursInput = container.querySelector('#sleep-hours') as HTMLInputElement;
                fireEvent.change(hoursInput, { target: { value: '08:30' } });
                expect(mockSleepHook.setSleepHours).toHaveBeenCalledWith('08:30');

                const saveBtn = screen.getByText(/Salva sonno/i);
                fireEvent.click(saveBtn);
                expect(mockSleepHook.saveSleep).toHaveBeenCalledTimes(1);
            });

            it('T1.1.4: DataHistory displays supplied sleep metrics in history list formatted in HH:MM', () => {
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

                // History focuses one selected day at a time, matching Training history.
                expect(container.textContent).toContain('Sonno 08:00');

                fireEvent.click(screen.getByRole('button', { name: /10 agosto 2026, 1 rilevazione/i }));
                expect(container.textContent).toContain('Sonno 07:30');

                // The contextual edit action keeps using the real callback.
                fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
                const editItem = screen.getByRole('menuitem', { name: 'Modifica misurazione' });
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
    });

    describe('Boundaries and corner cases', () => {
    beforeEach(async () => {
        window.localStorage.clear();
        localStorage.setItem(`logbook:v2:${captureSession().owner}:health-consent-generation`, '1');
        useAppStore.getState().resetStore();
        useAppStore.setState({ dataOwner: captureSession().owner });
        vi.clearAllMocks();
    });

    afterEach(() => {
        window.localStorage.clear();
        useAppStore.getState().resetStore();
        vi.restoreAllMocks();
    });

        describe('R1 Boundaries (Sleep Formats & Edge Values)', () => {
            it('T2.1.1: Zero and empty sleep strings handle cleanly without throwing NaN', async () => {
                await prepareUnlockedTestArchive('user:test-user-id');
                const owner = captureSession().owner;
                const initialData = { ...emptyUserData, nutrition: {} };
                await initializeLocal(owner, initialData);
                useAppStore.setState({ userData: initialData, dataOwner: owner });
                const { result } = renderHook(() => useSleepMeasurements());

                act(() => {
                    result.current.setSleepHours('');
                });

                await act(async () => {
                    await result.current.saveSleep();
                });

                // Validation failure leaves the durable owner archive untouched.
                expect(useAppStore.getState().userData?.nutrition).toEqual({});
                expect((await readLocal(owner))?.data.nutrition).toEqual({});
                expect(idbStore['logbook:v2:' + owner]).toMatch(/^tlb-sealed:v1:/);
            });



            it('T2.1.4: Incomplete sleep phase inputs (only total sleep provided, phases empty) save cleanly', async () => {
                await prepareUnlockedTestArchive('user:test-user-id');
                const today = Logic.getLocalDateString();
                const owner = captureSession().owner;
                const initialData = { ...emptyUserData, nutrition: {} };
                await initializeLocal(owner, initialData);
                useAppStore.setState({ userData: initialData, dataOwner: owner });
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
                const durable = (await readLocal(owner))?.data.nutrition?.[today];
                expect(durable?.sleepHours).toBe('08:00');
                expect(durable?.sleepDeep).toBeUndefined();
                expect(durable?.sleepLight).toBeUndefined();
                expect(idbStore['logbook:v2:' + owner]).toMatch(/^tlb-sealed:v1:/);
            });

            it('T2.1.5: Exporter.exportToCSV outputs sleep values in CSV without throwing on empty days', async () => {
                const downloadFileSpy = vi.spyOn(Exporter, 'downloadFile').mockResolvedValue(true);

                const nutrition = {
                    '2026-08-01': { date: '2026-08-01', kcal: 0, carbs: 0, pro: 0, fat: 0, weight: 80, sleepHours: '07:30', sleepDeep: '02:00' },
                    '2026-08-02': { date: '2026-08-02', kcal: 0, carbs: 0, pro: 0, fat: 0, weight: 80.2 } // no sleep
                };

                await Exporter.exportToCSV([], nutrition, []);

                // misurazioni.csv contains formatted sleep
                await vi.waitFor(() => {
                    expect(downloadFileSpy).toHaveBeenCalledWith('misurazioni.csv', expect.stringContaining('"07:30","02:00"'), expect.anything());
                });
            });
        });
    });
});
