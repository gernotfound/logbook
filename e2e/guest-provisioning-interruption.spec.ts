import { expect, test, type Page } from './fixtures';
import { pauseStorageWrite } from './storage-write-barrier';

const controlKey = 'logbook:v2:guest:secure-vault-control';
type VaultControl = {
  format: string; version: number; owner: string; phase: string;
  epoch: string; wrappedKey: Record<string, unknown>;
};

async function openObserver(observer: Page, appUrl: string) {
  // This reserved path bypasses the production SW app-shell navigation route.
  // The same-origin observation document runs no Auth/bootstrap code.
  const url = new URL('/__/e2e-lock-observer', appUrl).href;
  await observer.route(url, route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Native lock observer</title>',
  }));
  await observer.goto(url);
}

async function readVaultState(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('keyval-store');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{
        mirror: unknown; envelope: unknown; nonExtractableKey: boolean;
      }>((resolve, reject) => {
        const transaction = db.transaction('keyval', 'readonly');
        const store = transaction.objectStore('keyval');
        const mirror = store.get('logbook:v2:guest:secure-vault-control-mirror');
        const key = store.get('logbook:v2:guest:device-vault-key');
        const envelope = store.get('logbook:v2:guest');
        transaction.oncomplete = () => resolve({
          mirror: mirror.result ?? null,
          envelope: envelope.result ?? null,
          nonExtractableKey: key.result instanceof CryptoKey && !key.result.extractable,
        });
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  });
}

