import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './fixtures';

async function collectBlockingAccessibilityViolations(page: Page, surface: string) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  return result.violations
    .filter(violation => violation.impact === 'critical' || violation.impact === 'serious')
    .map(violation => ({
      surface,
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.flatMap(node => node.target),
      details: violation.nodes.map(node => ({ html: node.html, failureSummary: node.failureSummary })),
    }));
}

async function continueAsGuest(page: Page) {
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

for (const theme of ['light', 'dark'] as const) {
test(`representative guest surfaces have no serious automated accessibility violations in ${theme}`, async ({ page }) => {
  await page.emulateMedia({ colorScheme: theme });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'TheLogBook' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  const blocking = await collectBlockingAccessibilityViolations(page, 'login');

  await continueAsGuest(page);
  blocking.push(...await collectBlockingAccessibilityViolations(page, 'guest-home'));

  await page.getByRole('button', { name: 'Dati e statistiche', exact: true }).click();
  await expect(page.locator('#view-data')).toBeVisible();
  blocking.push(...await collectBlockingAccessibilityViolations(page, 'data'));

  await page.getByRole('button', { name: 'Allenamento', exact: true }).click();
  await page.getByRole('tab', { name: 'Schede', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Crea scheda' })).toBeVisible();
  blocking.push(...await collectBlockingAccessibilityViolations(page, 'training-routines'));

  await page.getByRole('button', { name: 'Nutrizione', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Cerca alimento' })).toBeVisible();
  blocking.push(...await collectBlockingAccessibilityViolations(page, 'nutrition'));

  await page.goto('/?tab=settings');
  await expect(page.getByRole('heading', { name: 'Impostazioni', exact: true })).toBeVisible();
  blocking.push(...await collectBlockingAccessibilityViolations(page, 'settings'));

  expect(blocking, 'axe found critical/serious WCAG violations').toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

}

test('keyboard-opened routine menu retains focus and fits a narrow real viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto('/');
  await continueAsGuest(page);
  await page.getByRole('button', { name: 'Allenamento', exact: true }).click();
  await page.getByRole('tab', { name: 'Schede', exact: true }).click();
  await page.getByRole('button', { name: 'Crea scheda' }).click();
  await page.getByPlaceholder('Nome scheda').fill('Scheda accessibile');
  await page.locator('#routine-creation-form').getByRole('button', { name: 'Salva', exact: true }).click();

  const card = page.locator('.routine-library-card').filter({
    has: page.getByRole('button', { name: 'Apri scheda Scheda accessibile 0 esercizi', exact: true }),
  });
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

  await page.getByRole('button', { name: 'Crea scheda' }).click();
  await page.getByPlaceholder('Nome scheda').fill('Seconda scheda accessibile');
  await page.locator('#routine-creation-form').getByRole('button', { name: 'Salva', exact: true }).click();
  const secondCard = page.locator('.routine-library-card').filter({
    has: page.getByRole('button', { name: 'Apri scheda Seconda scheda accessibile 0 esercizi', exact: true }),
  });
  const secondTrigger = secondCard.getByRole('button', { name: 'Opzioni' });

  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(menu).toBeVisible();
  await secondTrigger.focus();
  await page.keyboard.press('ArrowUp');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  const secondMenu = secondCard.getByRole('menu');
  await expect(secondMenu).toBeVisible();
  await expect(secondMenu.getByRole('menuitem').last()).toBeFocused();
  await expect(page.getByRole('menu')).toHaveCount(1);
  expect(await collectBlockingAccessibilityViolations(page, 'keyboard-routine-menu'),
    'axe found critical/serious WCAG violations in the open routine menu').toEqual([]);
});
