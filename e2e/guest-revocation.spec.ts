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

test('health consent withdrawal suspends guest tracking across tabs and reloads', async ({ page, context }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Continua senza account' }).click();
  await page.getByText('Aggiornamento Termini e Privacy').waitFor();
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) await checkbox.check();
  await page.getByRole('button', { name: 'Accetta e Continua' }).click();

  const otherTab = await context.newPage();
  await otherTab.goto('/');
  await expect(otherTab.getByRole('button', { name: 'Apri impostazioni' })).toBeVisible();

  await page.getByRole('button', { name: 'Apri impostazioni' }).click();
  await page.getByRole('button', { name: /^Privacy/ }).click();
  await page.getByRole('button', { name: 'Revoca il consenso per i dati salute' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Conferma' }).click();

  await expect(page.getByRole('heading', { name: 'Tracciamento sospeso' })).toBeVisible();
  await expect(otherTab.getByRole('heading', { name: 'Tracciamento sospeso' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Esporta i dati in JSON' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Allenamento', exact: true })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tracciamento sospeso' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});
