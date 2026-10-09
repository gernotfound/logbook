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
  // Insert a synthetic leftover only after both tabs finish startup. It is
  // owner-scoped cleanup residue and is not interpreted by workout hydration.
  await page.evaluate(() => localStorage.setItem('logbook:v2:guest:draft:withdrawal-test', 'synthetic-private-draft'));

  await page.getByRole('button', { name: 'Apri impostazioni' }).click();
  await page.getByRole('button', { name: /^Privacy/ }).click();
  await expect(page.getByRole('button', { name: 'Esporta backup prima della revoca' })).toBeVisible();
  await page.getByRole('button', { name: 'Revoca il consenso per i dati salute' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Conferma' }).click();

  await expect(page.getByRole('heading', { name: 'Tracciamento sospeso' })).toBeVisible();
  await expect(otherTab.getByRole('heading', { name: 'Tracciamento sospeso' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Esporta i dati in JSON' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('logbook:v2:guest:draft:withdrawal-test'))).toBeNull();
  await expect.poll(() => otherTab.evaluate(() => localStorage.getItem('logbook:v2:guest:draft:withdrawal-test'))).toBeNull();
  await expect(page.getByText('pulizia completata.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Allenamento', exact: true })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tracciamento sospeso' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});

test('guest can explicitly delete suspended local data and start a fresh guest session', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continua senza account' }).click();
  await page.getByText('Aggiornamento Termini e Privacy').waitFor();
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) await checkbox.check();
  await page.getByRole('button', { name: 'Accetta e Continua' }).click();

  await page.getByRole('button', { name: 'Apri impostazioni' }).click();
  await page.getByRole('button', { name: /^Privacy/ }).click();
  await page.getByRole('button', { name: 'Revoca il consenso per i dati salute' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Conferma' }).click();

  await expect(page.getByRole('heading', { name: 'Tracciamento sospeso' })).toBeVisible();
  await page.getByRole('button', { name: 'Elimina dati locali' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Conferma' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Conferma' }).click();

  await expect(page.getByRole('button', { name: 'Continua senza account' })).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    localStorage.getItem('logbook:v2:guest:health-consent-revocation-v1')
  )).toBeNull();

  await page.getByRole('button', { name: 'Continua senza account' }).click();
  await expect(page.locator('.guest-banner')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tracciamento sospeso' })).toHaveCount(0);
});
