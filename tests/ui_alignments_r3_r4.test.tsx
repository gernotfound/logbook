import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import React from 'react';
import DataMeasurements from '../src/components/Data/DataMeasurements';
import DataView from '../src/components/Data/DataView';
import SessionSetRow from '../src/components/Training/session/SessionSetRow';
import { useNutritionMeasurements } from '../src/hooks/useNutritionMeasurements';
import { useAppStore } from '../src/store/useAppStore';
import { Logic } from '../src/lib/logic';

describe('UI Alignments - R3 & R4', () => {
    beforeEach(() => {
        localStorage.clear();
        useAppStore.setState({
            userData: {
                profile: { height: 180, gender: 'M' },
                nutrition: {
                    '2026-08-10': {
                        date: '2026-08-10',
                        weight: 80.5,
                        waist: 85,
                        neck: 38,
                        chest: 105,
                        shoulders: 120,
                        biceps: 38,
                        thighs: 58,
                        calves: 37,
                        kcal: 2200,
                        carbs: 250,
                        pro: 160,
                        fat: 60,
                        meals: []
                    }
                },
                history: [],
                library: [],
                routines: [],
                customFoods: [],
                trainingCycles: [],
                activeCycleId: null,
                activeWorkout: null,
                supplements: []
            } as any
        });
    });

    describe('R3: DataMeasurements Date Navigator', () => {
        it('renders Date Navigator with Prec, Succ, and Italian date when setSelectedDate is provided', () => {
            const mockSetSelectedDate = vi.fn();
            const todayStr = Logic.getLocalDateString();

            render(
                <DataMeasurements
                    profile={{ gender: 'M' }}
                    selectedDate={todayStr}
                    setSelectedDate={mockSetSelectedDate}
                    targetDateStr={todayStr}
                    measureTime="08:00"
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
                    calculateAndSave={vi.fn().mockResolvedValue(undefined)}
                />
            );

            expect(screen.getByText('◀ Prec.')).toBeDefined();
            expect(screen.getByText('Succ. ▶')).toBeDefined();
            expect(screen.getByText('Oggi')).toBeDefined();

            // Next button is disabled when date is today
            const nextBtn = screen.getByText('Succ. ▶') as HTMLButtonElement;
            expect(nextBtn.disabled).toBe(true);

            // Click previous button
            const prevBtn = screen.getByText('◀ Prec.');
            fireEvent.click(prevBtn);
            expect(mockSetSelectedDate).toHaveBeenCalled();
        });

        it('allows navigating forward when viewing a past date and shows "Modifica misurazione" when existing data is present', () => {
            const mockSetSelectedDate = vi.fn();
            const pastDate = '2026-08-10';

            render(
                <DataMeasurements
                    profile={{ gender: 'M' }}
                    selectedDate={pastDate}
                    setSelectedDate={mockSetSelectedDate}
                    targetDateStr={pastDate}
                    hasExistingData={true}
                    measureTime="08:00"
                    setMeasureTime={vi.fn()}
                    weight="80.5"
                    setWeight={vi.fn()}
                    waist="85"
                    setWaist={vi.fn()}
                    neck="38"
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
                    calculateAndSave={vi.fn().mockResolvedValue(undefined)}
                />
            );

            expect(screen.getByText(/Modifica misurazione/i)).toBeDefined();
            expect(screen.getByText(/Salva modifiche/i)).toBeDefined();

            const nextBtn = screen.getByText('Succ. ▶') as HTMLButtonElement;
            expect(nextBtn.disabled).toBe(false);

            fireEvent.click(nextBtn);
            expect(mockSetSelectedDate).toHaveBeenCalled();

            // Click today center text
            const centerDateBlock = screen.getByTitle('Torna a oggi');
            fireEvent.click(centerDateBlock);
            expect(mockSetSelectedDate).toHaveBeenCalledWith(Logic.getLocalDateString());
        });

        it('DataView integrates selectedDate and renders DataMeasurements properly', () => {
            render(<DataView subTab="measurements" />);
            expect(screen.getByText('Misurazioni')).toBeDefined();
            expect(screen.getByText('◀ Prec.')).toBeDefined();
            expect(screen.getByText('Succ. ▶')).toBeDefined();
        });

        it('useNutritionMeasurements hook loads past day values when selectedDate is provided', () => {
            const { result } = renderHook(() => useNutritionMeasurements('2026-08-10'));

            expect(result.current.targetDateStr).toBe('2026-08-10');
            expect(result.current.weight).toBe('80.5');
            expect(result.current.waist).toBe('85');
            expect(result.current.neck).toBe('38');
            expect(result.current.chest).toBe('105');
            expect(result.current.hasExistingData).toBe(true);
        });

        it('useNutritionMeasurements saves to selectedDate in userData.nutrition', async () => {
            const { result } = renderHook(() => useNutritionMeasurements('2026-08-05'));

            act(() => {
                result.current.setWeight('75.2');
                result.current.setWaist('80');
                result.current.setNeck('37');
            });

            await act(async () => {
                await result.current.calculateAndSave();
            });

            const updatedNutrition = useAppStore.getState().userData?.nutrition;
            expect(updatedNutrition?.['2026-08-05']).toBeDefined();
            expect(updatedNutrition?.['2026-08-05'].weight).toBe(75.2);
            expect(updatedNutrition?.['2026-08-05'].waist).toBe(80);
            expect(updatedNutrition?.['2026-08-05'].neck).toBe(37);
        });
    });

    describe('R4: SessionSetRow Vertical Centering', () => {
        it('keeps labeled set fields and special sets visible with an accessible options menu', () => {
            const mockSet = {
                id: 'set_1',
                kg: 50,
                reps: 10,
                dropsets: [
                    { id: 'ds_1', kg: 40, reps: 8 }
                ],
                isometrics: [
                    { id: 'iso_1', kg: 30, time: 20 }
                ]
            };

            render(
                <SessionSetRow
                    set={mockSet}
                    sIndex={0}
                    exIndex={0}
                    isOpenMenu={false}
                    onToggleMenu={vi.fn()}
                    onRemoveSet={vi.fn()}
                    onUpdateSet={vi.fn()}
                    onAddSpecialSet={vi.fn()}
                    onUpdateSpecialSet={vi.fn()}
                    onRemoveSpecialSet={vi.fn()}
                />
            );

            expect((screen.getByRole('spinbutton', { name: 'Serie 1, chilogrammi', exact: true }) as HTMLInputElement).value).toBe('50');
            expect((screen.getByRole('spinbutton', { name: 'Serie 1, ripetizioni', exact: true }) as HTMLInputElement).value).toBe('10');
            expect(screen.getByText('Dropset 1')).toBeDefined();
            expect(screen.getByText('Isometria 1')).toBeDefined();
            const options = screen.getByRole('button', { name: 'Opzioni serie 1' });
            fireEvent.click(options);
            expect(options.getAttribute('aria-expanded')).toBe('true');
            expect(screen.getByRole('menuitem', { name: '+ Dropset' })).toBeDefined();
            expect(screen.getByRole('menuitem', { name: '+ Isometria' })).toBeDefined();

        });
    });
});

