import { test, expect, type Page } from '@playwright/test';

async function enterGuest(page: Page) {
    await page.goto('/');
    await page.getByRole('button', { name: 'Continua senza account' }).click();
    await expect(page.getByText('Aggiornamento Termini e Privacy')).toBeVisible();
    for (const checkbox of await page.locator('input[type="checkbox"]').all()) await checkbox.check();
    await page.getByRole('button', { name: 'Accetta e Continua' }).click();
    await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeVisible();
}
async function mainTab(page: Page, name: string) {
    await page.getByRole('navigation', { name: 'Navigazione principale' }).getByRole('button', { name, exact: true }).click();
}
async function expectPageFits(page: Page) {
    const sizes = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    expect(sizes.content).toBeLessThanOrEqual(sizes.viewport + 1);
    const tooSmall = await page.getByRole('navigation', { name: 'Navigazione principale' }).getByRole('button').evaluateAll(buttons => buttons.filter(button => {
        const rect = button.getBoundingClientRect(); return rect.width < 44 || rect.height < 44;
    }).map(button => button.getAttribute('aria-label')));
    expect(tooSmall).toEqual([]);
}

test('themes persist, narrow navigation fits, and a measurement draft survives tab changes', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await enterGuest(page);
    await mainTab(page, 'Impostazioni');
    await expect(page.getByRole('radio', { name: 'Sistema', exact: true })).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('radio', { name: 'Scuro', exact: true }).check();
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Scuro', exact: true })).toBeChecked();
    await mainTab(page, 'Dati e statistiche');
    await page.getByLabel('Peso (kg)', { exact: true }).fill('81.5');
    await mainTab(page, 'Impostazioni');
    await page.getByRole('radio', { name: 'Chiaro', exact: true }).check();
    await mainTab(page, 'Dati e statistiche');
    await expect(page.getByLabel('Peso (kg)', { exact: true })).toHaveValue('81.5');
    for (const width of [320, 430, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        for (const name of ['Home', 'Allenamento', 'Nutrizione', 'Dati e statistiche', 'Impostazioni']) {
            await mainTab(page, name);
            await expectPageFits(page);
        }
    }
});

test('all workout sets remain editable, timer stays above the scrolled content, and completion shows the report', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await enterGuest(page);
    await mainTab(page, 'Allenamento');
    await page.getByRole('tab', { name: 'Esercizi', exact: true }).click();
    await page.getByRole('button', { name: 'Crea esercizio', exact: true }).click();
    await page.getByPlaceholder('Nome esercizio (es. Panca piana con bilanciere)').fill('Panca prova grafica');
    await page.locator('#exercise-creation-form').getByRole('button', { name: 'Crea esercizio', exact: true }).click();
    await expect(page.getByText('Panca prova grafica', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Sessione', exact: true }).click();
    await page.getByRole('button', { name: 'Allenamento libero', exact: true }).click();
    await page.getByPlaceholder(/Cerca esercizio extra da aggiungere/).fill('Panca prova');
    await page.getByRole('option', { name: /Panca prova grafica/ }).click();
    const kg = page.getByRole('spinbutton', { name: 'Serie 1, chilogrammi', exact: true });
    await kg.fill('50');
    await page.getByRole('spinbutton', { name: 'Serie 1, ripetizioni', exact: true }).fill('10');
    await page.getByRole('button', { name: 'Aggiungi serie', exact: true }).click();
    await expect(page.getByRole('spinbutton', { name: 'Serie 2, chilogrammi', exact: true })).toBeVisible();
    await expect(kg).toHaveValue('50');
    await expectPageFits(page);
    const inputSizes = await page.locator('.workout-set-field input').evaluateAll(inputs => inputs.map(input => ({
        width: input.getBoundingClientRect().width, height: input.getBoundingClientRect().height, font: parseFloat(getComputedStyle(input).fontSize),
    })));
    for (const size of inputSizes) { expect(size.width).toBeGreaterThanOrEqual(44); expect(size.height).toBeGreaterThanOrEqual(44); expect(size.font).toBeGreaterThanOrEqual(16); }
    await page.getByRole('button', { name: 'Avvia recupero', exact: true }).click();
    await expect(page.getByLabel('Tempo di recupero', { exact: true })).not.toHaveText('00:00');
    await mainTab(page, 'Home');
    await page.getByRole('button', { name: 'Riprendi allenamento', exact: true }).click();
    await expect(kg).toHaveValue('50');
    await page.getByRole('button', { name: /Termina/ }).scrollIntoViewIfNeeded();
    const timer = page.locator('.workout-sticky-timer');
    const box = await timer.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeLessThan(120);
    await expect(page.getByRole('button', { name: 'Pausa recupero', exact: true })).toBeInViewport();
    await page.getByRole('button', { name: /Termina/ }).click();
    await page.getByRole('button', { name: 'Conferma', exact: true }).click();
    await expect(page.getByText('Allenamento concluso', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Chiudi e torna alla Home' })).toBeVisible();
    await page.getByRole('button', { name: 'Chiudi e torna alla Home' }).click();
    await expect(page.getByRole('heading', { name: 'Allenamento completato' })).toBeVisible();
});
