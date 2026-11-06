// Diagnostic experiment only: expand mutation scope after verifying the Vitest 5 runner.
// The official Vitest runner does not cover Playwright or Firestore Emulator suites.
export default {
  testRunner: 'vitest',
  // Stryker 10.1.1 calls a TypeScript API removed in TS 7 when rewriting tsconfigs.
  // Its sandbox preserves this repository's relative paths and references, so
  // no tsconfig rewrite is needed in this isolated diagnostic run.
  tsconfigFile: 'coverage/stryker-no-tsconfig-rewrite.json',
  vitest: {
    configFile: 'vitest.config.ts',
    related: false,
    pool: 'forks',
  },
  mutate: ['src/lib/csvExport.ts:7-25'],
  testFiles: [
    'tests/csv_export_builder.test.ts',
    'tests/sec01_csv_injection.test.tsx',
  ],
  coverageAnalysis: 'perTest',
  concurrency: 2,
  reporters: ['clear-text', 'progress', 'json', 'html'],
  jsonReporter: { fileName: 'coverage/mutation-trial/mutation.json' },
  htmlReporter: { fileName: 'coverage/mutation-trial/index.html' },
  tempDirName: 'coverage/stryker-sandbox',
  thresholds: { high: 80, low: 60, break: null },
};
