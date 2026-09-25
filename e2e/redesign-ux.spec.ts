import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 320, height: 850 } });

async function continueAsGuest(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continua senza account' }).click();
  await page.getByText('Aggiornamento Termini e Privacy').waitFor();
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) await checkbox.check();
  await page.getByRole('button', { name: 'Accetta e Continua' }).click();
  await page.getByRole('button', { name: 'Allenamento', exact: true }).waitFor();
}

test('food search results remain visible and can be added to a meal', async ({ page }) => {
  await continueAsGuest(page);
  await page.getByRole('button', { name: 'Nutrizione', exact: true }).click();
  await page.getByRole('button', { name: 'Crea alimento' }).click();
  await page.locator('#cf-name').fill('Avena visuale');
  await page.locator('#cf-pro').fill('12');
  await page.locator('#cf-carbs').fill('60');
  await page.locator('#cf-fat').fill('6');
  await page.getByRole('button', { name: 'Salva alimento' }).click();
  await page.getByRole('searchbox', { name: 'Cerca alimento' }).fill('Avena visuale');
  const results = page.getByLabel('Alimenti trovati');
  await expect(results.getByText('Avena visuale')).toBeVisible();
  await results.getByRole('button', { name: 'Colazione' }).click();
  await expect(page.getByRole('button', { name: /Modifica porzione di Avena visuale/i })).toBeVisible();
});

test('completed workout report has a reachable close control on a narrow viewport', async ({ page }) => {
  await continueAsGuest(page);
  await page.getByRole('button', { name: 'Allenamento', exact: true }).click();
  await page.getByRole('button', { name: 'Allenamento libero' }).click();
  await page.getByRole('button', { name: 'Salta check-in e inizia' }).click();
  await page.getByRole('button', { name: /Termina/ }).click();
  await expect(page.getByRole('heading', { name: /andato l.allenamento/i })).toBeVisible();
  await page.getByRole('button', { name: 'Salva e termina' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole('button', { name: 'Chiudi', exact: true });
  await expect(close).toBeVisible();
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Chiudi e torna alla Home' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  const bounds = await close.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  await close.click();
  await expect(dialog).toHaveCount(0);
});


test('adaptive appearance resolves system light and explicit dark on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await continueAsGuest(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');

  await page.evaluate(() => localStorage.setItem('logbook:appearance:v1', 'dark'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'dark');
  await expect(page.getByRole('button', { name: 'Allenamento', exact: true })).toBeVisible();
});
