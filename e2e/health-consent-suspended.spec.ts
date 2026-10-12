import { expect, test, type Page } from '@playwright/test';

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

for (const theme of ['light', 'dark'] as const) {
  test(`guest consent withdrawal suspends every fitness view and survives reload in ${theme} theme`, async ({ page, context }) => {
    await page.emulateMedia({ colorScheme: theme });
    await enterGuestMode(page);
    const secondTab = await context.newPage();
    await secondTab.goto('/');
    await expect(secondTab.locator('.guest-banner')).toBeVisible();

    await page.goto('/?tab=settings');
    await expect(page.getByRole('heading', { name: 'Impostazioni', exact: true })).toBeVisible();
    await page.locator('.settings-menu').getByRole('button', { name: /Privacy/ }).click();
    await page.getByRole('button', { name: /Revoca il consenso per i dati salute/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Conferma' }).click();

    const heading = page.getByRole('heading', { name: 'Accesso a TheLogBook sospeso' });
    await expect(heading).toBeVisible();
    await expect(secondTab.getByRole('heading', { name: 'Accesso a TheLogBook sospeso' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Allenamento', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Esporta i tuoi dati (backup JSON)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Elimina definitivamente l\'account' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const frame = await page.locator('.auth-panel').boundingBox();
    expect(frame).not.toBeNull();
    expect(frame!.x).toBeGreaterThanOrEqual(0);
    expect(frame!.x + frame!.width).toBeLessThanOrEqual(321);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

    await page.reload();
    await expect(heading).toBeVisible();
    const checks = page.locator('#auth-overlay input[type="checkbox"]');
    await expect(checks).toHaveCount(2);
    await checks.nth(0).check();
    await checks.nth(1).check();
    await page.getByRole('button', { name: 'Presta un nuovo consenso' }).click();
    await expect(page.locator('.guest-banner')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Accesso a TheLogBook sospeso' })).toHaveCount(0);
  });
}
