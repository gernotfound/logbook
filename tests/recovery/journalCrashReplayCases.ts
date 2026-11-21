import { it, expect } from 'vitest';
import { get } from 'idb-keyval';
import type { CrashSuiteContext } from './journalCrashConsistency.test';

export function registerCrashReplayCases(ctx: CrashSuiteContext): void {
    const { owner, data, remote, commitLocal, commitDomainOperations, readLocal, hydrateLocal, replicateJournal, waitForJournalIdle, installReplaySafeRemote, failNextOwnerEnvelopeWrite, cloudSnapshot, currentCloudData, cloudDocumentsWithSync, invalidateSession, CloudDataIntegrityError } = ctx;

    it('rehydrates safely after remote commit with a lost acknowledgement, then clears the replayed journal', async () => {
        await commitLocal(owner, data(171), data(170));
        let fault: ReturnType<typeof failNextOwnerEnvelopeWrite> | undefined;
        installReplaySafeRemote(() => { fault ??= failNextOwnerEnvelopeWrite(); });
        try {
            const first = await replicateJournal();
            expect(first).toMatchObject({ ok: false, status: 'local-pending' });
            await waitForJournalIdle(owner);
            expect(fault?.hit).toBe(true);
            expect(currentCloudData().profile?.height).toBe('171');
            expect((await readLocal(owner))?.baseline.profile?.height).toBe('170');
        } finally {
            fault?.restore();
        }

        const committedCloud = cloudSnapshot();
        invalidateSession();
        const hydrated = await hydrateLocal(owner, currentCloudData(), [], cloudDocumentsWithSync());
        expect(hydrated.data.profile?.height).toBe('171');
        expect(hydrated.pending.length).toBeGreaterThan(0);

        const retry = await replicateJournal();
        expect(retry).toMatchObject({ ok: true, status: 'synced' });
        expect(cloudSnapshot()).toBe(committedCloud);
        expect((await readLocal(owner))?.pending).toEqual([]);
    });

    it('recovers offline activity journal entries without losing steps or keyed cardio sessions', async () => {
        await commitDomainOperations(owner, [
            { type: 'activity-steps.set', date: '2026-09-24', steps: 11000, source: 'manual', capturedAt: 100 },
            { type: 'cardio-session.upsert', date: '2026-09-24', session: { id: 'cardio-a', modality: 'bike', durationMinutes: 40, intensity: 'moderate', source: 'manual' } },
        ], data(170));
        const unavailable = Object.assign(new Error('Injected remote outage'), { code: 'unavailable' });
        remote.apply.mockRejectedValueOnce(unavailable);

        const first = await replicateJournal();
        expect(first.status).toBe('local-pending');
        expect((await readLocal(owner))?.data.nutrition?.['2026-09-24']).toMatchObject({ steps: 11000, cardioSessions: [{ id: 'cardio-a', durationMinutes: 40 }] });

        installReplaySafeRemote();
        invalidateSession();
        const retry = await replicateJournal();
        expect(retry).toMatchObject({ ok: true, status: 'synced' });
        expect((await readLocal(owner))?.pending).toEqual([]);
        expect(currentCloudData().nutrition?.['2026-09-24']).toMatchObject({ steps: 11000, cardioSessions: [{ id: 'cardio-a', durationMinutes: 40 }] });
    });

    it('does not acknowledge a writer integrity rejection and retains the encrypted journal for recovery', async () => {
        await commitLocal(owner, data(171), data(170));
        const before = await readLocal(owner);
        const ciphertext = await get('logbook:v2:' + owner);
        const initialCloud = cloudSnapshot();
        const integrityError = new CloudDataIntegrityError('', ['profile', 'height']);
        remote.apply.mockRejectedValueOnce(integrityError);

        const result = await replicateJournal();
        await waitForJournalIdle(owner);

        expect(result).toMatchObject({ ok: false, status: 'failed', error: integrityError });
        expect(remote.apply).toHaveBeenCalledTimes(1);
        expect(await get('logbook:v2:' + owner)).toEqual(ciphertext);
        expect(await readLocal(owner)).toEqual(before);
        expect(before?.pending.length).toBeGreaterThan(0);
        expect(cloudSnapshot()).toBe(initialCloud);

        installReplaySafeRemote();
        invalidateSession();
        expect(await replicateJournal()).toMatchObject({ ok: true, status: 'synced' });
        expect((await readLocal(owner))?.pending).toEqual([]);
        expect(currentCloudData().profile?.height).toBe('171');
    });

    it('leaves cloud untouched and journal durable when the remote fails before commit, then converges on retry', async () => {
        await commitLocal(owner, data(171), data(170));
        const initialCloud = cloudSnapshot();
        const unavailable = Object.assign(new Error('Injected remote outage'), { code: 'unavailable' });
        remote.apply.mockRejectedValueOnce(unavailable);

        const first = await replicateJournal();
        expect(first.status).toBe('local-pending');
        expect(cloudSnapshot()).toBe(initialCloud);
        expect((await readLocal(owner))?.pending.length).toBeGreaterThan(0);

        installReplaySafeRemote();
        invalidateSession();
        const retry = await replicateJournal();
        expect(retry).toMatchObject({ ok: true, status: 'synced' });
        expect((await readLocal(owner))?.pending).toEqual([]);
        expect(currentCloudData().profile?.height).toBe('171');
    });
}
