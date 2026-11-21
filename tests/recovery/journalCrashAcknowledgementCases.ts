import { it, expect } from 'vitest';
import { get, del } from 'idb-keyval';
import type { SemanticOperation } from '../../src/lib/sync/semanticProjection';
import type { LocalEnvelope } from '../../src/lib/sync/localEnvelopeValidation';
import type { CrashSuiteContext } from './journalCrashConsistency.test';

export function registerCrashAcknowledgementCases(ctx: CrashSuiteContext): void {
    const { owner, data, remote, commitLocal, readLocal, replicateJournal, waitForJournalIdle, installReplaySafeRemote, failNextOwnerEnvelopeWrite, cloudSnapshot, currentCloudData, invalidateSession, updateArchiveRecord, commitRemoteOperations } = ctx;

    it('retains and idempotently replays the journal when remote commit succeeds but local acknowledgement fails', async () => {
        await commitLocal(owner, data(171), data(170));
        let fault: ReturnType<typeof failNextOwnerEnvelopeWrite> | undefined;
        installReplaySafeRemote(() => { fault ??= failNextOwnerEnvelopeWrite(); });

        try {
            const first = await replicateJournal();
            expect(first).toMatchObject({ ok: false, status: 'local-pending' });
            await waitForJournalIdle(owner);
            expect(fault?.hit).toBe(true);
            expect((await readLocal(owner))?.pending.length).toBeGreaterThan(0);
            expect((await readLocal(owner))?.baseline.profile?.height).toBe('170');
            expect(currentCloudData().profile?.height).toBe('171');
        } finally {
            fault?.restore();
        }
        const committedCloud = cloudSnapshot();

        invalidateSession();
        const retry = await replicateJournal();
        expect(retry).toMatchObject({ ok: true, status: 'synced' });
        expect(remote.apply).toHaveBeenCalledTimes(2);
        expect(cloudSnapshot()).toBe(committedCloud);
        expect((await readLocal(owner))?.pending).toEqual([]);
        expect((await readLocal(owner))?.data.profile?.height).toBe('171');
    });

    it('keeps a post-commit acknowledgement error hard-failed when the local journal is no longer durable', async () => {
        await commitLocal(owner, data(171), data(170));
        installReplaySafeRemote(async () => {
            await del('logbook:v2:' + owner);
        });

        const result = await replicateJournal();

        expect(result.status).toBe('failed');
        expect(await readLocal(owner)).toBeUndefined();
        expect(currentCloudData().profile?.height).toBe('171');
    });

    it('requires a durable exact batch when the remote commit succeeds but its response is lost', async () => {
        await commitLocal(owner, data(171), data(170));
        remote.apply.mockImplementationOnce(async (_db: unknown, _uid: string, ops: SemanticOperation[]) => {
            commitRemoteOperations(ops);
            throw Object.assign(new Error('Injected lost remote response'), { code: 'unavailable' });
        });

        const first = await replicateJournal();

        expect(first.status).toBe('local-pending');
        const committedCloud = cloudSnapshot();
        expect((await readLocal(owner))?.pending.length).toBeGreaterThan(0);

        installReplaySafeRemote();
        invalidateSession();
        const retry = await replicateJournal();

        expect(retry).toMatchObject({ ok: true, status: 'synced' });
        expect(cloudSnapshot()).toBe(committedCloud);
        expect((await readLocal(owner))?.pending).toEqual([]);
    });

    it('hard-fails a lost remote response when the delivered batch is no longer durable', async () => {
        await commitLocal(owner, data(171), data(170));
        remote.apply.mockImplementationOnce(async (_db: unknown, _uid: string, ops: SemanticOperation[]) => {
            commitRemoteOperations(ops);
            await del('logbook:v2:' + owner);
            throw Object.assign(new Error('Injected lost remote response'), { code: 'unavailable' });
        });

        const result = await replicateJournal();

        expect(result.status).toBe('failed');
        expect(await readLocal(owner)).toBeUndefined();
        expect(currentCloudData().profile?.height).toBe('171');
    });

    it('fails closed when a current-version envelope loses its journal field', async () => {
        await commitLocal(owner, data(171), data(170));
        const before = (await readLocal(owner))!;
        await updateArchiveRecord<LocalEnvelope>(owner, () => {
            const invalid = structuredClone(before);
            delete (invalid as Partial<LocalEnvelope>).pending;
            return invalid;
        });
        const encrypted = await get('logbook:v2:' + owner);
        expect(encrypted).toMatch(/^tlb-sealed:v1:/);

        const result = await replicateJournal();

        expect(result.status).toBe('failed');
        expect(await get('logbook:v2:' + owner)).toEqual(encrypted);
    });

    it('rejects an acknowledgement whose durable operation payload no longer matches the delivered batch', async () => {
        await commitLocal(owner, data(171), data(170));
        let changedCiphertext: unknown;
        installReplaySafeRemote(async () => {
            await updateArchiveRecord<LocalEnvelope>(owner, current => {
                if (!current) throw new Error('Expected durable journal');
                const changed = structuredClone(current);
                changed.pending[0] = { ...changed.pending[0], value: 'corrupted-after-delivery' };
                return changed;
            });
            changedCiphertext = await get('logbook:v2:' + owner);
        });

        const result = await replicateJournal();

        expect(result).toMatchObject({
            ok: false, status: 'failed',
            error: {
                name: 'UnsafeDeliveredBatchError',
                cause: { message: 'Acknowledgement invalidato: replica o batch locale cambiati; journal preservato.' },
            },
        });
        expect(changedCiphertext).toMatch(/^tlb-sealed:v1:/);
        expect(await get('logbook:v2:' + owner)).toBe(changedCiphertext);
        const retained = await readLocal(owner);
        expect(retained?.pending).toHaveLength(1);
        expect(retained?.pending[0].value).toBe('corrupted-after-delivery');
        expect(retained?.baseline.profile?.height).toBe('170');
        expect(retained?.data.profile?.height).toBe('171');
        expect(currentCloudData().profile?.height).toBe('171');
    });

    it('preserves a newer local edit created between remote commit and acknowledgement', async () => {
        await commitLocal(owner, data(171), data(170));
        let injected = false;
        installReplaySafeRemote(async () => {
            if (injected) return;
            injected = true;
            await commitLocal(owner, data(172), data(171));
            const waiting = await readLocal(owner);
            expect(waiting?.pending).toHaveLength(2);
            expect(waiting?.data.profile?.height).toBe('172');
        });

        const result = await replicateJournal();

        expect(result).toMatchObject({ ok: true, status: 'synced' });
        expect(remote.apply).toHaveBeenCalledTimes(2);
        expect((await readLocal(owner))?.pending).toEqual([]);
        expect((await readLocal(owner))?.data.profile?.height).toBe('172');
        expect(currentCloudData().profile?.height).toBe('172');
    });
}
