import { test as base, expect } from '@playwright/test';
import { assertLoopbackE2eUrl } from '../scripts/e2e-environment.mjs';

const allowedOrigin = assertLoopbackE2eUrl(process.env.LOGBOOK_TEST_URL || 'http://127.0.0.1:4173');

// Network requests from pages must stay on the local preview origin. A service
// worker can bypass Playwright routing; the build also uses synthetic endpoints.
export const test = base.extend({
  context: async ({ context }, provideContext) => {
    await context.route('**/*', route => {
      try {
        if (new URL(route.request().url()).origin === allowedOrigin) {
          return route.continue();
        }
      } catch {
        // A malformed destination is not allowed.
      }
      return route.abort('blockedbyclient');
    });
    await provideContext(context);
  },
});

export { expect };
export type { Page } from '@playwright/test';
