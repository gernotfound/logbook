import { expect, test } from '../fixtures';
import { mountKindePlanning, withKindeReplicaDevices } from './kindeReplicaFixture';

test('Kinde routine deletion requires confirmation, preserves an unacknowledged journal and converges after retry', async ({ browser }) => {
    await withKindeReplicaDevices(browser, async ({
        first, second, receipts, firstCommitStatuses, allowFirstCommit,
    }) => {
        expect(await second.evaluate(() => window.kindeReplicaFixture!.submit({
            type: 'routine.upsert',
            routine: { id: 'rtn-delete-e2e', name: 'Scheda da eliminare', exercises: [] },
        }))).toMatchObject({ kind: 'cloud-acknowledged' });
        const initialReceipts = receipts();

        await first.bringToFront();
        await mountKindePlanning(first);
        await first.getByRole('button', { name: 'Apri archivio account' }).click();
        const library = first.getByRole('region', { name: 'Schede allenamento account' });
        await expect(library.getByText('Scheda da eliminare')).toBeVisible();

        async function requestDeletion() {
            await library.getByRole('button', { name: 'Opzioni' }).click();
            await library.getByRole('menuitem', { name: 'Elimina' }).click();
            const dialog = first.getByRole('alertdialog', { name: 'Conferma' });
            await expect(dialog).toContainText('Sei sicuro di voler eliminare questa scheda?');
            return dialog;
        }

        const canceled = await requestDeletion();
        await canceled.getByRole('button', { name: 'Annulla' }).click();
        await expect(canceled).toHaveCount(0);
        await expect(library.getByText('Scheda da eliminare')).toBeVisible();
        expect(firstCommitStatuses).toEqual([]);
        expect(receipts()).toBe(initialReceipts);

        const confirmed = await requestDeletion();
        await confirmed.getByRole('button', { name: 'Conferma' }).click();
        await expect.poll(() => firstCommitStatuses, { timeout: 20_000 }).toEqual([429]);
        await expect(first.getByRole('button', { name: 'Verifica salvataggio' })).toBeVisible();
        await expect(library).toHaveCount(0);
        expect(receipts()).toBe(initialReceipts);
        const prior = await second.evaluate(async () =>
            (await window.kindeReplicaFixture!.refresh()).data.routines?.map(routine => routine.id) ?? []);
        expect(prior).toContain('rtn-delete-e2e');

        allowFirstCommit();
        await first.getByRole('button', { name: 'Verifica salvataggio' }).click();
        await expect.poll(() => firstCommitStatuses, { timeout: 20_000 }).toEqual([429, 200]);
        await expect.poll(() => receipts(), { timeout: 20_000 }).toBe(initialReceipts + 1);
        await expect(library.getByText('Nessuna scheda creata.')).toBeVisible();
        const final = await second.evaluate(async () =>
            (await window.kindeReplicaFixture!.refresh()).data.routines?.map(routine => routine.id) ?? []);
        expect(final).not.toContain('rtn-delete-e2e');
    }, { planningUi: true });
});
