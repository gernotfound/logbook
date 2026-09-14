import { defineConfig } from 'vitest/config';

// Recovery tests inject failures into IndexedDB and process/session boundaries.
// Keep them single-worker so global fault points cannot leak across scenarios.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/recovery/**/*.test.ts'],
    maxWorkers: 1,
    testTimeout: 15000,
  },
});
