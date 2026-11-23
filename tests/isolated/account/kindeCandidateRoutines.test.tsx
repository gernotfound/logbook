import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { useKindeCandidateFitnessLifecycle } from '../../../src/contexts/auth/useKindeCandidateFitnessLifecycle';
import type { KindeCandidateFitnessSnapshot } from '../../../src/lib/auth/kindeCandidateFitnessRealm';
import { KindeCandidateRoutines } from '../../../src/components/Training/KindeCandidateRoutines';
import { RoutineLibraryList } from '../../../src/components/Training/routines/RoutineLibraryList';
import { useAppStore } from '../../../src/store/useAppStore';
import { useDialogStore } from '../../../src/store/useDialogStore';

const uid = 'k_' + 'U'.repeat(43);
const account: KindeCandidateFitnessSnapshot = {
    owner: 'user:' + uid,
    principal: { uid, fenceEpoch: 1, healthConsentRevision: 1 },
    data: {
        routines: [{
            id: 'same-id', name: 'Scheda account',
            exercises: [{ exId: 'account-ex', setsCount: 3, minReps: 6, maxReps: 10 }],
        }],
        library: [{
            id: 'account-ex', name: 'Squat Kinde', setsCount: 3,
            muscles: [], secondaryMuscles: [], sets: [],
        }],
    },
};
function candidate(phase: 'ready' | 'closed') {
    return {
        state: phase === 'ready'
            ? { phase, snapshot: account, view: {}, hasPendingJournal: false }
            : { phase },
        submit: vi.fn().mockResolvedValue({ kind: 'cloud-acknowledged' }),
        captureEditWitness: () => phase === 'ready'
            ? { owner: account.owner, isCurrent: () => true }
            : null,
    } as unknown as ReturnType<typeof useKindeCandidateFitnessLifecycle>;
}

beforeEach(() => {
    vi.mocked(useDialogStore.getState().showConfirm).mockClear();
});
afterEach(() => { cleanup(); });

