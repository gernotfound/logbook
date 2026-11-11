import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import NutritionFoodArchive from '../../src/components/Nutrition/NutritionFoodArchive';
import { useAppStore } from '../../src/store/useAppStore';
import { useDialogStore } from '../../src/store/useDialogStore';
import { invalidateSession } from '../../src/lib/sync/session';
import { createMockUserData, renderWithAuthenticatedTestOwner } from '../setup';
import { prepareUnlockedTestArchive } from '../secureVaultFixture';

describe('nutrition food archive owner isolation', () => {
    it('does not delete a food after the confirmation crosses an auth session transition', async () => {
        await prepareUnlockedTestArchive();
        const food = { id: 'cf-original', name: 'Riso', unit: 'g',
            baseQty: 100, kcal: 365, carbs: 80, pro: 7, fat: 1 };
        const data = createMockUserData({ customFoods: [food] });
        const previousDispatch = useAppStore.getState().dispatchDomainOperation;
        const dispatch = vi.fn(previousDispatch);
        useAppStore.setState({ dispatchDomainOperation: dispatch });
        vi.mocked(useDialogStore.getState().showConfirm).mockImplementationOnce(async () => {
            // The next session can still resolve to the same UID and food ID.
            invalidateSession();
            return true;
        });

        try {
            renderWithAuthenticatedTestOwner(<NutritionFoodArchive />, { userData: data });
            fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
            await act(async () => {
                fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina' }));
            });
            expect(useDialogStore.getState().showConfirm).toHaveBeenCalledOnce();
            expect(dispatch).not.toHaveBeenCalled();
            expect(useAppStore.getState().userData?.customFoods?.some(item => item.id === food.id)).toBe(true);
        } finally {
            useAppStore.setState({ dispatchDomainOperation: previousDispatch });
        }
    });
});
