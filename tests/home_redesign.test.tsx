import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HomeWorkoutWidget from '../src/components/Home/widgets/HomeWorkoutWidget';
import HomeNutritionWidget from '../src/components/Home/widgets/HomeNutritionWidget';

describe('Home actions and nutrition presentation', () => {
    it('offers a start action on a day with no recorded workout', () => {
        const navigate = vi.fn();
        render(<HomeWorkoutWidget isRestDay onNavigate={navigate} />);
        fireEvent.click(screen.getByRole('button', { name: 'Inizia allenamento di oggi' }));
        expect(navigate).toHaveBeenCalledWith('training');
    });
    it('prioritizes the local session over an already completed workout', () => {
        const navigate = vi.fn();
        const active = { id: 'active', date: '2026-09-16', routineName: 'Gambe', exercises: [] };
        render(<HomeWorkoutWidget activeWorkout={active} todaysWorkout={{ ...active, id: 'done', routineName: 'Petto' }} onNavigate={navigate} />);
        expect(screen.getByRole('heading', { name: 'Gambe' })).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Riprendi allenamento' }));
        expect(navigate).toHaveBeenCalledWith('training');
    });
    it('shows logged grams without inventing macro targets, and opens the diary', () => {
        const navigate = vi.fn();
        const { container } = render(<HomeNutritionWidget kcalEaten={1500} carbs={180} pro={130} fat={45} onNavigate={navigate} />);
        expect(screen.getByText('Obiettivo non impostato')).toBeDefined();
        expect(screen.queryByRole('progressbar')).toBeNull();
        const entries = Array.from(container.querySelectorAll('dl > div')).map(entry => entry.textContent);
        expect(entries).toEqual(['Carboidrati180 g', 'Proteine130 g', 'Grassi45 g']);
        fireEvent.click(screen.getByRole('button', { name: 'Apri diario alimentare' }));
        expect(navigate).toHaveBeenCalledWith('nutrition');
    });
    it('keeps the actual calorie amount readable when the target is exceeded', () => {
        render(<HomeNutritionWidget kcalEaten={2500} kcalTarget={2000} onNavigate={vi.fn()} />);
        expect(screen.getByText('2500')).toBeDefined();
        expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
    });
});
