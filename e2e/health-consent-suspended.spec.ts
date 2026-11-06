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

for (const theme of ['light', 'dark'] as const) {
  test(`guest withdrawal offers optional export, deletes local data and revokes other tabs in ${theme} theme`, async ({ page, context }) => {
    await page.emulateMedia({ colorScheme: theme });
    await enterGuestMode(page);
    await page.getByRole('button', { name: 'Dati e statistiche', exact: true }).click();
    await page.getByRole('tab', { name: 'Biometria', exact: true }).click();
    await page.locator('#biometry-height').fill('183');
    await page.getByRole('button', { name: 'Salva profilo biometrico' }).click();
    await expect(page.locator('#biometry-height')).toHaveValue('183');

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
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

    await enterGuestMode(page);
    await page.getByRole('button', { name: 'Dati e statistiche', exact: true }).click();
    await page.getByRole('tab', { name: 'Biometria', exact: true }).click();
    await expect(page.locator('#biometry-height')).not.toHaveValue('183');
  });
}
