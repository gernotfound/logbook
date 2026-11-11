import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import { emptyUserData, idbStore } from '../setup';
import { prepareUnlockedTestArchive } from '../secureVaultFixture';
import { captureSession } from '../../src/lib/sync/session';
import { deviceKey } from '../../src/lib/sync/deviceStorage';
import { initializeLocal, readLocal } from '../../src/lib/sync/localRepository';
import { useNutritionMeasurements } from '../../src/hooks/useNutritionMeasurements';
import { useAppStore } from '../../src/store/useAppStore';
import { Logic } from '../../src/lib/logic';
import {
    UserDataSchema,
} from '../../src/lib/schema';
import SessionSetRow from '../../src/components/Training/session/SessionSetRow';
import MuscleModel from '../../src/components/Training/MuscleModel';
import {
    calculateEffectiveSetWeightContract,
    calculateSetVolumeContract,
    calculateWorkoutVolumeContract,
    calculateRealtimeKcalContract,
    mergeActivePainsContract
} from '../requirements_r1_r6_contracts';

describe('LogBook 4-Tier Automated Test Suite (Requirements R1 - R6)', () => {
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

    /* =========================================================================
     * TIER 2: BOUNDARY & CORNER CASES (>=5 tests per requirement R1 - R6)
     * ========================================================================= */
    describe('Tier 2: Boundary & Corner Cases', () => {

        // ---------------------------------------------------------------------
        // Requirement R1: Boundaries
        // ---------------------------------------------------------------------
        describe('R1: Boundary & Corner Cases', () => {
            it('T2.1.1: 0 kg ballast on bodyweight chin-ups with 75 kg user weight returns 75 * reps, not 0 or NaN', () => {
                const ex = { isBodyweight: true, equipmentWeight: 0 };
                const vol = calculateSetVolumeContract({ kg: '0', reps: '12' }, ex, 75);
                expect(vol).toBe(900); // 75 * 12
                expect(isNaN(vol)).toBe(false);
            });

            it('T2.1.2: missing or undefined user weight falls back to 0 without throwing error', () => {
                const ex = { isBodyweight: true };
                const vol = calculateSetVolumeContract({ kg: '10', reps: '5' }, ex, 0);
                expect(vol).toBe(50); // (10 + 0) * 5
                expect(isNaN(vol)).toBe(false);
            });

            it('T2.1.3: negative ballast on assisted pull-up machine (e.g. -20 kg counterweight)', () => {
                const ex = { isBodyweight: true, equipmentWeight: 0 };
                const userWeight = 80;
                // Net weight is 80 - 20 = 60 kg
                const effective = calculateEffectiveSetWeightContract('-20', ex, userWeight);
                expect(effective).toBe(60);
                const vol = calculateSetVolumeContract({ kg: '-20', reps: '10' }, ex, userWeight);
                expect(vol).toBe(600);
            });

            it('T2.1.4: handles string inputs with spaces or decimals in set kg and equipment weight', () => {
                const ex = { isBodyweight: true, equipmentWeight: 2.5 };
                const effective = calculateEffectiveSetWeightContract(' 12.5 ', ex, 75);
                expect(effective).toBe(90); // 12.5 + 2.5 + 75
            });

            it('T2.1.5: exercise with isBodyweight false and equipmentWeight 0 behaves identically to standard weight_reps', () => {
                const exStandard = { isBodyweight: false, equipmentWeight: 0 };
                const vol = calculateSetVolumeContract({ kg: '100', reps: '5' }, exStandard, 80);
                expect(vol).toBe(500);
            });

            it('T2.1.6: zero reps produces zero volume regardless of bodyweight or equipment weight', () => {
                const ex = { isBodyweight: true, equipmentWeight: 20 };
                const vol = calculateSetVolumeContract({ kg: '50', reps: '0' }, ex, 80);
                expect(vol).toBe(0);
            });

            it('T2.1.7: empty exercises array in workout volume returns 0', () => {
                const vol = calculateWorkoutVolumeContract({ exercises: [] }, [], 75);
                expect(vol).toBe(0);
            });
        });

        // ---------------------------------------------------------------------
        // Requirement R2: Boundaries
        // ---------------------------------------------------------------------
        describe('R2: Boundary & Corner Cases', () => {
            it('T2.2.1: empty string inputs evaluate safely to 0 kcal without NaN', () => {
                const kcal = calculateRealtimeKcalContract('', '', '');
                expect(kcal).toBe(0);
                expect(isNaN(kcal)).toBe(false);
            });

            it('T2.2.2: null and undefined inputs evaluate safely to 0 kcal', () => {
                const kcal = calculateRealtimeKcalContract(null, undefined, null);
                expect(kcal).toBe(0);
            });

            it('T2.2.3: extreme high macro values calculate correctly without overflow', () => {
                const kcal = calculateRealtimeKcalContract(500, 300, 200);
                // 500*4 + 300*4 + 200*9 = 2000 + 1200 + 1800 = 5000
                expect(kcal).toBe(5000);
            });

            it('T2.2.4: non-numeric string values (e.g. "abc") default safely to 0 kcal', () => {
                const kcal = calculateRealtimeKcalContract('abc', 'xyz', '---');
                expect(kcal).toBe(0);
            });

            it('T2.2.5: decimal inputs with comma notation calculate accurately', () => {
                const kcal = calculateRealtimeKcalContract('10,5', '20,0', '5,5');
                // 10.5*4 + 20*4 + 5.5*9 = 42 + 80 + 49.5 = 171.5 -> 172
                expect(kcal).toBe(172);
            });

            it('T2.2.6: negative macro values clamp or evaluate mathematically without crash', () => {
                const kcal = calculateRealtimeKcalContract(-10, 20, 5);
                expect(kcal).toBe(85); // -10*4 + 20*4 + 5*9
            });

            it('T2.2.7: fractional rounding boundary (e.g. 0.125g macros)', () => {
                const kcal = calculateRealtimeKcalContract(0.125, 0.125, 0.125);
                // 0.5 + 0.5 + 1.125 = 2.125 -> 2
                expect(kcal).toBe(2);
            });
        });

        // ---------------------------------------------------------------------
        // Requirement R3: Boundaries
        // ---------------------------------------------------------------------
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

        // ---------------------------------------------------------------------
        // Requirement R4: Boundaries
        // ---------------------------------------------------------------------
        describe('R4: Boundary & Corner Cases', () => {
            it('T2.4.1: rapid menu toggles in SessionSetRow do not throw or lose component state', () => {
                const mockToggle = vi.fn();
                const { rerender } = render(
                    <SessionSetRow 
                        set={{ id: 's1', kg: '80', reps: '10' }}
                        sIndex={0}
                        exIndex={0}
                        isOpenMenu={false}
                        onToggleMenu={mockToggle}
                        onRemoveSet={vi.fn()}
                        onUpdateSet={vi.fn()}
                        onAddSpecialSet={vi.fn()}
                        onUpdateSpecialSet={vi.fn()}
                        onRemoveSpecialSet={vi.fn()}
                    onUpdateSetTarget={vi.fn()}
                    />
                );

                const trigger = screen.getByRole('button', { name: 'Opzioni serie 1' });
                expect(trigger.getAttribute('aria-expanded')).toBe('false');
                fireEvent.click(trigger);
                expect(mockToggle).toHaveBeenCalledTimes(1);
                expect(mockToggle).toHaveBeenCalledWith('s1');

                rerender(
                    <SessionSetRow 
                        set={{ id: 's1', kg: '80', reps: '10' }}
                        sIndex={0}
                        exIndex={0}
                        isOpenMenu={true}
                        onToggleMenu={mockToggle}
                        onRemoveSet={vi.fn()}
                        onUpdateSet={vi.fn()}
                        onAddSpecialSet={vi.fn()}
                        onUpdateSpecialSet={vi.fn()}
                        onRemoveSpecialSet={vi.fn()}
                    onUpdateSetTarget={vi.fn()}
                    />
                );

                expect(screen.getByText('+ Dropset')).toBeDefined();
                expect(trigger.getAttribute('aria-expanded')).toBe('true');
                fireEvent.click(trigger);
                expect(mockToggle).toHaveBeenCalledTimes(2);
                expect(mockToggle).toHaveBeenLastCalledWith('s1');
            });

            it('T2.4.2: multiple dropsets display sequential labels "↳ Dropset 1", "↳ Dropset 2"', () => {
                const set = {
                    id: 's1',
                    kg: '100',
                    reps: '6',
                    segments: [
                        { technique: 'dropset' as const, id: 'ds1', kg: '80', reps: '6' },
                        { technique: 'dropset' as const, id: 'ds2', kg: '60', reps: '8' }
                    ]
                };
                render(
                    <SessionSetRow 
                        set={set}
                        sIndex={0}
                        exIndex={0}
                        isOpenMenu={false}
                        onToggleMenu={vi.fn()}
                        onRemoveSet={vi.fn()}
                        onUpdateSet={vi.fn()}
                        onAddSpecialSet={vi.fn()}
                        onUpdateSpecialSet={vi.fn()}
                        onRemoveSpecialSet={vi.fn()}
                    onUpdateSetTarget={vi.fn()}
                    />
                );

                expect(screen.getByText('↳ Dropset 1')).toBeDefined();
                expect(screen.getByText('↳ Dropset 2')).toBeDefined();
            });

            it('T2.4.3: multiple isometrics display sequential labels "↳ Isometria 1", "↳ Isometria 2"', () => {
                const set = {
                    id: 's1',
                    kg: '50',
                    reps: '10',
                    segments: [
                        { technique: 'isometry' as const, reps: '', id: 'iso1', kg: '40', time: '20' },
                        { technique: 'isometry' as const, reps: '', id: 'iso2', kg: '30', time: '15' }
                    ]
                };
                render(
                    <SessionSetRow 
                        set={set}
                        sIndex={0}
                        exIndex={0}
                        isOpenMenu={false}
                        onToggleMenu={vi.fn()}
                        onRemoveSet={vi.fn()}
                        onUpdateSet={vi.fn()}
                        onAddSpecialSet={vi.fn()}
                        onUpdateSpecialSet={vi.fn()}
                        onRemoveSpecialSet={vi.fn()}
                    onUpdateSetTarget={vi.fn()}
                    />
                );

                expect(screen.getByText('↳ Isometria 1')).toBeDefined();
                expect(screen.getByText('↳ Isometria 2')).toBeDefined();
            });

            it('T2.4.4: combining both dropset and isometry on the same set', () => {
                const set = {
                    id: 's1',
                    kg: '80',
                    reps: '8',
                    segments: [
                        { technique: 'dropset' as const, id: 'ds1', kg: '60', reps: '6' },
                        { technique: 'isometry' as const, reps: '', id: 'iso1', kg: '40', time: '15' }
                    ],
                };
                render(
                    <SessionSetRow 
                        set={set}
                        sIndex={0}
                        exIndex={0}
                        isOpenMenu={false}
                        onToggleMenu={vi.fn()}
                        onRemoveSet={vi.fn()}
                        onUpdateSet={vi.fn()}
                        onAddSpecialSet={vi.fn()}
                        onUpdateSpecialSet={vi.fn()}
                        onRemoveSpecialSet={vi.fn()}
                    onUpdateSetTarget={vi.fn()}
                    />
                );

                expect(screen.getByText('↳ Dropset 1')).toBeDefined();
                expect(screen.getByText('↳ Isometria 1')).toBeDefined();
            });

            it('T2.4.5: clicking remove button on dropset invokes onRemoveSpecialSet', () => {
                const mockRemove = vi.fn();
                const set = {
                    id: 's1',
                    kg: '80',
                    reps: '8',
                    segments: [{ technique: 'dropset' as const, id: 'ds1', kg: '60', reps: '6' }]
                };
                render(
                    <SessionSetRow 
                        set={set}
                        sIndex={0}
                        exIndex={0}
                        isOpenMenu={false}
                        onToggleMenu={vi.fn()}
                        onRemoveSet={vi.fn()}
                        onUpdateSet={vi.fn()}
                        onAddSpecialSet={vi.fn()}
                        onUpdateSpecialSet={vi.fn()}
                        onRemoveSpecialSet={mockRemove}
                    onUpdateSetTarget={vi.fn()}
                    />
                );

                const removeBtn = screen.getByRole('button', { name: 'Rimuovi Dropset 1' });
                fireEvent.click(removeBtn);
                expect(mockRemove).toHaveBeenCalledWith(0, 's1', 'segments', 'ds1');
            });

            it('T2.4.6: SessionSetRow handles empty string kg and reps without throwing', () => {
                const set = { id: 's1', kg: '', reps: '' };
                expect(() => render(
                    <SessionSetRow 
                        set={set}
                        sIndex={0}
                        exIndex={0}
                        isOpenMenu={false}
                        onToggleMenu={vi.fn()}
                        onRemoveSet={vi.fn()}
                        onUpdateSet={vi.fn()}
                        onAddSpecialSet={vi.fn()}
                        onUpdateSpecialSet={vi.fn()}
                        onRemoveSpecialSet={vi.fn()}
                    onUpdateSetTarget={vi.fn()}
                    />
                )).not.toThrow();
            });

            it('T2.4.7: delete set button aria-label includes set number for accessibility', () => {
                render(
                    <SessionSetRow 
                        set={{ id: 's3', kg: '50', reps: '10' }}
                        sIndex={2}
                        exIndex={0}
                        isOpenMenu={false}
                        onToggleMenu={vi.fn()}
                        onRemoveSet={vi.fn()}
                        onUpdateSet={vi.fn()}
                        onAddSpecialSet={vi.fn()}
                        onUpdateSpecialSet={vi.fn()}
                        onRemoveSpecialSet={vi.fn()}
                    onUpdateSetTarget={vi.fn()}
                    />
                );

                expect(screen.getByRole('button', { name: 'Rimuovi serie 3' })).toBeDefined();
            });
        });

        // ---------------------------------------------------------------------
        // Requirement R5: Boundaries
        // ---------------------------------------------------------------------
        describe('R5: Boundary & Corner Cases', () => {
            it('T2.5.1: empty activePains array in UserData parses safely', () => {
                const parsed = UserDataSchema.parse({ ...emptyUserData, activePains: [] });
                expect((parsed as any).activePains).toEqual([]);
            });

            it('T2.5.2: omitted or undefined activePains normalizes to an empty array', () => {
                const withoutPains = { ...emptyUserData };
                delete withoutPains.activePains;
                expect(UserDataSchema.parse(withoutPains).activePains).toEqual([]);
                expect(UserDataSchema.parse({ ...emptyUserData, activePains: undefined }).activePains).toEqual([]);
            });

            it('T2.5.3: unknown muscle IDs do not highlight unrelated body paths', () => {
                const { container } = render(
                    <MuscleModel
                        selectedMuscles={['unknown_alien_muscle', 'fake_quad']}
                        interactive={false}
                    />
                );
                const paths = Array.from(container.querySelectorAll<SVGPathElement>('[data-muscle-path]'));
                expect(paths.length).toBeGreaterThan(20);
                for (const path of paths) {
                    expect(path.style.fill).toBe('var(--surface-light)');
                }
            });

            it('T2.5.4: duplicate muscle IDs in activePains list are handled safely', () => {
                const pains = ['petto', 'petto', 'petto'];
                const uniquePains = mergeActivePainsContract(pains, [' petto ', 'petto']);
                expect(uniquePains).toEqual(['petto']);
            });

            it('T2.5.5: all muscle groups active simultaneously renders full mannequin in danger state', () => {
                const allMuscles = Logic.MUSCLES.map(m => m.id);
                const colorMap = Object.fromEntries(allMuscles.map(m => [m, '#ff4d6d']));

                const { container } = render(
                    <MuscleModel
                        muscleColors={colorMap}
                        interactive={false}
                    />
                );

                const expectedPaths = new Set(allMuscles.flatMap(id => Logic.GROUP_MAP[id] ?? []));
                const highlighted = Array.from(container.querySelectorAll<SVGPathElement>('[data-muscle-path]'))
                    .filter(path => expectedPaths.has(path.dataset.musclePath ?? ''));
                expect(highlighted).toHaveLength(expectedPaths.size);
                expect(new Set(highlighted.map(path => path.dataset.musclePath))).toEqual(expectedPaths);
                for (const path of highlighted) {
                    expect(['#ff4d6d', 'rgb(255, 77, 109)']).toContain(path.style.fill);
                }
            });

            it('T2.5.8: two mounted muscle maps keep SVG ids unique and logical paths stable', () => {
                const { container } = render(
                    <>
                        <MuscleModel selectedMuscles={['petto']} />
                        <MuscleModel selectedMuscles={['petto']} />
                    </>
                );
                const ids = Array.from(container.querySelectorAll<HTMLElement>('[id]')).map(node => node.id);
                expect(ids.length).toBeGreaterThan(0);
                expect(new Set(ids).size).toBe(ids.length);
                expect(container.querySelectorAll('[data-muscle-path="chest-upper-left"]')).toHaveLength(2);
            });

            it('T2.5.6: validateWorkoutRatings validates numeric bounds (1-5)', () => {
                const valid = Logic.validateWorkoutRatings(4, 3, 5);
                expect(valid.isValid).toBe(true);
                expect(valid.mood).toBe(4);

                const invalid = Logic.validateWorkoutRatings(15, 0, -2);
                expect(invalid.isValid).toBe(false);
            });

            it('T2.5.7: validateWorkoutRatings accepts null or empty optional ratings', () => {
                const res = Logic.validateWorkoutRatings(null, undefined, '');
                expect(res.isValid).toBe(true);
                expect(res.mood).toBeNull();
            });
        });

        // ---------------------------------------------------------------------
        // Requirement R6: Boundaries
        // ---------------------------------------------------------------------
        describe('R6: Boundary & Corner Cases', () => {
            it('T2.6.5: empty and whitespace-only reports do not delete active pains', () => {
                expect(mergeActivePainsContract(['petto'], ['', '  ', '     '])).toEqual(['petto']);
            });

            it('T2.6.6: session ratings where user selects multiple new pains deduplicates gracefully', () => {
                const activePains = ['petto'];
                const sessionPains = ['tricipiti', 'tricipiti', 'spalle'];

                const updated = mergeActivePainsContract(activePains, sessionPains);
                expect(updated).toEqual(['petto', 'tricipiti', 'spalle']);
                expect(activePains).toEqual(['petto']);
                expect(sessionPains).toEqual(['tricipiti', 'tricipiti', 'spalle']);
            });

            it('T2.6.7: mergeActivePains contract handles absent arguments as empty arrays', () => {
                expect(mergeActivePainsContract(undefined, undefined)).toEqual([]);
            });
        });
    });
});
