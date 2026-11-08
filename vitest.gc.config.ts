import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { assertIsolatedVitestEnvironment } from './scripts/vitest-env-isolation';

// GC tests load the transaction writer and its Firebase consent dependency.
// Reject non-synthetic client endpoints before test modules initialize SDKs.
assertIsolatedVitestEnvironment(loadEnv('test', fileURLToPath(new URL('.', import.meta.url)), 'VITE_'));

const appVersion = process.env.npm_package_version || '0.0.0-test';

export default defineConfig({
    define: { __APP_VERSION__: JSON.stringify(appVersion) },
    test: {
        environment: 'node',
        setupFiles: ['./tests/isolated/browserStorageSetup.ts'],
        include: ['tests/gc/**/*.test.ts'],
        maxWorkers: 1,
        testTimeout: 30000,
    },
});
