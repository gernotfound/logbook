import { expect, test } from '../fixtures';
import { loadKindeReplica, mountKindePlanning, withKindeReplicaDevices } from './kindeReplicaFixture';

test('reads owner-scoped Kinde routines without legacy actions or a new D1 receipt', async ({ browser }) => {
    await withKindeReplicaDevices(browser, async ({ first, second, receipts, firstCommitStatuses }) => {
        const seed = await second.evaluate(() => window.kindeReplicaFixture!.submit([
            { type: 'exercise.upsert', exercise: {
                id: 'routine-ex', name: 'Squat Kinde', setsCount: 1,
                muscles: [], secondaryMuscles: [], sets: [],
            } },
            { type: 'routine.upsert', routine: {
                id: 'rtn-kinde', name: 'Scheda Kinde',
                exercises: [{ exId: 'routine-ex', setsCount: 3, minReps: 6, maxReps: 10 }],
            } },
        ]));
        expect(seed).toMatchObject({ kind: 'cloud-acknowledged' });
        const initialReceipts = receipts();

        await first.bringToFront();
        await mountKindePlanning(first);
        const library = first.getByRole('region', { name: 'Schede allenamento account' });
        await expect(library).toHaveCount(0);
        await first.getByRole('button', { name: 'Apri archivio account' }).click();
        await expect(library).toBeVisible();
        await expect(library.getByText('Scheda Kinde')).toBeVisible();
        await library.getByRole('button', { name: 'Opzioni' }).click();
        await expect(library.getByRole('menuitem', { name: 'Modifica' })).toHaveCount(0);
        await expect(library.getByRole('menuitem', { name: 'Duplica' })).toBeVisible();
        await expect(library.getByRole('menuitem', { name: 'Elimina' })).toBeVisible();
        await library.getByRole('button', { name: 'Opzioni' }).click();

        await library.getByRole('button', { name: /Apri scheda/ }).click();
        await expect(library.getByText('Squat Kinde')).toBeVisible();
        await expect(library.getByText('3 × 6–10')).toBeVisible();

        await library.getByRole('searchbox', { name: 'Cerca scheda per nome' }).fill('non presente');
        await expect(library.getByText('Nessuna scheda trovata.')).toBeVisible();
        await library.getByRole('button', { name: 'Cancella ricerca' }).click();
        await expect(library.getByText('Scheda Kinde')).toBeVisible();
        expect(firstCommitStatuses).toEqual([]);
        expect(receipts()).toBe(initialReceipts);

        await first.getByRole('button', { name: 'Torna alla gestione account' }).click();
        await expect(library).toHaveCount(0);
    }, { planningUi: true });
});

test('duplicates a Kinde routine from the verified archive and replicates it once to a second device', async ({ browser }) => {
    await withKindeReplicaDevices(browser, async ({ first, second, receipts, firstCommitStatuses, allowFirstCommit }) => {
        expect(await second.evaluate(() => window.kindeReplicaFixture!.submit([
            { type: 'exercise.upsert', exercise: {
                id: 'clone-ex', name: 'Squat da duplicare', setsCount: 1,
                muscles: [], secondaryMuscles: [], sets: [],
            } },
            { type: 'routine.upsert', routine: {
                id: 'clone-original', name: 'Programma Kinde',
                exercises: [{ exId: 'clone-ex', setsCount: 3, minReps: 8, maxReps: 12 }],
            } },
        ]))).toMatchObject({ kind: 'cloud-acknowledged' });
        const before = receipts();
        await first.bringToFront();
        await mountKindePlanning(first);
        await first.getByRole('button', { name: 'Apri archivio account' }).click();
        const library = first.getByRole('region', { name: 'Schede allenamento account' });
        await expect(library.getByText('Programma Kinde')).toBeVisible();

        // This fixture intentionally rejects the first write with HTTP 429 unless
        // explicitly enabled. Here the test proves a successful verified receipt.
        allowFirstCommit();
        await library.getByRole('button', { name: 'Opzioni' }).click();
        await library.getByRole('menuitem', { name: 'Duplica' }).click();
        await expect(library.getByText('Programma Kinde - 1')).toBeVisible();
        expect(firstCommitStatuses).toEqual([200]);
        expect(receipts()).toBe(before + 1);

        const observed = await second.evaluate(async () =>
            (await window.kindeReplicaFixture!.refresh()).data.routines);
        expect(observed).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'clone-original', name: 'Programma Kinde' }),
            expect.objectContaining({ name: 'Programma Kinde - 1',
                exercises: [{ exId: 'clone-ex', setsCount: 3, minReps: 8, maxReps: 12 }] }),
        ]));
        expect(observed?.map(r => r.id)).toHaveLength(2);
        expect(observed?.[0].id).not.toBe(observed?.[1].id);
    }, { planningUi: true });
});

