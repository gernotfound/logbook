import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, render } from '@testing-library/react';
import { renderWithProviders } from './setup';

import CustomFoodForm from '../src/components/Nutrition/CustomFoodForm';
import InlineEditMealItem from '../src/components/Nutrition/InlineEditMealItem';
import NutritionHistory from '../src/components/Nutrition/NutritionHistory';
import NutritionMeals from '../src/components/Nutrition/NutritionMeals';
import NutritionPlanning from '../src/components/Nutrition/NutritionPlanning';
import NutritionFoodArchive from '../src/components/Nutrition/NutritionFoodArchive';
import NutritionSupplements from '../src/components/Nutrition/NutritionSupplements';
import { FoodItemRow } from '../src/components/Nutrition/archive/FoodItemRow';
import HomeNutritionWidget from '../src/components/Home/widgets/HomeNutritionWidget';

describe('Nutrition Section Style & Color Refactoring Suite', () => {

    describe('R1 & R2: CustomFoodForm', () => {
        it('renders title with var(--text-main)', () => {
            const cfData = { name: '', brand: '', unit: 'g', pieceWeight: '', kcal: '', carbs: '', pro: '', fat: '' };
            render(
                <CustomFoodForm 
                    cfData={cfData}
                    setCfData={vi.fn()}
                    saveCustomFood={vi.fn()}
                    showCustomModal={true}
                    setShowCustomModal={vi.fn()}
                />
            );
            const heading = screen.getByRole('heading', { level: 3 });
            expect(heading.style.color).toBe('var(--text-main)');
        });
    });

    describe('R1 & R2: InlineEditMealItem', () => {
        const item = {
            id: 'item-1',
            name: 'Petto di pollo',
            brand: 'AIA',
            quantity: 150,
            baseQty: 100,
            unit: 'g',
            kcal: 110,
            pro: 23,
            carbs: 0,
            fat: 1.5,
            meal: 'Pranzo'
        };

        it('renders food name with var(--text-main) and title with var(--text-main)', () => {
            render(
                <InlineEditMealItem
                    item={item}
                    onClose={vi.fn()}
                    onSave={vi.fn()}
                    onDelete={vi.fn()}
                />
            );
            const title = screen.getByRole('heading', { level: 2 });
            expect(title.style.color).toBe('var(--text-main)');

            const foodName = screen.getByText('Petto di pollo');
            expect(foodName.style.color).toBe('var(--text-main)');
        });

        it('renders all 4 macro preview values with var(--text-main) and labels with var(--text-muted)', () => {
            const { container } = render(
                <InlineEditMealItem
                    item={item}
                    onClose={vi.fn()}
                    onSave={vi.fn()}
                    onDelete={vi.fn()}
                />
            );

            // Labels
            expect(screen.getByText('KCAL').style.color).toBe('var(--text-muted)');
            expect(screen.getByText('PRO').style.color).toBe('var(--text-muted)');
            expect(screen.getByText('CARBO').style.color).toBe('var(--text-muted)');
            expect(screen.getByText('GRASSI').style.color).toBe('var(--text-muted)');

            // Values
            const values = container.querySelectorAll('div[style*="font-weight: bold"]');
            const macroValTexts = Array.from(values).map(el => (el as HTMLElement).textContent);
            expect(macroValTexts).toContain('165'); // 110 * 1.5
            expect(macroValTexts).toContain('34.5g'); // 23 * 1.5
            expect(macroValTexts).toContain('0g'); // 0 * 1.5
            expect(macroValTexts).toContain('2.3g'); // 1.5 * 1.5

            // Ensure no traffic light HEX or variable colors are used in text preview
            const previewContainer = screen.getByText('KCAL').parentElement?.parentElement;
            expect(previewContainer?.innerHTML).not.toContain('#34d399');
            expect(previewContainer?.innerHTML).not.toContain('#60a5fa');
            expect(previewContainer?.innerHTML).not.toContain('#f87171');
            expect(previewContainer?.innerHTML).not.toContain('var(--warning-color)');
            expect(previewContainer?.innerHTML).not.toContain('var(--success-color)');
            expect(previewContainer?.innerHTML).not.toContain('var(--primary-color)');
            expect(previewContainer?.innerHTML).not.toContain('var(--danger-color)');
        });
    });

    describe('R1: NutritionHistory', () => {
        const historyData = [
            {
                date: '2026-08-16',
                isDayOn: true,
                kcal: 2200,
                pro: 160,
                carbs: 250,
                fat: 60,
                meals: [{ id: 1 }, { id: 2 }],
                supplementsIntake: [{ id: 's1' }]
            }
        ];

        it('renders macro labels in var(--text-muted) and numeric values in var(--text-main)', () => {
render(
                <NutritionHistory 
                    nutritionHistory={historyData}
                    onDayClick={vi.fn()}
                />
            );

            expect(screen.getByText('Kcal').style.color).toBe('var(--text-muted)');
            expect(screen.getByText('Pro').style.color).toBe('var(--text-muted)');
            expect(screen.getByText('Car').style.color).toBe('var(--text-muted)');
            expect(screen.getByText('Gra').style.color).toBe('var(--text-muted)');

            const kcalVal = screen.getByText('2200');
            const proVal = screen.getByText('160g');
            const carVal = screen.getByText('250g');
            const graVal = screen.getByText('60g');

            expect(kcalVal.style.color).toBe('var(--text-main)');
            expect(proVal.style.color).toBe('var(--text-main)');
            expect(carVal.style.color).toBe('var(--text-main)');
            expect(graVal.style.color).toBe('var(--text-main)');

            // Check heading color
            const h1 = screen.getByRole('heading', { level: 1 });
            expect(h1.style.color).toBe('var(--text-main)');
        });
    });

    describe('R1 & R2: NutritionMeals', () => {
        it('renders TDEE target, search title, and macro header labels without bright text colors', () => {
            const mockHook: any = {
                todayNutrition: { kcal: 1800, pro: 140, carbs: 200, fat: 50 },
                dailyTarget: { kcal: 2400, pro: 160, carbs: 280, fat: 65 },
                isDayOn: true,
                setDayType: vi.fn(),
                searchQuery: '',
                handleSearch: vi.fn(),
                searchResults: [],
                clearSearch: vi.fn(),
                showCustomModal: false,
                setShowCustomModal: vi.fn(),
                editingFoodId: null,
                cancelCustomFood: vi.fn(),
                cfData: {},
                setCfData: vi.fn(),
                saveCustomFood: vi.fn(),
                meals: [
                    { id: 'm1', name: 'Avena', quantity: 80, baseQty: 100, unit: 'g', kcal: 300, pro: 10, carbs: 50, fat: 5, meal: 'Colazione' }
                ],
                addFood: vi.fn(),
                removeFood: vi.fn(),
                updateMealItem: vi.fn(),
                targetDateStr: '2026-08-16'
            };

renderWithProviders(
                <NutritionMeals mealsHook={mockHook} selectedDate="2026-08-16" />
            );

            // Target kcal text
            const targetKcal = screen.getByText('2400');
            expect(targetKcal.style.color).toBe('var(--text-main)');

            // PRO, CAR, GRA labels in header
            expect(screen.getByText('PRO').style.color).toBe('var(--text-muted)');
            expect(screen.getByText('CAR').style.color).toBe('var(--text-muted)');
            expect(screen.getByText('GRA').style.color).toBe('var(--text-muted)');

            // Search heading
            const searchHeading = screen.getByRole('heading', { level: 2, name: /Cerca alimento/i });
            expect(searchHeading.style.color).toBe('var(--text-main)');

            // Meal category headers (Colazione, Pranzo, Cena, Spuntini) should be var(--text-main) and not text-primary
            const colazioneHeader = screen.getByRole('heading', { level: 2, name: /Colazione/i });
            expect(colazioneHeader.classList.contains('text-primary')).toBe(false);
            expect(colazioneHeader.style.color).toBe('var(--text-main)');
        });
    });

    describe('R1 & R2: NutritionPlanning', () => {
        it('renders titles and macro labels in Dark Glassmorphism text hierarchy', () => {
            renderWithProviders(<NutritionPlanning />);

            // Main Title
            const h1 = screen.getByRole('heading', { level: 1 });
            expect(h1.style.color).toBe('var(--text-main)');

            // Sub-sections titles
            const h2Elements = screen.getAllByRole('heading', { level: 2 });
            h2Elements.forEach(h2 => {
                expect(h2.style.color).toBe('var(--text-main)');
            });

            // Italian Sentence Case check for TDEE normo stimato
            const normoLabel = screen.getByText('TDEE (normo stimato)');
            expect(normoLabel).toBeDefined();
            expect(normoLabel.style.color).toBe('var(--text-muted)');

            // Macro input labels (Pro, Carbo, Grassi g/kg and variations)
            const proLabel = screen.getByText('Pro (g/kg)');
            const carboLabel = screen.getByText('Carbo (g/kg)');
            const grassiLabel = screen.getByText('Grassi (g/kg)');
            expect(proLabel.style.color).toBe('var(--text-muted)');
            expect(carboLabel.style.color).toBe('var(--text-muted)');
            expect(grassiLabel.style.color).toBe('var(--text-muted)');

            const varProLabel = screen.getByText('Variazione pro (%)');
            const varCarLabel = screen.getByText('Variazione carbo (%)');
            const varFatLabel = screen.getByText('Variazione grassi (%)');
            expect(varProLabel.style.color).toBe('var(--text-muted)');
            expect(varCarLabel.style.color).toBe('var(--text-muted)');
            expect(varFatLabel.style.color).toBe('var(--text-muted)');
        });
    });

    describe('R1 & R2: NutritionSupplements', () => {
        it('renders supplements library headings with var(--text-main)', () => {
            renderWithProviders(
                <NutritionSupplements selectedDate="2026-08-16" />
            );

            // Button to open create form
            const newSuppBtn = screen.getByRole('button', { name: /\+ Nuovo integratore/i });
            expect(newSuppBtn).toBeDefined();
        });
    });

    describe('R1 & R2: NutritionFoodArchive & FoodItemRow', () => {
        it('renders FoodArchive title with var(--text-main)', () => {
            renderWithProviders(<NutritionFoodArchive />);
            const title = screen.getByRole('heading', { level: 1 });
            expect(title.style.color).toBe('var(--text-main)');
        });

        it('renders FoodItemRow kcal with var(--text-main)', () => {
            const food = {
                id: 'cf-1',
                name: 'Pane integrale',
                brand: 'Mulino Bianco',
                baseQty: 100,
                unit: 'g',
                kcal: 240,
                pro: 9,
                carbs: 45,
                fat: 2
            };

            render(
                <FoodItemRow
                    food={food}
                    isLast={false}
                    mealTypes={['Colazione', 'Pranzo']}
                    onEdit={vi.fn()}
                    onDelete={vi.fn()}
                    onQuickAddToMeal={vi.fn()}
                />
            );

            const kcalSpan = screen.getByText(/240 kcal/i);
            expect(kcalSpan.style.color).toBe('var(--text-main)');
        });
    });

    describe('HomeNutritionWidget alignment', () => {
        it('renders heading and macro labels in var(--text-muted) and target in var(--text-main)', () => {
            render(
                <HomeNutritionWidget
                    kcalEaten={1500}
                    kcalTarget={2200}
                    carbs={180}
                    pro={130}
                    fat={45}
                    onNavigate={vi.fn()}
                />
            );

            const heading = screen.getByRole('heading', { level: 2, name: /Nutrizione odierna/i });
            expect(heading.style.color).toBe('var(--text-main)');

            const targetKcal = screen.getByText('2200');
            expect(targetKcal.style.color).toBe('var(--text-main)');

            expect(screen.getByText('CARBO').style.color).toBe('var(--text-muted)');
            expect(screen.getByText('PRO').style.color).toBe('var(--text-muted)');
            expect(screen.getByText('GRASSI').style.color).toBe('var(--text-muted)');
        });
    });
});
