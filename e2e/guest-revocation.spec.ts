import { test, expect, type Page } from './fixtures';

const routineName = 'Scheda E2E revoca guest';

async function hasGuestEnvelope(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('keyval-store');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<boolean>((resolve, reject) => {
        const request = db.transaction('keyval', 'readonly').objectStore('keyval').get('logbook:v2:guest');
        request.onsuccess = () => resolve(request.result !== undefined);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
}

test('guest logout revokes another tab and removes its durable archive without resurrection', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continua senza account' }).click();
  await page.waitForSelector('text=Aggiornamento Termini e Privacy');
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) await checkbox.check();
  await page.getByRole('button', { name: 'Accetta e Continua' }).click();
  await expect(page.locator('.guest-banner')).toBeVisible();

  // Persist current-release guest data through the UI before revoking the session.
  await page.getByRole('button', { name: 'Allenamento', exact: true }).click();
  await page.locator('button.sub-nav-btn:has-text("Schede")').click();
  await page.getByRole('button', { name: 'Crea scheda' }).click();
  await page.locator('input[placeholder="Nome scheda"]').fill(routineName);
  await page.locator('#routine-creation-form').getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(page.getByText(routineName, { exact: true })).toBeVisible();
  await expect.poll(() => hasGuestEnvelope(page)).toBe(true);

  const background = await context.newPage();
  await background.goto('/');
  await expect(background.locator('.guest-banner')).toBeVisible();
  await background.getByRole('button', { name: 'Allenamento', exact: true }).click();
  await background.locator('button.sub-nav-btn:has-text("Schede")').click();
  await expect(background.getByText(routineName, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Esci', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Conferma' }).click();

  await expect(page.locator('.guest-banner')).toHaveCount(0);
  await expect(background.locator('.guest-banner')).toHaveCount(0);
  await expect(background.getByRole('button', { name: 'Continua senza account' })).toBeVisible();
  await expect.poll(() => background.evaluate(() => localStorage.getItem('logbook_is_guest'))).toBeNull();
  await expect.poll(() => hasGuestEnvelope(background)).toBe(false);

  await background.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => hasGuestEnvelope(background)).toBe(false);
  await expect.poll(() => background.evaluate(() =>
    Object.keys(localStorage).filter(key => key.startsWith('logbook:v2:guest:')).length
  )).toBe(0);

  // A fresh guest generation must not inherit business data from the revoked one.
  await page.getByRole('button', { name: 'Continua senza account' }).click();
  await expect(page.locator('.guest-banner')).toBeVisible();
  await expect(background.locator('.guest-banner')).toHaveCount(0);
  // A new guest generation requires fresh consent before the data views are interactive.
  await page.waitForSelector('text=Aggiornamento Termini e Privacy');
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) await checkbox.check();
  await page.getByRole('button', { name: 'Accetta e Continua' }).click();
  await page.getByRole('button', { name: 'Allenamento', exact: true }).click();
  await page.locator('button.sub-nav-btn:has-text("Schede")').click();
  await expect(page.getByText(routineName, { exact: true })).toHaveCount(0);
});
