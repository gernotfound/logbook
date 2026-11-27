import { get } from 'idb-keyval';
import { describe, expect, it, vi } from 'vitest';
import type { CloudReplicaBatch } from '../../../src/lib/sync/cloudReplicaTransport';
import type { LocalEnvelope } from '../../../src/lib/sync/localEnvelopeValidation';
import type { CandidateJournalTestContext } from './cloudflareJournalCandidate.test';

export function registerCandidateJournalDeliveryCases({
    owner, storeKey, adk, profile, seed, transport, savedDelivery, changedRemote,
    deliverCloudflareJournalCandidate, stageCloudflareDelivery,
    CloudReplicaTransportError, updateArchiveRecord, readLocal, initializeLocal,
}: CandidateJournalTestContext): void {
    describe('durable staging, receipt acknowledgment and session fences', () => {
    it('keeps a staged ciphertext from another fenced epoch and skips receipt, commit and ACK', async () => {
        const setup = await savedDelivery();
        const api = transport(setup.control, setup.snapshot);
        const before = await readLocal(owner);
        expect(before?.cloudflareDelivery).toBeDefined();
        await expect(deliverCloudflareJournalCandidate(owner, adk, api, 'csrf-session', () => true, {
            consentRevision: 1, fenceEpoch: setup.control.fenceEpoch + 1,
        })).rejects.toThrow('Intento D1 di un’altra epoca');
        expect(api.receipt).not.toHaveBeenCalled();
        expect(api.commit).not.toHaveBeenCalled();
        expect(await readLocal(owner)).toEqual(before);
    });

    it('refuses a foreign control before reading cloud documents for the local journal', async () => {
        const setup = await seed();
        const api = transport({ ...setup.control, uid: 'other-owner' }, setup.snapshot);
        await expect(deliverCloudflareJournalCandidate(owner, adk, api, 'csrf-session', () => true))
            .rejects.toThrow('Snapshot remoto');
        expect(api.read).not.toHaveBeenCalled();
        expect(api.commit).not.toHaveBeenCalled();
        expect(await readLocal(owner)).toEqual(setup.local);
    });

    it('blocks a new batch when D1 reports a different epoch from the session proof', async () => {
        const setup = await seed();
        const api = transport(setup.control, setup.snapshot);
        await expect(deliverCloudflareJournalCandidate(owner, adk, api, 'csrf-session', () => true, {
            consentRevision: 1, fenceEpoch: setup.control.fenceEpoch + 1,
        })).rejects.toThrow('Epoca cloud D1 differente');
        expect(api.read).not.toHaveBeenCalled();
        expect(api.commit).not.toHaveBeenCalled();
        expect(await readLocal(owner)).toEqual(setup.local);
    });

    it('stages an encrypted causal prefix then requires a matching receipt for the local ACK', async () => {
        const { control, snapshot } = await seed();
        const remote = transport(control, snapshot);
        const result = await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true);
        expect(result).toBe('acknowledged');
        expect(remote.control).toHaveBeenCalledOnce();
        expect(remote.read).toHaveBeenCalledWith(['']);
        expect(remote.receipt).toHaveBeenCalledTimes(2);
        expect(remote.commit).toHaveBeenCalledOnce();
        const saved = (await readLocal(owner))!;
        expect(saved.pending).toEqual([]);
        expect(saved.cloudflareDelivery).toBeUndefined();
        expect(saved.data.profile?.height).toBe('171');
        expect(saved.syncMetaByDocument[''].clock).toEqual({ s00: 1 });
    });

    it('durably bounds a nine-document causal group before D1 preflight and never ACKs a failed request', async () => {
        const { local, control, snapshot } = await seed();
        const initialSeq = local.pending[0].seq;
        const oversized = Array.from({ length: 9 }, (_, index) => ({
            ...structuredClone(local.pending[0]),
            docPath: `history_months/2026-${String(index + 1).padStart(2, '0')}`,
        }));
        await updateArchiveRecord<LocalEnvelope>(owner, current => {
            if (!current) throw new Error('Archivio sintetico assente');
            return { ...current, pending: oversized, revision: current.revision + 1 };
        });
        expect((await readLocal(owner))?.pending.map(op => op.seq))
            .toEqual(Array(9).fill(initialSeq));

        const remote = transport(control, snapshot);
        remote.control.mockRejectedValue(new CloudReplicaTransportError(503));
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .rejects.toMatchObject({ status: 503 });

        const preserved = (await readLocal(owner))!;
        expect(preserved.pending.map(op => op.seq))
            .toEqual([...Array(8).fill(initialSeq), initialSeq + 1]);
        expect(preserved.pending.map(op => op.docPath)).toEqual(oversized.map(op => op.docPath));
        expect(preserved.actorSeq).toBe(local.actorSeq + 1);
        expect(preserved.clock.s00).toBe(local.actorSeq + 1);
        expect(preserved.cloudflareDelivery).toBeUndefined();
        expect(remote.read).not.toHaveBeenCalled();
        expect(remote.commit).not.toHaveBeenCalled();
        expect(remote.receipt).not.toHaveBeenCalled();

        const ciphertext = await get(storeKey);
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .rejects.toMatchObject({ status: 503 });
        expect(await get(storeKey)).toBe(ciphertext);
        expect((await readLocal(owner))?.pending).toEqual(preserved.pending);
    });

    it('recovers an existing immutable intent before fetching a new snapshot', async () => {
        const { control, snapshot, local, replica } = await seed();
        await stageCloudflareDelivery(owner, local.pending, snapshot, control, replica,
            'batch000000000251', adk, () => true);
        const before = (await readLocal(owner))!.cloudflareDelivery!.batch;
        const remote = transport(control, snapshot);
        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('acknowledged');
        expect(remote.control).not.toHaveBeenCalled();
        expect(remote.read).not.toHaveBeenCalled();
        expect(remote.commit.mock.calls[0][0]).toEqual(before);
        expect((await readLocal(owner))!.pending).toEqual([]);
    });

    it('keeps staged ciphertext and operations when remote delivery is ambiguous', async () => {
        const { control, snapshot } = await seed();
        const remote = transport(control, snapshot);
        remote.commit.mockImplementation(async () => { throw new Error('ambiguous remote timeout'); });
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .rejects.toThrow('ambiguous remote timeout');
        const pending = (await readLocal(owner))!;
        const savedBatch = structuredClone(pending.cloudflareDelivery!.batch);
        expect(pending.pending).toHaveLength(1);
        expect(await get(storeKey)).toBeDefined();

        const recover = {
            control: vi.fn(async () => { throw new Error('unexpected control fetch'); }),
            read: vi.fn(async () => { throw new Error('unexpected snapshot fetch'); }),
            scanAll: vi.fn(async () => { throw new Error('unexpected full scan'); }),
            commitOutcome: vi.fn(async () => { throw new Error('unexpected status check'); }),
            commit: vi.fn(async () => { throw new Error('unexpected reseal or resend'); }),
            receipt: vi.fn(async (batch: CloudReplicaBatch) => {
                expect(batch).toEqual(savedBatch);
                return { revision: batch.expectedRevision + 1, lastSeq: batch.lastSeq };
            }),
        };
        expect(await deliverCloudflareJournalCandidate(owner, adk, recover, 'csrf-session', () => true))
            .toBe('acknowledged');
        expect(recover.control).not.toHaveBeenCalled();
        expect(recover.read).not.toHaveBeenCalled();
        expect(recover.commit).not.toHaveBeenCalled();
        expect((await readLocal(owner))!.pending).toEqual([]);
    });

    it('takes one fresh control and document read when a second replica advances D1 before staging', async () => {
        const setup = await seed();
        const { control, scan } = changedRemote(setup);
        const remote = transport(control, scan);
        remote.control.mockResolvedValueOnce(setup.control);
        const commit = remote.commit.getMockImplementation()!;
        remote.commit.mockImplementation(async (batch, csrf) => {
            const staged = (await readLocal(owner))?.cloudflareDelivery;
            expect(staged?.batch).toEqual(batch);
            expect(staged?.operations).toEqual(setup.local.pending);
            return commit(batch, csrf);
        });

        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .resolves.toBe('acknowledged');
        expect(remote.control).toHaveBeenCalledTimes(2);
        expect(remote.read.mock.calls).toEqual([[['']], [['']]]);
        expect(remote.commit).toHaveBeenCalledOnce();
        expect(remote.commit.mock.calls[0][0]).toMatchObject({ expectedRevision: control.revision });
        expect(remote.receipt).toHaveBeenCalledTimes(2);
        expect(await readLocal(owner)).toMatchObject({ pending: [], syncMetaByDocument: { '': { clock: { s00: 1, s01: 1 } } } });
    });

    it('preserves the exact journal when another D1 revision arrives during the bounded retry', async () => {
        const { control, snapshot } = await seed();
        const before = await get(storeKey);
        const remote = transport(control, { ...snapshot, revision: 1 });
        remote.control.mockResolvedValueOnce(control).mockResolvedValueOnce({ ...control, revision: 1 });
        remote.read.mockResolvedValueOnce({ ...snapshot, revision: 1 }).mockResolvedValueOnce({ ...snapshot, revision: 2 });
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .resolves.toBe('reconciliation-required');
        expect(remote.control).toHaveBeenCalledTimes(2);
        expect(remote.read).toHaveBeenCalledTimes(2);
        expect(remote.receipt).not.toHaveBeenCalled();
        expect(remote.commit).not.toHaveBeenCalled();
        expect(await get(storeKey)).toBe(before);
        expect((await readLocal(owner))!.pending).toHaveLength(1);
    });

    it('refuses a retry control older than the document revision already observed', async () => {
        const { control, snapshot } = await seed();
        const before = await get(storeKey);
        const remote = transport(control, { ...snapshot, revision: 2 });
        remote.control.mockResolvedValueOnce(control).mockResolvedValueOnce({ ...control, revision: 1 });
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .rejects.toThrow('Snapshot remoto non coerente');
        expect(remote.control).toHaveBeenCalledTimes(2);
        expect(remote.read).toHaveBeenCalledOnce();
        expect(remote.receipt).not.toHaveBeenCalled();
        expect(remote.commit).not.toHaveBeenCalled();
        expect(await get(storeKey)).toBe(before);
    });

    it.each([
        { revision: 0 }, { revision: 2, fenceEpoch: 6 }, { revision: 2, consentRevision: 2 },
    ])('rejects incompatible D1 evidence %j without retrying or staging', async changed => {
        const { control, snapshot } = await seed();
        const before = await get(storeKey);
        const remote = transport({ ...control, revision: 1 }, { ...snapshot, ...changed });
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .rejects.toThrow('Snapshot remoto non coerente');
        expect(remote.control).toHaveBeenCalledOnce();
        expect(remote.read).toHaveBeenCalledOnce();
        expect(remote.receipt).not.toHaveBeenCalled();
        expect(remote.commit).not.toHaveBeenCalled();
        expect(await get(storeKey)).toBe(before);
    });

    it('aborts after a changed session during a remote read, before any IndexedDB staging', async () => {
        const { control, snapshot } = await seed();
        const before = await get(storeKey);
        const remote = transport(control, snapshot);
        let current = true;
        remote.read.mockImplementation(async () => {
            current = false;
            return snapshot;
        });
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => current))
            .rejects.toThrow('Sessione D1 cambiata');
        expect(remote.commit).not.toHaveBeenCalled();
        expect(await get(storeKey)).toBe(before);
    });

    it('fails closed without CSRF or with a guest, without contacting D1', async () => {
        const { control, snapshot } = await seed();
        const remote = transport(control, snapshot);
        const before = await get(storeKey);
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, '', () => true))
            .rejects.toThrow('non validi');
        await expect(deliverCloudflareJournalCandidate('guest', adk, remote, 'csrf-session', () => true))
            .rejects.toThrow('non validi');
        expect(remote.control).not.toHaveBeenCalled();
        expect(remote.read).not.toHaveBeenCalled();
        expect(await get(storeKey)).toBe(before);
    });

    it('does not turn an already empty account journal into a cloud commit', async () => {
        await initializeLocal(owner, profile(170));
        const remote = transport({ uid: owner.slice(5), revision: 0, fenceEpoch: 5, consentRevision: 1, replicas: {} },
            { revision: 0, fenceEpoch: 5, consentRevision: 1, documents: [] });
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .resolves.toBe('idle');
        expect(remote.control).not.toHaveBeenCalled();
        expect(remote.commit).not.toHaveBeenCalled();
    });
    });
}
