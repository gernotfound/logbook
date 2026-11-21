import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';

import { SessionRatings } from '../../../src/components/Training/session/SessionRatings';
import NutritionSupplements from '../../../src/components/Nutrition/NutritionSupplements';
import { FoodItemRow } from '../../../src/components/Nutrition/archive/FoodItemRow';
import { HomeNutritionWidget } from '../../../src/components/Home/widgets/HomeNutritionWidget';
import HomeView from '../../../src/components/Home/HomeView';
import { SessionSetRow } from '../../../src/components/Training/session/SessionSetRow';
import DataMeasurements from '../../../src/components/Data/DataMeasurements';
import DataSleep from '../../../src/components/Data/DataSleep';
import { renderWithProviders } from '../../setup';
import { seedViewportStressStore } from './viewportStressStore';

describe('Viewport adversarial DOM component invariants (jsdom, not layout geometry)', () => {
    beforeEach(seedViewportStressStore);
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    describe('2. Multi-Item Flex Children minWidth: 0 Defense', () => {
        it('2.1: SessionRatings exposes compact 1-5 controls for mood, pump and fatigue', () => {
            const { container } = render(
                <SessionRatings
                    water="1.5"
                    setWater={vi.fn()}
                    mood="8"
                    setMood={vi.fn()}
                    pump="9"
                    setPump={vi.fn()}
                    fatigue="5"
                    setFatigue={vi.fn()}
                />
            );

            expect(container.querySelector('[aria-label="Umore, scala da 1 a 5"]')).not.toBeNull();
            expect(container.querySelector('[aria-label="Pump, scala da 1 a 5"]')).not.toBeNull();
            expect(container.querySelector('[aria-label="Stanchezza, scala da 1 a 5"]')).not.toBeNull();
        });

        it('2.2: NutritionSupplements form fields row has flex: 1 and minWidth: 0 on all 3 columns', () => {
            const { container } = render(
                <NutritionSupplements
                    selectedDate="2026-08-25"
                    setSelectedDate={vi.fn()}
                />
            );

            // Open new supplement modal form
            const newBtn = screen.getByText('+ Nuovo integratore');
            fireEvent.click(newBtn);

            const targetInput = container.querySelector('input[placeholder="Opzionale (es. 5)"]');
            const portionInput = container.querySelector('input[placeholder="es. 20"]');
            const unitInput = container.querySelector('input[placeholder="es. g, mg, cp"]');

            expect(targetInput).not.toBeNull();
            expect(portionInput).not.toBeNull();
            expect(unitInput).not.toBeNull();

            const targetCol = targetInput!.parentElement!;
            const portionCol = portionInput!.parentElement!;
            const unitCol = unitInput!.parentElement!;

            expect(targetCol.style.minWidth).toBe('0px');
            expect(targetCol.style.flex).toMatch(/^1/);
            expect(portionCol.style.minWidth).toBe('0px');
            expect(portionCol.style.flex).toMatch(/^1/);
            expect(unitCol.style.minWidth).toBe('0px');
            expect(unitCol.style.flex).toMatch(/^1/);
        });

        it('2.3: HomeNutritionWidget macros stay readable beside the calorie ring', () => {
            render(
                <HomeNutritionWidget
                    kcalEaten={1800}
                    kcalTarget={2400}
                    carbs={200}
                    pro={150}
                    fat={60}
                    onNavigate={vi.fn()}
                />
            );

            const carboLabel = screen.getByText('Carboidrati');
            const proLabel = screen.getByText('Proteine');
            const grassiLabel = screen.getByText('Grassi');

            const macroContainer = carboLabel.closest('.home-macros') as HTMLElement;
            expect(macroContainer).not.toBeNull();
            expect(macroContainer.querySelectorAll('dt')).toHaveLength(3);
            expect(carboLabel.nextElementSibling?.textContent).toMatch(/200\s*g/);
            expect(proLabel.nextElementSibling?.textContent).toMatch(/150\s*g/);
            expect(grassiLabel.nextElementSibling?.textContent).toMatch(/60\s*g/);
            expect(macroContainer.parentElement?.classList.contains('home-nutrition-details')).toBe(true);
            const homeCss = fs.readFileSync(path.resolve(__dirname, '../../../src/components/Home/home.css'), 'utf-8');
            expect(homeCss).toMatch(/\.home-nutrition-details\s*\{[^}]*flex:\s*1;[^}]*min-width:\s*0/);
            expect(homeCss).toMatch(/\.home-macros\s*>\s*div\s*\{[^}]*flex-wrap:\s*wrap/);
        });

        it('2.4: HomeView stats cards render with their labels (no overflow measurement)', () => {
            renderWithProviders(<HomeView onNavigate={vi.fn()} />);

            const bfCard = screen.getByText(/Massa grassa/i).closest('.card') as HTMLElement;
            const recoveryCard = screen.getByText(/Esposizione recente e dolori/i).closest('.card') as HTMLElement;

            expect(bfCard).not.toBeNull();
            expect(recoveryCard).not.toBeNull();
            expect(screen.getByText('Streak')).toBeDefined();
            expect(screen.getByText('Sessioni')).toBeDefined();
        });

        it('2.5: SessionSetRow inputs row has minWidth: 0 on inputs container and flex inputs', () => {
            const mockSet = { id: 's1', kg: '100', reps: '10', done: false };
            const { container } = render(
                <SessionSetRow
                    set={mockSet}
                    sIndex={0}
                    exIndex={0}
                    trackingType="weight_reps"
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

            const kgInput = container.querySelector('#kg-s1') as HTMLInputElement;
            const repsInput = container.querySelector('#reps-s1') as HTMLInputElement;

            expect(kgInput).not.toBeNull();
            expect(repsInput).not.toBeNull();

            expect(kgInput.style.minWidth).toBe('0px');
            expect(kgInput.style.flex).toMatch(/^1/);
            expect(repsInput.style.minWidth).toBe('0px');
            expect(repsInput.style.flex).toMatch(/^1/);

            const parentInputsContainer = kgInput.parentElement!;
            expect(parentInputsContainer.style.minWidth).toBe('0px');
            expect(parentInputsContainer.style.flex).toMatch(/^1/);
        });

        it('2.6: DataMeasurements and DataSleep multi-input rows enforce minWidth: 0', () => {
            const { container: mContainer } = render(
                <DataMeasurements
                    profile={{ gender: 'M' }}
                    selectedDate="2026-08-25"
                    setSelectedDate={vi.fn()}
                    targetDateStr="2026-08-25"
                    measureTime="08:30"
                    setMeasureTime={vi.fn()}
                    weight="78.5"
                    setWeight={vi.fn()}
                    waist="82"
                    setWaist={vi.fn()}
                    neck="38"
                    setNeck={vi.fn()}
                    hip=""
                    setHip={vi.fn()}
                    chest="102"
                    setChest={vi.fn()}
                    shoulders="120"
                    setShoulders={vi.fn()}
                    biceps="38"
                    setBiceps={vi.fn()}
                    thighs="58"
                    setThighs={vi.fn()}
                    calves="37"
                    setCalves={vi.fn()}
                    handleCancelEdit={vi.fn()}
                    calculateAndSave={vi.fn().mockResolvedValue(undefined)}
                />
            );

            const weightInput = mContainer.querySelector('#measure-weight') as HTMLInputElement;
            const estimateCheckbox = mContainer.querySelector('.data-method-option input[type="checkbox"]') as HTMLInputElement;
            const waistInput = mContainer.querySelector('#measure-waist') as HTMLInputElement;
            const neckInput = mContainer.querySelector('#measure-neck') as HTMLInputElement;

            expect(weightInput.parentElement!.style.minWidth).toBe('0px');
            expect(mContainer.querySelector('#measure-bf')).toBeNull();
            expect(estimateCheckbox.checked).toBe(false);
            expect(waistInput.parentElement!.style.minWidth).toBe('0px');
            expect(neckInput.parentElement!.style.minWidth).toBe('0px');

            const { container: sContainer } = render(
                <DataSleep
                    selectedDate="2026-08-25"
                    setSelectedDate={vi.fn()}
                    todayDateStr="2026-08-25"
                    sleepHook={{
                        editingDate: null,
                        setEditingDate: vi.fn(),
                    cancelEdit: vi.fn(() => true),
                        saveSleep: vi.fn(),
                        sleepHours: '07:30',
                        setSleepHours: vi.fn(),
                        sleepDeep: '01:45',
                        setSleepDeep: vi.fn(),
                        sleepLight: '04:15',
                        setSleepLight: vi.fn(),
                        sleepRem: '01:30',
                        setSleepRem: vi.fn(),
                        sleepAwake: '00:15',
                        setSleepAwake: vi.fn(),
                    }}
                />
            );

            const deepInput = sContainer.querySelector('#sleep-deep') as HTMLInputElement;
            const lightInput = sContainer.querySelector('#sleep-light') as HTMLInputElement;

            const deepContainer = deepInput.closest('.input-row > div') as HTMLElement;
            const lightContainer = lightInput.closest('.input-row > div') as HTMLElement;

            expect(deepContainer.style.minWidth).toBe('0px');
            expect(lightContainer.style.minWidth).toBe('0px');
        });
    });

    /* =========================================================================
     * SECTION 3: QUICK-ADD BUTTONS WRAPPING CLEANLY ON 320PX VIEWPORT
     * ========================================================================= */
    describe('3. Quick-Add Buttons & Ultra-Narrow 320px Viewport Behavior', () => {
        const mockFood = {
            id: 'food_1',
            name: 'Petto di pollo al forno con erbe aromatiche e limone',
            brand: 'Fileni Bio',
            kcal: 110,
            baseQty: 100,
            unit: 'g',
            pro: 23,
            carbs: 0,
            fat: 1.5
        };

        const mealTypes = ['Colazione', 'Pranzo', 'Cena', 'Spuntini'];

        it('3.1: FoodItemRow quick-add buttons container explicitly declares flexWrap: wrap', () => {
            const onQuickAdd = vi.fn();
render(
                <FoodItemRow
                    food={mockFood}
                    isLast={false}
                    mealTypes={mealTypes}
                    onEdit={vi.fn()}
                    onDelete={vi.fn()}
                    onDuplicate={vi.fn()}
                    onQuickAddToMeal={onQuickAdd}
                />
            );

            const quickAddLabel = screen.getByText('+ Aggiungi a:');
            const quickAddContainer = quickAddLabel.parentElement as HTMLElement;

            expect(quickAddContainer).not.toBeNull();
            expect(quickAddContainer.style.display).toBe('flex');
            expect(quickAddContainer.style.flexWrap).toBe('wrap');

            // All 4 meal type buttons are rendered and interactive
            for (const mt of mealTypes) {
                const btn = screen.getByText(mt);
                expect(btn).not.toBeNull();
                btn.click();
                expect(onQuickAdd).toHaveBeenCalledWith(mockFood, mt);
            }
        });

        it('3.2: FoodItemRow macro details and title containers declare flexWrap: wrap to prevent horizontal blowouts on long names', () => {
render(
                <FoodItemRow
                    food={mockFood}
                    isLast={false}
                    mealTypes={mealTypes}
                    onEdit={vi.fn()}
                    onDelete={vi.fn()}
                    onDuplicate={vi.fn()}
                    onQuickAddToMeal={vi.fn()}
                />
            );

            // Title container has flexWrap: wrap
            const titleSpan = screen.getByText(mockFood.name);
            const titleContainer = titleSpan.parentElement as HTMLElement;
            expect(titleContainer.style.flexWrap).toBe('wrap');

            // Macro details container has flexWrap: wrap
            const kcalSpan = screen.getByText(`${mockFood.kcal} kcal`);
            const macroContainer = kcalSpan.parentElement as HTMLElement;
            expect(macroContainer.style.flexWrap).toBe('wrap');
        });

        it('3.3: 320px wrapper mounts FoodItemRow controls in jsdom (layout not measured)', () => {
            // Emulate container constrained to 320px width (iPhone SE 1st gen)
            const rootWrapper = document.createElement('div');
            rootWrapper.id = 'app-container';
            rootWrapper.style.width = '320px';
            rootWrapper.style.maxWidth = '600px';
            rootWrapper.style.overflowX = 'clip';
            document.body.appendChild(rootWrapper);

            const { container } = render(
                <div style={{ width: '100%', padding: '10px', boxSizing: 'border-box' }}>
                    <FoodItemRow
                        food={mockFood}
                        isLast={false}
                        mealTypes={mealTypes}
                        onEdit={vi.fn()}
                        onDelete={vi.fn()}
                    onDuplicate={vi.fn()}
                        onQuickAddToMeal={vi.fn()}
                    />
                </div>,
                { container: rootWrapper }
            );

            const buttons = container.querySelectorAll('button');
            expect(buttons.length).toBeGreaterThanOrEqual(5); // 1 ContextMenu trigger button + 4 quick-add buttons
            
            // Cleanup attached DOM node
            document.body.removeChild(rootWrapper);
        });
    });

    /* =========================================================================
     * SECTION 4: GRID-2 MEDIA QUERY SWITCH AT <= 360PX VIEWPORT STRESS
     * ========================================================================= */
});
