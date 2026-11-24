import { expect, test } from '../fixtures';
import { mountKindePlanning, withKindeReplicaDevices } from './kindeReplicaFixture';

test('recovers a Kinde cycle draft after reload and edits the same active cycle on a later commit', async ({ browser }) => {
    await withKindeReplicaDevices(browser, async ({ first, second, receipts, allowFirstCommit }) => {
        const seed = await second.evaluate(() => window.kindeReplicaFixture!.submit({
            type: 'routine.create', routine: { id: 'cycle-editor-routine', name: 'Scheda Forza', exercises: [] },
        }));
        expect(seed.kind).toBe('cloud-acknowledged');
        const before = receipts();
        allowFirstCommit();
        await first.bringToFront();
        const cycles = first.getByRole('region', { name: 'Cicli di allenamento account' });
        const open = async () => {
            await mountKindePlanning(first);
            await first.getByRole('button', { name: 'Apri archivio account' }).click();
            await expect(cycles).toBeVisible();
        };
        const resume = cycles.getByRole('button', { name: 'Nuovo o riprendi ciclo' });
        const name = cycles.getByLabel('Nome ciclo', { exact: true });
        await open();
        await resume.click();
        await name.fill('Ciclo in bozza');
        await cycles.getByRole('combobox', { name: 'Aggiungi scheda alla sequenza' }).fill('cycle-editor-routine');
        expect(receipts()).toBe(before);
        await first.reload();
        await open();
        await resume.click();
        await expect(name).toHaveValue('Ciclo in bozza');
        await expect(cycles.getByRole('heading', { name: 'Sequenza rotazione schede (1)' })).toBeVisible();
        await cycles.getByRole('button', { name: 'Salva ciclo', exact: true }).click();
        const original = cycles.getByRole('article').filter({ hasText: 'Ciclo in bozza' });
        await expect(original.getByText('Ciclo attivo', { exact: true })).toBeVisible();
        await expect.poll(receipts).toBe(before + 1);
        const current = () => second.evaluate(async () => {
            const data = (await window.kindeReplicaFixture!.refresh()).data;
            return { active: data.activeCycleId, cycles: data.trainingCycles };
        });
        const saved = await current();
        expect(saved.cycles).toMatchObject([{ name: 'Ciclo in bozza', routines: [{ routineId: 'cycle-editor-routine' }] }]);
        expect(saved.active).toBe(saved.cycles?.[0]?.id);

        await original.getByRole('button', { name: 'Opzioni' }).click();
        await original.getByRole('menuitem', { name: 'Modifica' }).click();
        await name.fill('Ciclo riveduto');
        await cycles.getByRole('button', { name: 'Chiudi e conserva bozza' }).click();
        await resume.click();
        await expect(name).toHaveValue('Ciclo riveduto');
        await cycles.getByRole('button', { name: 'Salva modifiche' }).click();
        await expect(cycles.getByRole('article').filter({ hasText: 'Ciclo riveduto' })).toBeVisible();
        await expect.poll(receipts).toBe(before + 2);
        const edited = await current();
        expect(edited.active).toBe(saved.active);
        expect(edited.cycles).toMatchObject([{ id: saved.active, name: 'Ciclo riveduto' }]);
    }, { planningUi: true });
});

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
        await expect(newCycle.getByRole('button', { name: 'Modifica', exact: true })).toBeEnabled();
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

test('duplicates and removes a Kinde cycle without deleting its routine or training history', async ({ browser }) => {
    await withKindeReplicaDevices(browser, async ({ first, second, receipts, allowFirstCommit }) => {
        const seed = await second.evaluate(() => window.kindeReplicaFixture!.submit([
            { type: 'routine.create', routine: { id: 'kept-routine', name: 'Seduta', exercises: [] } },
            { type: 'training-cycle.upsert', cycle: {
                id: 'original-cycle', name: 'Forza', durationWeeks: 6,
                routines: [{ routineId: 'kept-routine', frequencyPerWeek: 1 }],
            } },
            { type: 'active-cycle.switch', id: 'original-cycle', expectedActiveId: null },
            { type: 'history.upsert', workout: {
                id: 'kept-workout', date: '2026-10-01', cycleId: 'original-cycle', routineName: 'Seduta', exercises: [],
            } },
        ]));
        expect(seed.kind).toBe('cloud-acknowledged');
        const initialReceipts = receipts();
        allowFirstCommit();
        await first.bringToFront();
        await mountKindePlanning(first);
        await first.getByRole('button', { name: 'Apri archivio account' }).click();
        const archive = first.getByRole('region', { name: 'Cicli di allenamento account' });
        const original = archive.getByRole('article').filter({ has: first.getByText('Forza', { exact: true }) });
        const duplicate = archive.getByRole('article').filter({ has: first.getByText('Forza - 1', { exact: true }) });
        await original.getByRole('button', { name: 'Opzioni' }).click();
        await original.getByRole('menuitem', { name: 'Duplica' }).click();
        await expect(duplicate).toBeVisible();
        await expect(original.getByText('Ciclo attivo', { exact: true })).toBeVisible();
        expect(receipts()).toBe(initialReceipts + 1);

        const requestDelete = async () => {
            await original.getByRole('button', { name: 'Opzioni' }).click();
            await original.getByRole('menuitem', { name: 'Elimina' }).click();
            return first.getByRole('alertdialog', { name: 'Conferma' });
        };
        await (await requestDelete()).getByRole('button', { name: 'Annulla' }).click();
        await expect(original).toBeVisible();
        expect(receipts()).toBe(initialReceipts + 1);
        await (await requestDelete()).getByRole('button', { name: 'Conferma' }).click();
        await expect(duplicate.getByText('Ciclo attivo', { exact: true })).toBeVisible();
        await expect(original).toHaveCount(0);
        expect(receipts()).toBe(initialReceipts + 2);
        const data = await second.evaluate(async () => (await window.kindeReplicaFixture!.refresh()).data);
        expect(data.trainingCycles).toHaveLength(1);
        expect(data.trainingCycles?.[0]).toMatchObject({
            name: 'Forza - 1', routines: [{ routineId: 'kept-routine', frequencyPerWeek: 1 }],
        });
        expect(data.activeCycleId).toBe(data.trainingCycles?.[0]?.id);
        expect(data.routines).toMatchObject([{ id: 'kept-routine' }]);
        expect(data.history).toMatchObject([{ id: 'kept-workout', cycleId: 'original-cycle' }]);
    }, { planningUi: true });
});
