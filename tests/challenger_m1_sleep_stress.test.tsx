import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, renderHook } from '@testing-library/react';
import { renderWithProviders, emptyUserData } from './setup';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';
import { Logic } from '../src/lib/logic';
import { UserDataSchema } from '../src/lib/schema';
import { useSleepMeasurements } from '../src/hooks/useSleepMeasurements';
import DataSleep from '../src/components/Data/DataSleep';
import DataHistory from '../src/components/Data/DataHistory';

const EMPTY_NUTRITION_OBJ = {};

// Integrated wrapper component simulating real parent page for sleep UI & history
const SleepIntegratedView: React.FC = () => {
    const sleepHook = useSleepMeasurements();
    const nutrition = useAppStore(state => state.userData?.nutrition || EMPTY_NUTRITION_OBJ);
    
    // Sort history by date descending
    const measurementsHistory = React.useMemo(() => {
        return Object.values(nutrition).sort((a: any, b: any) => 
            (b.date || '').localeCompare(a.date || '')
        );
    }, [nutrition]);

    return (
        <div>
            <DataSleep sleepHook={sleepHook} />
            <DataHistory 
                measurementsHistory={measurementsHistory} 
                editingDate={sleepHook.editingDate} 
                onSelectEdit={(day) => sleepHook.setEditingDate(day.date)} 
            />
        </div>
    );
};

