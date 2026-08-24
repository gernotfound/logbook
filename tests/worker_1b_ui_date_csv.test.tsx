import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Exporter } from '../src/lib/export';
import DataMeasurements from '../src/components/Data/DataMeasurements';
import DataSleep from '../src/components/Data/DataSleep';
import TrainingHistory from '../src/components/Training/TrainingHistory';
import TrainingPlanning from '../src/components/Training/planning/TrainingPlanning';
import { SessionRatings } from '../src/components/Training/session/SessionRatings';
import { useAppStore } from '../src/store/useAppStore';
import type { WorkoutSession, UserData, Exercise, WorkoutRoutine } from '../src/types';
import fs from 'fs';
import path from 'path';

describe('Worker 1B: UI/UX, Date Navigation, CSV Export & PWA Fixes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        useAppStore.setState({
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
                nutritionPlanning: {} as any,
                supplements: [],
                activePains: [],
                catalogOverrides: { exercises: {}, foods: {} }
            } as UserData,
            localWorkout: null
        });
    });

    describe('P0-2 & P2-6: Exporter.exportToCSV Quoting and Fallbacks', () => {
        it('encloses dateStr in quotes to prevent locale dates with commas from corrupting columns', async () => {
            let exportedContent = '';
            const downloadSpy = vi.spyOn(Exporter, 'downloadFile').mockImplementation((filename, content) => {
                if (filename === 'allenamenti.csv') {
                    exportedContent = content;
                }
            });

            const timestamp = new Date('2026-08-23T17:40:00.000Z').getTime();
            const session: WorkoutSession = {
                id: 's1',
                globalStartTime: timestamp,
                routineName: 'Spinta A',
                exercises: [
                    {
                        exId: 'ex_1',
                        name: 'Panca piana',
                        sets: [{ id: 'set_1', kg: '100', reps: '8' }]
                    }
                ]
            };

            await Exporter.exportToCSV([session], {}, [{ id: 'ex_1', name: 'Panca piana' }]);

            expect(downloadSpy).toHaveBeenCalledWith('allenamenti.csv', expect.any(String));
            const lines = exportedContent.split('\n');
            const dataLine = lines[1]; // First data line after header

            // The dataLine must start with quotes around the date string: "dateStr","Spinta A","Panca piana",...
            expect(dataLine).toMatch(/^"[^"]+", "Spinta A"|"[^"]+","Spinta A"/);
            expect(dataLine).toContain('"Spinta A"');
            expect(dataLine).toContain('"Panca piana"');

            downloadSpy.mockRestore();
        });

        it('falls back to session.date when globalStartTime is absent or 0', async () => {
            let exportedContent = '';
            const downloadSpy = vi.spyOn(Exporter, 'downloadFile').mockImplementation((filename, content) => {
                if (filename === 'allenamenti.csv') {
                    exportedContent = content;
                }
            });

            const session: WorkoutSession = {
                id: 's2',
                date: '2026-05-14',
                routineName: 'Gambe B',
                exercises: [
                    {
                        exId: 'ex_1',
                        name: 'Squat',
                        sets: [{ id: 'set_1', kg: '120', reps: '5' }]
                    }
                ]
            };

            await Exporter.exportToCSV([session], {}, []);

            expect(downloadSpy).toHaveBeenCalledWith('allenamenti.csv', expect.any(String));
            const lines = exportedContent.split('\n');
            const dataLine = lines[1];
            expect(dataLine).toContain('"2026-05-14"');

            downloadSpy.mockRestore();
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
                    manualBf=""
                    setManualBf={vi.fn()}
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
            const prevBtn = screen.getByText('◀ Prec.');
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
                    manualBf=""
                    setManualBf={vi.fn()}
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
            const nextBtn = screen.getByText('Succ. ▶');
            fireEvent.click(nextBtn);
            expect(setSelectedDate).toHaveBeenCalledWith('2026-08-01');
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
            };

            const { rerender } = render(
                <DataSleep
                    sleepHook={mockSleepHook}
                    selectedDate={selectedDate}
                    setSelectedDate={setSelectedDate}
                />
            );

            // Click previous day from 2026-09-01 -> 2026-08-31
            const prevBtn = screen.getByText('◀ Prec.');
            fireEvent.click(prevBtn);
            expect(setSelectedDate).toHaveBeenCalledWith('2026-08-31');

            rerender(
                <DataSleep
                    sleepHook={mockSleepHook}
                    selectedDate="2026-08-31"
                    setSelectedDate={setSelectedDate}
                />
            );

            // Click next day from 2026-08-31 -> 2026-09-01
            const nextBtn = screen.getByText('Succ. ▶');
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
                exercises: [{ exId: 'ex_1', sets: [{ id: 's1', kg: '100', reps: '10' }] }]
            };

            useAppStore.setState({
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
        it('DataMeasurements renders (opzionali) in sentence case', () => {
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
                    manualBf=""
                    setManualBf={vi.fn()}
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

            expect(screen.getByText('Misure circonferenze (opzionali)')).toBeDefined();
        });

        it('TrainingPlanning duplicates cycle with (copia) in sentence case', async () => {
            render(<TrainingPlanning />);

            const dupBtn = screen.getByTitle('Duplica ciclo');
            await act(async () => {
                fireEvent.click(dupBtn);
            });

            const cycles = useAppStore.getState().userData?.trainingCycles || [];
            expect(cycles.some(c => c.name === 'Mesociclo Massa (copia)')).toBe(true);
        });

        it('SessionRatings renders Valuta sessione (1-10) — opzionale in sentence case', () => {
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

            expect(screen.getByText('Valuta sessione (1-10) — opzionale')).toBeDefined();
        });
    });

    describe('P2-4: PWA Manifest Configuration', () => {
        it('vite.config.ts includes id in manifest configuration', () => {
            const viteConfigPath = path.resolve(__dirname, '../vite.config.ts');
            const content = fs.readFileSync(viteConfigPath, 'utf-8');
            expect(content).toMatch(/manifest:\s*\{[^}]*id:\s*basePath/s);
        });
    });
});
