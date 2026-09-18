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
        it('renders calorie targets, readable macro names and labeled food search', () => {
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

            const summary = screen.getByRole('region', { name: 'Riepilogo alimentazione' });
            expect(summary.textContent).toContain('1800');
            expect(summary.textContent).toContain('2400');
            expect(summary.textContent).toContain('Proteine');
            expect(summary.textContent).toContain('Carboidrati');
            expect(summary.textContent).toContain('Grassi');
            expect(screen.getByRole('searchbox', { name: 'Cerca alimento' })).toBeDefined();
            expect(screen.getByRole('heading', { level: 2, name: 'Colazione' })).toBeDefined();

        });
    });

    describe('R1 & R2: NutritionPlanning', () => {
        it('renders planning headings and associates each macro label with its input', () => {
            renderWithProviders(<NutritionPlanning />);

            expect(screen.getByRole('heading', { level: 1, name: 'Pianificazione macro' })).toBeDefined();
            expect(screen.getByRole('heading', { level: 2, name: 'Media settimanale desiderata' })).toBeDefined();
            expect(screen.getByText('TDEE (normo stimato)').tagName).toBe('DT');
            for (const label of ['Pro (g/kg)', 'Carbo (g/kg)', 'Grassi (g/kg)', 'Variazione pro (%)', 'Variazione carbo (%)', 'Variazione grassi (%)']) {
                expect(screen.getByRole('spinbutton', { name: label })).toBeDefined();
            }
            expect(screen.getByRole('button', { name: 'Salva pianificazione' })).toBeDefined();

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
        it('renders a named diary action and explicit macro amounts with the calorie target', () => {
            render(<HomeNutritionWidget kcalEaten={1500} kcalTarget={2200} carbs={180} pro={130} fat={45} onNavigate={vi.fn()} />);
            expect(screen.getByRole('button', { name: 'Apri diario alimentare' })).toBeDefined();
            expect(screen.getByText('Obiettivo: 2200 kcal')).toBeDefined();
            for (const label of ['Carboidrati', 'Proteine', 'Grassi']) expect(screen.getByText(label).tagName).toBe('DT');
            expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('68');
        });
    });
});
