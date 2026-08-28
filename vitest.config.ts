import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({ registerType: 'prompt' }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.tsx'],
    testTimeout: 10000,
    exclude: [
      ...configDefaults.exclude,
      '**/teamwork_projects/**',
      '**/.agents/**',
      '**/challenger_*.test.{ts,tsx}',
      '**/*adversarial*.test.{ts,tsx}',
      '**/*stress*.test.{ts,tsx}'
    ],
  },
});
