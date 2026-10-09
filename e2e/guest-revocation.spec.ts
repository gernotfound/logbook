import { test, expect } from '@playwright/test';

test('guest logout revokes another live tab and its background persistence', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continua senza account' }).click();
  await page.waitForSelector('text=Aggiornamento Termini e Privacy');
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) await checkbox.check();
  await page.getByRole('button', { name: 'Accetta e Continua' }).click();
  await expect(page.locator('.guest-banner')).toBeVisible();

  const background = await context.newPage();
  await background.goto('/');
  await expect(background.locator('.guest-banner')).toBeVisible();

  await page.getByRole('button', { name: 'Esci', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Conferma' }).click();

  await expect(page.locator('.guest-banner')).toHaveCount(0);
  await expect(background.locator('.guest-banner')).toHaveCount(0);
  await expect(background.getByRole('button', { name: 'Continua senza account' })).toBeVisible();
  await expect.poll(() => background.evaluate(() => localStorage.getItem('logbook_is_guest'))).toBeNull();

  await background.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => background.evaluate(() =>
    Object.keys(localStorage).filter(key => key.startsWith('logbook:v2:guest:')).length
  )).toBe(0);

  // A fresh login in the first tab does not resurrect the second tab's stale generation.
  await page.getByRole('button', { name: 'Continua senza account' }).click();
  await expect(page.locator('.guest-banner')).toBeVisible();
  await expect(background.locator('.guest-banner')).toHaveCount(0);
});
