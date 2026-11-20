import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import NutritionSupplements from '../../src/components/Nutrition/NutritionSupplements';
import { storageOwner } from '../../src/lib/sync/session';
import { useAppStore } from '../../src/store/useAppStore';
import { emptyUserData } from '../setup';

it('preserves quick intake values for different supplements updated in one React batch', () => {
    const previous = useAppStore.getState();
    useAppStore.setState({
        userData: {
            ...emptyUserData,
            supplements: [
                { id: 'first', name: 'Creatina', unit: 'g' },
                { id: 'second', name: 'Magnesio', unit: 'mg' },
            ],
        },
        dataOwner: storageOwner(),
    });

    try {
        const view = render(<NutritionSupplements selectedDate="2026-09-14" />);
        const first = screen.getByRole('spinbutton', { name: 'Quantità assunzione Creatina' }) as HTMLInputElement;
        const second = screen.getByRole('spinbutton', { name: 'Quantità assunzione Magnesio' }) as HTMLInputElement;

        act(() => {
            fireEvent.change(first, { target: { value: '3' } });
            fireEvent.change(second, { target: { value: '200' } });
        });

        expect(first.value).toBe('3');
        expect(second.value).toBe('200');
        view.unmount();
    } finally {
        useAppStore.setState({ userData: previous.userData, dataOwner: previous.dataOwner });
    }
});
