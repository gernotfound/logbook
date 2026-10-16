import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NutritionSupplementIntakes } from '../src/components/Nutrition/meals/NutritionSupplementIntakes';

describe('supplement intake catalogue lookups', () => {
    it('shows the correct per-owner name and unit, including deleted supplements', () => {
        const intakes = [
            { id: 'a', supplementId: 'one', amount: 5, time: 1 },
            { id: 'b', supplementId: 'gone', amount: 2, time: 2 },
        ];
        const view = render(<NutritionSupplementIntakes
            intakes={intakes}
            supplementsLibrary={[{ id: 'one', name: 'Creatina', unit: 'g' }]}
            onRemoveIntake={vi.fn()}
        />);
        expect(screen.getByText('Creatina')).toBeDefined();
        expect(screen.getByText('Integratore eliminato')).toBeDefined();
        expect(screen.getByText(/5 g/)).toBeDefined();

        view.rerender(<NutritionSupplementIntakes
            intakes={intakes}
            supplementsLibrary={[{ id: 'one', name: 'Creatina nuova', unit: 'mg' }]}
            onRemoveIntake={vi.fn()}
        />);
        expect(screen.queryByText('Creatina')).toBeNull();
        expect(screen.getByText('Creatina nuova')).toBeDefined();
        expect(screen.getByText(/5 mg/)).toBeDefined();
    });
});
