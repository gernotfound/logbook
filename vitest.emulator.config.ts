import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { assertIsolatedVitestEnvironment } from './scripts/vitest-env-isolation';

// The Firestore emulator launcher uses a demo project, but imported client
// modules must also reject inherited Production endpoints before SDK startup.
assertIsolatedVitestEnvironment(loadEnv('test', fileURLToPath(new URL('.', import.meta.url)), 'VITE_'));

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
