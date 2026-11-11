import React from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { applyDomainOperations } from '../../src/lib/sync/domainOperations';
import { UserDataSchema } from '../../src/lib/schema';
import { describe, expect, it, vi } from 'vitest';
import { NutritionSupplementIntakes } from '../../src/components/Nutrition/meals/NutritionSupplementIntakes';
import NutritionSupplements from '../../src/components/Nutrition/NutritionSupplements';
import { useDialogStore } from '../../src/store/useDialogStore';
import { storageOwner, invalidateSession } from '../../src/lib/sync/session';
import { useSupplements } from '../../src/hooks/useSupplements';
import { useAppStore } from '../../src/store/useAppStore';
import { emptyUserData } from '../setup';

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
    it('rejects a stale delete confirmation after a different Auth epoch, even with the same supplement ID', async () => {
        const previous = useAppStore.getState();
        const confirm = vi.mocked(useDialogStore.getState().showConfirm);
        const originalConfirmImpl = confirm.getMockImplementation();
        confirm.mockClear();
        let finish!: (confirmed: boolean) => void;
        confirm.mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve; }));
        const dispatch = vi.fn().mockResolvedValue({ ok: true, status: 'synced' });
        useAppStore.setState({
            userData: { ...emptyUserData, supplements: [{ id: 'shared', name: 'Creatina A', unit: 'g' }] },
            dataOwner: storageOwner(), dispatchDomainOperation: dispatch,
        });
        try {
            render(<NutritionSupplements selectedDate="2026-09-14" />);
            fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
            fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina' }));
            expect(confirm).toHaveBeenCalledOnce();
            act(() => {
                invalidateSession();
                invalidateSession();
                useAppStore.setState({
                    userData: { ...emptyUserData, supplements: [{ id: 'shared', name: 'Creatina B', unit: 'g' }] },
                });
            });
            await act(async () => { finish(true); });
            expect(dispatch).not.toHaveBeenCalled();
            expect(screen.getByText('Creatina B')).toBeDefined();
        } finally {
            useAppStore.setState({
                userData: previous.userData, dataOwner: previous.dataOwner,
                dispatchDomainOperation: previous.dispatchDomainOperation,
            });
            confirm.mockReset();
            if (originalConfirmImpl) confirm.mockImplementation(originalConfirmImpl);
            else confirm.mockResolvedValue(true);
        }
    });

    it.each(['supplement', 'intake'] as const)(
        'does not show stale %s deletion errors after the Auth epoch changes', async target => {
            const previous = useAppStore.getState();
            const dialogAlert = vi.mocked(useDialogStore.getState().showAlert);
            let reject!: (reason: Error) => void;
            const pending = new Promise<never>((_, rejectPromise) => { reject = rejectPromise; });
            const dispatch = vi.fn(() => pending);
            useAppStore.setState({ dispatchDomainOperation: dispatch as typeof previous.dispatchDomainOperation });
            dialogAlert.mockClear();
            try {
                const { result } = renderHook(() => useSupplements('2026-09-14'));
                let removing!: Promise<void>;
                act(() => {
                    removing = target === 'supplement'
                        ? result.current.deleteSupplementFromLibrary('shared')
                        : result.current.removeIntake('intake-shared');
                });
                expect(dispatch).toHaveBeenCalledOnce();
                act(() => { invalidateSession(); invalidateSession(); });
                await act(async () => { reject(new Error('failed old write')); await removing; });
                expect(dialogAlert).not.toHaveBeenCalled();
            } finally {
                useAppStore.setState({ dispatchDomainOperation: previous.dispatchDomainOperation });
            }
        },
    );

    it('does not treat a resolved but rejected supplement commit as successful', async () => {
        const previous = useAppStore.getState().dispatchDomainOperation;
        const dispatch = vi.fn().mockResolvedValue({ ok: false, status: 'failed', error: new Error('IDB unavailable') });
        useAppStore.setState({ dispatchDomainOperation: dispatch });
        try {
            const { result } = renderHook(() => useSupplements('2026-09-14'));
            await act(async () => {
                await expect(result.current.saveSupplementToLibrary({ name: 'Creatina', unit: 'g', target: 5 })).rejects.toThrow('IDB unavailable');
            });
            await act(async () => {
                await expect(result.current.addIntake('one', 3)).rejects.toThrow('IDB unavailable');
            });
            expect(dispatch).toHaveBeenCalledTimes(2);
        } finally {
            useAppStore.setState({ dispatchDomainOperation: previous });
        }
    });

    it('rejects invalid supplement doses and intake amounts at the domain boundary', () => {
        const empty = UserDataSchema.parse({});
        for (const target of [-2, 0, Infinity]) {
            expect(() => applyDomainOperations(empty, {
                type: 'supplement.upsert',
                supplement: { id: 's', name: 'Creatina', unit: 'g', target },
            })).toThrow(/dosi/i);
        }
        for (const amount of [0, -2, NaN, Infinity]) {
            expect(() => applyDomainOperations(empty, {
                type: 'supplement-intake.upsert',
                date: '2026-09-14',
                intake: { id: 'i', supplementId: 's', amount, time: 1 },
            })).toThrow(/quantit/i);
        }
    });

    it('keeps the supplement form open on a rejected device commit', async () => {
        const previous = useAppStore.getState();
        const dispatch = vi.fn().mockResolvedValue({ ok: false, status: 'failed', error: new Error('storage unavailable') });
        useAppStore.setState({ userData: { ...emptyUserData, supplements: [] }, dataOwner: storageOwner(), dispatchDomainOperation: dispatch });
        vi.mocked(useDialogStore.getState().showAlert).mockClear();
        try {
            render(<NutritionSupplements selectedDate="2026-09-14" />);
            fireEvent.click(screen.getByRole('button', { name: /Nuovo integratore/ }));
            fireEvent.change(screen.getByLabelText('Nome integratore'), { target: { value: 'Creatina' } });
            fireEvent.change(screen.getByLabelText('Dose target giornaliera'), { target: { value: '5' } });
            fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
            await waitFor(() => expect(useDialogStore.getState().showAlert).toHaveBeenCalled());
            expect(screen.getByRole('heading', { name: 'Crea nuovo integratore' })).toBeDefined();
            expect((screen.getByLabelText('Nome integratore') as HTMLInputElement).value).toBe('Creatina');
            expect(dispatch).toHaveBeenCalledTimes(1);
        } finally {
            useAppStore.setState({ userData: previous.userData, dataOwner: previous.dataOwner, dispatchDomainOperation: previous.dispatchDomainOperation });
        }
    });

    it('retains a quick intake amount when its durable operation is rejected', async () => {
        const previous = useAppStore.getState();
        const dispatch = vi.fn().mockResolvedValue({ ok: false, status: 'failed', error: new Error('storage unavailable') });
        useAppStore.setState({
            userData: { ...emptyUserData, supplements: [{ id: 'creatine', name: 'Creatina', unit: 'g', portion: 5 }] },
            dataOwner: storageOwner(), dispatchDomainOperation: dispatch,
        });
        vi.mocked(useDialogStore.getState().showAlert).mockClear();
        try {
            render(<NutritionSupplements selectedDate="2026-09-14" />);
            const input = screen.getByRole('spinbutton', { name: 'Quantità assunzione Creatina' }) as HTMLInputElement;
            fireEvent.change(input, { target: { value: '3' } });
            fireEvent.click(screen.getByRole('button', { name: /Aggiungi/ }));
            await waitFor(() => expect(useDialogStore.getState().showAlert).toHaveBeenCalled());
            expect(input.value).toBe('3');
            expect(dispatch).toHaveBeenCalledTimes(1);
        } finally {
            useAppStore.setState({ userData: previous.userData, dataOwner: previous.dataOwner, dispatchDomainOperation: previous.dispatchDomainOperation });
        }
    });

});
