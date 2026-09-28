import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const TOKEN_NAMES = [
  '--font-size-micro',
  '--font-size-meta',
  '--font-size-secondary',
  '--font-size-body',
  '--font-size-control',
  '--font-size-section',
  '--font-size-page',
  '--font-size-display-sm',
  '--font-size-display-md',
  '--font-size-display-xl',
  '--font-size-display-2xl',
  '--font-size-timer',
] as const;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

describe('scala tipografica canonica', () => {
  it('definisce i token normativi e il corpo a 15px', () => {
    const tokens = fs.readFileSync(path.join(ROOT, 'src/styles/tokens.css'), 'utf8');
    for (const token of TOKEN_NAMES) expect(tokens).toContain(token);
    expect(tokens).toMatch(/--font-size-body:\s*0\.9375rem/);
    expect(tokens).toMatch(/--font-size-control:\s*1rem/);
    expect(tokens).toMatch(/--font-size-page:\s*1\.375rem/);
  });

  it('non introduce dimensioni CSS arbitrarie nel codice applicativo', () => {
    const files = walk(path.join(ROOT, 'src')).filter(file => /\.(?:css|tsx?|jsx?)$/.test(file));
    const violations: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/font-size\s*:\s*([0-9]*\.?[0-9]+(?:px|rem))/g)) {
        if (match[1] !== '16px') violations.push(`${path.relative(ROOT, file)}: ${match[0]}`);
      }
      for (const match of source.matchAll(/fontSize\s*:\s*['"]([0-9]*\.?[0-9]+(?:px|rem))['"]/g)) {
        if (match[1] !== '16px') violations.push(`${path.relative(ROOT, file)}: ${match[0]}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('mantiene a 16px i controlli di input per Safari iOS', () => {
    const base = fs.readFileSync(path.join(ROOT, 'src/styles/base.css'), 'utf8');
    expect(base).toMatch(/input,\s*select,\s*textarea\s*\{[\s\S]*?font-size:\s*16px\s*!important/);
  });

  it('allinea Schede ed Esercizi alla stessa gerarchia tipografica', () => {
    const training = fs.readFileSync(path.join(ROOT, 'src/components/Training/training.css'), 'utf8');
    const routineCard = fs.readFileSync(path.join(ROOT, 'src/components/Training/routines/RoutineCard.tsx'), 'utf8');
    expect(training).toMatch(/\.exercise-compact-name\s*\{[\s\S]*?font-size:\s*var\(--font-size-control\)/);
    expect(training).toMatch(/\.exercise-compact-meta\s*\{[\s\S]*?font-size:\s*var\(--font-size-meta\)/);
    expect(routineCard).toContain('font-bold text-md');
    expect(routineCard).toContain('text-muted text-xs mt-4');
  });
});
