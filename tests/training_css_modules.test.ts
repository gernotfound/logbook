import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const directory = path.resolve('src/components/Training');
const entrypoint = path.join(directory, 'training.css');
const modules = [
  'training-overview.css',
  'training-history.css',
  'training-exercises.css',
  'training-session.css',
] as const;

describe('Training stylesheet module boundaries', () => {
  it('loads each module exactly once in the historical cascade order', async () => {
    // Read the actual entrypoint, not the test compatibility-expanded stylesheet.
    const source = await readFile(entrypoint, 'utf8');
    const statements = [...source.matchAll(/@import\s+['"]([^'"]+)['"]\s*;/g)];
    expect(statements.map(match => match[1])).toEqual(modules.map(name => './' + name));
    expect(source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import\s+['"][^'"]+['"]\s*;/g, '').trim()).toBe('');

    for (const name of modules) {
      const content = await readFile(path.join(directory, name), 'utf8');
      expect(content).not.toMatch(/@import\b/);
      expect((content.match(/\{/g) ?? []).length).toBe((content.match(/\}/g) ?? []).length);
      expect(content.trim().length).toBeGreaterThan(0);
    }
  });

  it('keeps all training sections visible to existing UI regressions', () => {
    // Vitest expands local imports for this canonical entrypoint, like global.css.
    const css = readFileSync(entrypoint, 'utf8');
    const markers = [
      '.workout-sticky-timer {',
      '/* Training history calendar */',
      '/* Exercise library — proposal 5 */',
      '/* Sessione allenamento — redesign mobile-first */',
    ];
    const positions = markers.map(marker => css.indexOf(marker));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(css).toMatch(/\.workout-timer \.timer-controls\s*\{/);
    expect(css).toMatch(/\.history-header\s*\{/);
    expect(css).toMatch(/\.exercise-editor\s*\{/);
    expect(css).toMatch(/\.session-advanced-segment-grid\.with-rest\s*\{/);
    expect(css).toMatch(/@media\s*\(max-width:\s*24\.375rem\)/);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });
});
