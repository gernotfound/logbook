import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCriticalTest } from './critical-test-selection.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const testPaths = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);

const selected = testPaths.filter(isCriticalTest);
if (selected.length < 15) throw new Error('Critical coverage test selection unexpectedly small: ' + selected.length);

const sources = [
  'src/lib/auth/**/*.{ts,tsx}',
  'src/contexts/auth/**/*.{ts,tsx}',
  'src/lib/sync/**/*.{ts,tsx}',
  'src/lib/healthConsent*.ts',
  'server/healthConsent/**/*.ts',
  'server/accountDeletion/**/*.ts',
];
const vitest = resolve(root, 'node_modules/vitest/vitest.mjs');
const args = [
  vitest, 'run', '--config', 'vitest.config.ts',
  '--coverage.enabled', '--coverage.provider=v8',
  '--coverage.reporter=json-summary', '--coverage.reporter=text-summary',
  '--coverage.reportsDirectory=coverage/critical',
  ...sources.map(pattern => '--coverage.include=' + pattern),
  ...selected,
];
console.log('Critical diagnostic coverage: running ' + selected.length + ' selected Vitest files; excludes Emulator-only and Node-only isolated suites.');
const result = spawnSync(process.execPath, args, {
  cwd: root, env: { ...process.env, npm_lifecycle_event: 'test:coverage:critical' },
  stdio: 'inherit', timeout: 300_000,
});
if (result.error || result.status !== 0) {
  throw new Error('Critical coverage runner failed: ' + (result.error?.message || result.status));
}

const summary = JSON.parse(readFileSync(resolve(root, 'coverage/critical/coverage-summary.json'), 'utf8'));
const areas = [
  ['Auth', ['/src/lib/auth/', '/src/contexts/auth/']],
  ['Sync/storage', ['/src/lib/sync/']],
  ['Health consent', ['/src/lib/healthConsent', '/server/healthConsent/']],
  ['Account deletion', ['/server/accountDeletion/']],
];
for (const [area, identifiers] of areas) {
  const files = Object.entries(summary).filter(([path]) => {
    const unix = ('/' + path.replaceAll('\\', '/')).replaceAll('//', '/');
    return identifiers.some(id => unix.includes(id));
  });
  if (files.length === 0) throw new Error('Critical coverage report has no files for ' + area);
  const metrics = ['statements', 'branches', 'functions', 'lines'].map(metric => {
    const total = files.reduce((n, [, value]) => n + value[metric].total, 0);
    const covered = files.reduce((n, [, value]) => n + value[metric].covered, 0);
    return metric + '=' + (total ? (100 * covered / total).toFixed(1) : 'n/a') + '%';
  });
  console.log('COVERAGE ' + area + ': ' + files.length + ' files; ' + metrics.join(', '));
}
console.log('Coverage report: coverage/critical/coverage-summary.json; diagnostic only, no arbitrary pass thresholds. Backend/Emulator and E2E execution are not counted in this instrumented selection.');
