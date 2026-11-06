// Select tests through Vitest itself. Passing testFiles to Stryker 10.1.1
// can misclassify top-level/static mutations with Vitest 5 as Survived.
import { defineConfig, mergeConfig } from 'vitest/config';
import jsdomConfig from './vitest.config.ts';
import isolatedConfig from './vitest.isolated.config.ts';
import gcConfig from './vitest.gc.config.ts';
import { trialCases } from './stryker.trial.config.mjs';

const area = process.env.STRYKER_AREA ?? 'csv';
if (!Object.hasOwn(trialCases, area)) throw new Error('Unknown Stryker area: ' + area);

// Storage/journal and GC suites must retain the production-adjacent Node fixtures
// of their dedicated verification runner, not inherit jsdom's UI setup.
const variants = { isolated: isolatedConfig, gc: gcConfig };
const baseConfig = variants[trialCases[area].runner] ?? jsdomConfig;
export default mergeConfig(baseConfig, defineConfig({
  test: { include: trialCases[area].testFiles },
}));
