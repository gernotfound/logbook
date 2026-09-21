import { test, expect } from '@playwright/test';

test.describe('Offline scenarios & Background suspension', () => {
  test('Local workout and durable UserData survive offline page loss', async ({ page, context }) => {
    // 1. Apri l'app
    await page.goto('/');

    // 2. Assicurati che l'app sia caricata e pronta
    await expect(page.locator('text=LogBook')).toBeVisible();

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
    await page.click('button:has-text("Crea scheda")');
    await page.fill('input[placeholder="Nome scheda"]', 'Scheda E2E Offline');
    await page.click('#routine-creation-form button:has-text("Crea scheda")');
    await expect(page.getByText('Scheda E2E Offline', { exact: true })).toBeVisible();

    // 6. Torna alla vista Sessione
    await page.click('button.sub-nav-btn:has-text("Sessione")');
    await page.selectOption('select#archive-routine-select', { label: 'Scheda E2E Offline (0 es.)' });

    // 7. Inizia l'allenamento
    await page.locator('#view-training').getByRole('button', { name: 'Inizia allenamento', exact: true }).click();
    await expect(page.locator('button:has-text("Termina")')).toBeVisible();

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
    await expect(newPage.locator('button:has-text("Termina")')).toBeVisible();

    // 11. Termina l'allenamento
    await newPage.click('button:has-text("Termina")');
    await newPage.click('button:has-text("Conferma")');
    await expect(newPage.getByRole('dialog', { name: /Scheda E2E Offline/ })).toBeVisible();
    await newPage.getByRole('dialog').getByRole('button', { name: 'Chiudi', exact: true }).click();
    await newPage.click('button[aria-label="Allenamento"]');
    await expect(newPage.locator('#view-training').getByRole('button', { name: 'Inizia allenamento', exact: true })).toBeVisible();
  });
});