describe('Kinde routine library: verified owner boundary', () => {
    it('uses only the ready account snapshot and never invokes the guest writer', () => {
        const initial = useAppStore.getState();
        const oldWriter = vi.fn();
        useAppStore.setState({
            dataOwner: 'guest',
            userData: {
                routines: [{ id: 'same-id', name: 'Scheda guest estranea', exercises: [] }],
                library: [],
            },
            dispatchDomainOperation: oldWriter as typeof initial.dispatchDomainOperation,
        });
        try {
            const { rerender } = render(<KindeCandidateRoutines realm={candidate('ready')} />);
            const library = screen.getByRole('region', { name: 'Schede allenamento account' });
            expect(screen.getByText('Scheda account')).toBeDefined();
            expect(screen.queryByText('Scheda guest estranea')).toBeNull();
            expect(screen.getByRole('button', { name: 'Crea o riprendi scheda' })).toBeDefined();
            fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
            expect(screen.getByRole('menuitem', { name: 'Modifica' })).toBeDefined();
            expect(screen.getByRole('menuitem', { name: 'Duplica' })).toBeDefined();
            expect(screen.getByRole('menuitem', { name: 'Elimina' })).toBeDefined();
            fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));

            fireEvent.click(screen.getByRole('button', { name: /Apri scheda/ }));
            expect(screen.getByText('Squat Kinde')).toBeDefined();
            expect(screen.getByText('3 × 6–10')).toBeDefined();

            fireEvent.change(screen.getByRole('searchbox', { name: 'Cerca scheda per nome' }),
                { target: { value: 'inesistente' } });
            expect(screen.getByText('Nessuna scheda trovata.')).toBeDefined();
            fireEvent.click(screen.getByRole('button', { name: 'Cancella ricerca' }));
            expect(screen.getByText('Scheda account')).toBeDefined();
            expect(oldWriter).not.toHaveBeenCalled();

            rerender(<KindeCandidateRoutines realm={candidate('closed')} />);
            expect(screen.queryByRole('region', { name: 'Schede allenamento account' })).toBeNull();
            expect(oldWriter).not.toHaveBeenCalled();
            expect(library.isConnected).toBe(false);
        } finally {
            useAppStore.setState({
                dataOwner: initial.dataOwner,
                userData: initial.userData,
                dispatchDomainOperation: initial.dispatchDomainOperation,
            });
        }
    });

    it('shows a clean empty account when no routines exist', () => {
        const realm = {
            state: { phase: 'ready', snapshot: { ...account, data: { routines: [] } } },
        } as unknown as ReturnType<typeof useKindeCandidateFitnessLifecycle>;
        render(<KindeCandidateRoutines realm={realm} />);
        expect(screen.getByText('Nessuna scheda creata.')).toBeDefined();
        expect(screen.queryByRole('button', { name: 'Opzioni' })).toBeNull();
    });

    it('duplicates only the account routine through one Kinde journal intent', async () => {
        const realm = candidate('ready');
        render(<KindeCandidateRoutines realm={realm} />);
        fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Duplica' }));

        await waitFor(() => expect(realm.submit).toHaveBeenCalledTimes(1));
        expect(realm.submit).toHaveBeenCalledWith({
            type: 'routine.upsert',
            routine: expect.objectContaining({
                id: expect.stringMatching(/^rtn_/),
                name: 'Scheda account - 1',
                exercises: account.data.routines![0].exercises,
            }),
        });
        const operation = vi.mocked(realm.submit).mock.calls[0][0] as { routine: { id: string } };
        expect(operation.routine.id).not.toBe(account.data.routines![0].id);
    });

    it('rejects a confirmation resolved after the account witness was revoked', async () => {
        let approve!: (value: boolean) => void;
        const confirm = vi.mocked(useDialogStore.getState().showConfirm);
        confirm.mockImplementationOnce(() => new Promise<boolean>(resolve => { approve = resolve; }));
        const realm = candidate('ready');
        let valid = true;
        realm.captureEditWitness = () => ({ owner: account.owner, isCurrent: () => valid });
        render(<KindeCandidateRoutines realm={realm} />);
        fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina' }));
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(realm.submit).not.toHaveBeenCalled();
        valid = false;
        await act(async () => { approve(true); });
        expect(realm.submit).not.toHaveBeenCalled();
    });

    it('requires explicit confirmation and submits deletion only for the current owner', async () => {
        const confirm = vi.mocked(useDialogStore.getState().showConfirm);
        confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        const realm = candidate('ready');
        render(<KindeCandidateRoutines realm={realm} />);
        fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina' }));
        await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
        expect(realm.submit).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina' }));
        await waitFor(() => expect(realm.submit).toHaveBeenCalledTimes(1));
        expect(realm.submit).toHaveBeenCalledWith({ type: 'routine.delete', id: 'same-id' });
    });

    it('keeps pending receipt status under realm ownership and does not re-submit intent', async () => {
        let finish!: (outcome: { kind: 'local-pending'; pendingCount: number }) => void;
        const realm = candidate('ready');
        vi.mocked(realm.submit).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        render(<KindeCandidateRoutines realm={realm} />);
        fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Duplica' }));
        fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Duplica' }));
        expect(realm.submit).toHaveBeenCalledTimes(1);
        await act(async () => finish({ kind: 'local-pending', pendingCount: 1 }));
        expect(realm.submit).toHaveBeenCalledTimes(1);
    });

    it('preserves the existing guest edit/duplicate/delete callbacks in the shared list', () => {
        const edit = vi.fn(), duplicate = vi.fn(), remove = vi.fn();
        const routine = account.data.routines![0];
        render(<RoutineLibraryList
            routines={[routine]} library={account.data.library!}
            expandedRoutineId={null} onToggleExpand={vi.fn()}
            searchQuery="" onSearchQueryChange={vi.fn()}
            onEdit={edit} onDuplicate={duplicate} onDelete={remove}
        />);
        fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Modifica' }));
        expect(edit).toHaveBeenCalledWith(routine);

        fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Duplica' }));
        expect(duplicate).toHaveBeenCalledWith(routine, expect.any(Object));

        fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Elimina' }));
        expect(remove).toHaveBeenCalledWith(routine.id, expect.any(Object));
    });
});