test('keeps a duplicated Kinde routine in the original encrypted journal after a lost receipt', async ({ browser }) => {
    await withKindeReplicaDevices(browser, async ({ first, second, receipts, firstCommitStatuses, allowFirstCommit }) => {
        expect(await second.evaluate(() => window.kindeReplicaFixture!.submit({
            type: 'routine.upsert', routine: {
                id: 'retry-original', name: 'Scheda da recuperare',
                exercises: [],
            },
        }))).toMatchObject({ kind: 'cloud-acknowledged' });
        const before = receipts();

        await first.bringToFront();
        await mountKindePlanning(first);
        await first.getByRole('button', { name: 'Apri archivio account' }).click();
        const library = first.getByRole('region', { name: 'Schede allenamento account' });
        await library.getByRole('button', { name: 'Opzioni' }).click();
        await library.getByRole('menuitem', { name: 'Duplica' }).click();

        await expect(first.getByRole('button', { name: 'Verifica salvataggio' })).toBeVisible();
        await expect(library).toHaveCount(0);
        expect(firstCommitStatuses).toEqual([429]);
        expect(receipts()).toBe(before);
        const prior = await second.evaluate(async () =>
            (await window.kindeReplicaFixture!.refresh()).data.routines?.map(item => item.name));
        expect(prior).toEqual(['Scheda da recuperare']);

        allowFirstCommit();
        await first.getByRole('button', { name: 'Verifica salvataggio' }).click();
        await expect(library.getByText('Scheda da recuperare - 1')).toBeVisible();
        expect(firstCommitStatuses).toEqual([429, 200]);
        expect(receipts()).toBe(before + 1);
        const final = await second.evaluate(async () =>
            (await window.kindeReplicaFixture!.refresh()).data.routines?.map(item => item.name));
        expect(final).toEqual(expect.arrayContaining(['Scheda da recuperare', 'Scheda da recuperare - 1']));
        expect(final).toHaveLength(2);
    }, { planningUi: true });
});

test('reads Kinde training history and report without writing another owner\'s data', async ({ browser }) => {
    await withKindeReplicaDevices(browser, async ({ first, second, receipts, firstCommitStatuses }) => {
        const saved = await second.evaluate(() => window.kindeReplicaFixture!.submit([
            { type: 'exercise.upsert', exercise: {
                id: 'history-ex', name: 'Squat Kinde', setsCount: 1, muscles: [], secondaryMuscles: [], sets: [],
            } },
            { type: 'history.upsert', workout: {
                id: 'history-2026', date: '2026-11-20', routineName: 'Sessione Kinde',
                globalStartTime: Date.UTC(2026, 10, 20, 11),
                globalEndTime: Date.UTC(2026, 10, 20, 11, 45),
                exercises: [{ id: 'history-ex-instance', exId: 'history-ex', sessionNote: '',
                    sets: [{ id: 'history-set', kg: '40', reps: '10', done: true }] }],
            } },
        ]));
        expect(saved).toMatchObject({ kind: 'cloud-acknowledged' });
        const initialReceipts = receipts();

        await first.bringToFront();
        await mountKindePlanning(first);
        const history = first.getByRole('heading', { name: 'Storico allenamenti' });
        await expect(history).toHaveCount(0);
        await first.getByRole('button', { name: 'Apri archivio account' }).click();
        await expect(history).toBeVisible();
        const card = first.getByRole('button', { name: 'Apri il dettaglio di Sessione Kinde' });
        await expect(card).toBeVisible();

        await first.getByRole('button', { name: 'Opzioni' }).click();
        await expect(first.getByRole('menuitem', { name: 'Vedi report' })).toBeVisible();
        await expect(first.getByRole('menuitem', { name: 'Elimina allenamento' })).toBeVisible();
        await expect(first.getByRole('menuitem', { name: 'Modifica allenamento' })).toHaveCount(0);
        await card.click();
        const report = first.getByRole('dialog', { name: 'Sessione Kinde' });
        await expect(report).toBeVisible();
        await expect(report.getByText('Squat Kinde')).toBeVisible();
        await report.getByRole('button', { name: 'Chiudi', exact: true }).click();
        await expect(report).toHaveCount(0);

        expect(receipts()).toBe(initialReceipts);
        expect(firstCommitStatuses).toEqual([]);
        await first.getByRole('button', { name: 'Torna alla gestione account' }).click();
        await expect(history).toHaveCount(0);
    }, { planningUi: true });
});

