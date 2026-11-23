import { expect, test } from '../fixtures';
import { mountKindePlanning, withKindeReplicaDevices } from './kindeReplicaFixture';

test('recovers Kinde steps after reload, then confirms save and removal on another device', async ({ browser }) => {
    await withKindeReplicaDevices(browser, async ({ first, second, receipts, allowFirstCommit }) => {
        const date = '2026-10-12';
        const baseline = await second.evaluate(date => window.kindeReplicaFixture!.submit({
            type: 'nutrition-day.patch', date, patch: { sleepHours: '07:15' },
        }), date);
        expect(baseline.kind).toBe('cloud-acknowledged');
        const before = receipts();
        allowFirstCommit();
        await first.bringToFront();
        const steps = first.getByRole('region', { name: 'Passi account' });
        const open = async () => {
            await mountKindePlanning(first);
            await first.getByRole('button', { name: 'Apri archivio account' }).click();
            await first.getByLabel('Giorno attività').fill(date);
        };
        const edit = steps.getByRole('button', { name: 'Modifica o riprendi passi' });
        const input = steps.getByRole('spinbutton', { name: 'Numero di passi' });

        await open();
        await edit.click();
        await input.fill('8124');
        expect(receipts()).toBe(before);
        await first.reload();
        await open();
        await edit.click();
        await expect(input).toHaveValue('8124');
        await steps.getByRole('button', { name: 'Salva passi' }).click();
        await expect(steps.getByText(/^8[.\s]?124 passi$/)).toBeVisible();
        await expect.poll(receipts).toBe(before + 1);

        const readFromSecond = () => second.evaluate(async date =>
            (await window.kindeReplicaFixture!.refresh()).data.nutrition?.[date], date);
        expect(await readFromSecond()).toMatchObject({ steps: 8124, sleepHours: '07:15' });
        const remove = steps.getByRole('button', { name: 'Rimuovi passi registrati' });
        const confirm = first.getByRole('alertdialog', { name: 'Conferma' });
        await remove.click();
        await confirm.getByRole('button', { name: 'Annulla' }).click();
        expect(receipts()).toBe(before + 1);
        await remove.click();
        await confirm.getByRole('button', { name: 'Conferma' }).click();
        await expect(steps.getByText('Nessun dato per questo giorno.')).toBeVisible();
        await expect.poll(receipts).toBe(before + 2);
        const day = await readFromSecond();
        expect(day?.steps).toBeUndefined();
        expect(day?.sleepHours).toBe('07:15');
    }, { planningUi: true });
});
