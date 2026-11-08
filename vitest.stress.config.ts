import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig, { stressPatterns } from './vitest.config.ts';

const config = mergeConfig(baseConfig, defineConfig({ test: { include: stressPatterns } }));
// mergeConfig concatenates exclusions; retain the base exclusions except for
// the stress patterns selected by this dedicated runner.
config.test!.exclude = baseConfig.test?.exclude?.filter(pattern => !stressPatterns.includes(pattern));
export default config;