test('keeps a biometric edit pending until the Kinde journal is verified', async ({ browser }) => {
    await withKindeReplicaDevices(browser, async ({ first, second, receipts, firstCommitStatuses, allowFirstCommit }) => {
        await first.bringToFront();
        await mountKindePlanning(first);
        const height = first.getByLabel(/^Altezza/);
        const pending = first.getByText('Conferma cloud in attesa', { exact: false });
        const restore = first.getByRole('heading', { name: 'Ripristina backup account' });
        await expect(height).toHaveCount(0);
        await expect(restore).toBeVisible();
        await first.getByRole('button', { name: 'Apri archivio account' }).click();
        await height.fill('184');
        await expect(restore).toHaveCount(0);
        // The other device changes a different biometric field after the first
        // device captured its snapshot. Saving height must preserve that edit.
        expect(await second.evaluate(() => window.kindeReplicaFixture!.submit({
            type: 'profile.patch', patch: { gender: 'F' },
        }))).toMatchObject({ kind: 'cloud-acknowledged' });
        await first.getByRole('button', { name: 'Salva profilo biometrico' }).click();

        await expect(pending).toBeVisible();
        await expect(height).toHaveCount(0);
        expect(firstCommitStatuses).toEqual([429]);
        expect(receipts()).toBe(1);

        allowFirstCommit();
        await first.getByRole('button', { name: 'Verifica salvataggio' }).click();
        await expect(height).toHaveValue('184');
        await expect(pending).toHaveCount(0);
        expect(firstCommitStatuses).toEqual([429, 200]);
        expect(receipts()).toBe(2);
        expect(await second.evaluate(async () =>
            (await window.kindeReplicaFixture!.refresh()).data.profile)).toMatchObject({ height: '184', gender: 'F' });

        await first.getByRole('button', { name: 'Torna alla gestione account' }).click();
        await expect(height).toHaveCount(0);
        await expect(restore).toBeVisible();
    }, { planningUi: true });
});

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

test('adds, edits and removes a meal through the Kinde diary on the selected day', async ({ browser }) => {
    await withKindeReplicaDevices(browser, async ({ first, second, receipts, firstCommitStatuses, allowFirstCommit }) => {
        const foodName = 'Riso della fixture';
        expect(await second.evaluate(name => window.kindeReplicaFixture!.submit({
            type: 'food.upsert',
            food: { id: 'rice-fixture', name, baseQty: 100, unit: 'g', kcal: 350, carbs: 75, pro: 7, fat: 1 },
        }), foodName)).toMatchObject({ kind: 'cloud-acknowledged' });
        const yesterday = await first.evaluate(() => {
            const date = new Date();
            date.setDate(date.getDate() - 1);
            const twoDigits = (value: number) => String(value).padStart(2, '0');
            return [date.getFullYear(), twoDigits(date.getMonth() + 1), twoDigits(date.getDate())].join('-');
        });
        await first.bringToFront();
        await mountKindePlanning(first);
        const diary = first.getByRole('region', { name: 'Diario pasti' });
        await expect(diary).toHaveCount(0);
        await first.getByRole('button', { name: 'Apri archivio account' }).click();
        await diary.getByRole('button', { name: /Giorno precedente/ }).click();
        await diary.getByRole('searchbox', { name: 'Cerca alimento' }).fill(foodName);
        await diary.getByRole('button', { name: `Aggiungi ${foodName} a Pranzo` }).click();

        const pending = first.getByText('Conferma cloud in attesa', { exact: false });
        await expect(pending).toBeVisible();
        await expect(diary).toHaveCount(0);
        expect(firstCommitStatuses).toEqual([429]);
        expect(receipts()).toBe(1);

        allowFirstCommit();
        await first.getByRole('button', { name: 'Verifica salvataggio' }).click();
        const edit = diary.getByRole('button', { name: `Modifica porzione di ${foodName}` });
        await expect(edit).toBeVisible();
        await expect(pending).toHaveCount(0);
        expect(receipts()).toBe(2);
        await edit.click();
        await diary.getByRole('spinbutton', { name: /Quantità/ }).fill('60');
        await diary.getByRole('button', { name: 'Salva', exact: true }).click();
        await expect(edit).toContainText('60g');

        const readMeals = () => second.evaluate(async date =>
            (await window.kindeReplicaFixture!.refresh()).data.nutrition?.[date]?.meals ?? [], yesterday);
        expect(await readMeals()).toMatchObject([{ name: foodName, meal: 'Pranzo', quantity: 60 }]);
        expect(receipts()).toBe(3);

        await diary.getByRole('button', { name: `Rimuovi ${foodName}` }).click();
        await expect(diary).toBeVisible();
        await expect(edit).toHaveCount(0);
        expect(await readMeals()).toEqual([]);
        expect(firstCommitStatuses).toEqual([429, 200, 200, 200]);
        expect(receipts()).toBe(4);
    }, { planningUi: true });
});

