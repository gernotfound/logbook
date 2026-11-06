// Diagnostic mutation testing only. The normal M8 gate and production remain unchanged.
// This selection is deliberately bounded: Stryker's Vitest runner cannot run Playwright
// browser tests or the dedicated Firestore Emulator suite.
export const trialCases = {
  "csv": {
    "mutate": [
      "src/lib/csvExport.ts:7-25"
    ],
    "testFiles": [
      "tests/csv_export_builder.test.ts",
      "tests/sec01_csv_injection.test.tsx"
    ]
  },
  "meal-totals": {
    "mutate": [
      "src/lib/nutrition/calculateLoggedMealTotals.ts"
    ],
    "testFiles": [
      "src/lib/nutrition/calculateLoggedMealTotals.test.ts",
      "src/lib/nutrition/createLoggedMealItem.test.ts"
    ]
  },
  "meal-item": {
    "mutate": [
      "src/lib/nutrition/createLoggedMealItem.ts"
    ],
    "testFiles": [
      "src/lib/nutrition/createLoggedMealItem.test.ts"
    ]
  },
  "workout-duration": {
    "mutate": [
      "src/lib/calc/workoutDuration.ts"
    ],
    "testFiles": [
      "src/lib/calc/workoutDuration.test.ts"
    ]
  },
  "secure-id": {
    "mutate": [
      "src/lib/utils/date.ts:12-33"
    ],
    "testFiles": [
      "tests/secure_id_generation.test.ts"
    ]
  },
  "cycle-limits": {
    "mutate": [
      "src/lib/calc/cycleLimits.ts"
    ],
    "testFiles": [
      "tests/training_cycle_limits_regression.test.ts"
    ]
  },
  "password-policy": {
    "mutate": [
      "src/lib/auth/passwordPolicy.ts"
    ],
    "testFiles": [
      "src/lib/auth/passwordPolicy.test.ts"
    ]
  }
};
const area = process.env.STRYKER_AREA ?? 'csv';

if (!Object.hasOwn(trialCases, area)) {
  throw new Error('Unknown Stryker area: ' + area);
}
export default {
  testRunner: 'vitest',
  // Stryker 10.1.1 rewrites tsconfig.json via an API removed from TypeScript 7.
  // The non-existent optional path suppresses that rewrite in this trial only.
  // Keep TypeScript checking in the normal M8 gate, not in this mutation sandbox.
  tsconfigFile: 'coverage/stryker-no-tsconfig-rewrite.json',
  vitest: {
    configFile: 'vitest.mutation.config.mjs',
    related: false,
    pool: 'forks',
  },
  mutate: trialCases[area].mutate,
  coverageAnalysis: 'perTest',
  concurrency: 2,
  reporters: ['clear-text', 'progress', 'json', 'html'],
  jsonReporter: { fileName: 'coverage/mutation-trial/mutation.json' },
  htmlReporter: { fileName: 'coverage/mutation-trial/index.html' },
  tempDirName: 'coverage/stryker-sandbox',
  thresholds: { high: 80, low: 60, break: null },
};
