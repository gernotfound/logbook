import { expect, test, type Page } from '../fixtures';

async function observeTransactions(page: Page) {
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    document.documentElement.dataset.queuedWrites = '0';
    document.documentElement.dataset.completedWrites = '0';
    IDBDatabase.prototype.transaction = function(...args: Parameters<IDBDatabase['transaction']>) {
      const transaction = Reflect.apply(original, this, args) as IDBTransaction;
      if (this.name === 'keyval-store' && transaction.mode === 'readwrite'
        && transaction.objectStoreNames.contains('keyval')) {
        const root = document.documentElement;
        root.dataset.queuedWrites = String(Number(root.dataset.queuedWrites) + 1);
        transaction.addEventListener('complete', () => {
          root.dataset.completedWrites = String(Number(root.dataset.completedWrites) + 1);
        });
      }
      return transaction;
    };
  });
}

async function holdTransaction(page: Page) {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('keyval-store');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction('keyval', 'readwrite');
    let released = false;
    window.addEventListener('test:release-idb-barrier', () => { released = true; }, { once: true });
    // Native requests keep this transaction active without modifying a record.
    // Other realms can create transactions, but cannot read/transform/write
    // this object store until the browser commits or aborts this holder.
    const pulse = () => {
      const request = transaction.objectStore('keyval').get('logbook:v2:guest');
      request.onsuccess = () => {
        document.documentElement.dataset.idbBarrierHeld = 'true';
        if (!released) pulse();
      };
    };
    transaction.oncomplete = () => {
      document.documentElement.dataset.idbBarrierReleased = 'true';
      db.close();
    };
    transaction.onabort = () => db.close();
    pulse();
  });
  await expect(page.locator('html')).toHaveAttribute('data-idb-barrier-held', 'true');
}

for (const release of ['commit', 'close-holder'] as const) {
  test(`native IndexedDB serializes independent UI commits after ${release} without losing either mutation`, async ({ page, context }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Continua senza account' }).click();
    await expect(page.getByText('Aggiornamento Termini e Privacy')).toBeVisible();
    for (const checkbox of await page.locator('input[type="checkbox"]').all()) await checkbox.check();
    await page.getByRole('button', { name: 'Accetta e Continua' }).click();
    await expect(page.locator('.guest-banner')).toBeVisible();
    await page.getByRole('button', { name: 'Dati e statistiche', exact: true }).click();
    await page.getByRole('tab', { name: 'Biometria', exact: true }).click();
    await page.locator('#biometry-height').fill('183');

    const other = await context.newPage();
    await other.goto('/?tab=training');
    await other.locator('button.sub-nav-btn:has-text("Schede")').click();
    await other.getByRole('button', { name: 'Crea scheda' }).click();
    const name = `Commit concorrente ${release}`;
    await other.locator('input[placeholder="Nome scheda"]').fill(name);

    const holder = await context.newPage();
    await holder.goto('/?tab=settings');
    await expect(holder.getByRole('heading', { name: 'Impostazioni', exact: true })).toBeVisible();
    await Promise.all([observeTransactions(page), observeTransactions(other)]);
    await holdTransaction(holder);
    try {
      await Promise.all([
        page.getByRole('button', { name: 'Salva profilo biometrico' }).click(),
        other.locator('#routine-creation-form').getByRole('button', { name: 'Salva', exact: true }).click(),
      ]);
      // Both production commits have created real native readwrite
      // transactions while the third realm still owns the object store.
      await expect(page.locator('html')).toHaveAttribute('data-queued-writes', '1');
      await expect(other.locator('html')).toHaveAttribute('data-queued-writes', '1');
      await expect(page.locator('html')).toHaveAttribute('data-completed-writes', '0');
      await expect(other.locator('html')).toHaveAttribute('data-completed-writes', '0');
      if (release === 'close-holder') await holder.close();
      else {
        await holder.evaluate(() => window.dispatchEvent(new Event('test:release-idb-barrier')));
        await expect(holder.locator('html')).toHaveAttribute('data-idb-barrier-released', 'true');
      }
      await expect.poll(() => page.locator('html').getAttribute('data-completed-writes').then(Number)).toBeGreaterThanOrEqual(1);
      await expect.poll(() => other.locator('html').getAttribute('data-completed-writes').then(Number)).toBeGreaterThanOrEqual(1);
      await expect(other.getByText(name, { exact: true })).toBeVisible();

      // Discard both writers' memory. A new app document must reopen the
      // sealed archive and contain both independently submitted mutations.
      const reader = await context.newPage();
      await reader.goto('/?tab=training');
      await reader.locator('button.sub-nav-btn:has-text("Schede")').click();
      await expect(reader.getByText(name, { exact: true })).toBeVisible();
      await reader.getByRole('button', { name: 'Dati e statistiche', exact: true }).click();
      await reader.getByRole('tab', { name: 'Biometria', exact: true }).click();
      await expect(reader.locator('#biometry-height')).toHaveValue('183');
    } finally {
      if (!holder.isClosed()) await holder.close();
    }
  });
}
