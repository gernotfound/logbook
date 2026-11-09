import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExerciseArchive } from '../src/components/Training/exercises/ExerciseArchive';
import NutritionFoodArchive from '../src/components/Nutrition/NutritionFoodArchive';
import { createMockUserData, renderWithAuthenticatedTestOwner } from './setup';

describe('catalog archive progressive rendering', () => {
    it('limits exercise rows while preserving search, selection and new library snapshots', () => {
        const library = Array.from({ length: 125 }, (_, index) => ({
            id: `exercise-${index}`,
            name: index === 124 ? 'Esercizio assolutamenteunico' : `Esercizio ${index}`,
            setsCount: 3,
            sets: [],
            muscles: [],
            notes: '',
            isDefault: false,
        }));
        const onSelectedExIdChange = vi.fn();
        const props = {
            routines: [],
            selectedExId: null,
            onSelectedExIdChange,
            onEditItem: vi.fn(),
            onDuplicate: vi.fn(),
            onDelete: vi.fn(),
        };
        const view = render(<ExerciseArchive library={library} {...props} />);
        expect(screen.getAllByRole('button', { name: /^Apri dettaglio di/ })).toHaveLength(50);
        expect(screen.getByText('125 esercizi')).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: /Mostra altri esercizi/ }));
        expect(screen.getAllByRole('button', { name: /^Apri dettaglio di/ })).toHaveLength(100);
        fireEvent.click(screen.getByRole('button', { name: /Mostra altri esercizi/ }));
        expect(screen.getAllByRole('button', { name: /^Apri dettaglio di/ })).toHaveLength(125);
        expect(screen.queryByRole('button', { name: /Mostra altri esercizi/ })).toBeNull();
        view.rerender(<ExerciseArchive library={[...library]} {...props} />);
        expect(screen.getAllByRole('button', { name: /^Apri dettaglio di/ })).toHaveLength(50);
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'assolutamenteunico' } });
        expect(screen.getAllByRole('button', { name: /^Apri dettaglio di/ })).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'Apri dettaglio di Esercizio assolutamenteunico' }));
        expect(onSelectedExIdChange).toHaveBeenCalledWith('exercise-124');
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
        expect(screen.getAllByRole('button', { name: /^Apri dettaglio di/ })).toHaveLength(50);
    });

    it('limits initial food rows and keeps all meals available through load more and search', () => {
        const customFoods = Array.from({ length: 125 }, (_, index) => ({
            id: `food-${index}`,
            name: index === 124 ? 'Alimento parolaultraunica' : `Alimento ${index}`,
            unit: 'g', baseQty: 100, kcal: 100, carbs: 10, pro: 8, fat: 3,
        }));
        renderWithAuthenticatedTestOwner(<NutritionFoodArchive />, {
            userData: createMockUserData({ customFoods }),
        });
        expect(screen.getAllByRole('button', { name: 'Opzioni' })).toHaveLength(50);
        expect(screen.getByText('I tuoi alimenti (125)')).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: /Mostra altri alimenti/ }));
        expect(screen.getAllByRole('button', { name: 'Opzioni' })).toHaveLength(100);
        fireEvent.click(screen.getByRole('button', { name: /Mostra altri alimenti/ }));
        expect(screen.getAllByRole('button', { name: 'Opzioni' })).toHaveLength(125);
        expect(screen.queryByRole('button', { name: /Mostra altri alimenti/ })).toBeNull();
        fireEvent.change(screen.getByRole('textbox', { name: 'Cerca alimenti per nome o marca' }), {
            target: { value: 'parolaultraunica' },
        });
        expect(screen.getAllByRole('button', { name: 'Opzioni' })).toHaveLength(1);
        expect(screen.getByText('Alimento parolaultraunica')).toBeDefined();
        fireEvent.change(screen.getByRole('textbox', { name: 'Cerca alimenti per nome o marca' }), {
            target: { value: '' },
        });
        expect(screen.getAllByRole('button', { name: 'Opzioni' })).toHaveLength(50);
    });
});
