import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TrainingPlanning from '../src/components/Training/planning/TrainingPlanning';
import { useAppStore } from '../src/store/useAppStore';
import { useDialogStore } from '../src/store/useDialogStore';
import { update as updateIndexedDb } from 'idb-keyval';
import { DB } from '../src/lib/db';
import { prepareUnlockedTestArchive } from './secureVaultFixture';
import type { UserData } from '../src/types';

const originalDispatch = useAppStore.getState().dispatchDomainOperation;

const userData: UserData = {
    library: [],
    routines: [{ id: 'routine-1', name: 'Scheda A', exercises: [] }],
    trainingCycles: [{
        id: 'cycle-1',
        name: 'Ciclo persistente',
        durationWeeks: 4,
        sessionsPerWeek: 1,
        startDate: '2026-09-01',
        endDate: '2026-09-28',
        routines: [{ routineId: 'routine-1', frequencyPerWeek: 1 }],
        isActive: true
    }],
    activeCycleId: 'cycle-1'
};

describe('audit regression: TrainingPlanning persistence failures', () => {
    const showAlert = vi.mocked(useDialogStore.getState().showAlert);
    const showConfirm = vi.mocked(useDialogStore.getState().showConfirm);
    const dispatchDomainOperation = vi.fn().mockRejectedValue(new Error('write failed'));

    beforeEach(() => {
        showAlert.mockReset();
        showAlert.mockResolvedValue(undefined);
        showConfirm.mockReset();
        showConfirm.mockResolvedValue(true);
        dispatchDomainOperation.mockReset();
        dispatchDomainOperation.mockRejectedValue(new Error('write failed'));
        useAppStore.setState({
            userData: structuredClone(userData),
            dataOwner: 'user:test-user-id',
            localPersistenceBlocked: false,
            compatibilityStatus: 'ok',
            dispatchDomainOperation
        });
        vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    });

    afterEach(() => {
        act(() => {
            useAppStore.setState({ dispatchDomainOperation: originalDispatch, localPersistenceBlocked: false });
        });
        vi.restoreAllMocks();
    });

    it('keeps the editor open and shows retry feedback when saving fails', async () => {
        render(<TrainingPlanning />);

        fireEvent.click(screen.getByTitle('Opzioni'));
        fireEvent.click(screen.getByRole('menuitem', { name: /Modifica/i }));
        expect(screen.getByText(/Modifica ciclo/i)).toBeDefined();
        expect(screen.getByDisplayValue('Ciclo persistente')).toBeDefined();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Salva modifiche/i }));
        });

        await waitFor(() => expect(dispatchDomainOperation).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(showAlert).toHaveBeenCalledWith(
            'Salvataggio del ciclo non riuscito. Le modifiche sono ancora nel form: riprova.'
        ));

        expect(screen.getByText(/Modifica ciclo/i)).toBeDefined();
        expect(screen.getByDisplayValue('Ciclo persistente')).toBeDefined();
    });

    it('keeps the editor open on a resolved but non-durable failure status', async () => {
        dispatchDomainOperation.mockResolvedValueOnce({
            ok: false, status: 'failed', error: new Error('IndexedDB unavailable'),
        });
        render(<TrainingPlanning />);
        fireEvent.click(screen.getByTitle('Opzioni'));
        fireEvent.click(screen.getByRole('menuitem', { name: /Modifica/i }));
        fireEvent.change(screen.getByDisplayValue('Ciclo persistente'), {
            target: { value: 'Modifica non salvata' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Salva modifiche/i }));

        await waitFor(() => expect(showAlert).toHaveBeenCalledWith(
            'Salvataggio del ciclo non riuscito. Le modifiche sono ancora nel form: riprova.'
        ));
        expect(screen.getByDisplayValue('Modifica non salvata')).toBeDefined();
        expect(useAppStore.getState().userData?.trainingCycles?.[0]?.name).toBe('Ciclo persistente');
    });

    it('fails closed after the actual local archive update rejects before cloud sync', async () => {
        await prepareUnlockedTestArchive('user:test-user-id');
        const update = vi.mocked(updateIndexedDb);
        update.mockClear();
        update.mockRejectedValueOnce(new Error('IndexedDB quota exceeded'));
        vi.mocked(DB.saveUserData).mockClear();
        useAppStore.setState({ dispatchDomainOperation: originalDispatch });

        render(<TrainingPlanning />);
        fireEvent.click(screen.getByTitle('Opzioni'));
        fireEvent.click(screen.getByRole('menuitem', { name: /Modifica/i }));
        fireEvent.change(screen.getByDisplayValue('Ciclo persistente'), {
            target: { value: 'Modifica da salvare' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Salva modifiche/i }));
        await act(async () => {
            await useAppStore.getState().flushPendingSyncs();
        });

        await waitFor(() => expect(showAlert).toHaveBeenCalledWith(
            'Salvataggio del ciclo non riuscito. Le modifiche sono ancora nel form: riprova.'
        ));
        expect(update).toHaveBeenCalled();
        expect(DB.saveUserData).not.toHaveBeenCalled();
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(screen.getByDisplayValue('Modifica da salvare')).toBeDefined();
        await expect(useAppStore.getState().dispatchDomainOperation({
            type: 'training-cycle.upsert',
            cycle: userData.trainingCycles![0],
        })).rejects.toThrow('Archivio locale non leggibile');
    });

    it.each(['synced', 'rejected'] as const)(
        'does not close a newly opened editor when an earlier save settles %s',
        async outcome => {
            let resolve!: (value: { ok: true; status: 'synced' }) => void;
            let reject!: (error: Error) => void;
            const pending = new Promise<{ ok: true; status: 'synced' }>((yes, no) => {
                resolve = yes;
                reject = no;
            });
            dispatchDomainOperation.mockReturnValueOnce(pending);
            render(<TrainingPlanning />);

            fireEvent.click(screen.getByTitle('Opzioni'));
            fireEvent.click(screen.getByRole('menuitem', { name: /Modifica/i }));
            fireEvent.click(screen.getByRole('button', { name: /Salva modifiche/i }));
            await waitFor(() => expect(dispatchDomainOperation).toHaveBeenCalledTimes(1));

            fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
            fireEvent.click(screen.getByRole('button', { name: 'Crea ciclo' }));
            fireEvent.change(screen.getByPlaceholderText('Es. Mesociclo ipertrofia 4 giorni'), {
                target: { value: 'Nuovo ciclo in lavorazione' },
            });

            await act(async () => {
                if (outcome === 'synced') resolve({ ok: true, status: 'synced' });
                else reject(new Error('Old save failed'));
                await pending.catch(() => undefined);
            });

            expect(screen.getByDisplayValue('Nuovo ciclo in lavorazione')).toBeDefined();
            expect(screen.getByRole('heading', { name: /Nuovo ciclo/i })).toBeDefined();
            expect(showAlert).not.toHaveBeenCalled();
        },
    );

    it('refuses a planning mutation before IndexedDB when local persistence is blocked', async () => {
        vi.mocked(updateIndexedDb).mockClear();
        useAppStore.setState({
            dispatchDomainOperation: originalDispatch,
            localPersistenceBlocked: true,
        });
        const original = structuredClone(useAppStore.getState().userData);
        render(<TrainingPlanning />);
        fireEvent.click(screen.getByTitle('Opzioni'));
        fireEvent.click(screen.getByRole('menuitem', { name: /Modifica/i }));
        fireEvent.change(screen.getByDisplayValue('Ciclo persistente'), {
            target: { value: 'Mai persistito' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Salva modifiche/i }));

        await waitFor(() => expect(showAlert).toHaveBeenCalledWith(
            'Salvataggio del ciclo non riuscito. Le modifiche sono ancora nel form: riprova.'
        ));
        expect(screen.getByDisplayValue('Mai persistito')).toBeDefined();
        expect(useAppStore.getState().userData).toEqual(original);
        expect(updateIndexedDb).not.toHaveBeenCalled();
    });
    it('serializes duplicate actions on the active-cycle menu until the durable result settles', async () => {
        let finish!: (value: { ok: true; status: 'synced' }) => void;
        const pending = new Promise<{ ok: true; status: 'synced' }>(resolve => { finish = resolve; });
        dispatchDomainOperation.mockReturnValueOnce(pending).mockResolvedValue({ ok: true, status: 'synced' });
        render(<TrainingPlanning />);

        fireEvent.click(screen.getByTitle('Opzioni'));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Duplica' }));
        expect(dispatchDomainOperation).toHaveBeenCalledOnce();
        const deactivate = screen.getByRole('button', { name: 'Disattiva ciclo' }) as HTMLButtonElement;
        expect(deactivate.disabled).toBe(true);
        fireEvent.click(screen.getByTitle('Opzioni'));
        const duplicate = screen.getByRole('menuitem', { name: 'Duplica' }) as HTMLButtonElement;
        expect(duplicate.disabled).toBe(true);
        fireEvent.click(duplicate);
        expect(dispatchDomainOperation).toHaveBeenCalledOnce();

        await act(async () => { finish({ ok: true, status: 'synced' }); await pending; });
        expect(deactivate.disabled).toBe(false);
    });

    it('does not deactivate a different cycle after confirmation was delayed', async () => {
        let confirm!: (accepted: boolean) => void;
        showConfirm.mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
        dispatchDomainOperation.mockResolvedValue({ ok: true, status: 'synced' });
        render(<TrainingPlanning />);
        fireEvent.click(screen.getByRole('button', { name: 'Disattiva ciclo' }));
        expect(showConfirm).toHaveBeenCalledOnce();

        act(() => {
            const data = useAppStore.getState().userData!;
            useAppStore.setState({ userData: {
                ...data,
                trainingCycles: [...data.trainingCycles!, { ...data.trainingCycles![0], id: 'cycle-2', name: 'Altro ciclo', isActive: false }],
                activeCycleId: 'cycle-2',
            } });
        });
        await act(async () => { confirm(true); });
        expect(dispatchDomainOperation).not.toHaveBeenCalled();
        expect(useAppStore.getState().userData?.activeCycleId).toBe('cycle-2');
    });

    it('deletes the confirmed cycle without overwriting a newer active-cycle selection', async () => {
        const original = userData.trainingCycles![0];
        useAppStore.setState({ userData: {
            ...structuredClone(userData),
            trainingCycles: [
                original,
                { ...original, id: 'cycle-2', name: 'Secondo ciclo', isActive: false },
                { ...original, id: 'cycle-3', name: 'Terzo ciclo', isActive: false },
            ],
        } });
        let confirm!: (accepted: boolean) => void;
        showConfirm.mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
        dispatchDomainOperation.mockResolvedValue({ ok: true, status: 'synced' });
        render(<TrainingPlanning />);
        fireEvent.click(screen.getAllByTitle('Opzioni')[0]);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina' }));
        expect(showConfirm).toHaveBeenCalledOnce();

        act(() => {
            const data = useAppStore.getState().userData!;
            useAppStore.setState({ userData: { ...data, activeCycleId: 'cycle-3' } });
        });
        await act(async () => { confirm(true); });
        expect(dispatchDomainOperation).toHaveBeenCalledOnce();
        expect(dispatchDomainOperation).toHaveBeenCalledWith([
            { type: 'training-cycle.delete', id: 'cycle-1' },
        ]);
    });

    it('does not replace a newer unsaved editor after an older edit confirmation', async () => {
        const original = userData.trainingCycles![0];
        useAppStore.setState({ userData: {
            ...structuredClone(userData),
            trainingCycles: [original, { ...original, id: 'cycle-2', name: 'Secondo ciclo', isActive: false }],
        } });
        render(<TrainingPlanning />);
        fireEvent.click(screen.getAllByTitle('Opzioni')[0]);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Modifica' }));
        expect(screen.getByDisplayValue('Ciclo persistente')).toBeDefined();

        let confirm!: (accepted: boolean) => void;
        showConfirm.mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
        fireEvent.click(screen.getAllByTitle('Opzioni')[1]);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Modifica' }));
        expect(showConfirm).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
        fireEvent.click(screen.getByRole('button', { name: 'Crea ciclo' }));
        fireEvent.change(screen.getByPlaceholderText('Es. Mesociclo ipertrofia 4 giorni'), {
            target: { value: 'Nuovo ciclo in lavorazione' },
        });
        await act(async () => { confirm(true); });
        expect(screen.getByRole('heading', { name: /Nuovo ciclo/ })).toBeDefined();
        expect(screen.getByDisplayValue('Nuovo ciclo in lavorazione')).toBeDefined();
        expect(dispatchDomainOperation).not.toHaveBeenCalled();
    });
});
