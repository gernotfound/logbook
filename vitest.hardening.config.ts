import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config.ts';

export default mergeConfig(baseConfig, defineConfig({
  test: {
    include: [
      'tests/account/auth/logout_protection.test.ts',
      'tests/account/guest/guest_bootstrap_lifecycle.test.tsx',
      'tests/account/guest/guest_account_migration_v3.test.tsx',
      'tests/catalog/catalog_resolution_pipeline.test.ts',
      'tests/hardening/**/*.test.{ts,tsx}',
    ],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 10000,
  },
}));