test('reads Kinde meal history and opens the selected day without a write', async ({ browser }) => {
    await withKindeReplicaDevices(browser, async ({ first, second, receipts, firstCommitStatuses }) => {
        expect(await second.evaluate(() => {
            const meal = { meal: 'Pranzo', quantity: 100, kcal: 90, carbs: 3, pro: 2, fat: 1 };
            return window.kindeReplicaFixture!.submit([
                { type: 'nutrition-meal.upsert', date: '2026-09-13', meal: { ...meal, id: 'older', name: 'Pasto precedente' } },
                { type: 'nutrition-meal.upsert', date: '2026-09-15', meal: { ...meal, id: 'latest', name: 'Pasto recente' } },
                { type: 'nutrition-day.patch', date: '2026-09-16', patch: { weight: 78 } },
            ]);
        })).toMatchObject({ kind: 'cloud-acknowledged' });
        const initialReceipts = receipts();

        await first.bringToFront();
        await mountKindePlanning(first);
        const diary = first.getByRole('region', { name: 'Diario pasti' });
        await expect(diary).toHaveCount(0);
        await first.getByRole('button', { name: 'Apri archivio account' }).click();
        await diary.getByRole('tab', { name: 'Storico' }).click();
        const days = diary.getByRole('button', { name: /^Apri il diario del/ });
        await expect(days).toHaveCount(2);
        await days.first().press('Enter');
        await expect(diary.getByRole('tab', { name: 'Pasti' })).toBeFocused();
        await expect(diary.getByRole('button', { name: 'Modifica porzione di Pasto recente' })).toBeVisible();
        await expect(diary.getByRole('button', { name: 'Modifica porzione di Pasto precedente' })).toHaveCount(0);

        await diary.getByRole('tab', { name: 'Storico' }).click();
        await days.last().click();
        await expect(diary.getByRole('button', { name: 'Modifica porzione di Pasto precedente' })).toBeVisible();
        expect(receipts()).toBe(initialReceipts);
        expect(firstCommitStatuses).toEqual([]);

        await first.getByRole('button', { name: 'Torna alla gestione account' }).click();
        await expect(diary).toHaveCount(0);
    }, { planningUi: true });
});

