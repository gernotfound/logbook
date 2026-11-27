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
import { inspectKindeCandidateRetiredReplicaWithExistingKey } from '../../lib/sync/kindeCandidateRetiredReplicaReadOnly';
import { recoverKindeCandidateStagedReceipt } from '../../lib/sync/kindeCandidateStagedReceiptRecovery';

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
vi.mock('../../lib/sync/kindeCandidateRetiredReplicaReadOnly', () => ({
    inspectKindeCandidateRetiredReplicaWithExistingKey: vi.fn(),
}));
vi.mock('../../lib/sync/kindeCandidateStagedReceiptRecovery', () => ({
    recoverKindeCandidateStagedReceipt: vi.fn(),
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
    vi.mocked(inspectKindeCandidateRetiredReplicaWithExistingKey).mockResolvedValue({
        kind: 'baseline-unchanged', pendingOperations: 3, cloudRevision: 5,
    });
    vi.mocked(recoverKindeCandidateStagedReceipt).mockResolvedValue('unconfirmed');
}

describe('candidate-only replica registry presentation', () => {
    it('does not expose registry inspection in public identity-only or guest mode', async () => {
        authenticated();
        const publicEntry = render(<KindeAccountEntry identityOnly />);
        await screen.findByText(/Sessione Kinde verificata/);
        expect(screen.queryByRole('button', { name: 'Consulta il registro' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Controlla modifiche offline su questo dispositivo' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Analizza la copia cloud e i possibili conflitti' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Verifica la ricevuta di un invio sigillato' })).toBeNull();
        publicEntry.unmount();

        render(<KindeAccountEntry guestArchivePresent candidateMode="preparation" />);
        await screen.findByText(/archivio ospite/);
        expect(screen.queryByRole('button', { name: 'Consulta il registro' })).toBeNull();
        expect(inspectKindeCandidateReplicaRegistry).not.toHaveBeenCalled();
        expect(inspectKindeCandidateOfflineReplicaJournal).not.toHaveBeenCalled();
        expect(inspectKindeCandidateRetiredReplicaWithExistingKey).not.toHaveBeenCalled();
        expect(recoverKindeCandidateStagedReceipt).not.toHaveBeenCalled();
    });

    it('checks only a sealed delivery after observing a pending transition, preserving uncertainty', async () => {
        authenticated();
        vi.mocked(inspectKindeCandidateOfflineReplicaJournal).mockResolvedValue({
            kind: 'transition-pending', pendingOperations: 2,
        });
        render(<KindeAccountEntry candidateMode="preparation" />);
        const check = 'Verifica la ricevuta di un invio sigillato';
        expect(screen.queryByRole('button', { name: check })).toBeNull();
        fireEvent.click(await screen.findByRole('button', { name: 'Controlla modifiche offline su questo dispositivo' }));
        fireEvent.click(await screen.findByRole('button', { name: check }));
        await screen.findByText(/Nessuna ricevuta storica verificabile/);
        expect(recoverKindeCandidateStagedReceipt).toHaveBeenCalledWith({
            expected: { uid: principal.uid, fenceEpoch: 1, healthConsentRevision: 1 },
            stillCurrent: expect.any(Function),
        });
        expect(screen.queryByText(/il suo ACK è stato salvato/)).toBeNull();
        expect(prepareKindeCandidateOwner).not.toHaveBeenCalled();
    });

    it('distinguishes a verified historical ACK from an unknown error after the operation', async () => {
        authenticated();
        vi.mocked(inspectKindeCandidateOfflineReplicaJournal).mockResolvedValue({
            kind: 'transition-pending', pendingOperations: 1,
        });
        vi.mocked(recoverKindeCandidateStagedReceipt).mockResolvedValueOnce('acknowledged')
            .mockRejectedValueOnce(new Error('session changed'));
        render(<KindeAccountEntry candidateMode="preparation" />);
        const inspect = await screen.findByRole('button', { name: 'Controlla modifiche offline su questo dispositivo' });
        fireEvent.click(inspect);
        fireEvent.click(await screen.findByRole('button', { name: 'Verifica la ricevuta di un invio sigillato' }));
        await screen.findByText(/il suo ACK è stato salvato/);
        fireEvent.click(inspect);
        fireEvent.click(await screen.findByRole('button', { name: 'Verifica la ricevuta di un invio sigillato' }));
        await screen.findByText(/Un ACK potrebbe essere stato salvato prima dell’errore/);
        expect(screen.queryByText(/il suo ACK è stato salvato/)).toBeNull();
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
        expect(inspectKindeCandidateRetiredReplicaWithExistingKey).not.toHaveBeenCalled();
    });

    it('offers an authenticated, read-only baseline comparison only after a retired journal was observed', async () => {
        authenticated();
        vi.mocked(inspectKindeCandidateOfflineReplicaJournal).mockResolvedValue({
            kind: 'retired-pending', slot: 's04', generation: 2, reason: 'retired', pendingOperations: 3,
        });
        render(<KindeAccountEntry candidateMode="preparation" />);
        const diagnosticName = 'Analizza la copia cloud e i possibili conflitti';
        expect(screen.queryByRole('button', { name: diagnosticName })).toBeNull();
        fireEvent.click(await screen.findByRole('button', { name: 'Controlla modifiche offline su questo dispositivo' }));
        fireEvent.click(await screen.findByRole('button', { name: diagnosticName }));
        await screen.findByText(/la copia remota corrispondeva alla base delle 3 operazioni locali/);
        expect(inspectKindeCandidateRetiredReplicaWithExistingKey).toHaveBeenCalledWith({
            expected: { uid: principal.uid, fenceEpoch: 1, healthConsentRevision: 1 },
            stillCurrent: expect.any(Function),
        });
        expect(screen.getByText(/nessun ACK, claim, scelta di conflitto o riattribuzione/)).toBeTruthy();
        expect(prepareKindeCandidateOwner).not.toHaveBeenCalled();
        expect(retireKindeCandidateReplica).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Controlla modifiche offline su questo dispositivo' }));
        await screen.findByText(/3 operazioni restano nel journal locale/);
        expect(screen.queryByText(/la copia remota corrispondeva alla base/)).toBeNull();
    });

    it('shows divergence counts without claiming disjoint fields are recoverable', async () => {
        authenticated();
        vi.mocked(inspectKindeCandidateOfflineReplicaJournal).mockResolvedValue({
            kind: 'retired-pending', slot: 's04', generation: 2, reason: 'replaced', pendingOperations: 2,
        });
        vi.mocked(inspectKindeCandidateRetiredReplicaWithExistingKey).mockResolvedValue({
            kind: 'reconciliation-required', reason: 'cloud-diverged', evidence: {
                changedCloudFieldStamps: 2, pendingWithOverlappingCloudStamps: 0, unclassifiedDocuments: 1,
            },
        });
        render(<KindeAccountEntry candidateMode="preparation" />);
        fireEvent.click(await screen.findByRole('button', { name: 'Controlla modifiche offline su questo dispositivo' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Analizza la copia cloud e i possibili conflitti' }));
        await screen.findByText(/2 stamp causali differenti, 0 operazioni con possibili sovrapposizioni/);
        expect(screen.getByText(/Anche zero sovrapposizioni non dimostra/)).toBeTruthy();
    });

    it('does not interpret a possible lost ACK or a failed key inspection as recovered data', async () => {
        authenticated();
        vi.mocked(inspectKindeCandidateOfflineReplicaJournal).mockResolvedValue({
            kind: 'retired-pending', slot: 's04', generation: 2, reason: 'expired', pendingOperations: 1,
        });
        vi.mocked(inspectKindeCandidateRetiredReplicaWithExistingKey).mockResolvedValueOnce({
            kind: 'reconciliation-required', reason: 'possible-lost-ack',
        }).mockRejectedValueOnce(new Error('ADK not issued'));
        render(<KindeAccountEntry candidateMode="preparation" />);
        fireEvent.click(await screen.findByRole('button', { name: 'Controlla modifiche offline su questo dispositivo' }));
        const diagnose = await screen.findByRole('button', { name: 'Analizza la copia cloud e i possibili conflitti' });
        fireEvent.click(diagnose);
        await screen.findByText(/potrebbe esistere un invio già applicato senza conferma locale/);
        fireEvent.click(diagnose);
        await screen.findByText(/Non è stato possibile verificare la copia cloud con una chiave cloud già emessa/);
        expect(screen.queryByText(/potrebbe esistere un invio già applicato/)).toBeNull();
        expect(inspectKindeCandidateRetiredReplicaWithExistingKey).toHaveBeenCalledTimes(2);
    });

    it('shows unverifiable lineage as a blocker without proposing a causal transfer', async () => {
        authenticated();
        vi.mocked(inspectKindeCandidateOfflineReplicaJournal).mockResolvedValue({
            kind: 'retired-pending', slot: 's04', generation: 2, reason: 'missing', pendingOperations: 1,
        });
        vi.mocked(inspectKindeCandidateRetiredReplicaWithExistingKey).mockResolvedValue({
            kind: 'reconciliation-required', reason: 'unverifiable-lineage',
        });
        render(<KindeAccountEntry candidateMode="preparation" />);
        fireEvent.click(await screen.findByRole('button', { name: 'Controlla modifiche offline su questo dispositivo' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Analizza la copia cloud e i possibili conflitti' }));
        await screen.findByText(/il registro non conserva una storia coerente della replica originale/);
        expect(screen.queryByText(/la copia remota corrispondeva alla base/)).toBeNull();
        expect(screen.getByText(/nessun ACK, claim, scelta di conflitto o riattribuzione/)).toBeTruthy();
    });

    it('does not publish a causal diagnosis after a session cookie rotation', async () => {
        authenticated();
        vi.mocked(inspectKindeCandidateOfflineReplicaJournal).mockResolvedValue({
            kind: 'retired-pending', slot: 's04', generation: 2, reason: 'retired', pendingOperations: 1,
        });
        let finish!: (value: { kind: 'baseline-unchanged'; pendingOperations: number; cloudRevision: number }) => void;
        vi.mocked(inspectKindeCandidateRetiredReplicaWithExistingKey).mockImplementationOnce(() =>
            new Promise(resolve => { finish = resolve; }));
        render(<KindeAccountEntry candidateMode="preparation" />);
        fireEvent.click(await screen.findByRole('button', { name: 'Controlla modifiche offline su questo dispositivo' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Analizza la copia cloud e i possibili conflitti' }));
        await waitFor(() => expect(inspectKindeCandidateRetiredReplicaWithExistingKey).toHaveBeenCalledTimes(1));
        browserWitness.csrf = REPLACEMENT_CSRF;
        await act(async () => { finish({ kind: 'baseline-unchanged', pendingOperations: 1, cloudRevision: 5 }); });
        await screen.findByText(/Non è stato possibile verificare la copia cloud con una chiave cloud già emessa/);
        expect(screen.queryByText(/la copia remota corrispondeva alla base/)).toBeNull();
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
        await screen.findByText(/Nessuna operazione nel journal corrente/);
    });

    it('warns that historical consent journals survive even when the current queue is empty', async () => {
        authenticated();
        vi.mocked(inspectKindeCandidateOfflineReplicaJournal).mockResolvedValue({
            kind: 'archived-consent-pending', archivedOperations: 2,
        });
        render(<KindeAccountEntry candidateMode="preparation" />);
        fireEvent.click(await screen.findByRole('button', { name: 'Controlla modifiche offline su questo dispositivo' }));
        await screen.findByText(/conserva 2 operazioni storiche di un consenso precedente/);
        expect(screen.queryByText(/Nessuna operazione nel journal corrente/)).toBeNull();
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
