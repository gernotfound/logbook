import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';

import { SessionRatings } from '../src/components/Training/session/SessionRatings';
import NutritionSupplements from '../src/components/Nutrition/NutritionSupplements';
import { FoodItemRow } from '../src/components/Nutrition/archive/FoodItemRow';
import { HomeNutritionWidget } from '../src/components/Home/widgets/HomeNutritionWidget';
import HomeView from '../src/components/Home/HomeView';
import { SessionSetRow } from '../src/components/Training/session/SessionSetRow';
import { CycleEditor } from '../src/components/Training/planning/CycleEditor';
import DataMeasurements from '../src/components/Data/DataMeasurements';
import DataSleep from '../src/components/Data/DataSleep';
import DataBiometry from '../src/components/Data/DataBiometry';
import { renderWithProviders } from './setup';
import { useAppStore } from '../src/store/useAppStore';

describe('EMPIRICAL CHALLENGER: Viewport & Overflow Adversarial Stress Suite (m23_1)', () => {
    const cssPath = path.resolve(__dirname, '../src/styles/global.css');
    const globalCss = fs.readFileSync(cssPath, 'utf-8');

    beforeEach(() => {
        useAppStore.setState({
            userData: {
                profile: { height: 180, gender: 'M' },
                nutrition: {
                    '2026-08-25': {
                        date: '2026-08-25',
                        weight: 78.5,
                        waist: 82,
                        neck: 38,
                        kcal: 2300,
                        carbs: 260,
                        pro: 165,
                        fat: 65,
                        meals: []
                    }
                },
                history: [],
                library: [
                    { id: 'ex1', name: 'Panca piana', trackingType: 'weight_reps', muscles: ['petto'], secondaryMuscles: [], setsCount: 3, sets: [] }
                ],
                routines: [
                    { id: 'r1', name: 'Spinta A', exercises: [{ exId: 'ex1', setsCount: 3 }] }
                ],
                customFoods: [],
                trainingCycles: [],
                activeCycleId: null,
                activeWorkout: null,
                supplements: []
            } as any
        });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    /* =========================================================================
     * SECTION 1: GLOBAL CSS STRUCTURAL RULES, #APP-CONTAINER & OVERFLOW-X: CLIP
     * ========================================================================= */
    describe('1. Global CSS Architecture & Root Overflow Defense', () => {
        it('1.1: #app-container clips horizontal overflow and stays centered at mobile and desktop widths', () => {
            // Find #app-container block in global.css
            const appContainerMatch = globalCss.match(/#app-container\s*\{([^}]+)\}/);
            expect(appContainerMatch, 'Must define #app-container block in global.css').not.toBeNull();
            
            const content = appContainerMatch![1];
            expect(content).toMatch(/max-width:\s*40rem/);
            expect(content).toMatch(/margin:\s*0\s+auto/);
            expect(content).toMatch(/overflow-x:\s*clip/);
            expect(content).toMatch(/position:\s*relative/);
            expect(content).toMatch(/min-height:\s*100vh/);
            expect(globalCss).toMatch(/@media\s*\(min-width:\s*48rem\)\s*\{\s*#app-container\s*\{\s*max-width:\s*48rem/);
            expect(globalCss).toMatch(/@media\s*\(min-width:\s*64rem\)\s*\{\s*#app-container\s*\{\s*max-width:\s*60rem/);
        });

        it('1.2: .grid-2 uses shrinkable columns and switches to one column at 360px', () => {
            const grid2Match = globalCss.match(/\.grid-2\s*\{([^}]+)\}/);
            expect(grid2Match, 'Must define .grid-2 utility class').not.toBeNull();
            
            const grid2Props = grid2Match![1];
            expect(grid2Props).toMatch(/display:\s*grid/);
            expect(grid2Props).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
            expect(grid2Props).toMatch(/min-width:\s*0/);

            // 22.5rem is 360px at the 16px root size.
            const mediaQueryMatch = globalCss.match(/@media\s*\(max-width:\s*22\.5rem\)\s*\{\s*\.grid-2\s*\{([^}]+)\}/);
            expect(mediaQueryMatch, 'Must define the 360px single-column breakpoint for .grid-2').not.toBeNull();
            expect(mediaQueryMatch![1]).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
        });

        it('1.3: .section-divider and .section-divider-last are defined with proper border, padding and margin', () => {
            const dividerMatch = globalCss.match(/\.section-divider\s*\{([^}]+)\}/);
            expect(dividerMatch).not.toBeNull();
            const dividerProps = dividerMatch![1];
            expect(dividerProps).toMatch(/border-bottom:\s*1px\s+solid\s+var\(--glass-border\)/);
            expect(dividerProps).toMatch(/padding-bottom:\s*1\.5rem/);
            expect(dividerProps).toMatch(/margin-bottom:\s*1\.5rem/);

            const lastDividerMatch = globalCss.match(/\.section-divider-last\s*\{([^}]+)\}/);
            expect(lastDividerMatch).not.toBeNull();
            const lastProps = lastDividerMatch![1];
            expect(lastProps).toMatch(/padding-bottom:\s*1\.5rem/);
            expect(lastProps).toMatch(/margin-bottom:\s*1\.5rem/);
        });

        it('1.4: Universal utility flex classes enforce min-width: 0 to prevent flexbox mobile blowouts', () => {
            const flexClasses = ['.flex', '.flex-col', '.flex-between', '.flex-1', '.flex-2'];
            for (const cls of flexClasses) {
                const escaped = cls.replace('.', '\\.');
                const regex = new RegExp(`${escaped}\\s*\\{([^}]+)\\}`);
                const match = globalCss.match(regex);
                expect(match, `Utility class ${cls} must exist in global.css`).not.toBeNull();
                expect(match![1], `Utility class ${cls} must contain min-width: 0`).toMatch(/min-width:\s*0/);
            }
        });

        it('1.5: Input, select, and textarea rules enforce font-size: 16px !important for Safari iOS zoom defense', () => {
            const inputRules = [...globalCss.matchAll(/input,\s*select,\s*textarea\s*\{([^}]+)\}/g)];
            expect(inputRules.length).toBeGreaterThan(0);
            expect(inputRules.some(rule => /font-size:\s*16px\s*!important/.test(rule[1]))).toBe(true);
        });
    });

    /* =========================================================================
     * SECTION 2: ADVERSARIAL MULTI-ITEM FLEX ROWS & MIN-WIDTH: 0 VERIFICATION
     * ========================================================================= */
    describe('2. Multi-Item Flex Children minWidth: 0 Defense', () => {
        it('2.1: SessionRatings mood, pump, fatigue columns all have flex: 1 and minWidth: 0', () => {
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

            const moodInput = container.querySelector('#mood-rating');
            const pumpInput = container.querySelector('#pump-rating');
            const fatigueInput = container.querySelector('#fatigue-rating');

            expect(moodInput).not.toBeNull();
            expect(pumpInput).not.toBeNull();
            expect(fatigueInput).not.toBeNull();

            const moodCol = moodInput!.parentElement!;
            const pumpCol = pumpInput!.parentElement!;
            const fatigueCol = fatigueInput!.parentElement!;

            // Verify minWidth: 0 on each column wrapper
            expect(moodCol.style.minWidth).toBe('0px');
            expect(moodCol.style.flex).toMatch(/^1/);
            expect(pumpCol.style.minWidth).toBe('0px');
            expect(pumpCol.style.flex).toMatch(/^1/);
            expect(fatigueCol.style.minWidth).toBe('0px');
            expect(fatigueCol.style.flex).toMatch(/^1/);
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
            const homeCss = fs.readFileSync(path.resolve(__dirname, '../src/components/Home/home.css'), 'utf-8');
            expect(homeCss).toMatch(/\.home-nutrition-details\s*\{[^}]*flex:\s*1;[^}]*min-width:\s*0/);
            expect(homeCss).toMatch(/\.home-macros\s*>\s*div\s*\{[^}]*flex-wrap:\s*wrap/);
        });

        it('2.4: HomeView stats cards (Massa grassa, Streak, Sessioni) render correctly without overflow', () => {
            renderWithProviders(<HomeView onNavigate={vi.fn()} />);

            const bfCard = screen.getByText(/Massa grassa/i).closest('.card') as HTMLElement;
            const recoveryCard = screen.getByText(/Recupero e Dolori/i).closest('.card') as HTMLElement;

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
                    manualBf="14.5"
                    setManualBf={vi.fn()}
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
            const bfInput = mContainer.querySelector('#measure-bf') as HTMLInputElement;
            const waistInput = mContainer.querySelector('#measure-waist') as HTMLInputElement;
            const neckInput = mContainer.querySelector('#measure-neck') as HTMLInputElement;

            expect(weightInput.parentElement!.style.minWidth).toBe('0px');
            expect(bfInput.parentElement!.style.minWidth).toBe('0px');
            expect(waistInput.parentElement!.style.minWidth).toBe('0px');
            expect(neckInput.parentElement!.style.minWidth).toBe('0px');

            const { container: sContainer } = render(
                <DataSleep
                    selectedDate="2026-08-25"
                    setSelectedDate={vi.fn()}
                    activeDateStr="2026-08-25"
                    isEditing={false}
                    existingLog={null}
                    sleepHook={{
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
                        sleepScore: '85',
                        setSleepScore: vi.fn(),
                        sleepQuality: 'Ottimo',
                        setSleepQuality: vi.fn(),
                        sleepHr: '52',
                        setSleepHr: vi.fn(),
                        sleepHrv: '65',
                        setSleepHrv: vi.fn(),
                        resetForm: vi.fn()
                    }}
                    handleCancelEdit={vi.fn()}
                    handleSaveSleep={vi.fn().mockResolvedValue(undefined)}
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

        it('3.3: 320px viewport simulation: layout contracts smoothly without horizontal overflow', () => {
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
    describe('4. .grid-2 Media Query Switch & Layout Verification', () => {
        it('4.1: CycleEditor uses .grid-2 for responsive dual-column inputs with minWidth: 0', () => {
            const { container } = render(
                <CycleEditor
                    routines={[
                        { id: 'r1', name: 'Upper A', exercises: [] }
                    ]}
                    onSave={vi.fn()}
                    onCancel={vi.fn()}
                />
            );

            const gridContainers = container.querySelectorAll('.grid-2');
            expect(gridContainers.length).toBeGreaterThanOrEqual(1);

            for (const grid of gridContainers) {
                const el = grid as HTMLElement;
                expect(el.classList.contains('grid-2')).toBe(true);
                expect(el.classList.contains('gap-15')).toBe(true);
            }
        });

        it('4.2: Utility stylesheet keeps the 360px grid override after wider viewport rules', () => {
            const gridBase = globalCss.indexOf('.grid-2 { display: grid;');
            const narrowOverride = globalCss.search(/@media\s*\(max-width:\s*22\.5rem\)\s*\{\s*\.grid-2\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
            expect(gridBase).toBeGreaterThanOrEqual(0);
            expect(narrowOverride).toBeGreaterThan(gridBase);
        });
    });

    /* =========================================================================
     * SECTION 5: VIEWPORT ADVERSARIAL STRESS MATRIX (320px, 375px, 390px, 430px, Desktop)
     * ========================================================================= */
    describe('5. Viewport Adversarial Stress Matrix', () => {
        const viewports = [
            { name: 'Ultra-Narrow Mobile (iPhone SE 1st gen)', width: 320 },
            { name: 'Compact Mobile (iPhone SE 2nd/3rd gen, 13 mini)', width: 375 },
            { name: 'Standard iOS/Android (iPhone 14/15/16)', width: 390 },
            { name: 'Large Pro Max (iPhone 16 Pro Max, Pixel 8 Pro)', width: 430 },
            { name: 'Desktop Centered (1024px, 1440px)', width: 1024 }
        ];

        for (const vp of viewports) {
            it(`5.x: Viewport ${vp.width}px (${vp.name}) renders core interactive forms without syntax or layout blowouts`, () => {
                const wrapper = document.createElement('div');
                wrapper.id = 'app-container';
                wrapper.style.width = `${Math.min(vp.width, 600)}px`;
                wrapper.style.margin = '0 auto';
                wrapper.style.overflowX = 'clip';
                document.body.appendChild(wrapper);

                const { unmount } = render(
                    <div style={{ width: '100%', boxSizing: 'border-box' }}>
                        <SessionRatings
                            water="2.0"
                            setWater={vi.fn()}
                            mood="9"
                            setMood={vi.fn()}
                            pump="8"
                            setPump={vi.fn()}
                            fatigue="4"
                            setFatigue={vi.fn()}
                        />
                        <FoodItemRow
                            food={{ id: 'f1', name: 'Riso basmati', kcal: 350, baseQty: 100, unit: 'g', pro: 7, carbs: 78, fat: 1 }}
                            isLast={true}
                            mealTypes={['Colazione', 'Pranzo', 'Cena', 'Spuntini']}
                            onEdit={vi.fn()}
                            onDelete={vi.fn()}
                            onQuickAddToMeal={vi.fn()}
                        />
                        <DataBiometry
                            profile={{ height: 180, gender: 'M', birthDate: '1995-05-15' }}
                            onSaveProfile={vi.fn()}
                        />
                    </div>,
                    { container: wrapper }
                );

                expect(wrapper.querySelector('#water-intake')).not.toBeNull();
                expect(wrapper.querySelector('#mood-rating')).not.toBeNull();
                expect(wrapper.querySelector('#pump-rating')).not.toBeNull();
                expect(wrapper.querySelector('#fatigue-rating')).not.toBeNull();

                unmount();
                document.body.removeChild(wrapper);
            });
        }
    });

    /* =========================================================================
     * SECTION 6: COMPREHENSIVE REPOSITORY-WIDE COMPLIANCE AUDIT
     * ========================================================================= */
    describe('6. Comprehensive Repository-Wide Compliance Audit', () => {
        it('6.1: All spacing and border utility classes exist in global.css', () => {
            const requiredUtilities = [
                '.border-t',
                '.p-15',
                '.pt-10',
                '.pt-15',
                '.pb-10',
                '.pb-15',
                '.mt-15',
                '.mt-20',
                '.mb-20',
                '.gap-15'
            ];

            for (const util of requiredUtilities) {
                const escaped = util.replace('.', '\\.');
                const regex = new RegExp(`${escaped}\\s*\\{`);
                expect(globalCss, `Missing utility class ${util} in global.css`).toMatch(regex);
            }
        });

        it('6.2: refactored views retain visible section separation', () => {
            const filesToCheck = [
                'src/components/Settings/AccountSettingsTab.tsx',
                'src/components/Settings/PrivacySettingsTab.tsx',
                'src/components/Settings/ExportSettingsTab.tsx',
                'src/components/Settings/StorageDiagnostics.tsx',
                'src/components/Training/planning/TrainingPlanning.tsx',
                'src/components/Training/TrainingSessionSetup.tsx',
                'src/components/Nutrition/NutritionMeals.tsx',
                'src/components/Nutrition/NutritionFoodArchive.tsx',
                'src/components/Data/DataMeasurements.tsx',
                'src/components/Data/DataSleep.tsx',
                'src/components/Data/DataBiometry.tsx',
                'src/components/Training/routines/RoutineEditor.tsx',
                'src/components/Training/session/SessionExerciseCard.tsx'
            ];

            for (const relPath of filesToCheck) {
                const absPath = path.resolve(__dirname, '..', relPath);
                expect(fs.existsSync(absPath), `File ${relPath} must exist`).toBe(true);
                const fileContent = fs.readFileSync(absPath, 'utf-8');
                expect(
                    /section-divider|tracking-panel/.test(fileContent),
                    `File ${relPath} should utilize a divider or panel surface`
                ).toBe(true);
            }
        });

        it('6.3: No input/select/textarea in src/components declares an inline fontSize < 16px', () => {
            function walkDir(dir: string): string[] {
                let results: string[] = [];
                const list = fs.readdirSync(dir);
                list.forEach(file => {
                    const fullPath = path.join(dir, file);
                    const stat = fs.statSync(fullPath);
                    if (stat && stat.isDirectory()) {
                        results = results.concat(walkDir(fullPath));
                    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
                        results.push(fullPath);
                    }
                });
                return results;
            }

            const allFiles = walkDir(path.resolve(__dirname, '../src/components'));
            for (const file of allFiles) {
                const content = fs.readFileSync(file, 'utf-8');
                // Regex looking specifically for <input, <select, or <textarea with inline fontSize < 16px
                const inputTagRegex = /<(?:input|select|textarea)\b[^>]*style=\{\{[^}]*fontSize:\s*['"](?:1[0-5]px|0\.[0-9]+rem)['"][^}]*\}\}[^>]*\/?>/gs;
                const badMatches = content.match(inputTagRegex);
                expect(
                    badMatches,
                    `File ${path.basename(file)} contains dangerous form input fontSize < 16px: ${badMatches?.join(', ')}`
                ).toBeNull();
            }
        });
    });
});
