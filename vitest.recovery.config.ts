import { defineConfig } from 'vitest/config';

const appVersion = process.env.npm_package_version || '0.0.0-test';

// Recovery tests inject failures into IndexedDB and process/session boundaries.
// Keep them single-worker so global fault points cannot leak across scenarios.
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  test: {
    environment: 'node',
    include: ['tests/recovery/**/*.test.ts'],
    maxWorkers: 1,
    testTimeout: 15000,
  },
});
