import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export const stressPatterns = ['**/challenger_*.test.{ts,tsx}', '**/*adversarial*.test.{ts,tsx}', '**/*stress*.test.{ts,tsx}'];

const appVersion = process.env.npm_package_version || '0.0.0-test';

// Dedicated M5/M7/M8 suites run these files under their own verification commands.
// Exclude them only from npm's canonical general runner, not from focused vitest invocations.
const dedicatedSuiteExclusions = process.env.npm_lifecycle_event === 'test' ? [
  'tests/logout_protection.test.ts',
  'tests/guest_bootstrap_lifecycle.test.tsx',
  'tests/guest_account_migration_v3.test.tsx',
  'tests/catalog_resolution_pipeline.test.ts',
  'tests/hardening/**/*.test.{ts,tsx}',
  'tests/m7_account_deletion_job_store.test.ts',
  'tests/m7_account_deletion_fairness.test.ts',
  'tests/m7_account_deletion_retention.test.ts',
  'tests/m7_account_deletion_runner.test.ts',
  'tests/m7_account_deletion_api.test.ts',
  'tests/m7_account_deletion_http_auth.test.ts',
  'tests/m7_account_deletion_device.test.ts',
  'tests/m7_account_deletion_cron.test.ts',
  'tests/m8_domain_operations.test.ts',
] : [];


export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    VitePWA({ registerType: 'prompt' }),
  ],
  test: {
    // All network tests use a non-routable loopback backend; Production config is injected by Hosting.
    env: { VITE_ACCOUNT_DELETION_API_ORIGIN: 'http://127.0.0.1:9' },
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/cssReadCompat.ts', './tests/setup.tsx'],
    testTimeout: 10000,
    maxWorkers: 2,
    coverage: {
    },
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
