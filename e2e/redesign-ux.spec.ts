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


test('Schede stays inside a 320px viewport and keeps the full muscle model in both themes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await continueAsGuest(page);
  await page.getByRole('button', { name: 'Allenamento', exact: true }).click();
  await page.getByRole('tab', { name: 'Schede', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Schede', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crea scheda' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.getByRole('button', { name: 'Crea scheda' }).click();
  await page.getByPlaceholder('Nome scheda').fill('Scheda mobile');
  const muscleSvg = page.locator('.routine-editor-muscle-map svg');
  await expect(muscleSvg).toBeVisible();

  const muscleFitsViewBox = await muscleSvg.evaluate((svgElement) => {
    const svg = svgElement as SVGSVGElement;
    const group = svg.querySelector('g') as SVGGElement | null;
    if (!group) return false;
    const contentBounds = group.getBBox();
    const viewBox = svg.viewBox.baseVal;
    return contentBounds.x >= viewBox.x
      && contentBounds.y >= viewBox.y
      && contentBounds.x + contentBounds.width <= viewBox.x + viewBox.width
      && contentBounds.y + contentBounds.height <= viewBox.y + viewBox.height;
  });
  expect(muscleFitsViewBox).toBe(true);

  await page.locator('#routine-creation-form').getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(page.getByText('Scheda mobile', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Apri scheda Scheda mobile' }).click();
  await expect(page.getByText('Muscoli coinvolti')).toBeVisible();

  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(hasOverflow).toBe(false);

  await page.evaluate(() => localStorage.setItem('logbook:appearance:v1', 'dark'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Allenamento', exact: true }).click();
  await page.getByRole('tab', { name: 'Schede', exact: true }).click();
  await expect(page.getByText('Scheda mobile', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
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
