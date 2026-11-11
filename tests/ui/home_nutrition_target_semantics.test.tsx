import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomeNutritionWidget from '../../src/components/Home/widgets/HomeNutritionWidget';
import { useHomeView } from '../../src/hooks/useHomeView';
import { emptyUserData, renderWithProviders } from '../setup';

describe('Home nutrition target semantics', () => {
    it('reports the true percentage to assistive technology when calories exceed the goal', () => {
        const view = render(<HomeNutritionWidget kcalEaten={3000} kcalTarget={2000} onNavigate={vi.fn()} />);
        const indicator = screen.getByRole('progressbar', { name: 'Calorie giornaliere' });
        expect(indicator.getAttribute('aria-valuenow')).toBe('100');
        expect(indicator.getAttribute('aria-valuetext')).toBe('3000 kcal registrate su 2000 kcal di obiettivo (150%)');
        expect(indicator.querySelector('.home-ring-value')?.getAttribute('stroke-dasharray')).toBe('100 100');
        expect(screen.getByText('Obiettivo: 2000 kcal')).toBeTruthy();

        view.rerender(<HomeNutritionWidget kcalEaten={1500} kcalTarget={2000} onNavigate={vi.fn()} />);
        expect(indicator.getAttribute('aria-valuenow')).toBe('75');
        expect(indicator.getAttribute('aria-valuetext')).toBe('1500 kcal registrate su 2000 kcal di obiettivo (75%)');
    });

    it('does not expose a fake progressbar when no calorie target exists', () => {
        render(<HomeNutritionWidget kcalEaten={450} onNavigate={vi.fn()} />);
        expect(screen.queryByRole('progressbar')).toBeNull();
        const summary = screen.getByRole('group', { name: 'Calorie registrate' });
        expect(summary.textContent).toContain('450');
        expect(screen.getByText('Obiettivo non impostato')).toBeTruthy();
    });

    it('does not invent a 2500 kcal goal if nutrition planning is missing', () => {
        function Target() {
            const state = useHomeView(false);
            return <output data-testid="calorie-goal">{state.loading ? 'loading' : state.kcalTarget}</output>;
        }
        const view = renderWithProviders(<Target />, {
            userData: { ...emptyUserData, nutritionPlanning: undefined },
        });
        expect(screen.getByTestId('calorie-goal').textContent).toBe('0');
        view.unmount();
        renderWithProviders(<Target />, {
            userData: { ...emptyUserData, nutritionPlanning: { ...emptyUserData.nutritionPlanning!, normocalorica: { kcal: 2300 } } },
        });
        expect(screen.getByTestId('calorie-goal').textContent).toBe('2300');
    });
});
