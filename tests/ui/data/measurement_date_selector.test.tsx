import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, renderHook, act } from '@testing-library/react';
import { emptyUserData, idbStore } from '../../setup';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { useAppStore } from '../../../src/store/useAppStore';
import { captureSession } from '../../../src/lib/sync/session';
import { initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { Logic } from '../../../src/lib/logic';
import { UserDataSchema, NutritionDaySchema } from '../../../src/lib/schema';
import DataMeasurements from '../../../src/components/Data/DataMeasurements';
import { useNutritionMeasurements } from '../../../src/hooks/useNutritionMeasurements';
import { deviceKey } from '../../../src/lib/sync/deviceStorage';

describe('Measurement date navigation', () => {
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

        describe('R3: Measurements Date Selector', () => {

            it('T1.3.1: DataMeasurements renders main measurement card with weight and circumference inputs', () => {
                const mockSave = vi.fn().mockResolvedValue(undefined);
                render(
                    <DataMeasurements 
                        profile={{ gender: 'M' }}
                        editingDate={null}
                        measureTime="08:00"
                        setMeasureTime={vi.fn()}
                        weight="75.5"
                        setWeight={vi.fn()}
                        waist="82"
                        setWaist={vi.fn()}
                        neck="38"
                        setNeck={vi.fn()}
                        hip=""
                        setHip={vi.fn()}
                        chest="102"
                        setChest={vi.fn()}
                        shoulders="118"
                        setShoulders={vi.fn()}
                        biceps="37"
                        setBiceps={vi.fn()}
                        thighs="58"
                        setThighs={vi.fn()}
                        calves="37"
                        setCalves={vi.fn()}
                        handleCancelEdit={vi.fn()}
                        calculateAndSave={mockSave}
                    />
                );

                expect(screen.getByText(/Nuova misurazione/)).toBeDefined();
                expect(screen.getByDisplayValue('75.5')).toBeDefined();
                expect(screen.getByDisplayValue('82')).toBeDefined();
            });

            it('T1.3.2: useNutritionMeasurements initializes and exposes measurement state', async () => {
                await prepareUnlockedTestArchive('user:test-user-id');
                const { result } = renderHook(() => useNutritionMeasurements());
                expect(result.current.profile).toBeDefined();
                expect(result.current.measureTime).toBeDefined();
                expect(typeof result.current.setWeight).toBe('function');
                expect(typeof result.current.calculateAndSave).toBe('function');
            });

            it('T1.3.3: nutrition-day.patch persists the selected-date measurement and preserves meals', async () => {
                await prepareUnlockedTestArchive('user:test-user-id');
                const targetDate = '2026-08-10';
                const owner = captureSession().owner;
                const initial = UserDataSchema.parse({
                    ...emptyUserData,
                    nutrition: {
                        [targetDate]: {
                            date: targetDate, kcal: 2200, carbs: 250, pro: 150, fat: 60,
                            meals: [{ id: 'meal-1', name: 'Pranzo', meal: 'Pranzo', quantity: 1, kcal: 800, carbs: 90, pro: 40, fat: 25 }]
                        }
                    }
                });
                await initializeLocal(owner, initial);
                const initialCiphertext = idbStore['logbook:v2:' + owner];
                expect(initialCiphertext).toMatch(/^tlb-sealed:v1:/);
                useAppStore.setState({ userData: initial, dataOwner: owner, localPersistenceBlocked: false });
                const { result } = renderHook(() => useNutritionMeasurements(targetDate));
                act(() => result.current.setWeight('75'));
                await act(async () => {
                    expect(await result.current.calculateAndSave()).toBe(true);
                });
                expect(useAppStore.getState().userData?.nutrition?.[targetDate]?.weight).toBe(75);
                const updatedCiphertext = idbStore['logbook:v2:' + owner];
                expect(updatedCiphertext).toMatch(/^tlb-sealed:v1:/);
                expect(updatedCiphertext).not.toBe(initialCiphertext);
                const persisted = await readLocal(owner);
                expect(persisted?.data.nutrition?.[targetDate]?.weight).toBe(75);
                expect(persisted?.data.nutrition?.[targetDate]?.meals?.[0]?.id).toBe('meal-1');
            });


            it('T1.3.4: switching to edit mode changes title to Modifica misurazione', () => {
                render(
                    <DataMeasurements 
                        profile={{ gender: 'M' }}
                        editingDate="2026-08-15"
                        measureTime="07:30"
                        setMeasureTime={vi.fn()}
                        weight="74.8"
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

                expect(screen.getByText(/Modifica misurazione/i)).toBeDefined();
                expect(screen.getByText('Annulla')).toBeDefined();
                expect(screen.getByRole('button', { name: /Salva modifiche/i })).toBeDefined();
            });

            it('T1.3.5: female profile conditionally displays hip measurement input', () => {
                const { rerender } = render(
                    <DataMeasurements 
                        profile={{ gender: 'M' }}
                        editingDate={null}
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
                expect(screen.queryByText('Fianchi')).toBeNull();

                rerender(
                    <DataMeasurements 
                        profile={{ gender: 'F' }}
                        editingDate={null}
                        measureTime="08:00"
                        setMeasureTime={vi.fn()}
                        weight=""
                        setWeight={vi.fn()}
                        waist=""
                        setWaist={vi.fn()}
                        neck=""
                        setNeck={vi.fn()}
                        hip="95"
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
                expect(screen.getByText('Fianchi')).toBeDefined();
            });

            it('T1.3.6: NutritionDaySchema validates weight, BF and circumference numbers', () => {
                const data = {
                    date: '2026-08-18',
                    kcal: 2300,
                    carbs: 280,
                    pro: 160,
                    fat: 65,
                    weight: 76.2,
                    bf: 13.8,
                    waist: 81.5,
                    neck: 38.0
                };
                const parsed = NutritionDaySchema.parse(data);
                expect(parsed.weight).toBe(76.2);
                expect(parsed.bf).toBe(13.8);
                expect(parsed.waist).toBe(81.5);
            });

            it('T1.3.7: formatItalianDate displays canonical Italian sentence date', () => {
                const dateStr = '2026-08-20';
                const formatted = Logic.formatItalianDate(dateStr);
                expect(formatted).toBe('20/08/2026');
            });
        });
    });

    describe('Boundaries and corner cases', () => {
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

        describe('R3: Boundary & Corner Cases', () => {
            it('T2.3.1: month boundary navigation: subtracting 1 day from 2026-08-01 gives 2026-07-31', () => {
                const d = new Date('2026-08-01T12:00:00');
                d.setDate(d.getDate() - 1);
                const prev = Logic.getLocalDateString(d);
                expect(prev).toBe('2026-07-31');
            });

            it('T2.3.2: year boundary navigation: subtracting 1 day from 2026-01-01 gives 2025-12-31', () => {
                const d = new Date('2026-01-01T12:00:00');
                d.setDate(d.getDate() - 1);
                const prev = Logic.getLocalDateString(d);
                expect(prev).toBe('2025-12-31');
            });

            it('T2.3.3: leap year boundary: adding 1 day to 2024-02-28 gives 2024-02-29', () => {
                const d = new Date('2024-02-28T12:00:00');
                d.setDate(d.getDate() + 1);
                const next = Logic.getLocalDateString(d);
                expect(next).toBe('2024-02-29');
            });

            it('T2.3.4: rejected measurement save leaves the previous meals and durable day unchanged', async () => {
                const date = '2026-08-10';
                const owner = captureSession().owner;
                localStorage.setItem(deviceKey('health-consent-generation', owner), '1');
                const initial = UserDataSchema.parse({
                    ...emptyUserData,
                    nutrition: {
                        [date]: {
                            date, kcal: 2500, carbs: 300, pro: 170, fat: 70, weight: 75,
                            meals: [{ id: 'm1', name: 'Pranzo', meal: 'Pranzo', quantity: 1, kcal: 800, carbs: 100, pro: 50, fat: 20 }]
                        }
                    }
                });
                await prepareUnlockedTestArchive(owner);
                await initializeLocal(owner, initial);
                const sealedBefore = idbStore['logbook:v2:' + owner];
                expect(sealedBefore).toMatch(/^tlb-sealed:v1:/);
                const originalDispatch = useAppStore.getState().dispatchDomainOperation;
                useAppStore.setState({
                    userData: initial, dataOwner: owner, localPersistenceBlocked: false,
                    dispatchDomainOperation: vi.fn(async () => ({
                        ok: false as const, status: 'rejected' as const, error: new Error('Local commit rejected')
                    }))
                });
                try {
                    const { result } = renderHook(() => useNutritionMeasurements(date));
                    act(() => result.current.setWeight('76'));
                    await act(async () => { expect(await result.current.calculateAndSave()).toBe(false); });
                    expect(useAppStore.getState().dispatchDomainOperation).toHaveBeenCalledWith(
                        expect.objectContaining({ type: 'nutrition-day.patch', date, patch: expect.objectContaining({ weight: 76 }) })
                    );
                    expect(useAppStore.getState().userData?.nutrition?.[date]?.weight).toBe(75);
                    expect((await readLocal(owner))?.data.nutrition?.[date]?.meals?.[0]?.id).toBe('m1');
                    expect((await readLocal(owner))?.data.nutrition?.[date]?.weight).toBe(75);
                    expect(idbStore['logbook:v2:' + owner]).toBe(sealedBefore);
                } finally {
                    useAppStore.setState({ dispatchDomainOperation: originalDispatch });
                }
            });


            it('T2.3.5: saving weight without optional circumferences persists a sealed nutrition day', async () => {
                const date = '2026-08-15';
                const owner = captureSession().owner;
                localStorage.setItem(deviceKey('health-consent-generation', owner), '1');
                const initial = UserDataSchema.parse({
                    ...emptyUserData,
                    nutrition: {
                        [date]: {
                            date, kcal: 2200, carbs: 240, pro: 150, fat: 65,
                            meals: [{ id: 'm1', name: 'Pranzo', meal: 'Pranzo', quantity: 1, kcal: 800, carbs: 90, pro: 40, fat: 20 }]
                        }
                    }
                });
                await prepareUnlockedTestArchive(owner);
                await initializeLocal(owner, initial);
                const sealedBefore = idbStore['logbook:v2:' + owner];
                expect(sealedBefore).toMatch(/^tlb-sealed:v1:/);
                useAppStore.setState({ userData: initial, dataOwner: owner, localPersistenceBlocked: false });

                const { result } = renderHook(() => useNutritionMeasurements(date));
                act(() => result.current.setWeight('75'));
                await act(async () => {
                    expect(await result.current.calculateAndSave()).toBe(true);
                });

                const memory = useAppStore.getState().userData?.nutrition?.[date];
                const durable = (await readLocal(owner))?.data.nutrition?.[date];
                for (const saved of [memory, durable]) {
                    expect(saved?.weight).toBe(75);
                    expect(saved?.kcal).toBe(2200);
                    expect(saved?.meals?.[0]?.id).toBe('m1');
                    for (const field of ['waist', 'neck', 'hip', 'chest', 'shoulders', 'biceps', 'thighs', 'calves'] as const) {
                        expect(saved?.[field]).toBeUndefined();
                    }
                }
                expect(idbStore['logbook:v2:' + owner]).toMatch(/^tlb-sealed:v1:/);
                expect(idbStore['logbook:v2:' + owner]).not.toBe(sealedBefore);
            });

            it('T2.3.6: parseDateInput handles YYYY-MM-DD, DD/MM/YYYY, and single digit dates', () => {
                expect(Logic.parseDateInput('2026-08-20')).toBe('2026-08-20');
                expect(Logic.parseDateInput('20/08/2026')).toBe('2026-08-20');
                expect(Logic.parseDateInput('1/9/2026')).toBe('2026-09-01');
            });

            it('T2.3.7: getCalendarMonthGrid creates calendar matrix with valid week structure', () => {
                const grid = Logic.getCalendarMonthGrid(2026, 7); // August 2026 (zero-based month)
                expect(Array.isArray(grid)).toBe(true);
                expect(grid.length).toBe(42);
                expect(grid.filter(day => day.isCurrentMonth)).toHaveLength(31);
                expect(grid[0].dateStr).toBe('2026-07-27');
                expect(grid[grid.length - 1].dateStr).toBe('2026-09-06');
            });
        });
    });
});
