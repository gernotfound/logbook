import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { assertLoopbackE2eUrl } from '../scripts/e2e-environment.mjs';
import { expect, test } from './fixtures';

const origin = assertLoopbackE2eUrl(process.env.LOGBOOK_TEST_URL || 'http://127.0.0.1:4173');
const datedPrefix = 'logbook:v2:guest:sealed:draft:dated-intent:';
const canonicalPrefix = 'logbook:v2:guest:sealed:draft:measurement:';

async function openIsolatedProfile(directory: string): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(directory, { headless: true, baseURL: origin });
  await context.route('**/*', route => {
    try {
      if (new URL(route.request().url()).origin === origin) return route.continue();
    } catch {
      // Unknown URLs must not leave the isolated CI browser.
    }
    return route.abort('blockedbyclient');
  });
  return context;
}

async function openGuestMeasurements(page: Page) {
  await page.getByRole('button', { name: 'Dati e statistiche', exact: true }).click();
  await page.getByRole('tab', { name: 'Misurazioni', exact: true }).click();
  await expect(page.locator('#measure-weight')).toBeVisible();
}

async function deviceEvidence(page: Page) {
  return page.evaluate(([dated, canonical]) => Object.fromEntries(
    Object.entries(localStorage).filter(([key]) =>
      key.startsWith(dated) || key.startsWith(canonical))
  ), [datedPrefix, canonicalPrefix]);
}

test('offline browser restart after abrupt crash preserves an uncommitted dated measurement and its AEAD witness', async () => {
  test.setTimeout(75_000);
  const profile = await mkdtemp(join(tmpdir(), 'logbook-dated-crash-'));
  let original: BrowserContext | undefined;
  let recovered: BrowserContext | undefined;
  try {
    original = await openIsolatedProfile(profile);
    const page = original.pages()[0] ?? await original.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: 'Continua senza account' }).click();
    await expect(page.getByText('Aggiornamento Termini e Privacy')).toBeVisible();
    for (const checkbox of await page.locator('input[type="checkbox"]').all()) {
      await checkbox.check();
    }
    await page.getByRole('button', { name: 'Accetta e Continua' }).click();
    await expect(page.getByRole('button', { name: 'Dati e statistiche', exact: true })).toBeVisible();
    await openGuestMeasurements(page);

    // Don't blur or submit: only the synchronous device archive may contain
    // this uncommitted health-form edit when Chromium is terminated.
    const value = '75';
    await page.locator('#measure-weight').fill(value);
    const before = await deviceEvidence(page);
    expect(Object.keys(before).filter(key => key.startsWith(datedPrefix))).toHaveLength(1);
    expect(Object.keys(before).filter(key => key.startsWith(canonicalPrefix))).toHaveLength(1);
    expect(Object.values(before).every(ciphertext => typeof ciphertext === 'string'
      && !ciphertext.includes('"75"'))).toBe(true);

    // The successor document must load from the installed Service Worker
    // while the browser context is still offline, not from the test server.
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await original.setOffline(true);

    const crashed = page.waitForEvent('crash', { timeout: 15_000 });
    const cdp = await original.newCDPSession(page);
    // The command may never settle once Chromium dies: use the independent
    // crash event rather than awaiting a reply from the dead process.
    void cdp.send('Page.crash').catch(() => {});
    await crashed;
    if (original.browser()?.isConnected()) await original.close();

    recovered = await openIsolatedProfile(profile);
    await recovered.setOffline(true);
    const resumed = recovered.pages()[0] ?? await recovered.newPage();
    await resumed.goto('/');
    await expect(resumed.getByRole('button', { name: 'Dati e statistiche', exact: true })).toBeVisible();
    await openGuestMeasurements(resumed);
    await expect(resumed.locator('#measure-weight')).toHaveValue(value);
    expect(await deviceEvidence(resumed)).toEqual(before);
  } finally {
    await recovered?.close().catch(() => {});
    await original?.close().catch(() => {});
    await rm(profile, { recursive: true, force: true });
  }
});
