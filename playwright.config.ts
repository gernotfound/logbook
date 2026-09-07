import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    // deepcode ignore HardcodedNonCryptoSecret: Mock values for E2E testing
    env: {
      VITE_FIREBASE_API_KEY: process.env.VITE_FIREBASE_API_KEY || 'dummy-key',
      VITE_FIREBASE_AUTH_DOMAIN: process.env.VITE_FIREBASE_AUTH_DOMAIN || 'dummy-domain.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: process.env.VITE_FIREBASE_PROJECT_ID || 'dummy-project',
      VITE_FIREBASE_STORAGE_BUCKET: process.env.VITE_FIREBASE_STORAGE_BUCKET || 'dummy-bucket.appspot.com',
      VITE_FIREBASE_MESSAGING_SENDER_ID: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '1234567890',
      VITE_FIREBASE_APP_ID: process.env.VITE_FIREBASE_APP_ID || '1:1234567890:web:123456',
      VITE_FIREBASE_MEASUREMENT_ID: process.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-12345',
      VITE_FIREBASE_DATABASE_URL: process.env.VITE_FIREBASE_DATABASE_URL || 'https://dummy-project.firebaseio.com',
      VITE_RECAPTCHA_V3_SITE_KEY: process.env.VITE_RECAPTCHA_V3_SITE_KEY || 'dummy-recaptcha-key'
    }
  },
});
