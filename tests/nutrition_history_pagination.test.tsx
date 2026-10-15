import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import NutritionHistory from '../src/components/Nutrition/NutritionHistory';

describe('meal history incremental rendering', () => {
    const days = Array.from({ length: 66 }, (_, index) => ({
        date: `2026-09-${String(index + 1).padStart(2, '0')}`,
        meals: [{ id: `meal-${index}` }],
        kcal: index,
        pro: index,
        carbs: 0,
        fat: 0,
    }));

    it('renders bounded pages without dropping days or changing the selected date', () => {
        const onDayClick = vi.fn();
        const { container } = render(<NutritionHistory nutritionHistory={days} onDayClick={onDayClick} />);
        const cards = () => container.querySelectorAll('.clickable-card');
        expect(cards()).toHaveLength(30);
        fireEvent.click(cards()[0]);
        expect(onDayClick).toHaveBeenCalledWith(days[0].date);

        fireEvent.click(screen.getByRole('button', { name: /Mostra altri giorni/i }));
        expect(cards()).toHaveLength(60);
        fireEvent.click(screen.getByRole('button', { name: /Mostra altri giorni/i }));
        expect(cards()).toHaveLength(66);
        expect(screen.queryByRole('button', { name: /Mostra altri giorni/i })).toBeNull();
        fireEvent.click(cards()[65]);
        expect(onDayClick).toHaveBeenCalledWith(days[65].date);
    });

    it('shows an empty state and no pagination controls', () => {
        render(<NutritionHistory nutritionHistory={[]} />);
        expect(screen.getByText('Nessun pasto registrato finora.')).toBeDefined();
        expect(screen.queryByRole('button', { name: /Mostra altri giorni/i })).toBeNull();
    });
});
