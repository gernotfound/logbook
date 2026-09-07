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
    await expect(page.locator('button[aria-label="Allenamento"]')).toBeVisible();

    // 4. Naviga alla tab Allenamento (tramite la Bottom Nav)
    await page.click('button[aria-label="Allenamento"]');

    // 5. Crea una scheda vuota per poter avviare una sessione
    await page.click('button.sub-nav-btn:has-text("Schede")');
    
    // Apri il box di creazione
    await page.click('button:has-text("Crea scheda")');

    // Compila il nome della scheda
    await page.fill('input[placeholder*="Spinta"]', 'Scheda E2E Offline');
    await page.click('button:has-text("Crea scheda")');

    // 6. Torna alla vista Sessione
    await page.click('button.sub-nav-btn:has-text("Sessione")');

    // Seleziona la scheda appena creata
    await page.selectOption('select#archive-routine-select', { label: 'Scheda E2E Offline (0 es.)' });

    // 7. Inizia l'allenamento
    await page.click('button:has-text("Inizia allenamento")');
    
    // Assicurati di essere nella schermata allenamento attivo
    await expect(page.locator('button:has-text("Termina")')).toBeVisible();

    // 8. Vai offline
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

    // 11. Torna online per riaprire l'app senza crashare se il SW non ha claimato il client in tempo
    await context.setOffline(false);

    // Chiudi e riapri il tab simulando la riapertura dell'app dopo il kill
    await page.close();
    const newPage = await context.newPage();
    await newPage.goto('/');
    
    // Naviga di nuovo ad allenamento
    await newPage.click('button[aria-label="Allenamento"]');

    // Assicurati che il workout sia ancora lì
    await expect(newPage.locator('button:has-text("Termina")')).toBeVisible();

    // 12. Termina l'allenamento
    await newPage.click('button:has-text("Termina")');
    // Conferma l'alert (GlobalDialog)
    await newPage.click('button:has-text("Conferma")');

    // Verifica che l'allenamento sia finito
    await expect(newPage.locator('button:has-text("Inizia allenamento")')).toBeVisible();
  });
});
