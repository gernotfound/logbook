import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './fixtures';

async function assertNoBlockingAccessibilityViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const blocking = result.violations
    .filter(violation => violation.impact === 'critical' || violation.impact === 'serious')
    .map(violation => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.flatMap(node => node.target),
    }));

  expect(blocking, 'axe found critical/serious WCAG violations').toEqual([]);
}

async function continueAsGuest(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continua senza account' }).click();
  await page.getByText('Aggiornamento Termini e Privacy').waitFor();
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) {
    await checkbox.check();
  }
  await page.getByRole('button', { name: 'Accetta e Continua' }).click();
  await page.getByRole('button', { name: 'Allenamento', exact: true }).waitFor();
  await expect(page.locator('#weekly-volume-chart-card')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#volume-calories-correlation-card')).toHaveAttribute('aria-busy', 'false');
}

test('representative guest surfaces have no serious automated accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'TheLogBook' })).toBeVisible();
  await assertNoBlockingAccessibilityViolations(page);

  await continueAsGuest(page);
  await assertNoBlockingAccessibilityViolations(page);

  await page.getByRole('button', { name: 'Dati e statistiche', exact: true }).click();
  await expect(page.locator('#view-data')).toBeVisible();
  await assertNoBlockingAccessibilityViolations(page);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('keyboard-opened routine menu retains focus and fits a narrow real viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await continueAsGuest(page);
  await page.getByRole('button', { name: 'Allenamento', exact: true }).click();
  await page.getByRole('tab', { name: 'Schede', exact: true }).click();
  await page.getByRole('button', { name: 'Crea scheda' }).click();
  await page.getByPlaceholder('Nome scheda').fill('Scheda accessibile');
  await page.locator('#routine-creation-form').getByRole('button', { name: 'Salva', exact: true }).click();

  const card = page.locator('.routine-library-card').filter({ hasText: 'Scheda accessibile' });
  const trigger = card.getByRole('button', { name: 'Opzioni' });
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  const menu = card.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  const bounds = await menu.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
