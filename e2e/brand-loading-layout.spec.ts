import { expect, test } from './fixtures';

test.describe.configure({ retries: 0 });

test('the initial loading wordmark fits a short landscape viewport', async ({ page }, testInfo) => {
  const viewport = { width: 844, height: 390 };
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  let release!: () => void;
  const entryGate = new Promise<void>(resolve => { release = resolve; });
  let held = false;
  // Hold the real entry bundle so the real index.html first paint remains
  // observable. Styles, markup, artwork and browser layout are not mocked.
  await page.route('**/assets/index-*.js', async route => {
    held = true;
    await entryGate;
    await route.continue();
  });
  try {
    await page.goto('/', { waitUntil: 'commit' });
    await expect.poll(() => held).toBe(true);
    const loader = page.locator('#initial-loader');
    await expect(loader).toBeVisible();
    await expect(loader).toHaveCSS('position', 'fixed');
    await expect.poll(() => loader.locator('img').evaluate(image =>
      (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
    )).toBe(true);
    await testInfo.attach('initial-landscape-loading', {
      body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png',
    });
    const bounds = await loader.locator('.brand-loading-screen__wordmark').boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height, 'the loading wordmark must not be clipped below the screen').toBeLessThanOrEqual(viewport.height);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
