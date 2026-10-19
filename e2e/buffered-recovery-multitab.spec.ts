import { expect, test, type Page } from './fixtures';

async function enterGuest(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continua senza account' }).click();
  await expect(page.getByText('Aggiornamento Termini e Privacy')).toBeVisible();
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) {
    await checkbox.check();
  }
  await page.getByRole('button', { name: 'Accetta e Continua' }).click();
  await expect(page.locator('.guest-banner')).toBeVisible();
}

async function openRecoveryInspector(page: Page) {
  await page.goto('/?tab=settings');
  await expect(page.getByRole('heading', { name: 'Impostazioni', exact: true })).toBeVisible();
  await page.locator('.settings-menu').getByRole('button', { name: /Dati e backup/ }).click();
  await page.getByRole('button', { name: 'Esamina copie sul dispositivo' }).click();
}

test('two real guest tabs preserve independent encrypted edits and expose both for read-only comparison', async ({ page, context }) => {
  await enterGuest(page);
  await page.getByRole('button', { name: 'Allenamento', exact: true }).click();
  await page.getByRole('tab', { name: 'Esercizi', exact: true }).click();
  await page.getByRole('button', { name: 'Crea esercizio' }).click();
  const exercise = 'Testimone browser isolato';
  await page.locator('#exercise-name').fill(exercise);
  await page.locator('#exercise-creation-form').getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Crea esercizio' })).toBeVisible();

  await page.getByRole('tab', { name: 'Sessione', exact: true }).click();
  await page.getByRole('button', { name: 'Allenamento libero' }).click();
  await page.getByRole('button', { name: 'Salta check-in e inizia' }).click();
  await expect(page.getByRole('button', { name: 'Termina allenamento' })).toBeVisible();
  await page.getByPlaceholder('Cerca esercizio per nome...').fill(exercise);
  await page.getByRole('option', { name: new RegExp(exercise) }).click();
  await page.getByRole('button', { name: 'Aggiungi nota per la prossima volta' }).click();
  const first = page.getByPlaceholder('Note per la prossima volta (dolori, feedback)...');
  await expect(first).toBeVisible();

  // Open the second independent JS realm before either editor changes the field.
  const second = await context.newPage();
  await second.goto('/?tab=training');
  await expect(second.getByRole('button', { name: 'Termina allenamento' })).toBeVisible();
  await second.getByRole('button', { name: 'Aggiungi nota per la prossima volta' }).click();
  const secondEditor = second.getByPlaceholder('Note per la prossima volta (dolori, feedback)...');
  await expect(secondEditor).toBeVisible();

  const a = 'Prima scheda: copia privata non confermata';
  const b = 'Seconda scheda: valore concorrente non confermato';
  await first.fill(a);
  await secondEditor.fill(b);

  // The second writer cannot CAS the shared canonical key, but its own AEAD
  // witness must have been synchronously persisted first.
  const prefix = 'logbook:v2:guest:sealed:draft:buffered-intent:';
  const saved = await page.evaluate((p) => Object.fromEntries(
    Object.entries(localStorage).filter(([key]) => key.startsWith(p))
  ), prefix);
  expect(Object.keys(saved)).toHaveLength(2);
  expect(Object.values(saved).every(raw => typeof raw === 'string' && !raw.includes(a) && !raw.includes(b))).toBe(true);

  // A third fresh tab must be able to compare values without overwriting
  // either original. This is not a recovery replay or a winning-value choice.
  const viewer = await context.newPage();
  await openRecoveryInspector(viewer);
  await expect(viewer.getByText('2 copie conservate in 1 campo.')).toBeVisible();
  await viewer.locator('.settings-recovery-group summary').first().click();
  await expect(viewer.getByDisplayValue(a)).toBeVisible();
  await expect(viewer.getByDisplayValue(b)).toBeVisible();
  expect(await viewer.evaluate((p) => Object.fromEntries(
    Object.entries(localStorage).filter(([key]) => key.startsWith(p))
  ), prefix)).toEqual(saved);

  await viewer.getByRole('button', { name: 'Nascondi copie' }).click();
  await expect(viewer.getByDisplayValue(a)).toHaveCount(0);
  expect(await viewer.evaluate((p) => Object.fromEntries(
    Object.entries(localStorage).filter(([key]) => key.startsWith(p))
  ), prefix)).toEqual(saved);

  // Terminate both editing realms without logout or a normal React unmount:
  // later inspection must not depend on their in-memory component state.
  await page.close();
  await second.close();
  await viewer.reload();
  await expect(viewer.getByRole('heading', { name: 'Impostazioni', exact: true })).toBeVisible();
  await viewer.locator('.settings-menu').getByRole('button', { name: /Dati e backup/ }).click();
  await viewer.getByRole('button', { name: 'Esamina copie sul dispositivo' }).click();
  await expect(viewer.getByText('2 copie conservate in 1 campo.')).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`guest recovery inspector remains usable at 320px in ${theme} theme without exposing data on mount`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 850 });
    await page.emulateMedia({ colorScheme: theme });
    await enterGuest(page);
    await page.goto('/?tab=settings');
    await expect(page.getByRole('heading', { name: 'Impostazioni', exact: true })).toBeVisible();
    await page.locator('.settings-menu').getByRole('button', { name: /Dati e backup/ }).click();
    await expect(page.getByRole('region', { name: 'Copie di recupero' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Esamina copie sul dispositivo' }).click();
    await expect(page.getByText('Nessuna testimonianza indipendente disponibile.')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  });
}
