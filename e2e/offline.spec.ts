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
    const primaryNav = page.getByRole('navigation', { name: 'Navigazione principale' });
    const trainingNavButton = primaryNav.getByRole('button', { name: 'Allenamento', exact: true });
    await expect(trainingNavButton).toBeVisible();

    // 4. Naviga alla tab Allenamento (tramite la Bottom Nav)
    await trainingNavButton.click();
    const activeTrainingPanel = page.locator('.app-tab-panel:not([hidden])');

    // 5. Crea una scheda vuota per poter avviare una sessione
    await activeTrainingPanel.locator('button.sub-nav-btn:has-text("Schede")').click();
    
    // Apri il box di creazione
    await activeTrainingPanel.locator('button:has-text("Crea scheda")').click();

    // Compila il nome della scheda
    await activeTrainingPanel.locator('input[placeholder="Nome scheda"]').fill('Scheda E2E Offline');
    await activeTrainingPanel.locator('button:has-text("Crea scheda")').click();

    // 6. Torna alla vista Sessione
    await activeTrainingPanel.locator('button.sub-nav-btn:has-text("Sessione")').click();

    // Seleziona la scheda appena creata
    await activeTrainingPanel.locator('select#archive-routine-select').selectOption({ label: 'Scheda E2E Offline (0 es.)' });

    // 7. Inizia l'allenamento nel solo pannello attivo: la Home keep-alive può contenere una CTA omonima nascosta.
    const startWorkoutButton = activeTrainingPanel.getByRole('button', { name: 'Inizia allenamento', exact: true });
    await expect(startWorkoutButton).toBeVisible();
    await startWorkoutButton.click();
    
    // Assicurati di essere nella schermata allenamento attivo
    await expect(activeTrainingPanel.getByRole('button', { name: 'Termina sessione', exact: true })).toBeVisible();

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
    const reopenedPrimaryNav = newPage.getByRole('navigation', { name: 'Navigazione principale' });
    await reopenedPrimaryNav.getByRole('button', { name: 'Allenamento', exact: true }).click();
    const reopenedTrainingPanel = newPage.locator('.app-tab-panel:not([hidden])');

    // Assicurati che il workout sia ancora lì
    await expect(reopenedTrainingPanel.getByRole('button', { name: 'Termina sessione', exact: true })).toBeVisible();

    // 12. Termina l'allenamento
    await reopenedTrainingPanel.getByRole('button', { name: 'Termina sessione', exact: true }).click();
    // Conferma l'alert (GlobalDialog)
    await newPage.getByRole('button', { name: 'Conferma', exact: true }).click();

    // Verifica che l'allenamento sia finito nel pannello attivo.
    await expect(
      reopenedTrainingPanel.getByRole('button', { name: 'Inizia allenamento', exact: true })
    ).toBeVisible();
  });
});
