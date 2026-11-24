import { expect, test } from '../fixtures';
import { mountKindePlanning, withKindeReplicaDevices } from './kindeReplicaFixture';

test('starts a Kinde routine, restores series and review from the device, and completes once', async ({ browser }) => {
    await withKindeReplicaDevices(browser, async ({ first, second, receipts, allowFirstCommit }) => {
        const seed = await second.evaluate(() => window.kindeReplicaFixture!.submit([
            { type: 'exercise.upsert', exercise: { id: 'test-bench', name: 'Panca sintetica', setsCount: 1, sets: [] } },
            { type: 'routine.create', routine: { id: 'test-routine', name: 'Scheda sintetica',
                exercises: [{ exId: 'test-bench', setsCount: 1 }] } },
        ]));
        expect(seed.kind).toBe('cloud-acknowledged');
        const before = receipts();
        allowFirstCommit();
        await first.bringToFront();
        const workout = first.getByRole('region', { name: 'Allenamento account', exact: true });
        const open = async () => {
            await mountKindePlanning(first);
            await first.getByRole('button', { name: 'Apri archivio account' }).click();
            await expect(workout).toBeVisible();
        };
        await open();
        await workout.getByLabel('Scheda', { exact: true }).selectOption('test-routine');
        await workout.getByRole('button', { name: 'Allenati con la scheda' }).click();
        await workout.getByRole('button', { name: 'Energia: 4 su 5' }).click();
        await workout.getByRole('button', { name: 'Inizia allenamento' }).click();

        const finish = workout.getByRole('button', { name: 'Termina allenamento' });
        await expect(finish).toBeVisible();
        await expect.poll(receipts).toBe(before + 1);
        const exercise = workout.getByRole('button', { name: /Panca sintetica/ });
        await exercise.click();
        await workout.getByPlaceholder('Kg', { exact: true }).fill('55.5');
        await workout.getByPlaceholder('Reps', { exact: true }).fill('8');
        await expect(workout.getByPlaceholder('Kg', { exact: true })).toHaveValue('55.5');
        expect(receipts()).toBe(before + 1);
        expect(await first.evaluate(() => Object.keys(localStorage).some(key => key.includes('draft:buffered:')))).toBe(false);

        await first.reload();
        await open();
        await workout.getByRole('button', { name: 'Riprendi allenamento' }).click();
        await exercise.click();
        await expect(workout.getByPlaceholder('Kg', { exact: true })).toHaveValue('55.5');
        await expect(workout.getByPlaceholder('Reps', { exact: true })).toHaveValue('8');
        await workout.getByRole('button', { name: 'Sincronizza seduta' }).click();
        await expect.poll(receipts).toBe(before + 2);
        const shared = await second.evaluate(async () => (await window.kindeReplicaFixture!.refresh()).data.activeWorkout);
        expect(shared).toMatchObject({ exercises: [{ sets: [{ kg: '55.5', reps: '8' }] }] });
        await finish.click();
        await workout.getByRole('button', { name: 'Umore: 4 su 5' }).click();
        await workout.getByLabel('Acqua bevuta (litri)').fill('1.5');
        await first.reload();
        await open();
        await workout.getByRole('button', { name: 'Riprendi allenamento' }).click();
        await expect(workout.getByLabel('Acqua bevuta (litri)')).toHaveValue('1.5');
        await workout.getByRole('button', { name: 'Salva e termina' }).click();
        await expect.poll(receipts).toBe(before + 3);
        await expect(workout.getByRole('button', { name: 'Allenamento libero' })).toBeVisible();
        const saved = await second.evaluate(async () => {
            const data = (await window.kindeReplicaFixture!.refresh()).data;
            return { active: data.activeWorkout, history: data.history };
        });
        expect(saved.active).toBeNull();
        expect(saved.history).toMatchObject([{
            routineId: 'test-routine', readiness: { energy: 4 }, moodRating: 4, waterLiters: 1.5,
            exercises: [{ exId: 'test-bench', sets: [{ kg: '55.5', reps: '8' }] }],
        }]);
    }, { planningUi: true });
});
