import { expect, test } from '../fixtures';

// Legal pages are static: they do not require an account or a PWA runtime.
test.use({ serviceWorkers: 'block' });

test('about and privacy are readable anonymously in light and dark mode', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/about.html');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Allenamenti, alimentazione e progressi');
    await expect(page.getByRole('link', { name: 'Informativa sulla privacy' }).first()).toBeVisible();
    await expect(page.locator('#auth-login-box')).toHaveCount(0);
    await expect(page.locator('script')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);

    await page.goto('/privacy.html');
    await expect(page.getByRole('heading', { level: 1, name: 'Informativa sulla privacy' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Accesso con Google: dati, uso e condivisione' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Informazioni' })).toBeVisible();
    await expect(page.locator('#auth-login-box')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
});
