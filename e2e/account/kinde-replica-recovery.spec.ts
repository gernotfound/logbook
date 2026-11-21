import { expect, test } from '../fixtures';
import { loadKindeReplica, withKindeReplicaDevices } from './kindeReplicaFixture';

test('recovers a Kinde edit made offline after a competing browser save', async ({ browser }) => {
    await withKindeReplicaDevices(browser, async ({ first, second, receipts, firstCommitStatuses, allowFirstCommit }) => {
        allowFirstCommit();
        await first.context().setOffline(true);
        await expect.poll(() => first.evaluate(() => navigator.onLine)).toBe(false);
        await expect(first.evaluate(() => window.kindeReplicaFixture!.submit({
            type: 'profile.patch', patch: { height: '184' },
        }))).resolves.toEqual({ kind: 'local-pending', pendingCount: 1 });
        expect(await first.evaluate(() => window.kindeReplicaFixture!.snapshot()?.data.profile?.height)).toBe('184');
        expect(firstCommitStatuses).toEqual([]);
        expect(receipts()).toBe(0);

        expect(await second.evaluate(() => window.kindeReplicaFixture!.submit({
            type: 'profile.patch', patch: { neck: '37' },
        }))).toEqual({ kind: 'cloud-acknowledged', operations: 1 });
        expect(await second.evaluate(() => window.kindeReplicaFixture!.snapshot()?.data.profile?.height)).toBeUndefined();
        expect(receipts()).toBe(1);

        await first.context().setOffline(false);
        await first.reload();
        expect(await first.evaluate(() => window.kindeReplicaFixture)).toBeUndefined();
        await loadKindeReplica(first);
        const merged = { height: '184', neck: '37' };
        expect(await first.evaluate(() => window.kindeReplicaFixture!.snapshot()?.data.profile)).toMatchObject(merged);
        expect(await second.evaluate(async () => (await window.kindeReplicaFixture!.refresh()).data.profile)).toMatchObject(merged);
        expect(firstCommitStatuses).toEqual([200]);
        expect(receipts()).toBe(2);
    });
});

test('resumes a sealed Kinde edit after reload and another browser commit', async ({ browser }) => {
    await withKindeReplicaDevices(browser, async ({ first, second, receipts, firstCommitStatuses, allowFirstCommit }) => {
        expect(await first.evaluate(() => window.kindeReplicaFixture!.submit({
            type: 'profile.patch', patch: { height: '183' },
        }))).toEqual({ kind: 'local-pending', pendingCount: 1 });
        expect(await first.evaluate(() => window.kindeReplicaFixture!.snapshot())).toBeNull();
        expect(receipts()).toBe(0);

        await first.reload();
        expect(await first.evaluate(() => window.kindeReplicaFixture)).toBeUndefined();
        expect(await second.evaluate(() => window.kindeReplicaFixture!.submit({
            type: 'profile.patch', patch: { neck: '37' },
        }))).toEqual({ kind: 'cloud-acknowledged', operations: 1 });
        expect(await second.evaluate(() => window.kindeReplicaFixture!.snapshot()?.data.profile?.height)).toBeUndefined();
        expect(receipts()).toBe(1);

        allowFirstCommit();
        await loadKindeReplica(first);
        const merged = { height: '183', neck: '37' };
        expect(await first.evaluate(() => window.kindeReplicaFixture!.snapshot()?.data.profile)).toMatchObject(merged);
        expect(await second.evaluate(async () => (await window.kindeReplicaFixture!.refresh()).data.profile)).toMatchObject(merged);
        expect(firstCommitStatuses).toEqual([429, 409, 200]);
        expect(receipts()).toBe(2);
    });
});

for (const concurrentWrites of [1, 2]) {
    test(`handles ${concurrentWrites} competing D1 writes before the first profile stages a batch`, async ({ browser }) => {
        await withKindeReplicaDevices(browser, async ({
            first, second, receipts, firstCommitStatuses, allowFirstCommit, beforeFirstDocumentRead,
        }) => {
            allowFirstCommit();
            const peerPatches = [{ neck: '37' }, { waist: '91' }].slice(0, concurrentWrites);
            for (const [index, patch] of peerPatches.entries()) {
                beforeFirstDocumentRead(async () => {
                    expect(receipts()).toBe(index);
                    expect(firstCommitStatuses).toEqual([]);
                    const saved = await second.evaluate(input => window.kindeReplicaFixture!.submit({
                        type: 'profile.patch', patch: input,
                    }), patch);
                    expect(saved).toEqual({ kind: 'cloud-acknowledged', operations: 1 });
                    expect(receipts()).toBe(index + 1);
                });
            }

            const outcome = await first.evaluate(() => window.kindeReplicaFixture!.submit({
                type: 'profile.patch', patch: { height: '183' },
            }));
            const merged = Object.assign({ height: '183' }, ...peerPatches);
            if (concurrentWrites === 1) {
                expect(outcome).toEqual({ kind: 'cloud-acknowledged', operations: 1 });
                expect(await first.evaluate(() => window.kindeReplicaFixture!.snapshot()?.data.profile)).toMatchObject(merged);
            } else {
                expect(outcome).toEqual({ kind: 'local-pending', pendingCount: 1 });
                expect(await first.evaluate(() => window.kindeReplicaFixture!.snapshot())).toBeNull();
                expect(firstCommitStatuses).toEqual([]);
                expect(receipts()).toBe(concurrentWrites);
                await first.reload();
                await loadKindeReplica(first);
                expect(await first.evaluate(() => window.kindeReplicaFixture!.snapshot()?.data.profile)).toMatchObject(merged);
            }
            expect(await second.evaluate(async () => (await window.kindeReplicaFixture!.refresh()).data.profile)).toMatchObject(merged);
            expect(firstCommitStatuses).toEqual([200]);
            expect(receipts()).toBe(concurrentWrites + 1);
        });
    });
}
