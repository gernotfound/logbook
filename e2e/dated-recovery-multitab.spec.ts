import { expect, test, type Page } from './fixtures';
import { pauseStorageWrite } from './storage-write-barrier';

async function enterGuest(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continua senza account' }).click();
  await expect(page.getByText('Aggiornamento Termini e Privacy')).toBeVisible();
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) {
    await checkbox.check();
  }
  await page.getByRole('button', { name: 'Accetta e Continua' }).click();
  await expect(page.getByRole('button', { name: 'Dati e statistiche', exact: true })).toBeVisible();
}

async function openMeasurements(page: Page) {
  await page.getByRole('button', { name: 'Dati e statistiche', exact: true }).click();
  await page.getByRole('tab', { name: 'Misurazioni', exact: true }).click();
  await expect(page.locator('#measure-weight')).toBeVisible();
}

async function inspect(page: Page) {
  await page.goto('/?tab=settings');
  await expect(page.getByRole('heading', { name: 'Impostazioni', exact: true })).toBeVisible();
  await page.locator('.settings-menu').getByRole('button', { name: /Dati e backup/ }).click();
  await page.getByRole('button', { name: 'Esamina copie sul dispositivo' }).click();
}

async function readGuestArchive(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('keyval-store');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<string>((resolve, reject) => {
        const transaction = db.transaction('keyval', 'readonly');
        const request = transaction.objectStore('keyval').get('logbook:v2:guest');
        let raw: unknown;
        request.onsuccess = () => { raw = request.result; };
        transaction.oncomplete = () => {
          if (typeof raw !== 'string' || !raw.startsWith('tlb-sealed:v1:')) {
            reject(new Error('Guest envelope unavailable'));
          } else resolve(raw);
        };
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  });
}

const prefix = 'logbook:v2:guest:sealed:draft:dated-intent:';
const canonicalPrefix = 'logbook:v2:guest:sealed:draft:measurement:';

for (const interleaving of ['stale', 'collision'] as const) {
  test(`real browser tabs retain sealed dated-form values after a ${interleaving} write and block ambiguous saves`, async ({ page, context }) => {
    await enterGuest(page);
    await openMeasurements(page);

    const other = await context.newPage();
    await other.goto('/');
    await openMeasurements(other);

    const archiveBefore = await readGuestArchive(page);
    if (interleaving === 'collision') {
      // Both editors arrive before either independent witness is written.
      // Once released, production's evidence check may reject either canonical
      // write; preserving both values does not depend on selecting a winner.
      const leftBarrier = await pauseStorageWrite(page, prefix);
      const rightBarrier = await pauseStorageWrite(other, prefix);
      const leftEdit = page.locator('#measure-weight').fill('75');
      const rightEdit = other.locator('#measure-weight').fill('76');
      const edits = Promise.allSettled([leftEdit, rightEdit]);
      try {
        const [left, right] = await Promise.all([leftBarrier.wait(), rightBarrier.wait()]);
        expect(left.key).not.toBe(right.key);
        expect(left.previous).toBeNull();
        expect(right.previous).toBeNull();
        expect([left.value, right.value].every(raw => raw.startsWith('tlb-sealed:v1:')
          && !raw.includes('"75"') && !raw.includes('"76"'))).toBe(true);
        await Promise.all([leftBarrier.release(), rightBarrier.release()]);
      } finally {
        await Promise.all([leftBarrier.dispose(), rightBarrier.dispose()]);
        await edits;
      }
      const results = await edits;
      for (const result of results) if (result.status === 'rejected') throw result.reason;
    } else {
      await page.locator('#measure-weight').fill('75');
      await other.locator('#measure-weight').fill('76');
    }
    await expect(page.locator('#measure-weight')).toHaveValue('75');
    await expect(other.locator('#measure-weight')).toHaveValue('76');

    const witnessesBeforeSave = await page.evaluate(p => Object.fromEntries(
      Object.entries(localStorage).filter(([key]) => key.startsWith(p))
    ), prefix);

    // Exercise the business-save path after the conflict, not just the draft
    // inspector. Neither editor may acknowledge or consume either witness.
    await page.getByRole('button', { name: 'Salva misurazione', exact: true }).click();
    await other.getByRole('button', { name: 'Salva misurazione', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toContainText('Errore durante il salvataggio della misurazione.');
    await expect(other.getByRole('alertdialog')).toContainText('Errore durante il salvataggio della misurazione.');
    expect(await readGuestArchive(page)).toBe(archiveBefore);

    const saved = await page.evaluate(p => Object.fromEntries(
      Object.entries(localStorage).filter(([key]) => key.startsWith(p))
    ), prefix);
    expect(Object.keys(saved)).toHaveLength(2);
    expect(saved).toEqual(witnessesBeforeSave);
    expect(Object.values(saved).every(value => !value.includes('"75"') && !value.includes('"76"'))).toBe(true);

    const viewer = await context.newPage();
    await inspect(viewer);
    await expect(viewer.getByText('2 copie conservate in 1 campo.')).toBeVisible();
    await viewer.locator('.settings-recovery-group summary').first().click();
    const fields = viewer.locator('.settings-recovery-entry textarea[readonly]');
    await expect(fields).toHaveCount(2);
    expect((await fields.evaluateAll(elements => elements.map(element =>
      JSON.parse((element as HTMLTextAreaElement).value).weight
    ))).sort()).toEqual(['75', '76']);
    expect(await viewer.evaluate(p => Object.fromEntries(
      Object.entries(localStorage).filter(([key]) => key.startsWith(p))
    ), prefix)).toEqual(saved);

    // Recreate only the diagnostic realm; neither input editor may
    // automatically choose or destroy the other tab's witness.
    await inspect(viewer);
    await viewer.locator('.settings-recovery-group summary').first().click();
    await expect(fields).toHaveCount(2);
    expect((await fields.evaluateAll(elements => elements.map(element =>
      JSON.parse((element as HTMLTextAreaElement).value).weight
    ))).sort()).toEqual(['75', '76']);
  });
}

test('canonical dated-form quota failure leaves a sealed, readable witness for a separate tab', async ({ page, context }) => {
  await enterGuest(page);
  await openMeasurements(page);

  // Reject only the canonical key, never the per-editor copy.
  await page.evaluate(prefix => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(this: Storage, key: string, value: string) {
      if (key.startsWith(prefix)) throw new DOMException('synthetic quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  }, canonicalPrefix);

  await page.locator('#measure-weight').fill('77');
  const stored = await page.evaluate(([witness, canonical]) => ({
    witnesses: Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith(witness))),
    canonical: Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith(canonical))),
  }), [prefix, canonicalPrefix]);

  expect(Object.keys(stored.witnesses)).toHaveLength(1);
  expect(Object.keys(stored.canonical)).toHaveLength(0);
  expect(Object.values(stored.witnesses).every(v => !v.includes('"77"'))).toBe(true);

  const viewer = await context.newPage();
  await inspect(viewer);
  await expect(viewer.getByText('1 copia conservata in 1 campo.')).toBeVisible();
  await viewer.locator('.settings-recovery-group summary').first().click();
  const recovery = viewer.locator('.settings-recovery-entry textarea[readonly]');
  await expect(recovery).toHaveCount(1);
  expect(JSON.parse(await recovery.inputValue()).weight).toBe('77');
  expect(await viewer.evaluate(p => Object.fromEntries(
    Object.entries(localStorage).filter(([key]) => key.startsWith(p))
  ), prefix)).toEqual(stored.witnesses);
});
