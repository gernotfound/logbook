import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import NutritionFoodArchive from '../../src/components/Nutrition/NutritionFoodArchive';
import { useAppStore } from '../../src/store/useAppStore';
import { useDialogStore } from '../../src/store/useDialogStore';
import { invalidateSession } from '../../src/lib/sync/session';
import { createMockUserData, renderWithAuthenticatedTestOwner } from '../setup';
import type { SyncResult } from '../../src/types';
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
    it('refuses deletion of an unidentified food without opening confirmation or dispatching', async () => {
        await prepareUnlockedTestArchive();
        const food = { name: 'Senza ID', unit: 'g', baseQty: 100, kcal: 100, carbs: 10, pro: 10, fat: 1 };
        const previousDispatch = useAppStore.getState().dispatchDomainOperation;
        const dispatch = vi.fn(previousDispatch);
        const showConfirm = vi.mocked(useDialogStore.getState().showConfirm);
        const showAlert = vi.mocked(useDialogStore.getState().showAlert);
        showConfirm.mockClear();
        showAlert.mockClear();
        useAppStore.setState({ dispatchDomainOperation: dispatch });
        try {
            renderWithAuthenticatedTestOwner(<NutritionFoodArchive />, {
                userData: createMockUserData({ customFoods: [food] }),
            });
            fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
            await act(async () => {
                fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina' }));
            });
            expect(showConfirm).not.toHaveBeenCalled();
            expect(dispatch).not.toHaveBeenCalled();
            expect(showAlert).toHaveBeenCalledWith('Impossibile eliminare un alimento senza identificativo valido.');
        } finally {
            useAppStore.setState({ dispatchDomainOperation: previousDispatch });
        }
    });

    it('keeps the edit draft open when a successful durable commit finishes in a replaced auth epoch', async () => {
        await prepareUnlockedTestArchive();
        const food = {
            id: 'cf-edit', name: 'Riso', unit: 'g',
            baseQty: 100, kcal: 365, carbs: 80, pro: 7, fat: 1,
        };
        const previousDispatch = useAppStore.getState().dispatchDomainOperation;
        let complete!: (value: SyncResult) => void;
        const dispatch = vi.fn(() => new Promise<SyncResult>(resolve => { complete = resolve; }));
        const showAlert = vi.mocked(useDialogStore.getState().showAlert);
        showAlert.mockClear();
        useAppStore.setState({ dispatchDomainOperation: dispatch });
        try {
            renderWithAuthenticatedTestOwner(<NutritionFoodArchive />, {
                userData: createMockUserData({ customFoods: [food] }),
            });
            fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
            fireEvent.click(screen.getByRole('menuitem', { name: 'Modifica' }));
            expect(screen.getByRole('heading', { name: 'Modifica alimento' })).toBeDefined();
            fireEvent.click(screen.getByRole('button', { name: 'Salva modifiche' }));
            expect(dispatch).toHaveBeenCalledOnce();
            act(() => { invalidateSession(); invalidateSession(); });
            await act(async () => {
                complete({ ok: true, status: 'synced' });
            });
            expect(screen.getByRole('heading', { name: 'Modifica alimento' })).toBeDefined();
            expect(showAlert).not.toHaveBeenCalled();
        } finally {
            useAppStore.setState({ dispatchDomainOperation: previousDispatch });
        }
    });

});
