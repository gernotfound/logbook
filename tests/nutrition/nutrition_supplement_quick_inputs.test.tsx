import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import NutritionSupplements from '../../src/components/Nutrition/NutritionSupplements';
import { storageOwner } from '../../src/lib/sync/session';
import { useAppStore } from '../../src/store/useAppStore';
import { emptyUserData } from '../setup';

it('keeps batched supplement drafts independent through two durable intake commits', async () => {
    const previous = useAppStore.getState();
    const dispatch = vi.fn(async () => ({ ok: true as const, status: 'synced' as const }));
    useAppStore.setState({
        userData: {
            ...emptyUserData,
            supplements: [
                { id: 'first', name: 'Creatina', unit: 'g' },
                { id: 'second', name: 'Magnesio', unit: 'mg' },
            ],
        },
        dataOwner: storageOwner(),
        dispatchDomainOperation: dispatch,
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

        fireEvent.click(within(screen.getByRole('article', { name: 'Creatina' }))
            .getByRole('button', { name: /Aggiungi/ }));
        await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
        expect(dispatch).toHaveBeenNthCalledWith(1, expect.objectContaining({
            type: 'supplement-intake.add',
            date: '2026-09-14',
            intake: expect.objectContaining({ supplementId: 'first', amount: 3 }),
        }));
        await waitFor(() => expect(first.value).toBe(''));
        expect(second.value).toBe('200');

        fireEvent.click(within(screen.getByRole('article', { name: 'Magnesio' }))
            .getByRole('button', { name: /Aggiungi/ }));
        await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));
        expect(dispatch).toHaveBeenNthCalledWith(2, expect.objectContaining({
            type: 'supplement-intake.add',
            date: '2026-09-14',
            intake: expect.objectContaining({ supplementId: 'second', amount: 200 }),
        }));
        await waitFor(() => expect(second.value).toBe(''));
        view.unmount();
    } finally {
        useAppStore.setState({
            userData: previous.userData,
            dataOwner: previous.dataOwner,
            dispatchDomainOperation: previous.dispatchDomainOperation,
        });
    }
});
