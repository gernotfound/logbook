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
      mascotSrc: image.currentSrc,
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
    let releaseData!: () => void;
    const dataGate = new Promise<void>(resolve => { releaseData = resolve; });
    let entryBlocked = false;
    let dataHeld = false;
    // Finish a real first document without the app entry so WebKit can paint
    // and capture it. Only this request is aborted: HTML, theme script, CSS and
    // artwork remain real. The next document loads the real app normally.
    await page.route('**/assets/index-*.js', async route => {
      entryBlocked = true;
      await route.abort('blockedbyclient');
    });
    await page.route('**/assets/DataView-*.js', async route => {
      dataHeld = true;
      await dataGate;
      await route.continue();
    });
    try {
      await page.goto('/');
      expect(entryBlocked).toBe(true);
      const theme = scenario.preference === 'system' ? scenario.system : scenario.preference;
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme-preference', scenario.preference);
      const initial = page.locator('#initial-loader');
      await expect(initial).toBeVisible();
      await expect(initial).toHaveCSS('position', 'fixed');
      await expect(initial).toHaveAttribute('role', 'status');
      await expect(initial).toHaveAttribute('aria-busy', 'true');
      await expect.poll(() => initial.locator('img').evaluate(image =>
        (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
      )).toBe(true);
      const bootstrap = await sample(page, '#initial-loader');
      expectFits(bootstrap, scenario);
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
      await page.unroute('**/assets/index-*.js');
      await page.reload();

      await page.getByRole('button', { name: 'Continua senza account' }).click();
      await expect(page.getByText('Aggiornamento Termini e Privacy')).toBeVisible();
      for (const checkbox of await page.locator('input[type="checkbox"]').all()) await checkbox.check();
      await page.getByRole('button', { name: 'Accetta e Continua' }).click();
      await page.getByRole('button', { name: 'Dati e statistiche', exact: true }).click();
      await expect.poll(() => dataHeld).toBe(true);
      const lazy = page.getByRole('status', { name: 'Caricamento sezione in corso', exact: true });
      await expect(lazy).toBeVisible();
      await expect(lazy).toHaveAttribute('aria-busy', 'true');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme-preference', scenario.preference);
      await expect.poll(() => lazy.locator('img.brand-loading-screen__mascot').evaluate(image =>
        (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
      )).toBe(true);
      const runtime = await sample(page, '.brand-loading-screen--content');
      expectFits(runtime, scenario);
      expect(runtime.scale).toBe(0.72);
      expect(runtime.mascotSrc).toBe(bootstrap.mascotSrc);
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
      releaseData();
      if (!page.isClosed()) await page.unrouteAll({ behavior: 'wait' });
    }
  });
}
