import { test, expect } from '@playwright/test';

test.describe('Offline scenarios & Background suspension', () => {
  test('Local workout survives offline mode and visibilitychange suspension', async ({ page, context }) => {
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
    await expect(page.getByRole('button', { name: 'Allenamento' })).toBeVisible();

    // 4. Naviga alla tab Allenamento (tramite la Bottom Nav)
    await page.getByRole('button', { name: 'Allenamento' }).click();

    // 5. Crea una scheda vuota per poter avviare una sessione
    await expect(page.getByRole('tab', { name: 'Schede' })).toBeVisible();
    await page.getByRole('tab', { name: 'Schede' }).dispatchEvent('click');
    
    // Apri il box di creazione
    await expect(page.getByRole('button', { name: '+ Crea scheda' })).toBeVisible();
    await page.getByRole('button', { name: '+ Crea scheda' }).click();

    // Compila il nome della scheda
    await page.getByPlaceholder('Nome scheda').fill('Scheda E2E Offline');
    await page.getByRole('button', { name: 'Crea scheda', exact: true }).click();
    
    // Attendiamo che la scheda sia effettivamente salvata e compaia in archivio
    await expect(page.locator('text=Scheda E2E Offline').first()).toBeVisible();

    // 6. Torna alla vista Sessione
    await page.getByRole('tab', { name: 'Sessione' }).dispatchEvent('click');

    // Seleziona la scheda appena creata (usiamo index 1 così funziona indipendentemente dalla formattazione del label)
    await page.locator('select#archive-routine-select').waitFor({ state: 'visible' });
    await page.selectOption('select#archive-routine-select', { index: 1 });

    // 7. Inizia l'allenamento
    await page.getByRole('button', { name: 'Inizia allenamento' }).click();
    
    // Assicurati di essere nella schermata allenamento attivo
    await expect(page.getByRole('button', { name: 'Termina' })).toBeVisible();

    // 8. Vai offline
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await context.setOffline(true);

    // 10. Simula la sospensione del thread o del tab
    // Visibilitychange farà scattare il salvataggio immediato in localStorage bypassando il debounce
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Reopen while still offline: prove cold startup from the installed service worker and local data.
    await page.close();
    const newPage = await context.newPage();
    await newPage.goto('/');
    
    // Naviga di nuovo ad allenamento
    await newPage.getByRole('button', { name: 'Allenamento' }).click();

    // Assicurati che il workout sia ancora lì
    await expect(newPage.getByRole('button', { name: 'Termina' })).toBeVisible();

    // 12. Termina l'allenamento
    await newPage.getByRole('button', { name: 'Termina' }).click();
    // Conferma l'alert (GlobalDialog)
    await newPage.getByRole('button', { name: 'Conferma' }).click();

    // Verifica che l'allenamento sia finito
    await expect(newPage.getByRole('button', { name: 'Inizia allenamento' })).toBeVisible();
  });
});