for (const phase of ['migrating', 'active'] as const) {
  test(`closing the real guest bootstrap before ${phase} control publication releases its native locks and resumes the same key`, async ({ page, context }) => {
    await page.goto('/');
    const next = await context.newPage();
    const observer = await context.newPage();
    await next.goto('/');
    await openObserver(observer, page.url());
    for (const tab of [page, next]) {
      await expect(tab.getByRole('button', { name: 'Continua senza account' })).toBeVisible();
    }

    // Pause an actual production publication after the mirror's IndexedDB
    // transaction committed, before localStorage receives that phase.
    const barrier = await pauseStorageWrite(page, controlKey, `"phase":"${phase}"`);
    const starting = Promise.allSettled([
      page.getByRole('button', { name: 'Continua senza account' }).click(),
    ]);
    let expected: VaultControl;
    let firstGeneration: string | null;
    try {
      const write = await barrier.wait();
      expect(write.key).toBe(controlKey);
      expected = JSON.parse(write.value) as VaultControl;
      expect(expected).toMatchObject({
        format: 'thelogbook-local-vault-control', version: 2, owner: 'guest', phase,
      });
      expect(expected.epoch).toMatch(/^[a-f0-9]{32}$/);
      if (phase === 'migrating') expect(write.previous).toBeNull();
      else expect(JSON.parse(write.previous!)).toEqual({ ...expected, phase: 'migrating' });

      const before = await readVaultState(observer);
      expect(before.mirror).toEqual(expected);
      expect(before.nonExtractableKey).toBe(true);
      expect(before.envelope).toBeNull();
      firstGeneration = await observer.evaluate(() => localStorage.getItem('logbook_guest_session_id_v1'));
      expect(firstGeneration).toMatch(/^[a-f0-9]{32}$/);

      await next.getByRole('button', { name: 'Continua senza account' }).click();
      await expect.poll(() => observer.evaluate(async () => {
        const { held = [], pending = [] } = await navigator.locks.query();
        const lifecycle = held.filter(lock => lock.name === 'thelogbook:guest-lifecycle');
        const vault = held.filter(lock => lock.name === 'thelogbook:secure-archive:guest');
        const queued = pending.filter(lock => lock.name === 'thelogbook:guest-lifecycle');
        return {
          lifecycle: lifecycle.length, vault: vault.length, queued: queued.length,
          sameHolder: lifecycle.length === 1 && vault.length === 1
            && lifecycle[0].clientId === vault[0].clientId,
          separateContender: queued.length === 1 && queued[0].clientId !== lifecycle[0]?.clientId,
        };
      })).toEqual({ lifecycle: 1, vault: 1, queued: 1, sameHolder: true, separateContender: true });

      // The terminated page is the REAL Auth/vault lock owner. No fake holder,
      // release callback or replay of its interrupted JS finishes the operation.
      await page.close();
    } finally {
      if (!page.isClosed()) await barrier.dispose();
      await starting;
    }

    await expect(next.getByText('Aggiornamento Termini e Privacy')).toBeVisible();
    for (const checkbox of await next.locator('input[type="checkbox"]').all()) await checkbox.check();
    await next.getByRole('button', { name: 'Accetta e Continua' }).click();
    await expect(next.locator('.guest-banner')).toBeVisible();
    const activeControl = { ...expected!, phase: 'active' };
    expect(await observer.evaluate(key => JSON.parse(localStorage.getItem(key)!), controlKey)).toEqual(activeControl);
    const recovered = await readVaultState(observer);
    expect(recovered.mirror).toEqual(activeControl);
    expect(recovered.nonExtractableKey).toBe(true);
    const nextGeneration = await next.evaluate(() => localStorage.getItem('logbook_guest_session_id_v1'));
    expect(nextGeneration).toMatch(/^[a-f0-9]{32}$/);
    expect(nextGeneration).not.toBe(firstGeneration!);

    // Completing the UI login is not proof that the recovered capability can
    // seal/read business data. Persist through the domain path and reopen it.
    await next.getByRole('button', { name: 'Dati e statistiche', exact: true }).click();
    await next.getByRole('tab', { name: 'Biometria', exact: true }).click();
    await next.locator('#biometry-height').fill('183');
    await next.getByRole('button', { name: 'Salva profilo biometrico' }).click();
    await expect.poll(async () => (await readVaultState(observer)).envelope).not.toBe(recovered.envelope);
    const ciphertext = (await readVaultState(observer)).envelope;
    expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
    expect(ciphertext).not.toContain('"height":"183"');

    const fresh = await context.newPage();
    await fresh.goto('/?tab=data');
    await fresh.getByRole('tab', { name: 'Biometria', exact: true }).click();
    await expect(fresh.locator('#biometry-height')).toHaveValue('183');
    expect((await readVaultState(fresh)).envelope).toBe(ciphertext);
    expect(await fresh.evaluate(key => JSON.parse(localStorage.getItem(key)!), controlKey)).toEqual(activeControl);
    await expect.poll(() => observer.evaluate(async () => {
      const locks = await navigator.locks.query();
      return [...(locks.held ?? []), ...(locks.pending ?? [])]
        .filter(lock => lock.name === 'thelogbook:guest-lifecycle'
          || lock.name === 'thelogbook:secure-archive:guest').length;
    })).toBe(0);
  });
}

