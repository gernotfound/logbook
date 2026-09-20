import { defineConfig } from 'vitest/config';

const appVersion = process.env.npm_package_version || '0.0.0-test';

// No UI setup: these tests exercise actual IndexedDB transactions and domain modules.
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  test: { environment: 'node', include: ['tests/isolated/**/*.test.ts'], maxWorkers: 2 },
});
