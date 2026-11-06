// Select tests through Vitest itself. Passing testFiles to Stryker 10.1.1
// can misclassify top-level/static mutations with Vitest 5 as Survived.
import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config.ts';
import { trialCases } from './stryker.trial.config.mjs';

const area = process.env.STRYKER_AREA ?? 'csv';
if (!Object.hasOwn(trialCases, area)) throw new Error('Unknown Stryker area: ' + area);

export default mergeConfig(baseConfig, defineConfig({
  test: { include: trialCases[area].testFiles },
}));
