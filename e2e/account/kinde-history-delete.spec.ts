import { expect, test, type Page } from '../fixtures';
import { mountKindePlanning, withKindeReplicaDevices } from './kindeReplicaFixture';

// Exercise the real account confirmation UI against synthetic D1 receipts and
// two TLS-isolated browser profiles, never the public fitness binding.
async function requestHistoryDeletion(page: Page, workoutName: string): Promise<void> {
    const workoutCard = page.locator('.history-workout-card').filter({
        has: page.getByRole('button', { name: 'Apri il dettaglio di ' + workoutName }),
    });
    await workoutCard.getByRole('button', { name: 'Opzioni' }).click();
    await workoutCard.getByRole('menuitem', { name: 'Elimina allenamento' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Conferma' });
    await expect(dialog).toContainText('Eliminare definitivamente questo allenamento dallo storico?');
}

async function seedUnrelatedHistory(page: Page): Promise<void> {
    // Keep a sibling session so an accidental "delete whole history" mutation
    // cannot pass by making the one seeded workout disappear.
    const result = await page.evaluate(() => window.kindeReplicaFixture!.submit({
        type: 'history.upsert', workout: {
            id: 'keep-history', date: '2026-11-20',
            routineName: 'Storico da conservare', exercises: [],
        },
    }));
    expect(result).toMatchObject({ kind: 'cloud-acknowledged' });
}

test('Kinde history deletion requires confirmation and one verified receipt before second-device removal', async ({ browser }) => {
    await withKindeReplicaDevices(browser, async ({
        first, second, receipts, firstCommitStatuses, allowFirstCommit,
    }) => {
        const seeded = await second.evaluate(() => window.kindeReplicaFixture!.submit({
            type: 'history.upsert', workout: {
                id: 'delete-history', date: '2026-11-20',
                routineName: 'Storico da cancellare', exercises: [],
            },
        }));
        expect(seeded).toMatchObject({ kind: 'cloud-acknowledged' });
        await seedUnrelatedHistory(second);
        const before = receipts();

        await first.bringToFront();
        await mountKindePlanning(first);
        await first.getByRole('button', { name: 'Apri archivio account' }).click();
        const card = first.getByRole('button', { name: 'Apri il dettaglio di Storico da cancellare' });
        await expect(card).toBeVisible();
        const keptCard = first.getByRole('button', { name: 'Apri il dettaglio di Storico da conservare' });
        await expect(keptCard).toBeVisible();

        await requestHistoryDeletion(first, 'Storico da cancellare');
        const dialog = first.getByRole('alertdialog', { name: 'Conferma' });
        await dialog.getByRole('button', { name: 'Annulla' }).click();
        await expect(dialog).toHaveCount(0);
        await expect(card).toBeVisible();
        await expect(keptCard).toBeVisible();
        expect(firstCommitStatuses).toEqual([]);
        expect(receipts()).toBe(before);

        allowFirstCommit();
        await requestHistoryDeletion(first, 'Storico da cancellare');
        await dialog.getByRole('button', { name: 'Conferma' }).click();
        // The card unmounts while submit is opening; that alone proves no cloud ACK.
        await expect.poll(() => firstCommitStatuses, { timeout: 20_000 }).toEqual([200]);
        await expect.poll(() => receipts(), { timeout: 20_000 }).toBe(before + 1);
        await expect(card).toHaveCount(0);
        await expect(keptCard).toBeVisible();

        const replicated = await second.evaluate(async () =>
            (await window.kindeReplicaFixture!.refresh()).data.history?.map(item => item.id) ?? []);
        expect(replicated).toEqual(['keep-history']);
    }, { planningUi: true });
});

test('Kinde history deletion retains the original pending journal after HTTP 429 and confirms only on retry', async ({ browser }) => {
    await withKindeReplicaDevices(browser, async ({
        first, second, receipts, firstCommitStatuses, allowFirstCommit,
    }) => {
        const seeded = await second.evaluate(() => window.kindeReplicaFixture!.submit({
            type: 'history.upsert', workout: {
                id: 'pending-history', date: '2026-11-20',
                routineName: 'Storico in attesa', exercises: [],
            },
        }));
        expect(seeded).toMatchObject({ kind: 'cloud-acknowledged' });
        await seedUnrelatedHistory(second);
        const before = receipts();

        await first.bringToFront();
        await mountKindePlanning(first);
        await first.getByRole('button', { name: 'Apri archivio account' }).click();
        await expect(first.getByRole('button', {
            name: 'Apri il dettaglio di Storico in attesa',
        })).toBeVisible();
        const keptCard = first.getByRole('button', { name: 'Apri il dettaglio di Storico da conservare' });
        await expect(keptCard).toBeVisible();
        await requestHistoryDeletion(first, 'Storico in attesa');
        await first.getByRole('alertdialog', { name: 'Conferma' })
            .getByRole('button', { name: 'Conferma' }).click();

        // Wait for the actual 429, not the temporary opening state after the dialog.
        await expect.poll(() => firstCommitStatuses, { timeout: 20_000 }).toEqual([429]);
        await expect(first.getByRole('button', { name: 'Verifica salvataggio' })).toBeVisible();
        await expect(first.getByRole('heading', { name: 'Storico allenamenti' })).toHaveCount(0);
        expect(receipts()).toBe(before);
        const beforeRecovery = await second.evaluate(async () =>
            (await window.kindeReplicaFixture!.refresh()).data.history?.map(item => item.id) ?? []);
        expect(beforeRecovery).toEqual(expect.arrayContaining(['pending-history', 'keep-history']));
        expect(beforeRecovery).toHaveLength(2);

        allowFirstCommit();
        await first.getByRole('button', { name: 'Verifica salvataggio' }).click();
        await expect.poll(() => firstCommitStatuses, { timeout: 20_000 }).toEqual([429, 200]);
        await expect.poll(() => receipts(), { timeout: 20_000 }).toBe(before + 1);
        await expect(first.getByRole('heading', { name: 'Storico allenamenti' })).toBeVisible();
        await expect(first.getByRole('button', {
            name: 'Apri il dettaglio di Storico in attesa',
        })).toHaveCount(0);
        await expect(keptCard).toBeVisible();
        const recovered = await second.evaluate(async () =>
            (await window.kindeReplicaFixture!.refresh()).data.history?.map(item => item.id) ?? []);
        expect(recovered).toEqual(['keep-history']);
    }, { planningUi: true });
});
