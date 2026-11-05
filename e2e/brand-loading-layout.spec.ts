import { expect, test, type Page } from './fixtures';

// Route the actual entry/lazy bundles; the worker lifecycle has separate E2E.
// Blocking workers here prevents precache from bypassing those HTTP barriers.
test.use({ serviceWorkers: 'block' });
test.describe.configure({ retries: 0 });

const cases = [
  { width: 320, height: 568, preference: 'system', system: 'light', motion: 'reduce' },
  { width: 320, height: 568, preference: 'light', system: 'dark', motion: 'no-preference' },
  { width: 844, height: 390, preference: 'light', system: 'dark', motion: 'reduce' },
  { width: 844, height: 390, preference: 'dark', system: 'light', motion: 'no-preference' },
  { width: 844, height: 390, preference: 'system', system: 'light', motion: 'no-preference' },
  { width: 390, height: 240, preference: 'system', system: 'dark', motion: 'reduce' },
  { width: 1280, height: 900, preference: 'system', system: 'light', motion: 'no-preference' },
  { width: 1280, height: 900, preference: 'dark', system: 'light', motion: 'reduce' },
] as const;

async function sample(page: Page, selector: string) {
  return page.locator(selector).evaluate(screen => {
    const rect = (element: Element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    };
    const image = screen.querySelector<HTMLImageElement>('.brand-loading-screen__mascot')!;
    const wordmark = screen.querySelector<HTMLElement>('.brand-loading-screen__wordmark')!;
    const spinner = screen.querySelector<HTMLElement>('.brand-loading-screen__spinner')!;
    const brand = screen.querySelector<HTMLElement>('.brand-loading-screen__brand')!;
    const screenCss = getComputedStyle(screen);
    const spinnerCss = getComputedStyle(spinner);
    const headingCss = getComputedStyle(wordmark.querySelector('h1')!);
    return {
      screen: rect(screen), image: rect(image), wordmark: rect(wordmark),
      background: screenCss.backgroundColor, color: screenCss.color,
      filter: getComputedStyle(image).filter,
      text: wordmark.textContent, weight: headingCss.fontWeight, size: headingCss.fontSize,
      gap: getComputedStyle(brand).gap,
      animation: spinnerCss.animationName, duration: spinnerCss.animationDuration,
      timing: spinnerCss.animationTimingFunction,
      borderTop: spinnerCss.borderTopColor, spinnerColor: spinnerCss.color,
      scale: Number(getComputedStyle(brand).getPropertyValue('--brand-loading-scale')),
      scrollLocked: getComputedStyle(document.documentElement).overflowY === 'hidden'
        && getComputedStyle(document.body).overflowY === 'hidden',
    };
  });
}

function expectFits(snapshot: Awaited<ReturnType<typeof sample>>, viewport: { width: number; height: number }) {
  for (const [name, box] of [['image', snapshot.image], ['wordmark', snapshot.wordmark]] as const) {
    expect(box.width, name).toBeGreaterThan(0);
    expect(box.height, name).toBeGreaterThan(0);
    expect(box.x, name).toBeGreaterThanOrEqual(snapshot.screen.x - 1);
    expect(box.y, name).toBeGreaterThanOrEqual(snapshot.screen.y - 1);
    expect(box.right, name).toBeLessThanOrEqual(Math.min(viewport.width, snapshot.screen.right) + 1);
    expect(box.bottom, name).toBeLessThanOrEqual(Math.min(viewport.height, snapshot.screen.bottom) + 1);
    expect((box.x + box.right) / 2, name).toBeCloseTo(viewport.width / 2, 0);
  }
  expect(snapshot.scrollLocked).toBe(true);
}

