import { expect, test } from '../fixtures';
import { loadKindeReplica, mountKindePlanning, withKindeReplicaDevices } from './kindeReplicaFixture';

test('reconciles nutrition planning from the Kinde form and replicates it to a second profile', async ({ browser }) => {
    await withKindeReplicaDevices(browser, async ({ first, second, receipts, firstCommitStatuses, allowFirstCommit }) => {
        const seed = await second.evaluate(() => window.kindeReplicaFixture!.submit({
            type: 'nutrition-day.patch', date: '2026-11-20', patch: { weight: 78 },
        }));
        expect(seed).toMatchObject({ kind: 'cloud-acknowledged' });
        expect(receipts()).toBe(1);

        await first.bringToFront();
        await mountKindePlanning(first);
        const save = first.getByRole('button', { name: 'Salva pianificazione' });
        const restore = first.getByRole('heading', { name: 'Ripristina backup account' });
        await expect(save).toHaveCount(0);
        await expect(restore).toBeVisible();
        await first.getByRole('button', { name: 'Apri archivio account' }).click();
        await first.getByLabel(/Giorni ON/).fill('3');
        await expect(restore).toHaveCount(0);
        await first.getByRole('textbox', { name: /Note/ }).fill('Pianificazione sintetica');
        await save.click();
        const pending = first.getByText('Conferma cloud in attesa', { exact: false });
        await expect(pending).toBeVisible();
        await expect(save).toHaveCount(0);
        expect(firstCommitStatuses).toEqual([429]);
        expect(receipts()).toBe(1);

        allowFirstCommit();
        await first.getByRole('button', { name: 'Verifica salvataggio' }).click();
        await expect(first.getByRole('textbox', { name: /Note/ })).toHaveValue('Pianificazione sintetica');
        await expect(pending).toHaveCount(0);
        expect(firstCommitStatuses).toEqual([429, 200]);
        expect(receipts()).toBe(2);

        const observed = await second.evaluate(async () => (await window.kindeReplicaFixture!.refresh()).data);
        expect(observed.nutritionPlanning).toMatchObject({
            onDaysCount: 3, weight: 78, notes: 'Pianificazione sintetica',
        });
        expect(observed.nutritionPlanningOrigin).toBe('user-edited');

        await first.getByRole('button', { name: 'Torna alla gestione account' }).click();
        await expect(save).toHaveCount(0);
        await expect(restore).toBeVisible();
    }, { planningUi: true });
});

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
