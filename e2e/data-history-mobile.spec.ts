import { expect, test, type Page } from './fixtures';

async function continueAsGuest(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continua senza account' }).click();
  await page.getByText('Aggiornamento Termini e Privacy').waitFor();
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) await checkbox.check();
  await page.getByRole('button', { name: 'Accetta e Continua' }).click();
  await page.getByRole('button', { name: 'Dati e statistiche', exact: true }).waitFor();
}

test('history detail exposes scrollable geometry and a reachable close action on a short mobile viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 420 });
  await continueAsGuest(page);

  await page.getByRole('button', { name: 'Dati e statistiche', exact: true }).click();
  await page.getByRole('tab', { name: 'Misurazioni', exact: true }).click();

  await page.locator('#measure-weight').fill('81.4');
  await page.locator('#measure-bf').fill('16.7');
  await page.getByText('Altre misurazioni', { exact: true }).click();
  await page.locator('#measure-waist').fill('84.2');
  await page.locator('#measure-neck').fill('38');
  await page.locator('#measure-chest').fill('101');
  await page.locator('#measure-shoulders').fill('118');
  await page.locator('#measure-biceps').fill('37.5');
  await page.locator('#measure-thighs').fill('59');
  await page.locator('#measure-calves').fill('38.5');
  await page.getByRole('button', { name: 'Salva misurazione', exact: true }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('tab', { name: 'Storico', exact: true }).click();
  await page.getByRole('button', { name: /Apri dettaglio/i }).click();

  const dialog = page.getByRole('dialog');
  const scrollArea = dialog.locator('.data-detail-scroll');
  await expect(dialog).toBeVisible();
  await expect(scrollArea).toBeVisible();

  const metrics = await scrollArea.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: style.overflowY,
      touchAction: style.touchAction,
    };
  });
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  expect(metrics.overflowY).toBe('auto');
  expect(metrics.touchAction).toBe('pan-y');

  if (testInfo.project.name === 'mobile-safari') {
    // This project asserts scroll geometry and sets the scroll offset directly in WebKit;
    // it does not claim to simulate a native swipe or inertial scrolling.
    // The close button is exercised with a browser touch tap.
    await scrollArea.evaluate(element => { element.scrollTop = element.scrollHeight; });
  } else {
    await scrollArea.hover();
    await page.mouse.wheel(0, 640);
  }
  await expect.poll(() => scrollArea.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const closeButton = dialog.getByRole('button', { name: 'Chiudi', exact: true });
  if (testInfo.project.name === 'mobile-safari') await closeButton.tap();
  else await closeButton.click();
  await expect(dialog).toHaveCount(0);
});
