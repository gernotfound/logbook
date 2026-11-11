import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import DataMeasurements from '../../../src/components/Data/DataMeasurements';
import DataSleep from '../../../src/components/Data/DataSleep';
import TrainingHistory from '../../../src/components/Training/TrainingHistory';
import TrainingPlanning from '../../../src/components/Training/planning/TrainingPlanning';
import { SessionRatings } from '../../../src/components/Training/session/SessionRatings';
import { useAppStore } from '../../../src/store/useAppStore';
import type { WorkoutSession, UserData } from '../../../src/types';
import { createDefaultNutritionPlanning } from '../../../src/lib/nutritionDefaults';

describe('Data and training UI regressions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        useAppStore.setState({
            dataOwner: 'user:test-user-id',
            userData: {
                profile: { gender: 'M' },
                library: [{ id: 'ex_1', name: 'Panca piana', setsCount: 3, sets: [] }],
                routines: [{ id: 'r_1', name: 'Push', exercises: [{ exId: 'ex_1', setsCount: 3 }] }],
                trainingCycles: [
                    {
                        id: 'cycle_1',
                        name: 'Mesociclo Massa',
                        durationWeeks: 6,
                        routines: [{ routineId: 'r_1', frequencyPerWeek: 2 }],
                        isActive: true
                    }
                ],
                activeCycleId: 'cycle_1',
                history: [],
                nutrition: {},
                customFoods: [],
                activeWorkout: null,
                nutritionPlanning: createDefaultNutritionPlanning(),
                supplements: [],
                activePains: [],
                catalogOverrides: { exercises: {}, foods: {} }
            } satisfies UserData,
            localWorkout: null
        });
    });

    describe('P1-1: Date Navigation in DataMeasurements and DataSleep', () => {
        it('DataMeasurements navigates previous and next days accurately across month boundaries', () => {
            let selectedDate = '2026-08-01';
            const setSelectedDate = vi.fn((newDate: string) => {
                selectedDate = newDate;
            });

            const { rerender } = render(
                <DataMeasurements
                    profile={{ gender: 'M' }}
                    selectedDate={selectedDate}
                    setSelectedDate={setSelectedDate}
                    measureTime=""
                    setMeasureTime={vi.fn()}
                    weight=""
                    setWeight={vi.fn()}
                    waist=""
                    setWaist={vi.fn()}
                    neck=""
                    setNeck={vi.fn()}
                    hip=""
                    setHip={vi.fn()}
                    chest=""
                    setChest={vi.fn()}
                    shoulders=""
                    setShoulders={vi.fn()}
                    biceps=""
                    setBiceps={vi.fn()}
                    thighs=""
                    setThighs={vi.fn()}
                    calves=""
                    setCalves={vi.fn()}
                    handleCancelEdit={vi.fn()}
                    calculateAndSave={vi.fn()}
                />
            );

            // Click previous day from 2026-08-01 -> 2026-07-31
            const prevBtn = screen.getByRole('button', { name: 'Giorno precedente' });
            fireEvent.click(prevBtn);
            expect(setSelectedDate).toHaveBeenCalledWith('2026-07-31');

            // Rerender with 2026-07-31
            rerender(
                <DataMeasurements
                    profile={{ gender: 'M' }}
                    selectedDate="2026-07-31"
                    setSelectedDate={setSelectedDate}
                    measureTime=""
                    setMeasureTime={vi.fn()}
                    weight=""
                    setWeight={vi.fn()}
                    waist=""
                    setWaist={vi.fn()}
                    neck=""
                    setNeck={vi.fn()}
                    hip=""
                    setHip={vi.fn()}
                    chest=""
                    setChest={vi.fn()}
                    shoulders=""
                    setShoulders={vi.fn()}
                    biceps=""
                    setBiceps={vi.fn()}
                    thighs=""
                    setThighs={vi.fn()}
                    calves=""
                    setCalves={vi.fn()}
                    handleCancelEdit={vi.fn()}
                    calculateAndSave={vi.fn()}
                />
            );

            // Click next day from 2026-07-31 -> 2026-08-01
            const nextBtn = screen.getByRole('button', { name: 'Giorno successivo' });
            fireEvent.click(nextBtn);
            expect(setSelectedDate).toHaveBeenCalledWith('2026-08-01');
        });

        it('locks the measurement date while editing an existing history record', () => {
            const setSelectedDate = vi.fn();
            const setValue = vi.fn();
            render(
                <DataMeasurements
                    profile={{ gender: 'M' }} selectedDate="2026-08-01"
                    editingDate="2026-08-01" setSelectedDate={setSelectedDate}
                    measureTime="" setMeasureTime={setValue}
                    weight="75" setWeight={setValue}
                    waist="" setWaist={setValue} neck="" setNeck={setValue}
                    hip="" setHip={setValue}
                    chest="" setChest={setValue} shoulders="" setShoulders={setValue}
                    biceps="" setBiceps={setValue} thighs="" setThighs={setValue}
                    calves="" setCalves={setValue}
                    handleCancelEdit={vi.fn()} calculateAndSave={vi.fn()}
                />
            );
            const previous = screen.getByRole('button', { name: 'Giorno precedente' });
            const next = screen.getByRole('button', { name: 'Giorno successivo' });
            const today = screen.getByRole('button', { name: /Torna a oggi/ });
            expect(previous).toHaveProperty('disabled', true);
            expect(next).toHaveProperty('disabled', true);
            expect(today).toHaveProperty('disabled', true);
            fireEvent.click(previous);
            fireEvent.click(next);
            fireEvent.click(today);
            expect(setSelectedDate).not.toHaveBeenCalled();
        });

        it('locks the sleep date while editing an existing record', () => {
            const setSelectedDate = vi.fn();
            const setField = vi.fn();
            const sleepHook = {
                editingDate: '2026-09-01', setEditingDate: vi.fn(), cancelEdit: vi.fn(() => true),
                saveSleep: vi.fn(), sleepHours: '07:30', setSleepHours: setField,
                sleepDeep: '', setSleepDeep: setField,
                sleepLight: '', setSleepLight: setField,
                sleepRem: '', setSleepRem: setField,
                sleepAwake: '', setSleepAwake: setField,
            };
            render(<DataSleep sleepHook={sleepHook} selectedDate="2026-09-01"
                setSelectedDate={setSelectedDate} todayDateStr="2026-10-01" />);
            for (const name of ['Giorno precedente', 'Giorno successivo']) {
                const button = screen.getByRole('button', { name });
                expect(button).toHaveProperty('disabled', true);
                fireEvent.click(button);
            }
            const today = screen.getByRole('button', { name: /Torna a oggi/ });
            expect(today).toHaveProperty('disabled', true);
            fireEvent.click(today);
            expect(setSelectedDate).not.toHaveBeenCalled();
        });

        it('DataSleep navigates previous and next days accurately across month boundaries', () => {
            let selectedDate = '2026-09-01';
            const setSelectedDate = vi.fn((newDate: string) => {
                selectedDate = newDate;
            });

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

            const { rerender } = render(
                <DataSleep
                    sleepHook={mockSleepHook}
                    selectedDate={selectedDate}
                    setSelectedDate={setSelectedDate}
                    todayDateStr="2026-10-01"
                />
            );

            // Click previous day from 2026-09-01 -> 2026-08-31
            const prevBtn = screen.getByRole('button', { name: 'Giorno precedente' });
            fireEvent.click(prevBtn);
            expect(setSelectedDate).toHaveBeenCalledWith('2026-08-31');

            rerender(
                <DataSleep
                    sleepHook={mockSleepHook}
                    selectedDate="2026-08-31"
                    setSelectedDate={setSelectedDate}
                    todayDateStr="2026-10-01"
                />
            );

            // Click next day from 2026-08-31 -> 2026-09-01
            const nextBtn = screen.getByRole('button', { name: 'Giorno successivo' });
            fireEvent.click(nextBtn);
            expect(setSelectedDate).toHaveBeenCalledWith('2026-09-01');
        });
    });

    describe('P2-6: TrainingHistory Date Fallback', () => {
        it('renders historical date from wo.date when globalStartTime is absent', () => {
            const historicalWorkout: WorkoutSession = {
                id: 'w_hist_1',
                date: '2025-12-25',
                routineName: 'Christmas Workout',
                exercises: [{ exId: 'ex_1', sessionNote: '', sets: [{ id: 's1', kg: '100', reps: '10' }] }]
            };

            useAppStore.setState({
                dataOwner: 'user:test-user-id',
                userData: {
                    ...useAppStore.getState().userData!,
                    history: [historicalWorkout]
                }
            });

            render(<TrainingHistory />);

            expect(screen.getByText('Christmas Workout')).toBeDefined();
            // Should contain 25 and dic/dec and 2025
            const historyText = screen.getByText(/25.*2025/i);
            expect(historyText).toBeDefined();
        });
    });

    describe('P3-1: Sentence Case Compliance', () => {
        it('DataMeasurements renders the approved optional-measurements disclosure', () => {
            render(
                <DataMeasurements
                    profile={{ gender: 'M' }}
                    measureTime=""
                    setMeasureTime={vi.fn()}
                    weight=""
                    setWeight={vi.fn()}
                    waist=""
                    setWaist={vi.fn()}
                    neck=""
                    setNeck={vi.fn()}
                    hip=""
                    setHip={vi.fn()}
                    chest=""
                    setChest={vi.fn()}
                    shoulders=""
                    setShoulders={vi.fn()}
                    biceps=""
                    setBiceps={vi.fn()}
                    thighs=""
                    setThighs={vi.fn()}
                    calves=""
                    setCalves={vi.fn()}
                    handleCancelEdit={vi.fn()}
                    calculateAndSave={vi.fn()}
                />
            );

            expect(screen.getByText('Altre misurazioni')).toBeDefined();
        });

        it('TrainingPlanning assigns a collision-safe numeric suffix when duplicating a cycle', async () => {
            render(<TrainingPlanning />);

            const optionsBtn = screen.getByTitle('Opzioni');
            await act(async () => {
                fireEvent.click(optionsBtn);
            });

            const dupBtn = screen.getByRole('menuitem', { name: /Duplica/i });
            await act(async () => {
                fireEvent.click(dupBtn);
            });

            const cycles = useAppStore.getState().userData?.trainingCycles || [];
            expect(cycles.some(c => c.name === 'Mesociclo Massa - 1')).toBe(true);
        });

        it('SessionRatings renders Valuta sessione in sentence case', () => {
            render(
                <SessionRatings
                    water=""
                    setWater={vi.fn()}
                    mood=""
                    setMood={vi.fn()}
                    pump=""
                    setPump={vi.fn()}
                    fatigue=""
                    setFatigue={vi.fn()}
                />
            );

            expect(screen.getByText('Valuta sessione')).toBeDefined();
        });
    });

});
