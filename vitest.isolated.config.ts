import { defineConfig } from 'vitest/config';

// No UI setup: these tests exercise actual IndexedDB transactions and domain modules.
export default defineConfig({ test: { environment: 'node', include: ['tests/isolated/**/*.test.ts'], maxWorkers: 2 } });