test('a queued Google guest action reports an interrupted published reservation without replacing it or changing guest data', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continua senza account' }).click();
  await expect(page.getByText('Aggiornamento Termini e Privacy')).toBeVisible();
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) await checkbox.check();
  await page.getByRole('button', { name: 'Accetta e Continua' }).click();
  await page.getByRole('button', { name: 'Dati e statistiche', exact: true }).click();
  await page.getByRole('tab', { name: 'Biometria', exact: true }).click();
  const initialCiphertext = (await readVaultState(page)).envelope;
  await page.locator('#biometry-height').fill('183');
  await page.getByRole('button', { name: 'Salva profilo biometrico' }).click();
  await expect.poll(async () => (await readVaultState(page)).envelope).not.toBe(initialCiphertext);

  const next = await context.newPage();
  for (const tab of [page, next]) {
    await tab.goto('/?tab=settings');
    await expect(tab.getByRole('heading', { name: 'Impostazioni', exact: true })).toBeVisible();
    await tab.locator('.settings-menu').getByRole('button', { name: /Account e accesso/ }).click();
    await expect(tab.getByRole('button', { name: 'Crea account con Google', exact: true })).toBeVisible();
  }
  const observer = await context.newPage();
  await openObserver(observer, page.url());
  const before = await readVaultState(observer);
  expect(before.envelope).toMatch(/^tlb-sealed:v1:/);
  const generation = await observer.evaluate(() => localStorage.getItem('logbook_guest_session_id_v1'));
  const intentKey = 'guest_migration_intent_v1';
  expect(await observer.evaluate(key => localStorage.getItem(key), intentKey)).toBeNull();

  const pageErrors: string[] = [];
  next.on('pageerror', error => { pageErrors.push(error.message); });
  let popups = 0;
  page.on('popup', () => { popups++; });
  next.on('popup', () => { popups++; });
  const firstBarrier = await pauseStorageWrite(page, intentKey);
  const starting = Promise.allSettled([
    page.getByRole('button', { name: 'Crea account con Google', exact: true }).click(),
  ]);
  try {
    const first = await firstBarrier.wait();
    const abandoned = JSON.parse(first.value) as { id: string; method: string; policy: string };
    expect(abandoned).toMatchObject({ method: 'google', policy: 'merge' });
    expect(abandoned.id).toBeTruthy();
    expect(first.previous).toBeNull();
    await firstBarrier.publishAndPause();
    expect(await observer.evaluate(key => localStorage.getItem(key), intentKey)).toBe(first.value);
    await next.getByRole('button', { name: 'Crea account con Google', exact: true }).click();
    await expect.poll(() => observer.evaluate(async () => {
      const { held = [], pending = [] } = await navigator.locks.query();
      const lifecycle = held.filter(lock => lock.name === 'thelogbook:guest-lifecycle');
      const intent = held.filter(lock => lock.name === 'thelogbook:guest-auth-intent');
      const queued = pending.filter(lock => lock.name === 'thelogbook:guest-lifecycle');
      return {
        lifecycle: lifecycle.length, intent: intent.length, queued: queued.length,
        sameHolder: lifecycle.length === 1 && intent.length === 1
          && lifecycle[0].clientId === intent[0].clientId,
        separateContender: queued.length === 1 && queued[0].clientId !== lifecycle[0]?.clientId,
      };
    })).toEqual({ lifecycle: 1, intent: 1, queued: 1, sameHolder: true, separateContender: true });

    await page.close();
    await expect(next.getByRole('alertdialog')).toContainText('Impossibile avviare l’accesso Google');
    expect(pageErrors).toEqual([]);
    expect(await observer.evaluate(key => localStorage.getItem(key), intentKey)).toBe(first.value);
    expect(await next.evaluate(() => sessionStorage.getItem('logbook:guest-auth-attempt'))).toBeNull();
    expect(await readVaultState(observer)).toEqual(before);
    await next.getByRole('alertdialog').getByRole('button', { name: 'OK', exact: true }).click();
    await expect(next.getByRole('button', { name: 'Crea account con Google', exact: true })).toBeEnabled();
    // An interrupted reservation is evidence, never permission for the other
    // tab to replace it or start a provider login with the old tab's choice.
    expect(JSON.parse((await observer.evaluate(key => localStorage.getItem(key), intentKey))!)).toEqual(abandoned);
  } finally {
    // The original action remains paused before Auth handoff. The contender
    // is rejected by the real reservation guard; neither starts a popup.
    if (!page.isClosed()) await page.close();
    if (!next.isClosed()) await next.close();
    await starting;
  }
  expect(popups).toBe(0);
  expect(await observer.evaluate(key => localStorage.getItem(key), intentKey)).not.toBeNull();
  expect(await observer.evaluate(() => localStorage.getItem('logbook_guest_session_id_v1'))).toBe(generation);

  const fresh = await context.newPage();
  await fresh.goto('/?tab=data');
  await fresh.getByRole('tab', { name: 'Biometria', exact: true }).click();
  await expect(fresh.locator('#biometry-height')).toHaveValue('183');
  expect(await readVaultState(fresh)).toEqual(before);
  await expect.poll(() => observer.evaluate(async () => {
    const { held = [], pending = [] } = await navigator.locks.query();
    return [...held, ...pending].filter(lock =>
      lock.name === 'thelogbook:guest-lifecycle' || lock.name === 'thelogbook:guest-auth-intent').length;
  })).toBe(0);
});
