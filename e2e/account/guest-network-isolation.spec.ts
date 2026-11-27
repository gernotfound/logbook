import { expect, test } from '../fixtures';

// The guest archive is strictly local. Static files from this preview origin
// are allowed; neither same-origin APIs nor external hosts are dependencies.
function forbiddenGuestRequest(rawUrl: string, appOrigin: string): boolean {
  const url = new URL(rawUrl);
  return url.origin !== appOrigin || /^\/(?:api|v1|__\/auth)(?:\/|$)/.test(url.pathname)
    || /^\/assets\/firebase-[^/]+\.js$/.test(url.pathname);
}

// Keep query strings out of CI diagnostics: OAuth parameters may be sensitive.
function requestDestination(rawUrl: string): string {
  const url = new URL(rawUrl);
  return url.origin + url.pathname;
}

test('guest network observer detects private routes and unlisted external hosts', () => {
  const origin = 'http://127.0.0.1:4173';
  for (const path of ['/api/auth/session', '/api/fitness', '/api/health-consent',
    '/v1/sync/commit', '/__/auth/callback']) {
    expect(forbiddenGuestRequest(origin + path, origin)).toBe(true);
  }
  expect(forbiddenGuestRequest('https://unlisted.example.test/pixel', origin)).toBe(true);
  expect(forbiddenGuestRequest('https://login.kinde.com/', origin)).toBe(true);
  expect(forbiddenGuestRequest(origin + '/assets/index.js', origin)).toBe(false);
  expect(forbiddenGuestRequest(origin + '/assets/firebase-auth-hash.js', origin)).toBe(true);
  expect(forbiddenGuestRequest(origin + '/assets/firebase-firestore-hash.js', origin)).toBe(true);
  expect(forbiddenGuestRequest(origin + '/assets/firebase-hash.js', origin)).toBe(true);
  expect(forbiddenGuestRequest(origin + '/', origin)).toBe(false);
});

test('guest fitness persists across an online reload and an offline restart without Auth or health API traffic', async ({ page, context }) => {
  await page.goto('/');
  // The signed-out Kinde entry may check its session before guest activation.
  // Observe from the user's guest choice onward, including consent/provisioning.
  await expect(page.getByRole('button', { name: 'Continua senza account' })).toBeVisible();

  const appOrigin = new URL(page.url()).origin;
  const forbidden: string[] = [];
  const onRequest = (request: { url(): string }) => {
    if (forbiddenGuestRequest(request.url(), appOrigin)) forbidden.push(requestDestination(request.url()));
  };
  context.on('request', onRequest);

  // Actively reject same-origin Auth/health calls even when their handlers
  // would return a synthetic 401/503. External requests are already blocked
  // by the shared isolated E2E fixture.
  await context.route('**/*', route => {
    const url = route.request().url();
    if (forbiddenGuestRequest(url, appOrigin)) {
      // A routed request must fail the test even if no request event is emitted.
      forbidden.push(requestDestination(url));
      return route.abort('blockedbyclient');
    }
    return route.fallback();
  });

  try {
    await page.getByRole('button', { name: 'Continua senza account' }).click();
    await expect(page.getByText('Aggiornamento Termini e Privacy')).toBeVisible();
    for (const box of await page.locator('input[type="checkbox"]').all()) await box.check();
    await page.getByRole('button', { name: 'Accetta e Continua' }).click();
    await expect(page.locator('.guest-banner')).toBeVisible();

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

    // Reopen the saved vault in the same tab, not just a newly created tab.
    await page.reload();
    await expect(page.locator('.guest-banner')).toBeVisible();
    await page.getByRole('button', { name: 'Dati e statistiche', exact: true }).click();
    await page.getByRole('tab', { name: 'Biometria', exact: true }).click();
    await expect(page.locator('#biometry-height')).toHaveValue('181');

    // A second tab starts with a persisted guest owner. It must not probe
    // the Kinde session even if the identity service is unavailable.
    const second = await context.newPage();
    await second.goto('/?tab=data');
    await expect(second.locator('.guest-banner')).toBeVisible();
    await second.getByRole('tab', { name: 'Biometria', exact: true }).click();
    await expect(second.locator('#biometry-height')).toHaveValue('181');

    await second.evaluate(async () => { await navigator.serviceWorker.ready; });
    await second.waitForFunction(() => navigator.serviceWorker.controller !== null);
    // Close every live document before offline recovery: a warm first tab
    // cannot mask a failure to cold-bootstrap the owner-scoped archive.
    await second.close();
    await page.close();
    expect(context.pages()).toHaveLength(0);
    await context.setOffline(true);
    const recovered = await context.newPage();
    await recovered.goto('/?tab=data');
    expect(await recovered.evaluate(() => navigator.onLine)).toBe(false);
    await expect(recovered.locator('.guest-banner')).toBeVisible();
    await recovered.getByRole('tab', { name: 'Biometria', exact: true }).click();
    await expect(recovered.locator('#biometry-height')).toHaveValue('181');
    expect(forbidden).toEqual([]);
  } finally {
    context.off('request', onRequest);
  }
});
