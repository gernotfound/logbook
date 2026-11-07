import { test, expect, type Page } from './fixtures';

const routineName = 'Scheda E2E revoca guest';

async function guestArchiveState(page: Page): Promise<{ envelope: boolean; mirror: boolean; key: boolean }> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('keyval-store');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{ envelope: boolean; mirror: boolean; key: boolean }>((resolve, reject) => {
        const transaction = db.transaction('keyval', 'readonly');
        const store = transaction.objectStore('keyval');
        const envelope = store.get('logbook:v2:guest');
        const mirror = store.get('logbook:v2:guest:secure-vault-control-mirror');
        const key = store.get('logbook:v2:guest:device-vault-key');
        transaction.oncomplete = () => resolve({
          envelope: envelope.result !== undefined,
          mirror: mirror.result !== undefined,
          key: key.result !== undefined,
        });
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  });
}

test('guest logout revokes another tab and removes its durable archive without resurrection', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continua senza account' }).click();
  await page.waitForSelector('text=Aggiornamento Termini e Privacy');
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) await checkbox.check();
  await page.getByRole('button', { name: 'Accetta e Continua' }).click();
  await expect(page.locator('.guest-banner')).toBeVisible();

  // Persist current-release guest data through the UI before revoking the session.
  await page.getByRole('button', { name: 'Allenamento', exact: true }).click();
  await page.locator('button.sub-nav-btn:has-text("Schede")').click();
  await page.getByRole('button', { name: 'Crea scheda' }).click();
  await page.locator('input[placeholder="Nome scheda"]').fill(routineName);
  await page.locator('#routine-creation-form').getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(page.getByText(routineName, { exact: true })).toBeVisible();
  await expect.poll(() => guestArchiveState(page)).toEqual({ envelope: true, mirror: true, key: true });
  await expect.poll(() => page.evaluate(() =>
    localStorage.getItem('logbook:v2:guest:secure-vault-control') !== null
  )).toBe(true);

  const background = await context.newPage();
  await background.goto('/');
  await expect(background.locator('.guest-banner')).toBeVisible();
  await background.getByRole('button', { name: 'Allenamento', exact: true }).click();
  await background.locator('button.sub-nav-btn:has-text("Schede")').click();
  await expect(background.getByText(routineName, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Esci', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Conferma' }).click();

  await expect(page.locator('.guest-banner')).toHaveCount(0);
  await expect(background.locator('.guest-banner')).toHaveCount(0);
  await expect(background.getByRole('button', { name: 'Continua senza account' })).toBeVisible();
  await expect.poll(() => background.evaluate(() => localStorage.getItem('logbook_is_guest'))).toBeNull();
  await expect.poll(() => background.evaluate(() =>
    localStorage.getItem('logbook:v2:guest:secure-vault-control')
  )).toBeNull();
  await expect.poll(() => guestArchiveState(background)).toEqual({ envelope: false, mirror: false, key: false });

  await background.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => guestArchiveState(background)).toEqual({ envelope: false, mirror: false, key: false });
  await expect.poll(() => background.evaluate(() =>
    Object.keys(localStorage).filter(key => key.startsWith('logbook:v2:guest:')).length
  )).toBe(0);

  // A fresh guest generation must not inherit business data from the revoked one.
  await page.getByRole('button', { name: 'Continua senza account' }).click();
  await expect(page.locator('.guest-banner')).toBeVisible();
  await expect(background.locator('.guest-banner')).toHaveCount(0);
  // A new guest generation requires fresh consent before the data views are interactive.
  await page.waitForSelector('text=Aggiornamento Termini e Privacy');
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) await checkbox.check();
  await page.getByRole('button', { name: 'Accetta e Continua' }).click();
  await page.getByRole('button', { name: 'Allenamento', exact: true }).click();
  await page.locator('button.sub-nav-btn:has-text("Schede")').click();
  await expect(page.getByText(routineName, { exact: true })).toHaveCount(0);
});

test('native guest lifecycle lock survives closed holder and queued login tabs without activating the abandoned attempt', async ({ page, context }) => {
  await page.goto('/');
  const latest = await context.newPage();
  const holder = await context.newPage();
  await latest.goto('/');
  await holder.goto('/');
  await expect(page.getByRole('button', { name: 'Continua senza account' })).toBeVisible();
  await expect(latest.getByRole('button', { name: 'Continua senza account' })).toBeVisible();

  await holder.evaluate(() => {
    const lifetime = new Promise<void>(() => { /* Released by destroying this document. */ });
    void navigator.locks.request('thelogbook:guest-lifecycle', { mode: 'exclusive' }, async () => {
      document.documentElement.dataset.lifecycleLockHeld = 'true';
      await lifetime;
    });
  });
  await expect(holder.locator('html')).toHaveAttribute('data-lifecycle-lock-held', 'true');

  await page.getByRole('button', { name: 'Continua senza account' }).click();
  await latest.getByRole('button', { name: 'Continua senza account' }).click();
  await expect.poll(() => holder.evaluate(async () => {
    const { held, pending } = await navigator.locks.query();
    const requests = pending?.filter(lock => lock.name === 'thelogbook:guest-lifecycle') ?? [];
    return {
      holders: held?.filter(lock => lock.name === 'thelogbook:guest-lifecycle').length,
      queued: requests.length,
      clients: new Set(requests.map(lock => lock.clientId)).size,
      activated: localStorage.getItem('logbook_guest_session_id_v1'),
    };
  })).toEqual({ holders: 1, queued: 2, clients: 2, activated: null });

  // Destroy both a queued Auth realm and the realm owning the native lock.
  // The remaining production AuthProvider must proceed without a fake queue
  // callback or a manual release event standing in for browser semantics.
  await page.close();
  await expect.poll(() => holder.evaluate(async () =>
    (await navigator.locks.query()).pending?.filter(lock =>
      lock.name === 'thelogbook:guest-lifecycle').length
  )).toBe(1);
  await holder.close();
  await expect(latest.getByText('Aggiornamento Termini e Privacy')).toBeVisible();
  for (const checkbox of await latest.locator('input[type="checkbox"]').all()) await checkbox.check();
  await latest.getByRole('button', { name: 'Accetta e Continua' }).click();
  await expect(latest.locator('.guest-banner')).toBeVisible();
  const generation = await latest.evaluate(() => localStorage.getItem('logbook_guest_session_id_v1'));
  expect(generation).toMatch(/^[a-f0-9]{32}$/);

  await latest.getByRole('button', { name: 'Allenamento', exact: true }).click();
  await latest.locator('button.sub-nav-btn:has-text("Schede")').click();
  await latest.getByRole('button', { name: 'Crea scheda' }).click();
  await latest.locator('input[placeholder="Nome scheda"]').fill(routineName);
  await latest.locator('#routine-creation-form').getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(latest.getByText(routineName, { exact: true })).toBeVisible();
  await expect.poll(() => hasGuestEnvelope(latest)).toBe(true);

  const fresh = await context.newPage();
  await fresh.goto('/?tab=training');
  await expect(fresh.locator('.guest-banner')).toBeVisible();
  await fresh.locator('button.sub-nav-btn:has-text("Schede")').click();
  await expect(fresh.getByText(routineName, { exact: true })).toBeVisible();
  expect(await fresh.evaluate(() => localStorage.getItem('logbook_guest_session_id_v1'))).toBe(generation);
});
