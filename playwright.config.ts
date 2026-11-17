import { defineConfig, devices } from '@playwright/test';
import { assertLoopbackE2eUrl } from './scripts/e2e-environment.mjs';

const testBaseURL = process.env.LOGBOOK_TEST_URL || 'http://127.0.0.1:4173';
assertLoopbackE2eUrl(testBaseURL);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Browser contexts and the PWA upgrade proxy are test-scoped. Parallelize
  // independent journeys without changing cross-tab checks within each test.
  workers: process.env.CI ? 2 : undefined,
  // CI needs per-test durations to diagnose unbalanced shards, while preserving HTML evidence.
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'html',
  use: {
    baseURL: testBaseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-safari',
      testMatch: /(accessibility|data-history-mobile|health-consent-suspended|secure-archive-device-key|refactoring-surfaces|domain-commit-multitab|guest-revocation|brand-loading-layout|public-legal)\.spec\.ts/,
      use: { ...devices['iPhone 13'] },
    },
  ],
});
