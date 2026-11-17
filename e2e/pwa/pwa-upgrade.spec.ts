import type { Page } from '../fixtures';
import { expect, test } from '../pwa-upgrade-fixtures';

async function openApplicationSettings(page: Page) {
  await page.goto('/?tab=settings');
  await expect(page.getByRole('heading', { name: 'Impostazioni', exact: true })).toBeVisible();
  await page.locator('.settings-menu').getByRole('button', { name: /Aspetto e applicazione/ }).click();
}

async function expectWorkoutNote(page: Page, value: string) {
  await page.getByRole('button', { name: 'Allenamento', exact: true }).click();
  await page.getByRole('tab', { name: 'Sessione', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Termina allenamento' })).toBeVisible();
  const summary = page.locator('.session-exercise-summary');
  if (await summary.getAttribute('aria-expanded') !== 'true') await summary.click();
  const toggle = page.locator('.session-next-note-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await expect(page.getByPlaceholder('Note per la prossima volta (dolori, feedback)...')).toHaveValue(value);
}

test('two real PWA builds wait, reject unsafe reload, then activate without losing data or reloading another tab', async ({ page, context, upgradeServer }) => {
  test.setTimeout(75_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Continua senza account' }).click();
  await expect(page.getByText('Aggiornamento Termini e Privacy')).toBeVisible();
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) await checkbox.check();
  await page.getByRole('button', { name: 'Accetta e Continua' }).click();
  await expect(page.locator('.guest-banner')).toBeVisible();

  const exercise = 'Esercizio conservato fra due build';
  await page.getByRole('button', { name: 'Allenamento', exact: true }).click();
  await page.getByRole('tab', { name: 'Esercizi', exact: true }).click();
  await page.getByRole('button', { name: 'Crea esercizio' }).click();
  await page.locator('#exercise-name').fill(exercise);
  await page.locator('#exercise-creation-form').getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Crea esercizio' })).toBeVisible();
  await page.getByRole('tab', { name: 'Sessione', exact: true }).click();
  await page.getByRole('button', { name: 'Allenamento libero' }).click();
  await page.getByRole('button', { name: 'Salta check-in e inizia' }).click();
  await page.getByPlaceholder('Cerca esercizio per nome...').fill(exercise);
  await page.getByRole('option', { name: new RegExp(exercise) }).click();
  await page.locator('.session-exercise-summary').click();
  await page.getByRole('button', { name: 'Aggiungi nota per la prossima volta' }).click();

  const background = await context.newPage();
  await openApplicationSettings(background);
  const previousVersion = await background.locator('.settings-version').textContent();
  expect(previousVersion).not.toContain('-e2e-next');
  for (const tab of [page, background]) {
    await tab.evaluate(async () => {
      await navigator.serviceWorker.ready;
      document.documentElement.dataset.upgradeRealm = 'previous';
    });
    await tab.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated');
  }
  await background.evaluate(() => {
    const previous = navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (navigator.serviceWorker.controller !== previous) {
        document.documentElement.dataset.upgradeControllerChanged = 'true';
      }
    });
  });

  // Switch the server release, then let the production Settings action discover
  // and install the real replacement. No synthetic waiting event is dispatched.
  upgradeServer.useNextBuild();
  await background.getByRole('button', { name: /Cerca aggiornamenti/ }).click();
  await expect(background.getByRole('alertdialog')).toContainText('Nuova versione trovata');
  await background.getByRole('alertdialog').getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.getByText('Nuova versione disponibile', { exact: true })).toBeVisible();
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state === 'installed');

  // Edit after installation while the previous bundle still owns the page.
  // The real buffered field and reload barrier must preserve these keystrokes.
  const value = 'Ultima nota prima della vera attivazione del Service Worker';
  await page.getByPlaceholder('Note per la prossima volta (dolori, feedback)...').fill(value);
  await page.evaluate(() => {
    // Fail envelope inspection, not the get inside idb-keyval.update's
    // readwrite commit: that separate failure correctly requires recovery.
    const original = IDBObjectStore.prototype.get;
    (window as Window & { restoreUpgradeRead?: () => void }).restoreUpgradeRead = () => {
      IDBObjectStore.prototype.get = original;
    };
    IDBObjectStore.prototype.get = function(query: IDBValidKey | IDBKeyRange) {
      if (this.name === 'keyval' && this.transaction.mode === 'readonly' && query === 'logbook:v2:guest') {
        throw new DOMException('Synthetic archive read failure', 'UnknownError');
      }
      return original.call(this, query);
    };
  });
  await page.getByRole('button', { name: 'Aggiorna applicazione', exact: true }).click();
  await expect(page.locator('.reload-prompt-toast p[role="alert"]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-upgrade-realm', 'previous');
  expect(await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return { waiting: registration?.waiting?.state, active: navigator.serviceWorker.controller === registration?.active };
  })).toEqual({ waiting: 'installed', active: true });
  await expect(background.locator('.settings-version')).toHaveText(previousVersion!);

  await page.evaluate(() => {
    const restore = (window as Window & { restoreUpgradeRead?: () => void }).restoreUpgradeRead;
    if (!restore) throw new Error('Missing test read-fault restoration');
    restore();
  });
  await page.getByRole('button', { name: 'Aggiorna applicazione', exact: true }).click();
  await expect.poll(async () => ({
    realm: await page.locator('html').getAttribute('data-upgrade-realm'),
    error: await page.locator('.reload-prompt-toast p[role="alert"]').allTextContents(),
  })).toEqual({ realm: null, error: [] });
  await expect(page.locator('.guest-banner')).toBeVisible();
  await expectWorkoutNote(page, value);

  // clientsClaim changes the other tab's controller too. It must keep its old
  // JS realm rather than bypassing that tab's own durability/reload barrier.
  await expect(background.locator('html')).toHaveAttribute('data-upgrade-controller-changed', 'true');
  await expect(background.locator('html')).toHaveAttribute('data-upgrade-realm', 'previous');
  await expect(background.locator('.settings-version')).toHaveText(previousVersion!);
  await openApplicationSettings(page);
  await expect(page.locator('.settings-version')).toContainText(`Versione ${process.env.LOGBOOK_E2E_NEXT_VERSION} ·`);
  await expect(page.getByText('Nuova versione disponibile', { exact: true })).toHaveCount(0);

  // Recreate the upgraded document offline, using the new worker's precache
  // plus the actual owner-bound IndexedDB and device workout copies.
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.guest-banner')).toBeVisible();
  await expectWorkoutNote(page, value);
  await page.getByRole('tab', { name: 'Esercizi', exact: true }).click();
  await expect(page.getByText(exercise, { exact: true })).toBeVisible();
  await expect(background.locator('html')).toHaveAttribute('data-upgrade-realm', 'previous');
});