describe('Empirical Challenger: Sleep Format in HH:MM & State Integration Stress Suite', () => {

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

    describe('1. UI Component Re-renders & Form State Synchronization', () => {
        it('renders DataSleep and synchronizes inputs via fireEvent across all 5 fields', async () => {
            const { container } = renderWithProviders(<SleepIntegratedView />);

            const hoursInput = container.querySelector('#sleep-hours') as HTMLInputElement;
            const deepInput = container.querySelector('#sleep-deep') as HTMLInputElement;
            const lightInput = container.querySelector('#sleep-light') as HTMLInputElement;
            const remInput = container.querySelector('#sleep-rem') as HTMLInputElement;
            const awakeInput = container.querySelector('#sleep-awake') as HTMLInputElement;

            expect(hoursInput).not.toBeNull();
            expect(deepInput).not.toBeNull();
            expect(lightInput).not.toBeNull();
            expect(remInput).not.toBeNull();
            expect(awakeInput).not.toBeNull();

            // Simulate typing in all inputs
            act(() => {
                fireEvent.change(hoursInput, { target: { value: '07:45' } });
                fireEvent.change(deepInput, { target: { value: '01:30' } });
                fireEvent.change(lightInput, { target: { value: '04:15' } });
                fireEvent.change(remInput, { target: { value: '01:15' } });
                fireEvent.change(awakeInput, { target: { value: '00:45' } });
            });

            expect(hoursInput.value).toBe('07:45');
            expect(deepInput.value).toBe('01:30');
            expect(lightInput.value).toBe('04:15');
            expect(remInput.value).toBe('01:15');
            expect(awakeInput.value).toBe('00:45');
        });

        it('switches between dates dynamically and synchronizes form values without stale data', async () => {
            const today = Logic.getLocalDateString();
            const yesterday = '2026-08-19';

            const customUserData = {
                ...emptyUserData,
                nutrition: {
                    [today]: {
                        date: today,
                        kcal: 2000, carbs: 200, pro: 150, fat: 50,
                        sleepHours: '08:00',
                        sleepDeep: '02:00',
                        sleepLight: '04:30',
                        sleepRem: '01:00',
                        sleepAwake: '00:30'
                    },
                    [yesterday]: {
                        date: yesterday,
                        kcal: 1800, carbs: 180, pro: 140, fat: 45,
                        sleepHours: '06:30',
                        sleepDeep: '01:15',
                        sleepLight: '03:45',
                        sleepRem: '01:00',
                        sleepAwake: '00:30'
                    }
                }
            };

            const { container } = renderWithProviders(<SleepIntegratedView />, { userData: customUserData });

            const hoursInput = container.querySelector('#sleep-hours') as HTMLInputElement;
            const deepInput = container.querySelector('#sleep-deep') as HTMLInputElement;

            // Initially loaded with today's data
            expect(hoursInput.value).toBe('08:00');
            expect(deepInput.value).toBe('02:00');
            expect(container.textContent).toContain('🌙 Dati sonno (' + today + ')');

            // Find history card for yesterday and click it
            const historyCards = container.querySelectorAll('.card');
            // The history cards start from index 1 (card 0 is the sleep-form-card)
            const yesterdayCard = Array.from(historyCards).find(c => c.textContent?.includes('19/08/2026') || c.textContent?.includes(yesterday));
            expect(yesterdayCard).toBeDefined();

            act(() => {
                fireEvent.click(yesterdayCard!);
            });

            // Form must update to yesterday's values
            expect(hoursInput.value).toBe('06:30');
            expect(deepInput.value).toBe('01:15');
            expect(container.textContent).toContain('✏️ Modifica sonno (' + yesterday + ')');

            // Click Cancel button
            const cancelBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Annulla'));
            expect(cancelBtn).toBeDefined();

            act(() => {
                fireEvent.click(cancelBtn!);
            });

            // Form must revert to today's values
            expect(hoursInput.value).toBe('08:00');
            expect(deepInput.value).toBe('02:00');
            expect(container.textContent).toContain('🌙 Dati sonno (' + today + ')');
        });
    });

    describe('2. Hydration from Stored State (Legacy & Modern Formats)', () => {
        it('hydrates legacy decimal numbers (e.g. 7.5, 1.5) into HH:MM in form inputs', () => {
            const today = Logic.getLocalDateString();
            const customUserData = {
                ...emptyUserData,
                nutrition: {
                    [today]: {
                        date: today,
                        kcal: 2200, carbs: 250, pro: 160, fat: 60,
                        sleepHours: 7.5,
                        sleepDeep: 1.5,
                        sleepLight: 4.25,
                        sleepRem: 1.25,
                        sleepAwake: 0.5
                    }
                }
            };

            const { container } = renderWithProviders(<SleepIntegratedView />, { userData: customUserData });

            expect((container.querySelector('#sleep-hours') as HTMLInputElement).value).toBe('07:30');
            expect((container.querySelector('#sleep-deep') as HTMLInputElement).value).toBe('01:30');
            expect((container.querySelector('#sleep-light') as HTMLInputElement).value).toBe('04:15');
            expect((container.querySelector('#sleep-rem') as HTMLInputElement).value).toBe('01:15');
            expect((container.querySelector('#sleep-awake') as HTMLInputElement).value).toBe('00:30');
        });

        it('hydrates legacy decimal strings and shorthand formats into canonical HH:MM', () => {
            const today = Logic.getLocalDateString();
            const customUserData = {
                ...emptyUserData,
                nutrition: {
                    [today]: {
                        date: today,
                        kcal: 2200, carbs: 250, pro: 160, fat: 60,
                        sleepHours: '7.5',
                        sleepDeep: '7,5',
                        sleepLight: '8h',
                        sleepRem: '1.25',
                        sleepAwake: '0.5h'
                    }
                }
            };

            const { container } = renderWithProviders(<SleepIntegratedView />, { userData: customUserData });

            expect((container.querySelector('#sleep-hours') as HTMLInputElement).value).toBe('07:30');
            expect((container.querySelector('#sleep-deep') as HTMLInputElement).value).toBe('07:30');
            expect((container.querySelector('#sleep-light') as HTMLInputElement).value).toBe('08:00');
            expect((container.querySelector('#sleep-rem') as HTMLInputElement).value).toBe('01:15');
            expect((container.querySelector('#sleep-awake') as HTMLInputElement).value).toBe('00:30');
        });

        it('hydrates corrupt / out-of-range values gracefully into empty strings without crash', () => {
            const today = Logic.getLocalDateString();
            const customUserData = {
                ...emptyUserData,
                nutrition: {
                    [today]: {
                        date: today,
                        kcal: 2200, carbs: 250, pro: 160, fat: 60,
                        sleepHours: 'invalid_data',
                        sleepDeep: 999,
                        sleepLight: -5,
                        sleepRem: '25:00',
                        sleepAwake: '12:65'
                    }
                }
            };

            const { container } = renderWithProviders(<SleepIntegratedView />, { userData: customUserData });

            expect((container.querySelector('#sleep-hours') as HTMLInputElement).value).toBe('');
            expect((container.querySelector('#sleep-deep') as HTMLInputElement).value).toBe('');
            expect((container.querySelector('#sleep-light') as HTMLInputElement).value).toBe('');
            expect((container.querySelector('#sleep-rem') as HTMLInputElement).value).toBe('');
            expect((container.querySelector('#sleep-awake') as HTMLInputElement).value).toBe('');
        });
    });

    describe('3. Clearing Optional Sleep Phases', () => {
        it('clears all optional sleep phases when user deletes them, leaving them undefined in store', async () => {
            const today = Logic.getLocalDateString();
            const customUserData = {
                ...emptyUserData,
                nutrition: {
                    [today]: {
                        date: today,
                        kcal: 2400, carbs: 300, pro: 170, fat: 65,
                        sleepHours: '08:00',
                        sleepDeep: '02:00',
                        sleepLight: '04:00',
                        sleepRem: '01:30',
                        sleepAwake: '00:30'
                    }
                }
            };

            const { container } = renderWithProviders(<SleepIntegratedView />, { userData: customUserData });

            const deepInput = container.querySelector('#sleep-deep') as HTMLInputElement;
            const lightInput = container.querySelector('#sleep-light') as HTMLInputElement;
            const remInput = container.querySelector('#sleep-rem') as HTMLInputElement;
            const awakeInput = container.querySelector('#sleep-awake') as HTMLInputElement;

            // Clear all optional phase inputs
            act(() => {
                fireEvent.change(deepInput, { target: { value: '' } });
                fireEvent.change(lightInput, { target: { value: '' } });
                fireEvent.change(remInput, { target: { value: '' } });
                fireEvent.change(awakeInput, { target: { value: '' } });
            });

            const saveBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Salva sonno'));
            expect(saveBtn).toBeDefined();

            await act(async () => {
                fireEvent.click(saveBtn!);
            });

            const state = useAppStore.getState();
            const day = state.userData?.nutrition?.[today];
            expect(day?.sleepHours).toBe('08:00');
            expect(day?.sleepDeep).toBeUndefined();
            expect(day?.sleepLight).toBeUndefined();
            expect(day?.sleepRem).toBeUndefined();
            expect(day?.sleepAwake).toBeUndefined();
            // Verify existing nutrition fields were not destroyed
            expect(day?.kcal).toBe(2400);
            expect(day?.carbs).toBe(300);
        });

        it('allows partial clearing of optional phases (e.g. keeping deep and light, clearing rem and awake)', async () => {
            const today = Logic.getLocalDateString();
            const customUserData = {
                ...emptyUserData,
                nutrition: {
                    [today]: {
                        date: today,
                        kcal: 2000, carbs: 200, pro: 150, fat: 50,
                        sleepHours: '07:30',
                        sleepDeep: '01:30',
                        sleepLight: '04:30',
                        sleepRem: '01:00',
                        sleepAwake: '00:30'
                    }
                }
            };

            const { container } = renderWithProviders(<SleepIntegratedView />, { userData: customUserData });

            const remInput = container.querySelector('#sleep-rem') as HTMLInputElement;
            const awakeInput = container.querySelector('#sleep-awake') as HTMLInputElement;

            act(() => {
                fireEvent.change(remInput, { target: { value: '' } });
                fireEvent.change(awakeInput, { target: { value: '' } });
            });

            const saveBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Salva sonno'));

            await act(async () => {
                fireEvent.click(saveBtn!);
            });

            const day = useAppStore.getState().userData?.nutrition?.[today];
            expect(day?.sleepHours).toBe('07:30');
            expect(day?.sleepDeep).toBe('01:30');
            expect(day?.sleepLight).toBe('04:30');
            expect(day?.sleepRem).toBeUndefined();
            expect(day?.sleepAwake).toBeUndefined();
        });
    });

    describe('4. Saving Total Sleep Validation & Alerts', () => {
        it('blocks save and shows alert when sleepHours is empty', async () => {
            const { container } = renderWithProviders(<SleepIntegratedView />, { userData: emptyUserData });
            const showAlertSpy = vi.spyOn(useDialogStore.getState(), 'showAlert');

            const saveBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Salva sonno'));

            await act(async () => {
                fireEvent.click(saveBtn!);
            });

            expect(showAlertSpy).toHaveBeenCalledWith(
                expect.stringContaining('Le ore di sonno sono obbligatorie')
            );
            // Verify no data was saved
            expect(useAppStore.getState().userData?.nutrition?.[Logic.getLocalDateString()]?.sleepHours).toBeUndefined();
        });

        it('blocks save and shows alert when sleepHours is invalid (e.g. 25:00 or random text)', async () => {
            const { container } = renderWithProviders(<SleepIntegratedView />, { userData: emptyUserData });
            const showAlertSpy = vi.spyOn(useDialogStore.getState(), 'showAlert');

            const hoursInput = container.querySelector('#sleep-hours') as HTMLInputElement;
            act(() => {
                fireEvent.change(hoursInput, { target: { value: '25:00' } });
            });

            const saveBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Salva sonno'));

            await act(async () => {
                fireEvent.click(saveBtn!);
            });

            expect(showAlertSpy).toHaveBeenCalledWith(
                expect.stringContaining('Le ore di sonno sono obbligatorie')
            );
        });

        it('blocks save and shows specific alert when an optional phase format is invalid', async () => {
            useAppStore.setState({ userData: emptyUserData });
            const showAlertSpy = vi.spyOn(useDialogStore.getState(), 'showAlert');
            const { result } = renderHook(() => useSleepMeasurements());

            act(() => {
                result.current.setSleepHours('08:00');
                result.current.setSleepDeep('99:99');
            });

            await act(async () => {
                await result.current.saveSleep();
            });

            expect(showAlertSpy).toHaveBeenCalledWith(
                expect.stringContaining('Il formato del sonno profondo non è valido')
            );
        });

        it('successfully saves only total sleep when optional phases are left blank', async () => {
            const today = Logic.getLocalDateString();
            useAppStore.setState({ userData: emptyUserData });
            const showAlertSpy = vi.spyOn(useDialogStore.getState(), 'showAlert');
            const { result } = renderHook(() => useSleepMeasurements());

            act(() => {
                result.current.setSleepHours('07:30');
            });

            await act(async () => {
                await result.current.saveSleep();
            });

            expect(showAlertSpy).toHaveBeenCalledWith(
                expect.stringContaining('Dati sonno salvati per il ' + today + '!')
            );

            const day = useAppStore.getState().userData?.nutrition?.[today];
            expect(day?.sleepHours).toBe('07:30');
            expect(day?.sleepDeep).toBeUndefined();
            expect(day?.sleepLight).toBeUndefined();
        });
    });

    describe('5. DataHistory Display and Click-to-Edit', () => {
        it('renders sleep hours in history items and activates edit mode upon clicking', async () => {
            const date1 = '2026-08-20';
            const date2 = '2026-08-19';

            const customUserData = {
                ...emptyUserData,
                nutrition: {
                    [date1]: {
                        date: date1,
                        kcal: 2200, carbs: 250, pro: 160, fat: 60,
                        weight: 75.5,
                        sleepHours: '08:15'
                    },
                    [date2]: {
                        date: date2,
                        kcal: 2100, carbs: 240, pro: 155, fat: 58,
                        weight: 75.8,
                        sleepHours: 7.25 // legacy decimal: 7h 15m -> 07:15
                    }
                }
            };

            const { container } = renderWithProviders(<SleepIntegratedView />, { userData: customUserData });

            // Check history cards rendered
            const historyText = container.textContent;
            expect(historyText).toContain('08:15');
            expect(historyText).toContain('07:15'); // Formatted from 7.25

            // Find date2 card
            const cards = container.querySelectorAll('.card');
            const date2Card = Array.from(cards).find(c => c.textContent?.includes('19/08/2026') || c.textContent?.includes(date2));
            expect(date2Card).toBeDefined();

            act(() => {
                fireEvent.click(date2Card!);
            });

            // Form should be in edit mode for date2
            expect(container.textContent).toContain('✏️ Modifica sonno (' + date2 + ')');
            expect((container.querySelector('#sleep-hours') as HTMLInputElement).value).toBe('07:15');
        });
    });

    describe('6. Zod Gateway Resilience Under Corrupted Injection', () => {
        it('handles non-primitive or malformed sleep values in UserDataSchema without throwing', () => {
            const corruptUser = {
                profile: {},
                library: [],
                routines: [],
                history: [],
                nutrition: {
                    '2026-08-20': {
                        date: '2026-08-20',
                        kcal: 2000, carbs: 200, pro: 150, fat: 50,
                        sleepHours: { invalid: 'object' } as any,
                        sleepDeep: [1, 2, 3] as any,
                        sleepLight: true as any,
                        sleepRem: -100,
                        sleepAwake: null
                    }
                }
            };

            expect(() => {
                const parsed = UserDataSchema.parse(corruptUser);
                const day = parsed.nutrition['2026-08-20'];
                expect(day.sleepHours).toBeUndefined();
                expect(day.sleepDeep).toBeUndefined();
                expect(day.sleepLight).toBeUndefined();
                expect(day.sleepRem).toBeUndefined();
                expect(day.sleepAwake).toBeUndefined();
            }).not.toThrow();
        });
    });
});
