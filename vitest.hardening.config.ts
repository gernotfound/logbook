import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config';

export default mergeConfig(baseConfig, defineConfig({
  test: {
    include: [
      'tests/logout_protection.test.ts',
      'tests/guest_bootstrap_lifecycle.test.tsx',
      'tests/guest_account_migration_v3.test.tsx',
      'tests/catalog_resolution_pipeline.test.ts',
      'tests/hardening/**/*.test.{ts,tsx}',
    ],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 10000,
  },
}));
