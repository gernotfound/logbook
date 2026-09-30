import { test, expect, type Page } from '@playwright/test';

async function enterGuestMode(page: Page) {
  await page.goto('/');
  await expect(page.locator('text=LogBook')).toBeVisible();
  await page.getByRole('button', { name: 'Continua senza account' }).click();
  await page.waitForSelector('text=Aggiornamento Termini e Privacy');
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) await checkbox.check();
  await page.getByRole('button', { name: 'Accetta e Continua' }).click();
  await expect(page.getByRole('button', { name: 'Apri impostazioni' })).toBeVisible();
}

async function openAnalyticsSettings(page: Page) {
  await page.getByRole('button', { name: 'Apri impostazioni' }).click();
  await page.getByRole('button', { name: /^Privacy/ }).click();
  await expect(page.locator('#analytics-toggle')).toBeVisible();
}

test.describe('Analytics consent multi-tab lifecycle', () => {
  test('synchronizes opt-in, revocation, reload and storage clear across tabs', async ({ page, context }) => {
    await context.route('**/_vercel/insights/script.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await context.route('**/_vercel/speed-insights/script.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));

    await enterGuestMode(page);
    const secondPage = await context.newPage();
    await secondPage.goto('/');
    await expect(secondPage.getByRole('button', { name: 'Apri impostazioni' })).toBeVisible();

    await openAnalyticsSettings(page);
    await openAnalyticsSettings(secondPage);

    const firstToggle = page.locator('#analytics-toggle');
    const secondToggle = secondPage.locator('#analytics-toggle');
    await expect(firstToggle).not.toBeChecked();
    await expect(secondToggle).not.toBeChecked();
    await firstToggle.check();
    await expect(secondToggle).toBeChecked();
    await firstToggle.uncheck();
    await expect(secondToggle).not.toBeChecked();

    await secondPage.reload();
    await openAnalyticsSettings(secondPage);
    await expect(secondPage.locator('#analytics-toggle')).not.toBeChecked();
    await firstToggle.check();
    await expect(secondPage.locator('#analytics-toggle')).toBeChecked();
    await page.evaluate(() => localStorage.clear());
    await expect(secondPage.locator('#analytics-toggle')).not.toBeChecked();
  });
});
