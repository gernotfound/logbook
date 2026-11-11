import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('Vite source config declares a stable basePath PWA manifest id', () => {
    const viteConfigPath = resolve(__dirname, '../../vite.config.ts');
    const content = readFileSync(viteConfigPath, 'utf-8');
    expect(content).toMatch(/manifest:\s*\{[^}]*id:\s*basePath/s);
});
