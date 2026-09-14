import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/fuzz/**/*.test.ts'],
        maxWorkers: 1,
        testTimeout: 30000,
    },
});
