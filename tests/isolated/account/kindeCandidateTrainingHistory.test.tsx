import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { useKindeCandidateFitnessLifecycle } from '../../../src/contexts/auth/useKindeCandidateFitnessLifecycle';
import { KindeCandidateTrainingHistory } from '../../../src/components/Training/KindeCandidateTrainingHistory';
import { useAppStore } from '../../../src/store/useAppStore';
import { useDialogStore } from '../../../src/store/useDialogStore';
import type { KindeCandidateFitnessSnapshot } from '../../../src/lib/auth/kindeCandidateFitnessRealm';
import type { WorkoutSession } from '../../../src/types';

const accountWorkout: WorkoutSession = {
    id: 'account-workout', date: '2026-11-20', routineName: 'Sessione account',
    globalStartTime: Date.UTC(2026, 10, 20, 11), globalEndTime: Date.UTC(2026, 10, 20, 11, 45),
    exercises: [{ id: 'account-ex-instance', exId: 'account-ex', sessionNote: '', sets: [
        { id: 'account-set', kg: '40', reps: '10', done: true },
    ] }],
};
const otherWorkout: WorkoutSession = {
    id: 'other-owner', date: '2026-11-20', routineName: 'Sessione privata estranea', exercises: [],
};
const uid = 'k_' + 'U'.repeat(43);
const account: KindeCandidateFitnessSnapshot = {
    owner: 'user:' + uid,
    principal: { uid, fenceEpoch: 1, healthConsentRevision: 1 },
    data: {
        history: [accountWorkout],
        library: [{ id: 'account-ex', name: 'Squat autorizzato', setsCount: 1, sets: [] }],
    },
};

function candidate(phase: 'ready' | 'closed') {
    return {
        state: phase === 'ready'
            ? { phase, snapshot: account, view: {}, hasPendingJournal: false }
            : { phase },
        submit: vi.fn().mockResolvedValue({ kind: 'cloud-acknowledged', operations: 1 }),
        captureEditWitness: () => phase === 'ready'
            ? { owner: account.owner, isCurrent: () => true }
            : null,
    } as unknown as ReturnType<typeof useKindeCandidateFitnessLifecycle>;
}

beforeEach(() => { vi.mocked(useDialogStore.getState().showConfirm).mockReset(); });
afterEach(() => { cleanup(); });

describe('Kinde training history: owner-scoped presentation and deletion', () => {
    it('offers the account editor and keeps legacy owner data and writers separate', () => {
        const oldData = useAppStore.getState().userData;
        const oldOwner = useAppStore.getState().dataOwner;
        const oldDispatch = useAppStore.getState().dispatchDomainOperation;
        const oldWriter = vi.fn();
        useAppStore.setState({
            dataOwner: 'guest',
            userData: { history: [otherWorkout] },
            dispatchDomainOperation: oldWriter as typeof oldDispatch,
        });
        try {
            const { rerender } = render(<KindeCandidateTrainingHistory realm={candidate('ready')} />);
            expect(screen.getByRole('heading', { name: 'Storico allenamenti' })).toBeDefined();
            expect(screen.getByText('Sessione account')).toBeDefined();
            expect(screen.queryByText('Sessione privata estranea')).toBeNull();

            fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
            expect(screen.getByRole('menuitem', { name: 'Vedi report' })).toBeDefined();
            expect(screen.getByRole('menuitem', { name: 'Modifica allenamento' })).toBeDefined();
            expect(screen.getByRole('menuitem', { name: 'Elimina allenamento' })).toBeDefined();
            fireEvent.click(screen.getByRole('menuitem', { name: 'Vedi report' }));
            expect(screen.getByRole('dialog', { name: 'Sessione account' })).toBeDefined();
            expect(screen.getByText('Squat autorizzato')).toBeDefined();
            expect(oldWriter).not.toHaveBeenCalled();

            rerender(<KindeCandidateTrainingHistory realm={candidate('closed')} />);
            expect(screen.queryByRole('dialog')).toBeNull();
            expect(screen.queryByRole('heading', { name: 'Storico allenamenti' })).toBeNull();
            expect(oldWriter).not.toHaveBeenCalled();
        } finally {
            useAppStore.setState({ dataOwner: oldOwner, userData: oldData, dispatchDomainOperation: oldDispatch });
        }
    });

    it('shows only an empty history for a newly consented account', () => {
        const realm = {
            state: { phase: 'ready', snapshot: { ...account, data: { history: [] } } },
        } as unknown as ReturnType<typeof useKindeCandidateFitnessLifecycle>;
        render(<KindeCandidateTrainingHistory realm={realm} />);
        expect(screen.getByText('Nessun allenamento in questo giorno.')).toBeDefined();
        expect(screen.queryByRole('button', { name: 'Opzioni' })).toBeNull();
    });
    it('requires confirmation and submits exactly one owner-scoped history deletion', async () => {
        const confirm = vi.mocked(useDialogStore.getState().showConfirm);
        confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        const realm = candidate('ready');
        render(<KindeCandidateTrainingHistory realm={realm} />);
        fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina allenamento' }));
        await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
        expect(realm.submit).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina allenamento' }));
        await waitFor(() => expect(realm.submit).toHaveBeenCalledTimes(1));
        expect(realm.submit).toHaveBeenCalledWith({ type: 'history.delete', id: accountWorkout.id });
    });

    it('rejects a confirmation from a revoked owner or session fence', async () => {
        let confirmDeletion!: (value: boolean) => void;
        vi.mocked(useDialogStore.getState().showConfirm)
            .mockImplementationOnce(() => new Promise<boolean>(resolve => { confirmDeletion = resolve; }));
        let current = true;
        const realm = candidate('ready');
        realm.captureEditWitness = () => ({ owner: account.owner, isCurrent: () => current });
        render(<KindeCandidateTrainingHistory realm={realm} />);
        fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina allenamento' }));
        expect(realm.submit).not.toHaveBeenCalled();

        current = false;
        await act(async () => { confirmDeletion(true); });
        expect(realm.submit).not.toHaveBeenCalled();
    });

    it('does not repeat an intent while a pending cloud receipt is unresolved', async () => {
        let finish!: (value: { kind: 'local-pending'; pendingCount: number }) => void;
        const realm = candidate('ready');
        vi.mocked(realm.submit).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValue(true);
        render(<KindeCandidateTrainingHistory realm={realm} />);
        fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina allenamento' }));
        await waitFor(() => expect(realm.submit).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina allenamento' }));
        expect(realm.submit).toHaveBeenCalledTimes(1);

        await act(async () => { finish({ kind: 'local-pending', pendingCount: 1 }); });
        expect(realm.submit).toHaveBeenCalledTimes(1);
        expect(useDialogStore.getState().showAlert).not.toHaveBeenCalled();
    });

    it('reports a failed deletion only while the same owner fence is current', async () => {
        const realm = candidate('ready');
        vi.mocked(realm.submit).mockRejectedValueOnce(new Error('synthetic failure'));
        vi.mocked(useDialogStore.getState().showConfirm).mockResolvedValueOnce(true);
        render(<KindeCandidateTrainingHistory realm={realm} />);
        fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina allenamento' }));
        await waitFor(() => expect(useDialogStore.getState().showAlert).toHaveBeenCalledWith(
            "Errore durante l'eliminazione dell'allenamento.",
        ));
        expect(realm.submit).toHaveBeenCalledTimes(1);
    });

});
