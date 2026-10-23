import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NutritionSupplementIntakes } from '../src/components/Nutrition/meals/NutritionSupplementIntakes';
import { useSupplements } from '../src/hooks/useSupplements';
import { useAppStore } from '../src/store/useAppStore';
import { emptyUserData } from './setup';

describe('supplement intake catalogue lookups', () => {
    it('resolves supplement names and units from the current library props, including deleted items', () => {
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
    it('updates the displayed intake when owner-scoped store data switches with a reused supplement ID', () => {
        const date = '2026-09-14';
        const getData = (name: string, unit: string) => ({
            ...emptyUserData,
            supplements: [{ id: 'shared', name, unit }],
            nutrition: { [date]: {
                date, kcal: 0, carbs: 0, pro: 0, fat: 0,
                supplementsIntake: [{ id: 'intake', supplementId: 'shared', amount: 3, time: 1 }],
            } },
        });
        useAppStore.setState({ dataOwner: 'user:a', userData: getData('Creatina A', 'g') });
        function Connected() {
            const { supplementsIntake, supplementsLibrary } = useSupplements(date);
            return <NutritionSupplementIntakes intakes={supplementsIntake}
                supplementsLibrary={supplementsLibrary} onRemoveIntake={vi.fn()} />;
        }
        render(<Connected />);
        expect(screen.getByText('Creatina A')).toBeDefined();
        act(() => {
            useAppStore.setState({ dataOwner: 'user:b', userData: getData('Creatina B', 'mg') });
        });
        expect(screen.queryByText('Creatina A')).toBeNull();
        expect(screen.getByText('Creatina B')).toBeDefined();
        expect(screen.getByText(/3 mg/)).toBeDefined();
    });
});
