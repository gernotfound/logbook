import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/firebase_functions_entrypoint.test.ts'],
    testTimeout: 10000,
  },
});
