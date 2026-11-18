import { expect, test } from '../fixtures';

// A guest archive has no remote identity or health-service dependency. Static
// same-origin assets remain permitted; the test observes page and SW traffic.
function forbiddenAccountRequest(rawUrl: string): boolean {
  const url = new URL(rawUrl);
  if (/^\/(?:api\/auth(?:\/|$)|api\/health-consent(?:\/|$)|api\/account(?:\/|$)|v1\/)/.test(url.pathname)) return true;
  if (/(?:^|\.)(?:kinde\.com|firebaseapp\.com|firebaseio\.com|firebasedatabase\.app)$/.test(url.hostname)) return true;
  if (/^(?:identitytoolkit|securetoken|firestore|firebaseinstallations|firebaseappcheck)\.googleapis\.com$/.test(url.hostname)) return true;
  if (/^www\.google\.com$/.test(url.hostname) && url.pathname.startsWith('/recaptcha/')) return true;
  if (/^www\.gstatic\.com$/.test(url.hostname) && url.pathname.startsWith('/recaptcha/')) return true;
  return false;
}

test('guest fitness persists across an online reload and an offline restart without Auth or health API traffic', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continua senza account' }).click();
  await expect(page.getByText('Aggiornamento Termini e Privacy')).toBeVisible();
  for (const box of await page.locator('input[type="checkbox"]').all()) await box.check();
  await page.getByRole('button', { name: 'Accetta e Continua' }).click();
  await expect(page.locator('.guest-banner')).toBeVisible();

  const forbidden: string[] = [];
  const onRequest = (request: { url(): string }) => {
    if (forbiddenAccountRequest(request.url())) forbidden.push(new URL(request.url()).pathname);
  };
  context.on('request', onRequest);

  // Actively reject same-origin Auth/health calls even when their handlers
  // would return a synthetic 401/503. External requests are already blocked
  // by the shared isolated E2E fixture.
  await context.route('**/*', route => {
    if (forbiddenAccountRequest(route.request().url())) return route.abort('blockedbyclient');
    return route.fallback();
  });

  try {
    await page.getByRole('button', { name: 'Dati e statistiche', exact: true }).click();
    await page.getByRole('tab', { name: 'Biometria', exact: true }).click();
    await page.locator('#biometry-height').fill('181');
    await page.getByRole('button', { name: 'Salva profilo biometrico' }).click();

    await expect.poll(() => page.evaluate(async () => {
      const request = indexedDB.open('keyval-store');
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const transaction = db.transaction('keyval', 'readonly');
        const record = transaction.objectStore('keyval').get('logbook:v2:guest');
        const value = await new Promise<unknown>((resolve, reject) => {
          record.onsuccess = () => resolve(record.result);
          record.onerror = () => reject(record.error);
        });
        return typeof value === 'string' && value.startsWith('tlb-sealed:v1:')
          && !value.includes('"height"');
      } finally {
        db.close();
      }
    })).toBe(true);

    // A second tab starts with a persisted guest owner. It must not probe
    // the Kinde session even if the identity service is unavailable.
    const second = await context.newPage();
    await second.goto('/?tab=data');
    await expect(second.locator('.guest-banner')).toBeVisible();
    await second.getByRole('tab', { name: 'Biometria', exact: true }).click();
    await expect(second.locator('#biometry-height')).toHaveValue('181');

    await second.evaluate(async () => { await navigator.serviceWorker.ready; });
    await second.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await context.setOffline(true);
    await second.close();
    const recovered = await context.newPage();
    await recovered.goto('/?tab=data');
    await expect(recovered.locator('.guest-banner')).toBeVisible();
    await recovered.getByRole('tab', { name: 'Biometria', exact: true }).click();
    await expect(recovered.locator('#biometry-height')).toHaveValue('181');
    expect(forbidden).toEqual([]);
  } finally {
    context.off('request', onRequest);
  }
});
