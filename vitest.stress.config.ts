import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import baseConfig, { stressPatterns } from './vitest.config.ts';

const config = mergeConfig(baseConfig, defineConfig({ test: { include: stressPatterns } }));
// mergeConfig concatenates exclusions; replace them so the included stress files remain runnable.
config.test!.exclude = [...configDefaults.exclude, '**/e2e/**', '**/teamwork_projects/**', '**/.agents/**'];
export default config;
