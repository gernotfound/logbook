import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export const stressPatterns = ['**/challenger_*.test.{ts,tsx}', '**/*adversarial*.test.{ts,tsx}', '**/*stress*.test.{ts,tsx}'];

const appVersion = process.env.npm_package_version || '0.0.0-test';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    VitePWA({ registerType: 'prompt' }),
  ],
  test: {
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
      '**/tests/isolated/**',
      '**/tests/emulator/**',
      '**/tests/fuzz/**',
      '**/tests/recovery/**',
      '**/tests/gc/**',
      ...stressPatterns,
    ],
  },
});
