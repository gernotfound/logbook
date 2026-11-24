import { expect, test } from '../fixtures';
import { mountKindePlanning, withKindeReplicaDevices } from './kindeReplicaFixture';

test('recovers changes to Kinde history without replacing the current workout', async ({ browser }) => {
    await withKindeReplicaDevices(browser, async ({ first, second, receipts, allowFirstCommit }) => {
        expect(await second.evaluate(() => window.kindeReplicaFixture!.submit([
            { type: 'history.upsert', workout: { id: 'edit-history', date: '2026-11-20', routineName: 'Seduta storica',
                globalDurationStr: '00:30:00', exercises: [] } },
            { type: 'active-workout.set', workout: { id: 'kept-active', date: '2026-11-21',
                routineName: 'Seduta corrente', exercises: [] } },
        ]))).toMatchObject({ kind: 'cloud-acknowledged' });
        const before = receipts();
        allowFirstCommit();
        await first.bringToFront();
        const card = first.getByRole('article').filter({
            has: first.getByRole('button', { name: 'Apri il dettaglio di Seduta storica' }),
        });
        const open = async () => {
            await mountKindePlanning(first);
            await first.getByRole('button', { name: 'Apri archivio account' }).click();
            await expect(card).toBeVisible();
        };
        await open();
        await card.getByRole('button', { name: 'Opzioni' }).click();
        await card.getByRole('menuitem', { name: 'Modifica allenamento' }).click();
        const editor = first.getByRole('region', { name: 'Editor dello storico allenamenti' });
        const duration = editor.getByLabel('Durata della sessione');
        await duration.fill('45:90');
        await editor.getByRole('button', { name: 'Salva modifiche' }).click();
        await expect(editor.getByRole('alert')).toContainText('Usa una durata valida');
        expect(receipts()).toBe(before);

        await editor.getByLabel('Acqua bevuta (litri)').fill('1.25');
        await editor.getByRole('button', { name: 'Umore: 4 su 5' }).click();
        await duration.fill('00:45:00');
        await first.reload();
        await open();
        await first.getByRole('button', { name: 'Riprendi bozza dello storico' }).click();
        await expect(duration).toHaveValue('00:45:00');
        await expect(editor.getByLabel('Acqua bevuta (litri)')).toHaveValue('1.25');
        await editor.getByRole('button', { name: 'Salva modifiche' }).click();
        await expect.poll(receipts).toBe(before + 1);
        await expect(card).toBeVisible();
        const data = await second.evaluate(async () => (await window.kindeReplicaFixture!.refresh()).data);
        expect(data.activeWorkout).toMatchObject({ id: 'kept-active', routineName: 'Seduta corrente' });
        expect(data.history).toMatchObject([{ id: 'edit-history', globalDurationStr: '00:45:00', moodRating: 4, waterLiters: 1.25 }]);
    }, { planningUi: true });
});
