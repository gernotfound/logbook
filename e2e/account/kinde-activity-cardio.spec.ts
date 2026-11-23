import { expect, test } from '../fixtures';
import { mountKindePlanning, withKindeReplicaDevices } from './kindeReplicaFixture';

test('recovers cardio on the selected day and retains the draft of a session removed by another device', async ({ browser }) => {
    await withKindeReplicaDevices(browser, async ({ first, second, receipts, allowFirstCommit }) => {
        const date = '2026-10-12';
        const seed = await second.evaluate(date => window.kindeReplicaFixture!.submit([
            { type: 'activity-steps.set', date, steps: 4100 },
            { type: 'nutrition-day.patch', date, patch: { sleepHours: '07:05' } },
            { type: 'cardio-session.upsert', date, session: {
                id: 'seed-bike', modality: 'bike', durationMinutes: 25, intensity: 'moderate',
            } },
        ]), date);
        expect(seed.kind).toBe('cloud-acknowledged');
        const before = receipts();
        allowFirstCommit();
        await first.bringToFront();
        const activity = first.getByRole('region', { name: 'Attività account' });
        const datePicker = activity.getByLabel('Giorno attività');
        const cardio = activity.getByRole('region', { name: 'Cardio del giorno' });
        const start = cardio.getByRole('button', { name: 'Aggiungi o riprendi cardio' });
        const duration = cardio.getByRole('spinbutton', { name: 'Durata (min)' });
        const confirmation = first.getByRole('alertdialog', { name: 'Conferma' });
        const open = async () => {
            await mountKindePlanning(first);
            await first.getByRole('button', { name: 'Apri archivio account' }).click();
            await datePicker.fill(date);
        };

        await open();
        await expect(activity.getByText(/^4[.\s]?100 passi$/)).toBeVisible();
        await start.click();
        await expect(datePicker).toBeDisabled();
        await expect(activity.getByRole('button', { name: 'Modifica o riprendi passi' })).toBeDisabled();
        await cardio.getByRole('combobox', { name: /^Modalità/ }).selectOption('walk');
        await duration.fill('35');
        await cardio.getByRole('combobox', { name: /^Intensità/ }).selectOption('moderate');
        expect(receipts()).toBe(before);
        await first.reload();
        await open();
        await start.click();
        await expect(duration).toHaveValue('35');
        await cardio.getByRole('button', { name: 'Salva cardio' }).click();
        await expect(cardio.getByText('Camminata', { exact: true })).toBeVisible();
        await expect.poll(receipts).toBe(before + 1);

        const removeBike = cardio.getByRole('button', { name: 'Elimina Cyclette' });
        await removeBike.click();
        await confirmation.getByRole('button', { name: 'Annulla' }).click();
        await expect(removeBike).toBeVisible();
        expect(receipts()).toBe(before + 1);
        await removeBike.click();
        await confirmation.getByRole('button', { name: 'Conferma' }).click();
        await expect(removeBike).toHaveCount(0);
        await expect.poll(receipts).toBe(before + 2);

        await cardio.getByRole('button', { name: 'Modifica Camminata' }).click();
        await duration.fill('41');
        await cardio.getByRole('button', { name: 'Chiudi e conserva bozza cardio' }).click();
        const removeFromSecond = await second.evaluate(async date => {
            const realm = window.kindeReplicaFixture!;
            const day = (await realm.refresh()).data.nutrition?.[date];
            const session = day?.cardioSessions?.find(item => item.modality === 'walk');
            if (!session) throw new Error('Missing verified session on the second device');
            return realm.submit({ type: 'cardio-session.delete', date, sessionId: session.id, expected: session });
        }, date);
        expect(removeFromSecond.kind).toBe('cloud-acknowledged');

        await first.reload();
        await open();
        await expect(cardio.getByText('Nessuna sessione cardio registrata per questo giorno.')).toBeVisible();
        await start.click();
        await expect(duration).toHaveValue('41');
        await expect(cardio.getByRole('status')).toContainText('è cambiata o è stata eliminata');
        await expect(cardio.getByRole('button', { name: 'Salva cardio' })).toBeDisabled();
        await cardio.getByRole('button', { name: 'Elimina bozza cardio' }).click();
        await confirmation.getByRole('button', { name: 'Conferma' }).click();
        await start.click();
        await expect(duration).toHaveValue('');
        expect(receipts()).toBe(before + 3);
        const day = await second.evaluate(async date =>
            (await window.kindeReplicaFixture!.refresh()).data.nutrition?.[date], date);
        expect(day).toMatchObject({ steps: 4100, sleepHours: '07:05', cardioSessions: [] });
    }, { planningUi: true });
});
