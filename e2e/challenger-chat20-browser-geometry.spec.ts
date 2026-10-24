import { expect, test, type Page } from './fixtures';

// These assertions use Chromium layout geometry. Vitest/jsdom cannot measure
// actual clipping, and a desktop browser does not emulate an OS virtual keyboard.
async function continueAsGuest(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continua senza account' }).click();
  await page.getByText('Aggiornamento Termini e Privacy').waitFor();
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) await checkbox.check();
  await page.getByRole('button', { name: 'Accetta e Continua' }).click();
  await page.getByRole('button', { name: 'Allenamento', exact: true }).waitFor();
}

test('workout muscle SVG remains inside its real container from narrow mobile to desktop', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await continueAsGuest(page);
  await page.getByRole('button', { name: 'Allenamento', exact: true }).click();
  await page.getByRole('tab', { name: 'Schede', exact: true }).click();
  await page.getByRole('button', { name: 'Crea scheda' }).click();

  const model = page.locator('.routine-editor-muscle-map svg');
  await expect(model).toBeVisible();
  for (const width of [320, 375, 768, 1200]) {
    await page.setViewportSize({ width, height: 850 });
    const geometry = await model.evaluate(svg => {
      const svgRect = svg.getBoundingClientRect();
      const parentRect = svg.parentElement!.getBoundingClientRect();
      const documentWidth = document.documentElement.scrollWidth;
      const viewportWidth = document.documentElement.clientWidth;
      return {
        svgWidth: svgRect.width, parentWidth: parentRect.width,
        svgLeft: svgRect.left, svgRight: svgRect.right,
        parentLeft: parentRect.left, parentRight: parentRect.right,
        documentWidth, viewportWidth
      };
    });
    expect(geometry.svgWidth, `SVG absent at ${width}px`).toBeGreaterThan(0);
    expect(geometry.svgWidth, `SVG detached from container at ${width}px`).toBeLessThanOrEqual(geometry.parentWidth + 1);
    expect(geometry.svgLeft).toBeGreaterThanOrEqual(geometry.parentLeft - 1);
    expect(geometry.svgRight).toBeLessThanOrEqual(geometry.parentRight + 1);
    expect(geometry.documentWidth, `Horizontal document overflow at ${width}px`).toBeLessThanOrEqual(geometry.viewportWidth);
  }
});

test('measurements focus remains observable within a short real Chromium viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 420 });
  await continueAsGuest(page);
  await page.getByRole('button', { name: 'Dati e statistiche', exact: true }).click();
  await page.getByRole('tab', { name: 'Misurazioni', exact: true }).click();
  await page.getByText('Altre misurazioni', { exact: true }).click();
  const bottomInput = page.locator('#measure-calves');
  await bottomInput.focus();
  await expect(bottomInput).toBeFocused();
  const bounds = await bottomInput.evaluate(input => {
    const rect = input.getBoundingClientRect();
    return {
      top: rect.top, bottom: rect.bottom,
      visibleHeight: window.visualViewport?.height ?? document.documentElement.clientHeight
    };
  });
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.visibleHeight + 1);
});
