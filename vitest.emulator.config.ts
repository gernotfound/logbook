import { defineConfig } from 'vitest/config';

const appVersion = process.env.npm_package_version || '0.0.0-test';

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  test: {
    environment: 'node',
    include: ['tests/emulator/**/*.test.ts'],
    setupFiles: ['tests/emulator/setup.ts'],
    maxWorkers: 1,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