test('manages supplements and dated intakes through the Kinde archive', async ({ browser }) => {
    await withKindeReplicaDevices(browser, async ({ first, second, receipts, firstCommitStatuses, allowFirstCommit }) => {
        expect(await second.evaluate(() => window.kindeReplicaFixture!.submit({
            type: 'supplement.upsert', supplement: { id: 'magnesium', name: 'Magnesio fixture', unit: 'mg' },
        }))).toMatchObject({ kind: 'cloud-acknowledged' });
        const yesterday = await first.evaluate(() => {
            const date = new Date();
            date.setDate(date.getDate() - 1);
            const pad = (value: number) => String(value).padStart(2, '0');
            return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-');
        });
        await first.bringToFront();
        await mountKindePlanning(first);
        const diary = first.getByRole('region', { name: 'Diario pasti' });
        await expect(diary).toHaveCount(0);
        await first.getByRole('button', { name: 'Apri archivio account' }).click();
        await diary.getByRole('tab', { name: 'Integratori' }).click();
        const panel = diary.getByRole('tabpanel', { name: 'Integratori' });
        await panel.getByRole('button', { name: /Giorno precedente/ }).click();
        const magnesiumInput = panel.getByRole('spinbutton', { name: 'Quantità assunzione Magnesio fixture' });
        await magnesiumInput.fill('200');
        await panel.getByRole('button', { name: /Nuovo integratore/ }).click();
        await panel.getByLabel('Nome integratore').fill('Creatina fixture');
        await panel.getByLabel('Dose singola (opzionale)').fill('3');
        await panel.getByRole('button', { name: 'Salva', exact: true }).click();
        const pending = first.getByText('Conferma cloud in attesa', { exact: false });
        await expect(pending).toBeVisible();
        await expect(diary).toHaveCount(0);
        expect(firstCommitStatuses).toEqual([429]);
        expect(receipts()).toBe(1);

        allowFirstCommit();
        await first.getByRole('button', { name: 'Verifica salvataggio' }).click();
        const creatine = panel.getByRole('article', { name: 'Creatina fixture', exact: true });
        await expect(creatine).toBeVisible();
        await expect(magnesiumInput).toHaveValue('200');
        await expect(panel.getByRole('heading', { name: 'Crea nuovo integratore' })).toHaveCount(0);
        await expect(pending).toHaveCount(0);
        expect(receipts()).toBe(2);

        await creatine.getByRole('button', { name: 'Opzioni' }).click();
        await first.getByRole('menuitem', { name: 'Modifica' }).click();
        await panel.getByLabel('Dose target giornaliera').fill('5');
        await panel.getByRole('button', { name: 'Salva', exact: true }).click();
        await expect(creatine.getByText('/ 5 g')).toBeVisible();
        expect(receipts()).toBe(3);

        await creatine.getByRole('button', { name: 'Opzioni' }).click();
        await first.getByRole('menuitem', { name: 'Duplica' }).click();
        await expect(panel.getByRole('article', { name: 'Creatina fixture - 1', exact: true })).toBeVisible();
        expect(receipts()).toBe(4);

        await creatine.getByRole('button', { name: '+ Aggiungi', exact: true }).click();
        const removeIntake = creatine.getByRole('button', { name: /Rimuovi assunzione di 3 g/ });
        await expect(removeIntake).toBeVisible();
        const readIntakes = () => second.evaluate(async date =>
            (await window.kindeReplicaFixture!.refresh()).data.nutrition?.[date]?.supplementsIntake ?? [], yesterday);
        expect(await readIntakes()).toMatchObject([{ amount: 3 }]);
        expect(receipts()).toBe(5);
        await removeIntake.click();
        await expect(creatine).toBeVisible();
        await expect(removeIntake).toHaveCount(0);
        expect(await readIntakes()).toEqual([]);
        expect(firstCommitStatuses).toEqual([429, 200, 200, 200, 200, 200]);
        expect(receipts()).toBe(6);
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

test('does not recreate a meal deleted on another Kinde device before an edit', async ({ browser }) => {
    await withKindeReplicaDevices(browser, async ({ first, second, receipts, firstCommitStatuses, allowFirstCommit }) => {
        allowFirstCommit();
        const date = '2026-11-20';
        const meal = { id: 'removed-meal', name: 'Riso', meal: 'Pranzo', quantity: 100,
            kcal: 100, carbs: 10, pro: 5, fat: 2 };
        expect(await second.evaluate(({ date, meal }) => window.kindeReplicaFixture!.submit({
            type: 'nutrition-meal.upsert', date, meal,
        }), { date, meal })).toMatchObject({ kind: 'cloud-acknowledged' });
        expect(await first.evaluate(async date =>
            (await window.kindeReplicaFixture!.refresh()).data.nutrition?.[date]?.meals, date)).toHaveLength(1);
        expect(await second.evaluate(({ date, mealId }) => window.kindeReplicaFixture!.submit({
            type: 'nutrition-meal.delete', date, mealId,
        }), { date, mealId: meal.id })).toMatchObject({ kind: 'cloud-acknowledged' });

        await expect(first.evaluate(({ date, mealId }) => window.kindeReplicaFixture!.submit({
            type: 'nutrition-meal.edit', date, mealId, quantity: 60,
        }), { date, mealId: meal.id })).rejects.toThrow('Alimento non più presente nella giornata');

        expect(await first.evaluate(async date =>
            (await window.kindeReplicaFixture!.refresh()).data.nutrition?.[date]?.meals ?? [], date)).toEqual([]);
        expect(firstCommitStatuses).toEqual([]);
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
