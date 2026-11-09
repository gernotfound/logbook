import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { assertIsolatedVitestEnvironment, TEST_BACKEND_ORIGIN } from './scripts/vitest-env-isolation';

// Recovery imports Firebase transitively through the repository and replica modules.
// Reject inherited client endpoints before test modules can initialize the SDK.
assertIsolatedVitestEnvironment(loadEnv('test', fileURLToPath(new URL('.', import.meta.url)), 'VITE_');

const appVersion = process.env.npm_package_version || '0.0.0-test';

// Recovery tests inject failures into IndexedDB and process/session boundaries.
// Keep them single-worker so global fault points cannot leak across scenarios.
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  test: {
    env: { VITE_ACCOUNT_DELETION_API_ORIGIN: TEST_BACKEND_ORIGIN },
    environment: 'node',
    setupFiles: ['./tests/isolated/browserStorageSetup.ts'],
    include: ['tests/recovery/**/*.test.ts'],
    maxWorkers: 1,
    testTimeout: 15000,
  },
});
