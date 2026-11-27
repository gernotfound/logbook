import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { browserWitness, confirmed, principal, REPLACEMENT_CSRF } from './KindeAccountEntryTestFixture';
import { KindeAccountEntry } from './KindeAccountEntry';
import { readKindeCandidateIdentity } from '../../lib/auth/kindeCandidateIdentity';
import { readKindeCandidateAccess } from '../../lib/auth/kindeCandidateClient';
import { inspectKindeCandidateReplicaRegistry } from '../../lib/sync/kindeCandidateReplicaRegistry';
import { retireKindeCandidateReplica, recoverKindeCandidateReplicaRetirement } from '../../lib/sync/kindeCandidateReplicaRetirementBridge';
import {
    inspectKindeCandidatePendingReplicaMutation, cancelKindeCandidatePendingReplicaMutation,
} from '../../lib/sync/kindeCandidateReplicaCancellationBridge';
import { prepareKindeCandidateOwner } from '../../lib/sync/kindeCandidateOwnerBootstrap';
import { inspectKindeCandidateOfflineReplicaJournal } from '../../lib/sync/kindeCandidateOfflineReplicaJournal';

vi.mock('../../lib/sync/kindeCandidateReplicaRegistry', () => ({
    inspectKindeCandidateReplicaRegistry: vi.fn(),
}));
vi.mock('../../lib/sync/kindeCandidateReplicaRetirementBridge', () => ({
    retireKindeCandidateReplica: vi.fn(), recoverKindeCandidateReplicaRetirement: vi.fn(),
}));
vi.mock('../../lib/sync/kindeCandidateReplicaCancellationBridge', () => ({
    inspectKindeCandidatePendingReplicaMutation: vi.fn(), cancelKindeCandidatePendingReplicaMutation: vi.fn(),
}));
vi.mock('../../lib/sync/kindeCandidateOfflineReplicaJournal', () => ({
    inspectKindeCandidateOfflineReplicaJournal: vi.fn(),
}));

const registry = {
    kind: 'replica-registry-observed' as const,
    control: { uid: principal.uid, revision: 5, fenceEpoch: 1, consentRevision: 1,
        replicas: { s04: { status: 'active' as const, replicaId: 'replica-05', generation: 2,
            leaseUntilMs: 1_800_000_000_000, checkpointAtMs: 1_790_000_000_000,
            lastSeq: 13, checkpointClock: { s04: 13 } } },
    },
};

function authenticated() {
    vi.mocked(readKindeCandidateIdentity).mockResolvedValue({
        kind: 'email-verified', principal: { ...principal, healthConsentRevision: 1 },
    });
    vi.mocked(readKindeCandidateAccess).mockResolvedValue(confirmed);
    vi.mocked(inspectKindeCandidateReplicaRegistry).mockResolvedValue(registry);
    vi.mocked(retireKindeCandidateReplica).mockResolvedValue('retired');
    vi.mocked(recoverKindeCandidateReplicaRetirement).mockResolvedValue('idle');
    vi.mocked(inspectKindeCandidatePendingReplicaMutation).mockResolvedValue(null);
    vi.mocked(cancelKindeCandidatePendingReplicaMutation).mockResolvedValue('cancelled');
    vi.mocked(inspectKindeCandidateOfflineReplicaJournal).mockResolvedValue({ kind: 'no-pending' });
}

