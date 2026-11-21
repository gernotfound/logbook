import { expect, test } from '../fixtures';
import { loadKindeReplica, withKindeReplicaDevices } from './kindeReplicaFixture';

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
