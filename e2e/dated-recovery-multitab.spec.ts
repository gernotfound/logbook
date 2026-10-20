import { expect, test, type Page } from './fixtures';

async function enterGuest(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continua senza account' }).click();
  await expect(page.getByText('Aggiornamento Termini e Privacy')).toBeVisible();
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) {
    await checkbox.check();
  }
  await page.getByRole('button', { name: 'Accetta e Continua' }).click();
  await expect(page.getByRole('button', { name: 'Dati e statistiche', exact: true })).toBeVisible();
}

async function openMeasurements(page: Page) {
  await page.getByRole('button', { name: 'Dati e statistiche', exact: true }).click();
  await page.getByRole('tab', { name: 'Misurazioni', exact: true }).click();
  await expect(page.locator('#measure-weight')).toBeVisible();
}

async function inspect(page: Page) {
  await page.goto('/?tab=settings');
  await expect(page.getByRole('heading', { name: 'Impostazioni', exact: true })).toBeVisible();
  await page.locator('.settings-menu').getByRole('button', { name: /Dati e backup/ }).click();
  await page.getByRole('button', { name: 'Esamina copie sul dispositivo' }).click();
}

const prefix = 'logbook:v2:guest:sealed:draft:dated-intent:';
const canonicalPrefix = 'logbook:v2:guest:sealed:draft:measurement:';

test('real browser tabs retain two independent sealed dated-form values and expose only read-only recovery', async ({ page, context }) => {
  await enterGuest(page);
  await openMeasurements(page);

  const other = await context.newPage();
  await other.goto('/');
  await openMeasurements(other);

  await page.locator('#measure-weight').fill('75');
  await other.locator('#measure-weight').fill('76');

  const saved = await page.evaluate(p => Object.fromEntries(
    Object.entries(localStorage).filter(([key]) => key.startsWith(p))
  ), prefix);
  expect(Object.keys(saved)).toHaveLength(2);
  expect(Object.values(saved).every(value => !value.includes('"75"') && !value.includes('"76"'))).toBe(true);

  const viewer = await context.newPage();
  await inspect(viewer);
  await expect(viewer.getByText('2 copie conservate in 1 campo.')).toBeVisible();
  await viewer.locator('.settings-recovery-group summary').first().click();
  const fields = viewer.locator('.settings-recovery-entry textarea[readonly]');
  await expect(fields).toHaveCount(2);
  expect((await fields.evaluateAll(elements => elements.map(element =>
    JSON.parse((element as HTMLTextAreaElement).value).weight
  ))).sort()).toEqual(['75', '76']);
  expect(await viewer.evaluate(p => Object.fromEntries(
    Object.entries(localStorage).filter(([key]) => key.startsWith(p))
  ), prefix)).toEqual(saved);

  // Recreate only the diagnostic realm; neither input editor may
  // automatically choose or destroy the other tab's witness.
  await inspect(viewer);
  await viewer.locator('.settings-recovery-group summary').first().click();
  await expect(fields).toHaveCount(2);
  expect((await fields.evaluateAll(elements => elements.map(element =>
    JSON.parse((element as HTMLTextAreaElement).value).weight
  ))).sort()).toEqual(['75', '76']);
});

test('canonical dated-form quota failure leaves a sealed, readable witness for a separate tab', async ({ page, context }) => {
  await enterGuest(page);
  await openMeasurements(page);

  // Reject only the canonical key, never the per-editor copy.
  await page.evaluate(prefix => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(this: Storage, key: string, value: string) {
      if (key.startsWith(prefix)) throw new DOMException('synthetic quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  }, canonicalPrefix);

  await page.locator('#measure-weight').fill('77');
  const stored = await page.evaluate(([witness, canonical]) => ({
    witnesses: Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith(witness))),
    canonical: Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith(canonical))),
  }), [prefix, canonicalPrefix]);

  expect(Object.keys(stored.witnesses)).toHaveLength(1);
  expect(Object.keys(stored.canonical)).toHaveLength(0);
  expect(Object.values(stored.witnesses).every(v => !v.includes('"77"'))).toBe(true);

  const viewer = await context.newPage();
  await inspect(viewer);
  await expect(viewer.getByText('1 copia conservata in 1 campo.')).toBeVisible();
  await viewer.locator('.settings-recovery-group summary').first().click();
  const recovery = viewer.locator('.settings-recovery-entry textarea[readonly]');
  await expect(recovery).toHaveCount(1);
  expect(JSON.parse(await recovery.inputValue()).weight).toBe('77');
  expect(await viewer.evaluate(p => Object.fromEntries(
    Object.entries(localStorage).filter(([key]) => key.startsWith(p))
  ), prefix)).toEqual(stored.witnesses);
});
