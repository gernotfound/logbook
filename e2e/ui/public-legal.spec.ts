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
    await expect(page.getByRole('navigation', { name: 'Navigazione principale' }).getByRole('link', { name: 'Informazioni', exact: true })).toBeVisible();
    await expect(page.locator('#auth-login-box')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
});

test('native Kinde form POST keeps the real same-origin Origin in Chromium and WebKit', async ({ page }) => {
  await page.goto('/verifica-accesso.html');
  const origin = new URL(page.url()).origin;

  await page.route('**/api/auth/kinde/start', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain',
      headers: { 'Cache-Control': 'no-store' },
      body: 'Synthetic form target: no provider request',
    });
  });

  const post = page.waitForRequest(request =>
    new URL(request.url()).pathname === '/api/auth/kinde/start' && request.method() === 'POST',
  );
  await Promise.all([
    page.waitForURL('**/api/auth/kinde/start'),
    page.getByRole('button', { name: 'Avvia accesso con Kinde' }).click(),
  ]);
  const request = await post;
  expect(request.isNavigationRequest()).toBe(true);
  const headers = await request.allHeaders();
  expect(headers.origin).toBe(origin);
  const fetchSite = headers['sec-fetch-site'];
  if (fetchSite !== undefined) expect(fetchSite).toBe('same-origin');
});
