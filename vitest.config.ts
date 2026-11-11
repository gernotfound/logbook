import { configDefaults, defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import { assertIsolatedVitestEnvironment, TEST_BACKEND_ORIGIN } from './scripts/vitest-env-isolation';
import react from '@vitejs/plugin-react';
import { VitePWA } from '@unplugin-pwa/vite';

// Vite's shell and .env.test.local precedence can override the tracked test
// placeholders. Reject that effective configuration before test setup imports SDKs.
assertIsolatedVitestEnvironment(loadEnv('test', fileURLToPath(new URL('.', import.meta.url)), 'VITE_'));

export const stressPatterns = ['**/challenger_*.test.{ts,tsx}', '**/*adversarial*.test.{ts,tsx}', '**/*stress*.test.{ts,tsx}'];

const appVersion = process.env.npm_package_version || '0.0.0-test';

// Dedicated M5/M7/M8 suites run these files under their own verification commands.
// Exclude them only from npm's canonical general runner, not from focused vitest invocations.
const dedicatedSuiteExclusions = process.env.npm_lifecycle_event === 'test' ? [
  'tests/account/auth/logout_protection.test.ts',
  'tests/account/guest/guest_bootstrap_lifecycle.test.tsx',
  'tests/account/guest/guest_account_migration_v3.test.tsx',
  'tests/catalog/catalog_resolution_pipeline.test.ts',
  'tests/hardening/**/*.test.{ts,tsx}',
  'tests/account/deletion/m7_account_deletion_job_store.test.ts',
  'tests/account/deletion/m7_account_deletion_fairness.test.ts',
  'tests/account/deletion/m7_account_deletion_retention.test.ts',
  'tests/account/deletion/m7_account_deletion_runner.test.ts',
  'tests/account/deletion/m7_account_deletion_api.test.ts',
  'tests/account/deletion/m7_account_deletion_http_auth.test.ts',
  'tests/account/deletion/m7_account_deletion_device.test.ts',
  'tests/account/deletion/m7_account_deletion_cron.test.ts',
  'tests/domain/m8_domain_operations.test.ts',
] : [];


export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    VitePWA({ strategies: 'buildSW', buildSW: { swSrc: 'src/sw.ts' }, registerType: 'prompt' }),
  ],
  test: {
    // All network tests use a non-routable loopback backend; Production config is injected by Hosting.
    env: { VITE_ACCOUNT_DELETION_API_ORIGIN: TEST_BACKEND_ORIGIN },
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/cssReadCompat.ts', './tests/setup.tsx'],
    testTimeout: 10000,
    // Only general CI shards gain a third worker; stress and instrumented coverage retain their limits.
    maxWorkers: process.env.CI && process.env.npm_lifecycle_event === 'test' ? 3 : 2,
    exclude: [
      ...configDefaults.exclude,
      '**/e2e/**',
      '**/tests-e2e/**',
      '**/teamwork_projects/**',
      '**/.agents/**',
      // Node-only isolated .test.ts suites have a separate runner. React
      // .test.tsx suites in the same directory must run here under jsdom.
      '**/tests/isolated/**/*.test.ts',
      '**/tests/emulator/**',
      '**/tests/fuzz/**',
      '**/tests/recovery/**',
      '**/tests/gc/**',
      ...stressPatterns,
      ...dedicatedSuiteExclusions,
    ],
  },
});
