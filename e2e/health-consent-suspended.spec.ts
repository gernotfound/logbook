import { expect, test, type Page } from './fixtures';

test.use({ viewport: { width: 320, height: 850 } });

async function enterGuestMode(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continua senza account' }).click();
  await page.getByText('Aggiornamento Termini e Privacy').waitFor();
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) {
    await checkbox.check();
  }
  await page.getByRole('button', { name: 'Accetta e Continua' }).click();
  await expect(page.locator('.guest-banner')).toBeVisible();
}

async function guestArchiveEntries(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('keyval-store');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const transaction = db.transaction('keyval', 'readonly');
        const store = transaction.objectStore('keyval');
        const keys = [
          'logbook:v2:guest',
          'logbook:v2:guest:secure-vault-control-mirror',
          'logbook:v2:guest:device-vault-key',
        ];
        const requests = keys.map(key => store.get(key));
        transaction.oncomplete = () => resolve(requests.filter(request => request.result !== undefined).length);
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`guest withdrawal offers optional export, deletes local data and revokes other tabs in ${theme} theme`, async ({ page, context }) => {
    await page.emulateMedia({ colorScheme: theme });
    await enterGuestMode(page);
    await page.getByRole('button', { name: 'Dati e statistiche', exact: true }).click();
    await page.getByRole('tab', { name: 'Biometria', exact: true }).click();
    await page.locator('#biometry-height').fill('183');
    await page.getByRole('button', { name: 'Salva profilo biometrico' }).click();
    await expect(page.locator('#biometry-height')).toHaveValue('183');
    expect(await guestArchiveEntries(page)).toBe(3);

    const secondTab = await context.newPage();
    await secondTab.goto('/');
    await expect(secondTab.locator('.guest-banner')).toBeVisible();

    await page.goto('/?tab=settings');
    await page.locator('.settings-menu').getByRole('button', { name: /Privacy/ }).click();
    await page.getByRole('button', { name: /Revoca il consenso per i dati salute/ }).click();
    const withdrawal = page.getByRole('region', { name: 'Conferma revoca del consenso' });
    await expect(withdrawal.getByRole('button', { name: 'Esporta prima i miei dati' })).toBeVisible();
    await expect(withdrawal.getByText(/esportazione è facoltativa/i)).toBeVisible();
    await expect(withdrawal.getByRole('button', { name: 'Revoca il consenso e cancella i dati' })).toBeEnabled();
    // Export is intentionally optional: the user can revoke without creating a file.
    await withdrawal.getByRole('button', { name: 'Revoca il consenso e cancella i dati' }).click();

    await expect(page.getByRole('button', { name: 'Continua senza account' })).toBeVisible();
    await expect(secondTab.getByRole('button', { name: 'Continua senza account' })).toBeVisible();
    // A fresh guest could hide the old values even if their encrypted bytes survived.
    // Check the underlying archive, wrapped control and device key before provisioning it.
    await expect.poll(() => guestArchiveEntries(page)).toBe(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

    await enterGuestMode(page);
    await page.getByRole('button', { name: 'Dati e statistiche', exact: true }).click();
    await page.getByRole('tab', { name: 'Biometria', exact: true }).click();
    await expect(page.locator('#biometry-height')).not.toHaveValue('183');
  });
}
