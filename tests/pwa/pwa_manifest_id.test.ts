import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('Vite source config declares a stable basePath PWA manifest id', () => {
    const viteConfigPath = fileURLToPath(new URL('../../vite.config.ts', import.meta.url));
    const content = readFileSync(viteConfigPath, 'utf-8');
    expect(content).toMatch(/manifest:\s*\{[^}]*id:\s*basePath/s);
});
