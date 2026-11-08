import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { assertIsolatedVitestEnvironment, TEST_BACKEND_ORIGIN } from './scripts/vitest-env-isolation';

// This runner bypasses the jsdom base config; enforce the same fail-closed
// environment boundary before isolated persistence tests can initialize SDKs.
assertIsolatedVitestEnvironment(loadEnv('test', fileURLToPath(new URL('.', import.meta.url)), 'VITE_'));

const appVersion = process.env.npm_package_version || '0.0.0-test';

// No UI setup: these tests exercise actual IndexedDB transactions and domain modules.
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  test: {
    env: { VITE_ACCOUNT_DELETION_API_ORIGIN: TEST_BACKEND_ORIGIN },
    environment: 'node',
    setupFiles: ['./tests/isolated/browserStorageSetup.ts'],
    include: ['tests/isolated/**/*.test.ts'],
    exclude: process.env.npm_lifecycle_event === 'test:isolated' ? ['tests/isolated/m8_domain_commit.test.ts'] : [],
    maxWorkers: 2,
  },
});