describe('candidate-only replica registry presentation', () => {
    it('does not expose registry inspection in public identity-only or guest mode', async () => {
        authenticated();
        const publicEntry = render(<KindeAccountEntry identityOnly />);
        await screen.findByText(/Sessione Kinde verificata/);
        expect(screen.queryByRole('button', { name: 'Consulta il registro' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Controlla modifiche offline su questo dispositivo' })).toBeNull();
        publicEntry.unmount();

        render(<KindeAccountEntry guestArchivePresent candidateMode="preparation" />);
        await screen.findByText(/archivio ospite/);
        expect(screen.queryByRole('button', { name: 'Consulta il registro' })).toBeNull();
        expect(inspectKindeCandidateReplicaRegistry).not.toHaveBeenCalled();
        expect(inspectKindeCandidateOfflineReplicaJournal).not.toHaveBeenCalled();
    });

    it('shows a retired offline journal as blocked without offering a claim or deleting edits', async () => {
        authenticated();
        vi.mocked(inspectKindeCandidateOfflineReplicaJournal).mockResolvedValue({
            kind: 'retired-pending', slot: 's04', generation: 2, reason: 'replaced', pendingOperations: 3,
        });
        render(<KindeAccountEntry candidateMode="preparation" />);
        fireEvent.click(await screen.findByRole('button', {
            name: 'Controlla modifiche offline su questo dispositivo',
        }));
        await screen.findByText(/3 operazioni restano nel journal locale senza ACK verificato/);
        expect(screen.getByText(/non tentare di riattribuire automaticamente/)).toBeTruthy();
        expect(inspectKindeCandidateOfflineReplicaJournal).toHaveBeenCalledWith({
            expected: { uid: principal.uid, fenceEpoch: 1, healthConsentRevision: 1 },
            stillCurrent: expect.any(Function),
        });
        expect(prepareKindeCandidateOwner).not.toHaveBeenCalled();
        expect(retireKindeCandidateReplica).not.toHaveBeenCalled();
    });

    it('does not present an unreadable offline vault as an empty journal', async () => {
        authenticated();
        vi.mocked(inspectKindeCandidateOfflineReplicaJournal).mockRejectedValueOnce(new Error('vault unavailable'));
        render(<KindeAccountEntry candidateMode="preparation" />);
        const button = await screen.findByRole('button', {
            name: 'Controlla modifiche offline su questo dispositivo',
        });
        fireEvent.click(button);
        await screen.findByText(/Non è possibile verificare il journal locale/);
        expect(screen.queryByText(/Nessuna operazione nel journal/)).toBeNull();
        fireEvent.click(button);
        await screen.findByText(/Nessuna operazione nel journal di sincronizzazione/);
    });

    it('shows technical membership without inventing device names or online state', async () => {
        authenticated();
        render(<KindeAccountEntry candidateMode="preparation" />);
        const button = await screen.findByRole('button', { name: 'Consulta il registro' });
        expect(screen.queryByText(/Replica s04/)).toBeNull();
        fireEvent.click(button);
        await screen.findByText(/Replica s04 · generazione 2/);
        expect(screen.getByText(/replica contrassegnata attiva/)).toBeTruthy();
        expect(screen.getByText(/non dimostra che un dispositivo sia online/)).toBeTruthy();
        expect(screen.queryByText('replica-05')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Prepara ritiro replica s04' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Conferma ritiro replica s04' })).toBeNull();
        expect(prepareKindeCandidateOwner).not.toHaveBeenCalled();
        expect(inspectKindeCandidateReplicaRegistry).toHaveBeenCalledTimes(1);
        expect(vi.mocked(inspectKindeCandidateReplicaRegistry).mock.calls[0][0].expected)
            .toMatchObject({ uid: principal.uid, fenceEpoch: 1, healthConsentRevision: 1 });
    });

    it('requires an explicit warning confirmation for the exact observed incarnation', async () => {
        authenticated();
        render(<KindeAccountEntry candidateMode="preparation" />);
        fireEvent.click(await screen.findByRole('button', { name: 'Consulta il registro' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Prepara ritiro replica s04' }));
        const action = screen.getByRole('button', { name: 'Conferma ritiro replica s04' });
        expect((action as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText(/rimaste soltanto offline/)).toBeTruthy();
        expect(retireKindeCandidateReplica).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('checkbox', { name: /Confermo di voler ritirare/ }));
        expect((action as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(action);
        await screen.findByText(/Il ritiro è stato verificato sul registro/);
        expect(retireKindeCandidateReplica).toHaveBeenCalledWith({
            expected: { uid: principal.uid, fenceEpoch: 1, healthConsentRevision: 1 },
            witness: { slot: 's04', replicaId: 'replica-05', generation: 2, lastSeq: 13,
                checkpointAtMs: 1_790_000_000_000, leaseUntilMs: 1_800_000_000_000 },
            stillCurrent: expect.any(Function),
        });
        expect(screen.queryByText(/Replica s04 · generazione/)).toBeNull();
    });

    it('preserves uncertainty on lost response and requires explicit recovery after reload', async () => {
        authenticated();
        vi.mocked(retireKindeCandidateReplica).mockRejectedValueOnce(new Error('lost response'));
        vi.mocked(recoverKindeCandidateReplicaRetirement).mockResolvedValueOnce('reconciliation-required');
        render(<KindeAccountEntry candidateMode="preparation" />);
        fireEvent.click(await screen.findByRole('button', { name: 'Consulta il registro' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Prepara ritiro replica s04' }));
        fireEvent.click(screen.getByRole('checkbox', { name: /Confermo di voler ritirare/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Conferma ritiro replica s04' }));
        await screen.findByText(/La richiesta potrebbe essere già stata salvata o inviata/);
        expect(screen.queryByRole('button', { name: 'Conferma ritiro replica s04' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Verifica una richiesta di ritiro in sospeso' }));
        await screen.findByText(/Ritiro ancora da riconciliare/);
        expect(recoverKindeCandidateReplicaRetirement).toHaveBeenCalledTimes(1);
        expect(retireKindeCandidateReplica).toHaveBeenCalledTimes(1);
    });

    it('inspects the sealed claim before requiring confirmation of its exact mutation ID', async () => {
        authenticated();
        vi.mocked(inspectKindeCandidatePendingReplicaMutation).mockResolvedValue({
            kind: 'claim', mutationId: 'claim-123', slot: null, generation: null, cancellationRequested: false,
        });
        render(<KindeAccountEntry candidateMode="preparation" />);
        fireEvent.click(await screen.findByRole('button', { name: 'Esamina una richiesta da annullare' }));
        await screen.findByText(/Riferimento operazione:/);
        expect(screen.getByText('claim-123')).toBeTruthy();
        const action = screen.getByRole('button', { name: 'Conferma annullamento richiesta' });
        expect((action as HTMLButtonElement).disabled).toBe(true);
        expect(cancelKindeCandidatePendingReplicaMutation).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('checkbox', { name: /Confermo di voler annullare/ }));
        fireEvent.click(action);
        await screen.findByText(/Il server ha provato che la richiesta non è stata eseguita/);
        expect(cancelKindeCandidatePendingReplicaMutation).toHaveBeenCalledWith({
            expected: { uid: principal.uid, fenceEpoch: 1, healthConsentRevision: 1 },
            mutationId: 'claim-123', stillCurrent: expect.any(Function),
        });
        expect(screen.queryByText('claim-123')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Conferma annullamento richiesta' })).toBeNull();
    });

    it('preserves uncertainty on a lost cancellation reply and offers explicit reinspection', async () => {
        authenticated();
        vi.mocked(inspectKindeCandidatePendingReplicaMutation).mockResolvedValue({
            kind: 'retirement', mutationId: 'retire-123', slot: 's04', generation: 2,
            cancellationRequested: true,
        });
        vi.mocked(cancelKindeCandidatePendingReplicaMutation).mockRejectedValueOnce(new Error('lost response'));
        render(<KindeAccountEntry candidateMode="preparation" />);
        const inspect = await screen.findByRole('button', { name: 'Esamina una richiesta da annullare' });
        fireEvent.click(inspect);
        await screen.findByText(/Annullamento già richiesto/);
        fireEvent.click(screen.getByRole('checkbox', { name: /Confermo di voler annullare/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Conferma annullamento richiesta' }));
        await screen.findByText(/Esito dell’annullamento sconosciuto/);
        expect(cancelKindeCandidatePendingReplicaMutation).toHaveBeenCalledTimes(1);
        fireEvent.click(inspect);
        await screen.findByText(/Annullamento già richiesto/);
        expect(inspectKindeCandidatePendingReplicaMutation).toHaveBeenCalledTimes(2);
        expect(cancelKindeCandidatePendingReplicaMutation).toHaveBeenCalledTimes(1);
    });

    it('does not interpret an already committed membership mutation as a successful cancellation', async () => {
        authenticated();
        vi.mocked(inspectKindeCandidatePendingReplicaMutation).mockResolvedValue({
            kind: 'retirement', mutationId: 'retire-123', slot: 's04', generation: 2,
            cancellationRequested: false,
        });
        vi.mocked(cancelKindeCandidatePendingReplicaMutation).mockResolvedValue('committed');
        render(<KindeAccountEntry candidateMode="preparation" />);
        fireEvent.click(await screen.findByRole('button', { name: 'Esamina una richiesta da annullare' }));
        await screen.findByText(/Riferimento operazione:/);
        fireEvent.click(screen.getByRole('checkbox', { name: /Confermo di voler annullare/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Conferma annullamento richiesta' }));
        await screen.findByText(/La richiesta originale risulta già eseguita/);
        expect(screen.queryByText(/Il server ha provato che la richiesta non è stata eseguita/)).toBeNull();
    });

    it('never exposes the retirement action to the public identity-only entry', async () => {
        authenticated();
        render(<KindeAccountEntry identityOnly />);
        await screen.findByText(/Sessione Kinde verificata/);
        expect(screen.queryByRole('button', { name: /ritiro/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /annullare/i })).toBeNull();
        expect(retireKindeCandidateReplica).not.toHaveBeenCalled();
        expect(inspectKindeCandidatePendingReplicaMutation).not.toHaveBeenCalled();
    });

    it('fails without showing a stale registry after a rotated cookie', async () => {
        authenticated();
        let finish!: (value: typeof registry) => void;
        vi.mocked(inspectKindeCandidateReplicaRegistry).mockImplementationOnce(() =>
            new Promise(resolve => { finish = resolve; }));
        render(<KindeAccountEntry candidateMode="preparation" />);
        fireEvent.click(await screen.findByRole('button', { name: 'Consulta il registro' }));
        await waitFor(() => expect(inspectKindeCandidateReplicaRegistry).toHaveBeenCalledTimes(1));
        browserWitness.csrf = REPLACEMENT_CSRF;
        await act(async () => { finish(registry); });
        await screen.findByText(/Registro non verificabile in questa sessione/);
        expect(screen.queryByText(/Replica s04/)).toBeNull();
    });

    it('preserves data and permits a read-only retry after a failed observation', async () => {
        authenticated();
        vi.mocked(inspectKindeCandidateReplicaRegistry).mockRejectedValueOnce(new Error('network'));
        render(<KindeAccountEntry candidateMode="preparation" />);
        const button = await screen.findByRole('button', { name: 'Consulta il registro' });
        fireEvent.click(button);
        await screen.findByRole('alert');
        expect(screen.queryByText(/Replica s04/)).toBeNull();
        fireEvent.click(button);
        await screen.findByText(/Replica s04/);
        expect(inspectKindeCandidateReplicaRegistry).toHaveBeenCalledTimes(2);
        expect(prepareKindeCandidateOwner).not.toHaveBeenCalled();
    });
});
