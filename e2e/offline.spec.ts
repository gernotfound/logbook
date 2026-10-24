import { test, expect } from './fixtures';

test.describe('Offline scenarios & Background suspension', () => {
  test('unreadable ownership storage renders the recovery barrier instead of mounting account data', async ({ page }) => {
    await page.addInitScript(() => {
      const read = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key: string) {
        if (key === 'logbook_is_guest') throw new DOMException('Owner storage blocked', 'SecurityError');
        return read.call(this, key);
      };
    });
    await page.goto('/');
    await expect(page.locator('#storage-unavailable')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Archivio non disponibile' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Riprova' })).toBeVisible();
    await expect(page.locator('#view-training')).toHaveCount(0);
  });

  test('Local workout and durable UserData survive offline page loss', async ({ page, context }) => {
    // 1. Apri l'app
    await page.goto('/');

    // 2. Assicurati che l'app sia caricata e pronta
    await expect(page.getByRole('heading', { name: 'TheLogBook' })).toBeVisible();

    // 3. Login as Guest
    await page.click('button:has-text("Continua senza account")');

    // 3.5 Accetta Termini e Condizioni (Privacy Overlay)
    await page.waitForSelector('text=Aggiornamento Termini e Privacy');
    const checkboxes = await page.locator('input[type="checkbox"]').all();
    for (const cb of checkboxes) {
      await cb.check();
    }
    await page.click('button:has-text("Accetta e Continua")');

    // Attendiamo di essere loggati e vedere la navbar
    await expect(page.locator('button[aria-label="Allenamento"]')).toBeVisible();

    // 4. Naviga alla tab Allenamento (tramite la Bottom Nav)
    await page.click('button[aria-label="Allenamento"]');

    // 5. Crea una scheda vuota: è UserData persistito nell'envelope IndexedDB.
    await page.click('button.sub-nav-btn:has-text("Schede")');
    await page.getByRole('button', { name: 'Crea scheda' }).click();
    await page.fill('input[placeholder="Nome scheda"]', 'Scheda E2E Offline');
    await page.click('#routine-creation-form button:has-text("Salva")');
    await expect(page.getByText('Scheda E2E Offline', { exact: true })).toBeVisible();

    // 6. Torna alla vista Sessione
    await page.click('button.sub-nav-btn:has-text("Sessione")');

    // 7. Avvia la scheda direttamente dall'archivio e completa il check-in.
    await page.locator('#view-training').getByRole('button', { name: /Scheda E2E Offline/ }).click();
    await page.getByRole('button', { name: 'Salta check-in e inizia' }).click();
    await expect(page.getByRole('button', { name: 'Termina allenamento' })).toBeVisible();

    // 8. Vai offline
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await context.setOffline(true);

    // 9. Simula la sospensione del thread/tab per il device-local snapshot.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // 10. Distruggi il JS realm e riapri offline: nessuna memoria di modulo può sopravvivere.
    await page.close();
    const newPage = await context.newPage();
    await newPage.goto('/');

    await newPage.click('button[aria-label="Allenamento"]');

    // UserData deve provenire dalla copia IndexedDB, non dal vecchio heap JavaScript.
    await newPage.click('button.sub-nav-btn:has-text("Schede")');
    await expect(newPage.getByText('Scheda E2E Offline', { exact: true })).toBeVisible();

    // Anche il workout device-local deve sopravvivere.
    await newPage.click('button.sub-nav-btn:has-text("Sessione")');
    await expect(newPage.getByRole('button', { name: 'Termina allenamento' })).toBeVisible();

    // 11. Termina l'allenamento
    await newPage.getByRole('button', { name: 'Termina allenamento' }).click();
    await expect(newPage.getByRole('heading', { name: /andato l.allenamento/i })).toBeVisible();
    await newPage.getByRole('button', { name: 'Salva e termina' }).click();
    await expect(newPage.getByRole('dialog', { name: /Scheda E2E Offline/ })).toBeVisible();
    await newPage.getByRole('dialog').getByRole('button', { name: 'Chiudi', exact: true }).click();
    await newPage.click('button[aria-label="Allenamento"]');
    await expect(newPage.locator('#view-training').getByRole('button', { name: /Scheda E2E Offline/ })).toBeVisible();
  });

  test('PWA shortcut query reopens the precached app shell while offline', async ({ page, context }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'TheLogBook' })).toBeVisible();

    // The SW update lifecycle is mounted after the app has an owner context.
    // Enter guest mode first, exactly as a real installed PWA session would.
    await page.getByRole('button', { name: 'Continua senza account' }).click();
    await page.waitForSelector('text=Aggiornamento Termini e Privacy');
    for (const checkbox of await page.locator('input[type="checkbox"]').all()) {
      await checkbox.check();
    }
    await page.getByRole('button', { name: 'Accetta e Continua' }).click();
    await expect(page.locator('button[aria-label="Allenamento"]')).toBeVisible();

    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await context.setOffline(true);

    await page.goto('/?tab=training');
    await expect(page.locator('#view-training')).toBeVisible();
    await expect.poll(() => new URL(page.url()).search).toBe('');
    // History has never been visited in this browser session. Its lazily loaded
    // chunk must still be available from the Service Worker precache offline.
    await page.getByRole('tab', { name: 'Storico' }).click();
    await expect(page.locator('#training-panel-history')).toBeVisible();
    await expect(page.getByText('Storico Allenamenti')).toBeVisible();

    await page.getByRole('tab', { name: 'Sessione' }).click();
    await expect(page.locator('#training-panel-session')).toBeVisible();
  });

  test('a pending PWA update remains dismissible without losing guest data on reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Continua senza account' }).click();
    await page.getByText('Aggiornamento Termini e Privacy').waitFor();
    for (const checkbox of await page.locator('input[type="checkbox"]').all()) {
      await checkbox.check();
    }
    await page.getByRole('button', { name: 'Accetta e Continua' }).click();
    await expect(page.locator('.guest-banner')).toBeVisible();

    await page.getByRole('button', { name: 'Allenamento', exact: true }).click();
    await page.getByRole('tab', { name: 'Schede', exact: true }).click();
    await page.getByRole('button', { name: 'Crea scheda' }).click();
    await page.getByPlaceholder('Nome scheda').fill('Scheda aggiornamento PWA');
    await page.locator('#routine-creation-form').getByRole('button', { name: 'Salva', exact: true }).click();
    await expect(page.getByText('Scheda aggiornamento PWA', { exact: true })).toBeVisible();

    // This triggers the real prompt listener, not a replacement service worker.
    await page.evaluate(() => window.dispatchEvent(new Event('logbook:pwa-update-waiting')));
    await expect(page.getByText('Nuova versione disponibile')).toBeVisible();

    // A 320px browser viewport verifies actual geometry, not CSS regex matches.
    await page.setViewportSize({ width: 320, height: 640 });
    const positions = await page.evaluate(() => {
      const toast = document.querySelector('.reload-prompt-toast')!.getBoundingClientRect();
      const nav = document.querySelector('.bottom-nav')!.getBoundingClientRect();
      return { toastBottom: toast.bottom, navTop: nav.top, toastLeft: toast.left, toastRight: toast.right };
    });
    expect(positions.toastBottom).toBeLessThanOrEqual(positions.navTop);
    expect(positions.toastLeft).toBeGreaterThanOrEqual(0);
    expect(positions.toastRight).toBeLessThanOrEqual(320);

    // Force a real owner-storage read failure at the reload barrier. Clicking
    // update must keep this JS realm alive and must not erase the saved routine.
    await page.evaluate(() => {
      const get = Storage.prototype.getItem;
      (window as Window & { __restoreOwnerRead?: () => void; __reloadSentinel?: string }).__restoreOwnerRead = () => {
        Storage.prototype.getItem = get;
      };
      (window as Window & { __reloadSentinel?: string }).__reloadSentinel = 'same-realm';
      Storage.prototype.getItem = function(key: string) {
        if (key === 'logbook_is_guest') throw new DOMException('Owner storage blocked', 'SecurityError');
        return get.call(this, key);
      };
    });
    await page.getByRole('button', { name: 'Aggiorna applicazione' }).click();
    await expect(page.locator('.reload-prompt-toast p[role="alert"]')).toBeVisible();
    expect(await page.evaluate(() => (window as Window & { __reloadSentinel?: string }).__reloadSentinel)).toBe('same-realm');
    await expect(page.getByText('Scheda aggiornamento PWA', { exact: true })).toBeVisible();
    await page.evaluate(() => (window as Window & { __restoreOwnerRead?: () => void }).__restoreOwnerRead?.());

    await page.getByRole('button', { name: 'Chiudi notifica' }).click();
    await expect(page.getByText('Nuova versione disponibile')).toHaveCount(0);

    await page.reload();
    await expect(page.locator('.guest-banner')).toBeVisible();
    await page.getByRole('button', { name: 'Allenamento', exact: true }).click();
    await page.getByRole('tab', { name: 'Schede', exact: true }).click();
    await expect(page.getByText('Scheda aggiornamento PWA', { exact: true })).toBeVisible();
  });

});
