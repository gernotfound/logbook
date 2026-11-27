import { get } from 'idb-keyval';
import { describe, expect, it } from 'vitest';
import type { CandidateJournalTestContext } from './cloudflareJournalCandidate.test';

export function registerCandidateJournalRebaseCases({
    owner, storeKey, adk, profile, savedDelivery, changedRemote, transport,
    readLocal, deliverCloudflareJournalCandidate, CloudReplicaTransportError,
    readAccountCloudDocument, parseSyncMeta, sealCloudDocument, commitLocal,
}: CandidateJournalTestContext): void {
    describe('verified 409 rebase, AEAD and competing-device recovery', () => {
    it('rebases a provably uncommitted 409 only after full AEAD scan and two stable controls', async () => {
        const setup = await savedDelivery();
        const before = (await readLocal(owner))!.cloudflareDelivery!.batch;
        const { control, scan } = changedRemote(setup);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValueOnce({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValue(control);
        remote.scanAll.mockResolvedValue(scan);

        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .resolves.toBe('retry-staged');
        expect(remote.commitOutcome).toHaveBeenCalledWith(before, 'csrf-session');
        expect(remote.control).toHaveBeenCalledTimes(2);
        expect(remote.scanAll).toHaveBeenCalledOnce();
        expect(remote.commit).toHaveBeenCalledOnce();
        const after = (await readLocal(owner))!;
        const replacement = after.cloudflareDelivery!.batch;
        expect(after.pending).toEqual(setup.local.pending);
        expect(replacement.batchId).not.toBe(before.batchId);
        expect(replacement.expectedRevision).toBe(2);
        expect(replacement.expectedFenceEpoch).toBe(5);
        expect(replacement.documents[0].document._sealed)
            .not.toEqual(before.documents[0].document._sealed);
        const opened = readAccountCloudDocument(replacement.documents[0].document,
            'CF04 candidate rebase regression', owner.slice(5), '', adk);
        expect(parseSyncMeta(opened.sync).clock.s00).toBe(1);

        // A second invocation replays the persisted replacement and does not
        // scan, reseal, or infer a prior successful acknowledgement.
        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('acknowledged');
        expect(remote.commit.mock.calls[1][0]).toEqual(replacement);
        expect(remote.scanAll).toHaveBeenCalledOnce();
        expect(remote.control).toHaveBeenCalledTimes(2);
        expect((await readLocal(owner))!.pending).toEqual([]);
    });

    it('rebases when the competing commit changed only a different document', async () => {
        const setup = await savedDelivery();
        const { control, scan } = changedRemote(setup);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValueOnce({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValue(control);
        remote.scanAll.mockResolvedValue({ ...scan, documents: [{
            path: 'nutrition_months/2026-11', revision: 2,
            document: sealCloudDocument(adk, owner.slice(5), 'nutrition_months/2026-11', {}, {
                protocolVersion: 3, clock: { s01: 1 }, fields: {},
                writer: { slot: 's01', replicaId: 'other-cloud-writer', generation: 1,
                    seq: 1, consentRevision: 1 },
            }),
        }] });

        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('retry-staged');
        expect((await readLocal(owner))!.pending).toEqual(setup.local.pending);
        expect((await readLocal(owner))!.cloudflareDelivery?.batch.expectedRevision).toBe(2);
    });

    it.each([
        { height: 168, stamped: true }, { height: 170, stamped: true },
        { height: 168, stamped: false }, { height: 170, stamped: false },
    ])('preserves the original intent after a conflicting or unattributed root write (%o)', async ({ height, stamped }) => {
        const setup = await savedDelivery();
        const original = (await readLocal(owner))!.cloudflareDelivery;
        const { control, scan } = changedRemote(setup);
        const competingRoot = sealCloudDocument(adk, owner.slice(5), '', {
            profile: { height: String(height) },
        }, {
            protocolVersion: 3, clock: { s01: 1 }, fields: stamped ? {
                'profile/height': { actorId: 's01', seq: 1, clock: { s01: 1 } },
            } : {},
            writer: { slot: 's01', replicaId: 'other-cloud-writer', generation: 1,
                seq: 1, consentRevision: 1 },
        });
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValueOnce({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValue(control);
        remote.scanAll.mockResolvedValue({ ...scan, documents: [
            { path: '', revision: 2, document: competingRoot },
        ] });
        const before = await get(storeKey);

        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('reconciliation-required');
        expect(remote.control).toHaveBeenCalledTimes(2);
        expect(remote.scanAll).toHaveBeenCalledOnce();
        expect(remote.commit).toHaveBeenCalledOnce();
        expect(await get(storeKey)).toBe(before);
        expect((await readLocal(owner))!.cloudflareDelivery).toEqual(original);
        expect((await readLocal(owner))!.pending).toEqual(setup.local.pending);
    });

    it('keeps the sealed delivery if a non-commit proof is followed by a foreign control', async () => {
        const setup = await savedDelivery();
        const { control } = changedRemote(setup);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValueOnce({ outcome: 'not-committed', currentRevision: control.revision });
        remote.control.mockResolvedValue({ ...control, uid: 'other-owner' });
        const bytes = await get(storeKey);
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .resolves.toBe('reconciliation-required');
        expect(remote.scanAll).not.toHaveBeenCalled();
        expect(await get(storeKey)).toBe(bytes);
    });

    it('preserves new edits made by another tab during recovery', async () => {
        const setup = await savedDelivery();
        const oldIntent = (await readLocal(owner))!.cloudflareDelivery;
        const { control, scan } = changedRemote(setup);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValueOnce(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValueOnce({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValue(control);
        remote.scanAll.mockImplementationOnce(async () => {
            await commitLocal(owner, profile(172), profile(171));
            return scan;
        });
        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('retry-staged');
        const saved = (await readLocal(owner))!;
        expect(saved.pending).toHaveLength(2);
        expect(saved.pending[0]).toEqual(oldIntent!.operations[0]);
        expect(saved.data.profile?.height).toBe('172');
        expect(saved.cloudflareDelivery?.operations).toEqual(oldIntent?.operations);
        expect(saved.cloudflareDelivery?.batch.batchId).not.toBe(oldIntent?.batch.batchId);
        expect(remote.commit).toHaveBeenCalledOnce();
    });

    it('does not rotate after inconclusive or committed historical status', async () => {
        const setup = await savedDelivery();
        const before = await get(storeKey);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValue(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValueOnce({ outcome: 'inconclusive', currentRevision: 0 })
            .mockResolvedValueOnce({ outcome: 'committed', currentRevision: 1 });
        for (let index = 0; index < 2; index += 1) {
            expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
                .toBe('reconciliation-required');
            expect(await get(storeKey)).toBe(before);
        }
        expect(remote.control).not.toHaveBeenCalled();
        expect(remote.scanAll).not.toHaveBeenCalled();
    });

    it('rejects mismatched revision or advanced same-actor sequence before scanning', async () => {
        const setup = await savedDelivery();
        const { control } = changedRemote(setup);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValue(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValue({ outcome: 'not-committed', currentRevision: 3 });
        remote.control.mockResolvedValue(control);
        const bytes = await get(storeKey);
        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('reconciliation-required');
        expect(await get(storeKey)).toBe(bytes);
        remote.commitOutcome.mockResolvedValue({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValue({
            ...control, replicas: {
                ...control.replicas, s00: { ...control.replicas.s00, lastSeq: 1 },
            },
        });
        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('reconciliation-required');
        expect(remote.scanAll).not.toHaveBeenCalled();
        expect(await get(storeKey)).toBe(bytes);
    });

    it('rejects tampered AEAD on an unrelated cloud document, preserving original intent', async () => {
        const setup = await savedDelivery();
        const { control, scan } = changedRemote(setup);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValue(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValue({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValue(control);
        const wrongKey = new Uint8Array(32).fill(99);
        const forged = sealCloudDocument(wrongKey, owner.slice(5), 'nutrition_months/2026-11',
            { '2026-11-14': { date: '2026-11-14', weight: 77 } },
            { protocolVersion: 3, clock: { s01: 1 }, fields: {},
                writer: { slot: 's01', replicaId: 'other-cloud-writer', generation: 1,
                    seq: 1, consentRevision: 1 } });
        remote.scanAll.mockResolvedValue({ ...scan, documents: [{
            path: 'nutrition_months/2026-11', revision: 2, document: forged,
        }] });
        const before = await get(storeKey);
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .rejects.toThrow();
        expect(await get(storeKey)).toBe(before);
        expect(remote.control).toHaveBeenCalledTimes(1);
    });

    it('rejects an unstable replica register after the authenticated scan', async () => {
        const setup = await savedDelivery();
        const { control, scan } = changedRemote(setup);
        const remote = transport(setup.control, setup.snapshot);
        remote.commit.mockRejectedValue(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValue({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValueOnce(control).mockResolvedValueOnce({
            ...control, revision: 3,
        });
        remote.scanAll.mockResolvedValue(scan);
        const original = await get(storeKey);
        expect(await deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => true))
            .toBe('reconciliation-required');
        expect(remote.control).toHaveBeenCalledTimes(2);
        expect(await get(storeKey)).toBe(original);
    });

    it('invalidates recovery when the Auth epoch changes while the remote scan is in flight', async () => {
        const setup = await savedDelivery();
        const { control, scan } = changedRemote(setup);
        const remote = transport(setup.control, setup.snapshot);
        let active = true;
        remote.commit.mockRejectedValue(new CloudReplicaTransportError(409));
        remote.commitOutcome.mockResolvedValue({ outcome: 'not-committed', currentRevision: 2 });
        remote.control.mockResolvedValue(control);
        remote.scanAll.mockImplementationOnce(async () => {
            active = false;
            return scan;
        });
        const original = await get(storeKey);
        await expect(deliverCloudflareJournalCandidate(owner, adk, remote, 'csrf-session', () => active))
            .rejects.toThrow('Sessione D1 cambiata');
        expect(await get(storeKey)).toBe(original);
    });
    });
}
