import { expect, test } from '../fixtures';
import { mountKindePlanning, withKindeReplicaDevices } from './kindeReplicaFixture';

test('reads and switches the active Kinde cycle with a verified second-device receipt', async ({ browser }) => {
    await withKindeReplicaDevices(browser, async ({ first, second, receipts, firstCommitStatuses, allowFirstCommit }) => {
        const seed = await second.evaluate(() => window.kindeReplicaFixture!.submit([
            { type: 'routine.create', routine: { id: 'cycles-routine', name: 'Allenamento A', exercises: [] } },
            { type: 'training-cycle.upsert', cycle: {
                id: 'cycles-old', name: 'Prima fase', durationWeeks: 4, routines: [],
            } },
            { type: 'training-cycle.upsert', cycle: {
                id: 'cycles-new', name: 'Seconda fase', durationWeeks: 6, sessionsPerWeek: 2,
                startDate: '2026-10-01', routines: [{ routineId: 'cycles-routine', frequencyPerWeek: 2 }],
            } },
            { type: 'active-cycle.switch', id: 'cycles-old', expectedActiveId: null },
        ]));
        expect(seed.kind).toBe('cloud-acknowledged');
        const before = receipts();
        await first.bringToFront();
        await mountKindePlanning(first);
        const cycles = first.getByRole('region', { name: 'Cicli di allenamento account' });
        await expect(cycles).toHaveCount(0);
        await first.getByRole('button', { name: 'Apri archivio account' }).click();
        const oldCycle = cycles.getByRole('article').filter({ hasText: 'Prima fase' });
        const newCycle = cycles.getByRole('article').filter({ hasText: 'Seconda fase' });
        await expect(oldCycle.getByText('Ciclo attivo', { exact: true })).toBeVisible();
        await newCycle.getByRole('button', { name: /Seconda fase/ }).click();
        await expect(newCycle.getByLabel('Sequenza schede del ciclo')).toContainText('Allenamento A');
        await expect(newCycle.getByRole('button', { name: 'Modifica', exact: true })).toHaveCount(0);
        expect(receipts()).toBe(before);

        await newCycle.getByRole('button', { name: 'Imposta come ciclo attivo' }).click();
        await expect.poll(() => firstCommitStatuses).toEqual([429]);
        await expect(cycles).toHaveCount(0);
        expect(receipts()).toBe(before);

        allowFirstCommit();
        await first.getByRole('button', { name: 'Verifica salvataggio' }).click();
        await expect(newCycle.getByText('Ciclo attivo', { exact: true })).toBeVisible();
        await expect(oldCycle.getByText('Ciclo attivo', { exact: true })).toHaveCount(0);
        expect(receipts()).toBe(before + 1);
        const readActive = () => second.evaluate(async () => (await window.kindeReplicaFixture!.refresh()).data.activeCycleId);
        expect(await readActive()).toBe('cycles-new');

        await newCycle.getByRole('button', { name: /Seconda fase/ }).click();
        const deactivate = newCycle.getByRole('button', { name: 'Disattiva ciclo' });
        const confirmation = first.getByRole('alertdialog', { name: 'Conferma' });
        await deactivate.click();
        await confirmation.getByRole('button', { name: 'Annulla' }).click();
        expect(receipts()).toBe(before + 1);
        await deactivate.click();
        await confirmation.getByRole('button', { name: 'Conferma' }).click();
        await expect.poll(() => firstCommitStatuses).toEqual([429, 200, 200]);
        await expect(cycles).toBeVisible();
        await expect(newCycle.getByText('Ciclo attivo', { exact: true })).toHaveCount(0);
        expect(receipts()).toBe(before + 2);
        expect(await readActive()).toBeNull();
    }, { planningUi: true });
});
