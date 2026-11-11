import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = path.resolve('src/components/Data');
const entrypoint = path.join(dir, 'data.css');
const modules = [
  'data-fields.css',
  'data-activity.css',
  'data-history.css',
  'data-responsive.css',
] as const;

describe('Data CSS module boundaries', () => {
  it('imports each standalone module exactly once in the historical cascade order', async () => {
    // Use the original file without the Vitest readFileSync import-expansion adapter.
    const entry = await readFile(entrypoint, 'utf8');
    const imports = [...entry.matchAll(/@import\s+['"]([^'"]+)['"]\s*;/g)];
    expect(imports.map(match => match[1])).toEqual(modules.map(name => './' + name));
    expect(entry.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import\s+['"][^'"]+['"]\s*;/g, '').trim()).toBe('');

    for (const name of modules) {
      const css = await readFile(path.join(dir, name), 'utf8');
      expect(css).not.toMatch(/@import\b/);
      expect((css.match(/\{/g) ?? []).length).toBe((css.match(/\}/g) ?? []).length);
      expect(css.trim()).not.toBe('');
    }
  });

  it('exposes the ordered, scoped rules to existing Data UI and typography checks', () => {
    // The adapter reads the effective stylesheet by expanding local imports.
    const css = readFileSync(entrypoint, 'utf8');
    const markers = [
      '#view-data {',
      '/* Attività */',
      '/* Storico Dati — composizione allineata allo Storico Allenamento. */',
      '@media (min-width: 32rem) {',
    ];
    const positions = markers.map(marker => css.indexOf(marker));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(css).toMatch(/#view-data \.data-form-grid\s*[,{\n]/);
    expect(css).toMatch(/#view-data \.activity-stat-grid\s*\{/);
    expect(css).toMatch(/#view-data \.history-header\s*\{/);
    expect(css).toMatch(/#view-data \.history-record-name\s*\{[^}]*font-size:\s*var\(--font-size-control\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*22\.5rem\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*20rem\)/);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });
});
