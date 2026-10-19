import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext } from '@playwright/test';
import { assertLoopbackE2eUrl } from '../scripts/e2e-environment.mjs';
import { expect, test } from './fixtures';

const origin = assertLoopbackE2eUrl(process.env.LOGBOOK_TEST_URL || 'http://127.0.0.1:4173');

/** A standalone, disposable on-disk browser profile: the test can restart Chromium after a crash. */
async function openIsolatedProfile(directory: string): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(directory, { headless: true, baseURL: origin });
  await context.route('**/*', route => {
    try {
      if (new URL(route.request().url()).origin === origin) return route.continue();
    } catch {
      // Invalid or non-loopback request is never allowed out of this E2E browser.
    }
    return route.abort('blockedbyclient');
  });
  return context;
}

test('abrupt browser crash preserves an unacknowledged encrypted note and recovers it offline', async () => {
  test.setTimeout(75_000);
  const profile = await mkdtemp(join(tmpdir(), 'logbook-buffered-crash-'));
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
  await expect(page.locator('.guest-banner')).toBeVisible();

  await page.getByRole('button', { name: 'Allenamento', exact: true }).click();
  await page.getByRole('tab', { name: 'Esercizi', exact: true }).click();
  await page.getByRole('button', { name: 'Crea esercizio' }).click();
  const exercise = 'Prova recupero crash locale';
  await page.locator('#exercise-name').fill(exercise);
  await page.locator('#exercise-creation-form').getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Crea esercizio' })).toBeVisible();

  await page.getByRole('tab', { name: 'Sessione', exact: true }).click();
  await page.getByRole('button', { name: 'Allenamento libero' }).click();
  await page.getByRole('button', { name: 'Salta check-in e inizia' }).click();
  await expect(page.getByRole('button', { name: 'Termina allenamento' })).toBeVisible();
  await page.getByPlaceholder('Cerca esercizio per nome...').fill(exercise);
  await page.getByRole('option', { name: new RegExp(exercise) }).click();
  await page.locator('.session-exercise-summary').click();
  await page.getByRole('button', { name: 'Aggiungi nota per la prossima volta' }).click();
  const note = page.getByPlaceholder('Note per la prossima volta (dolori, feedback)...');
  await expect(note).toBeVisible();

  const value = 'Testo non confermato: perdita improvvisa del processo e ripresa offline';
  await note.fill(value);

  // This is a real app write through the guest AEAD vault, not a synthetic
  // localStorage fixture. Both the independent witness and canonical draft
  // must have been synchronously written before intentionally killing the JS realm.
  const prefix = 'logbook:v2:guest:sealed:';
  const before = await page.evaluate((p) => Object.fromEntries(
    Object.entries(localStorage).filter(([key]) =>
      key.startsWith(p + 'draft:buffered-intent:') || key.startsWith(p + 'draft:buffered:textarea:'))
  ), prefix);
  expect(Object.keys(before).filter(k => k.includes('draft:buffered-intent:'))).toHaveLength(1);
  expect(Object.keys(before).filter(k => k.includes('draft:buffered:textarea:'))).toHaveLength(1);
  expect(Object.values(before).every(raw =>
    typeof raw === 'string' && !raw.includes(value))).toBe(true);

  // Precache must already control this page; the next document has no network.
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await original.setOffline(true);

  // Page.crash can terminate the entire browser process in Playwright's CI
  // container. Reopen a *new* Chromium process against the same disposable
  // on-disk profile; unlike context.newPage(), this works after browser death.
  const crashed = page.waitForEvent('crash', { timeout: 15_000 });
  const cdp = await original.newCDPSession(page);
  try {
    await cdp.send('Page.crash');
  } catch {
    // Closing the renderer can disconnect the command; the crash event is
    // the independent oracle that this was not a graceful navigation.
  }
  await crashed;
  await original.close().catch(() => {});

  recovered = await openIsolatedProfile(profile);
  await recovered.setOffline(true);
  const resumed = recovered.pages()[0] ?? await recovered.newPage();
  await resumed.goto('/?tab=training');
  await expect(resumed.getByRole('button', { name: 'Termina allenamento' })).toBeVisible();
  await resumed.locator('.session-exercise-summary').click();
  await resumed.getByRole('button', { name: 'Aggiungi nota per la prossima volta' }).click();
  await expect(resumed.getByPlaceholder('Note per la prossima volta (dolori, feedback)...')).toHaveValue(value);

  const after = await resumed.evaluate((p) => Object.fromEntries(
    Object.entries(localStorage).filter(([key]) =>
      key.startsWith(p + 'draft:buffered-intent:') || key.startsWith(p + 'draft:buffered:textarea:'))
  ), prefix);
  expect(after).toEqual(before);
  } finally {
    await recovered?.close().catch(() => {});
    await original?.close().catch(() => {});
    await rm(profile, { recursive: true, force: true });
  }
});