for (const scenario of cases) {
  test(`bootstrap and lazy React loader fit ${scenario.width}x${scenario.height} in ${scenario.preference}/${scenario.system}/${scenario.motion}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.emulateMedia({ colorScheme: scenario.system, reducedMotion: scenario.motion });
    await page.addInitScript(preference => localStorage.setItem('logbook:appearance:v1', preference), scenario.preference);
    let releaseEntry!: () => void;
    let releaseData!: () => void;
    const entryGate = new Promise<void>(resolve => { releaseEntry = resolve; });
    const dataGate = new Promise<void>(resolve => { releaseData = resolve; });
    let entryHeld = false;
    let dataHeld = false;
    // Both screens are real production renders, observed at native request
    // boundaries instead of keeping them alive with fake markup or CSS.
    await page.route('**/assets/index-*.js', async route => {
      entryHeld = true;
      await entryGate;
      await route.continue();
    });
    await page.route('**/assets/DataView-*.js', async route => {
      dataHeld = true;
      await dataGate;
      await route.continue();
    });
    try {
      await page.goto('/', { waitUntil: 'commit' });
      await expect.poll(() => entryHeld).toBe(true);
      const initial = page.locator('#initial-loader');
      await expect(initial).toBeVisible();
      await expect(initial).toHaveCSS('position', 'fixed');
      await expect.poll(() => initial.locator('img').evaluate(image =>
        (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
      )).toBe(true);
      const bootstrap = await sample(page, '#initial-loader');
      expectFits(bootstrap, scenario);
      const theme = scenario.preference === 'system' ? scenario.system : scenario.preference;
      const foreground = theme === 'light' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
      expect(bootstrap.background).toBe(theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)');
      expect(bootstrap.color).toBe(foreground);
      expect(bootstrap.filter).toBe(theme === 'light' ? 'invert(1)' : 'none');
      expect(bootstrap.weight).toBe('800');
      expect(bootstrap.text).toBe('CARICAMENT');
      if (scenario.motion === 'reduce') {
        expect(bootstrap.animation).toBe('none');
        expect(bootstrap.borderTop).toBe(bootstrap.spinnerColor);
      } else {
        expect(bootstrap.animation).toBe('brand-loading-spin');
        expect(bootstrap.duration).toBe('0.9s');
        expect(bootstrap.timing).toBe('linear');
      }
      await testInfo.attach('bootstrap-loader', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
      releaseEntry();

      await page.getByRole('button', { name: 'Continua senza account' }).click();
      await expect(page.getByText('Aggiornamento Termini e Privacy')).toBeVisible();
      for (const checkbox of await page.locator('input[type="checkbox"]').all()) await checkbox.check();
      await page.getByRole('button', { name: 'Accetta e Continua' }).click();
      await page.getByRole('button', { name: 'Dati e statistiche', exact: true }).click();
      await expect.poll(() => dataHeld).toBe(true);
      const lazy = page.getByRole('status', { name: 'Caricamento sezione in corso', exact: true });
      await expect(lazy).toBeVisible();
      const runtime = await sample(page, '.brand-loading-screen--content');
      expectFits(runtime, scenario);
      expect(runtime.scale).toBe(0.72);
      for (const key of ['background', 'color', 'filter', 'weight', 'size', 'gap', 'animation', 'duration', 'timing', 'borderTop', 'text'] as const) {
        expect(runtime[key], key).toBe(bootstrap[key]);
      }
      // Content loading uses exactly the same base artwork and wordmark;
      // only the complete group's uniform scale and vertical clearance differ.
      expect(runtime.image.width / bootstrap.image.width).toBeCloseTo(runtime.scale, 2);
      expect(runtime.image.height / bootstrap.image.height).toBeCloseTo(runtime.scale, 2);
      expect(runtime.wordmark.width / bootstrap.wordmark.width).toBeCloseTo(runtime.scale, 2);
      expect(runtime.wordmark.height / bootstrap.wordmark.height).toBeCloseTo(runtime.scale, 2);
      const nav = page.locator('.bottom-nav');
      await expect(nav).toBeVisible();
      const navBox = (await nav.boundingBox())!;
      expect(runtime.screen.bottom).toBeLessThanOrEqual(navBox.y + 1);
      expect(await nav.evaluate(element => {
        const box = element.getBoundingClientRect();
        return Boolean(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('.bottom-nav'));
      })).toBe(true);
      await testInfo.attach('react-content-loader', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
      await testInfo.attach('observed-loader-layout', { body: JSON.stringify({ bootstrap, runtime }), contentType: 'application/json' });
      releaseData();
      await expect(lazy).toHaveCount(0);
      await expect(page.getByRole('tab', { name: 'Misurazioni', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      releaseEntry();
      releaseData();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}
