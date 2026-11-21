import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import NutritionFoodArchive from '../../src/components/Nutrition/NutritionFoodArchive';
import { NutritionFoodSearch } from '../../src/components/Nutrition/meals/NutritionFoodSearch';
import { emptyCustomFoodDraft } from '../../src/lib/nutrition/customFoodDraft';
import { useAppStore } from '../../src/store/useAppStore';
import type { Food } from '../../src/types';
import { createMockUserData, renderWithAuthenticatedTestOwner } from '../setup';

const zeroFood: Food = {
    id: 0, name: 'Zero numerico', kcal: 100, carbs: 12, pro: 7, fat: 2, unit: 'g',
};
const namedFood: Food = {
    id: 'other', name: 'Alimento ordinario', kcal: 200, carbs: 25, pro: 9, fat: 4, unit: 'g',
};

describe('identità e focus degli alimenti nelle liste', () => {
    it('mantiene il pulsante del risultato con ID numerico zero quando i risultati cambiano ordine', () => {
        const props = {
            mealTypes: ['Pranzo'],
            searchQuery: 'alimento',
            handleSearch: vi.fn(),
            searchResults: [namedFood, zeroFood],
            clearSearch: vi.fn(),
            showCustomModal: false,
            setShowCustomModal: vi.fn(),
            editingFoodId: null,
            cancelCustomFood: vi.fn(),
            cfData: emptyCustomFoodDraft(),
            setCfData: vi.fn(),
            saveCustomFood: vi.fn(async () => true),
            addFood: vi.fn(async () => {}),
        };
        const view = render(<NutritionFoodSearch {...props} />);
        const target = screen.getByRole('button', { name: 'Aggiungi Zero numerico a Pranzo' });
        target.focus();
        expect(document.activeElement).toBe(target);

        view.rerender(<NutritionFoodSearch {...props} searchResults={[zeroFood, namedFood]} />);

        const moved = screen.getByRole('button', { name: 'Aggiungi Zero numerico a Pranzo' });
        expect(moved).toBe(target);
        expect(document.activeElement).toBe(target);
        fireEvent.click(moved);
        expect(props.addFood).toHaveBeenCalledExactlyOnceWith(zeroFood, 'Pranzo');
    });

    it('mantiene il menu contestuale dell\'alimento con ID zero quando si riordina l\'archivio', () => {
        renderWithAuthenticatedTestOwner(<NutritionFoodArchive />, {
            userData: createMockUserData({ customFoods: [namedFood, zeroFood] }),
        });
        const target = screen.getAllByRole('button', { name: 'Opzioni' })[1];
        target.focus();
        expect(document.activeElement).toBe(target);

        act(() => {
            useAppStore.setState(state => ({
                userData: { ...state.userData!, customFoods: [zeroFood, namedFood] },
            }));
        });

        const moved = screen.getAllByRole('button', { name: 'Opzioni' })[0];
        expect(moved).toBe(target);
        expect(document.activeElement).toBe(target);
    });

    it('offre un pulsante Cancella ricerca di 44×44 px e restituisce il focus al campo', () => {
        renderWithAuthenticatedTestOwner(<NutritionFoodArchive />, {
            userData: createMockUserData({ customFoods: [namedFood] }),
        });
        const searchInput = screen.getByRole('textbox', { name: 'Cerca alimenti per nome o marca' }) as HTMLInputElement;
        fireEvent.change(searchInput, { target: { value: 'alimento' } });
        const clearButton = screen.getByRole('button', { name: 'Cancella ricerca' }) as HTMLButtonElement;
        expect(clearButton.style.width).toBe('44px');
        expect(clearButton.style.height).toBe('44px');
        clearButton.focus();

        fireEvent.click(clearButton);

        expect(searchInput.value).toBe('');
        expect(document.activeElement).toBe(searchInput);
        expect(screen.getByText('I tuoi alimenti (1)')).toBeDefined();
    });
});
