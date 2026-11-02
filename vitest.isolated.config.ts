import { defineConfig } from 'vitest/config';

const appVersion = process.env.npm_package_version || '0.0.0-test';

// No UI setup: these tests exercise actual IndexedDB transactions and domain modules.
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  test: { env: { VITE_ACCOUNT_DELETION_API_ORIGIN: 'http://127.0.0.1:9' }, environment: 'node', setupFiles: ['./tests/isolated/browserStorageSetup.ts'], include: ['tests/isolated/**/*.test.ts'], maxWorkers: 2 },
});
