import { expect, test, type Page } from '@playwright/test';

async function inspectPersistedGuestKey(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('keyval-store');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    let storedKey: unknown;
    try {
      storedKey = await new Promise<unknown>((resolve, reject) => {
        const transaction = db.transaction('keyval', 'readonly');
        const request = transaction.objectStore('keyval').get('logbook:v2:guest:device-vault-key');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }

    if (!(storedKey instanceof CryptoKey)) throw new Error('Missing structured-cloned guest CryptoKey');
    const metadataText = localStorage.getItem('logbook:v2:guest:secure-vault-control');
    if (!metadataText) throw new Error('Missing durable vault metadata');
    const metadata = JSON.parse(metadataText) as {
      owner: string; phase: string; wrappedKey: { nonce: string; wrappedDek: string };
    };
    if (metadata.owner !== 'guest' || metadata.phase !== 'active') {
      throw new Error('Guest vault control not active');
    }

    const fromHex = (hex: string) => Uint8Array.from(
      hex.match(/.{2}/g) ?? [], byte => Number.parseInt(byte, 16),
    );
    const aad = new TextEncoder().encode(JSON.stringify([
      'thelogbook', 'local-dek', 'device', 2, 'guest',
      'logbook:v2:guest:device-vault-key',
    ]));
    const plaintext = await crypto.subtle.decrypt({
      name: 'AES-GCM',
      iv: fromHex(metadata.wrappedKey.nonce),
      additionalData: aad,
    }, storedKey, fromHex(metadata.wrappedKey.wrappedDek));

    let exportDenied = false;
    try {
      await crypto.subtle.exportKey('raw', storedKey);
    } catch {
      exportDenied = true;
    }
    return {
      nonExtractable: storedKey.extractable === false && exportDenied,
      algorithm: storedKey.algorithm.name,
      unwrappedBytes: plaintext.byteLength,
    };
  });
}

test('real browser retains non-exportable guest device key across a new document', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continua senza account' }).click();
  await expect(page.getByText('Aggiornamento Termini e Privacy')).toBeVisible();
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) {
    await checkbox.check();
  }
  await page.getByRole('button', { name: 'Accetta e Continua' }).click();
  await expect(page.locator('.guest-banner')).toBeVisible();

  const before = await inspectPersistedGuestKey(page);
  expect(before).toEqual({
    nonExtractable: true,
    algorithm: 'AES-GCM',
    unwrappedBytes: 32,
  });

  // A reload discards JS memory; decryption now depends on IndexedDB's real
  // structured-clone support, including the WebKit engine used by mobile Safari.
  await page.reload();
  await expect(page.locator('.guest-banner')).toBeVisible();
  expect(await inspectPersistedGuestKey(page)).toEqual(before);

  // Deliberately lose ONLY the synchronous control. A new JS realm must
  // reconstruct precisely the same wrapped DEK from IndexedDB, not provision
  // an empty competing vault. This is exercised in Chromium and WebKit.
  const originalControl = await page.evaluate(() => {
    const key = 'logbook:v2:guest:secure-vault-control';
    const value = localStorage.getItem(key);
    if (!value) throw new Error('Guest vault control disappeared before recovery test');
    localStorage.removeItem(key);
    return value;
  });
  await page.reload();
  await expect(page.locator('.guest-banner')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('logbook:v2:guest:secure-vault-control'))).toBe(originalControl);
  expect(await inspectPersistedGuestKey(page)).toEqual(before);
});
