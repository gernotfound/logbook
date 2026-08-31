import { test, expect } from '@playwright/test';

test.describe('Offline scenarios & Background suspension', () => {
  test('Local workout survives offline mode and visibilitychange suspension', async ({ page, context }) => {
    // 1. Apri l'app
    await page.goto('/');

    // 2. Assicurati che l'app sia caricata e pronta
    await expect(page.locator('text=LogBook')).toBeVisible();

    // 3. Login as Guest
    const guestBtn = page.locator('button:has-text("Continua come ospite")');
    if (await guestBtn.isVisible()) {
      await guestBtn.click();
      await expect(page.locator('text=Inizia sessione vuota')).toBeVisible();
    }

    // 4. Inizia un allenamento
    await page.click('button:has-text("Inizia sessione vuota")');
    
    // Assicurati di essere nella schermata allenamento attivo
    await expect(page.locator('button:has-text("Termina")')).toBeVisible();

    // 5. Aggiungi un esercizio
    await page.click('button:has-text("Aggiungi esercizio")');
    // Trova la card della Panca Piana
    await page.locator('.card', { hasText: 'Panca Piana' }).first().click();
    
    // Aggiungi un set
    await page.click('button:has-text("Aggiungi serie")');
    await page.fill('input[placeholder="kg"]', '80');
    await page.fill('input[placeholder="reps"]', '10');
    // Clicca sulla spunta
    await page.locator('button.bg-primary').first().click();

    // 6. Vai offline
    await context.setOffline(true);

    // 7. Simula la sospensione del thread o del tab
    // Visibilitychange farà scattare il salvataggio immediato in localStorage bypassando il debounce
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // 8. Torna online per riaprire l'app senza crashare se il SW non ha claimato il client in tempo
    await context.setOffline(false);

    // Chiudi e riapri il tab simulando la riapertura dell'app dopo il kill
    await page.close();
    const newPage = await context.newPage();
    await newPage.goto('/');

    // Assicurati che il workout sia ancora lì e il set anche
    await expect(newPage.locator('button:has-text("Termina")')).toBeVisible();
    await expect(newPage.locator('input[value="80"]')).toBeVisible();
    await expect(newPage.locator('input[value="10"]')).toBeVisible();

    // 10. Termina l'allenamento
    await newPage.click('button:has-text("Termina")');
    // Conferma l'alert
    await newPage.click('button:has-text("Termina sessione")');

    // Verifica che l'allenamento sia finito (Home)
    await expect(newPage.locator('text=Inizia sessione vuota')).toBeVisible();
  });
});
