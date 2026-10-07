import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const baselinePath = 'config/lint-warning-baseline.json';
const oxlintBin = fileURLToPath(new URL('../node_modules/oxlint/bin/oxlint', import.meta.url));
const update = process.argv.includes('--update');

const suites = [
  { id: 'default', args: [] },
  { id: 'a11y', args: ['--config', '.oxlintrc.a11y.json'] },
  { id: 'type-aware', args: ['--config', '.oxlintrc.type-aware.json'] },
];

function sourceLine(filename, line) {
  if (!line || !existsSync(filename)) return '';
  const lines = readFileSync(filename, 'utf8').split(/\r?\n/);
  return (lines[line - 1] ?? '').trim();
}

function collectSuite(suite) {
  const result = spawnSync(
    process.execPath,
    [oxlintBin, ...suite.args, '--format=json'],
    { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.error) throw result.error;

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error('Unable to parse oxlint JSON for ' + suite.id + ': ' + String(error) + '\n' + result.stdout.slice(0, 1000));
  }

  const diagnostics = parsed.diagnostics ?? [];
  const errors = diagnostics.filter(item => item.severity === 'error');
  if (errors.length > 0 || (result.status ?? 1) !== 0) {
    const summary = errors.slice(0, 10).map(item => item.filename + ': ' + item.code + ' ' + item.message).join('\n');
    throw new Error('Oxlint ' + suite.id + ' reported errors.\n' + summary);
  }

  return diagnostics
    .filter(item => item.severity === 'warning')
    .map(item => {
      const primary = item.labels?.[0]?.span;
      return {
        suite: suite.id,
        file: item.filename.replaceAll('\\', '/'),
        code: item.code,
        message: item.message,
        source: sourceLine(item.filename, primary?.line),
      };
    });
}

function normalize(items) {
  const counts = new Map();
  for (const item of items) {
    const key = JSON.stringify(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ ...JSON.parse(key), count }))
    .sort((a, b) =>
      a.suite.localeCompare(b.suite)
      || a.file.localeCompare(b.file)
      || a.code.localeCompare(b.code)
      || a.message.localeCompare(b.message)
      || a.source.localeCompare(b.source)
      || a.count - b.count
    );
}

const actual = normalize(suites.flatMap(collectSuite));

if (update) {
  writeFileSync(baselinePath, JSON.stringify(actual, null, 2) + '\n', 'utf8');
  console.log('Updated lint warning baseline with ' + actual.reduce((sum, item) => sum + item.count, 0) + ' warnings.');
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error('Lint warning baseline missing: ' + baselinePath);
  process.exit(1);
}

const expected = JSON.parse(readFileSync(baselinePath, 'utf8'));
const actualMap = new Map(actual.map(item => [JSON.stringify({ ...item, count: undefined }), item]));
const expectedMap = new Map(expected.map(item => [JSON.stringify({ ...item, count: undefined }), item]));
const added = actual.filter(item => {
  const match = expectedMap.get(JSON.stringify({ ...item, count: undefined }));
  return !match || match.count !== item.count;
});
const removed = expected.filter(item => {
  const match = actualMap.get(JSON.stringify({ ...item, count: undefined }));
  return !match || match.count !== item.count;
});

if (added.length || removed.length) {
  console.error('Lint warning baseline drift detected.');
  for (const item of added.slice(0, 20)) {
    console.error('+ ' + item.suite + ' ' + item.file + ' ' + item.code + ': ' + item.message + ' :: ' + item.source + ' (x' + item.count + ')');
  }
  for (const item of removed.slice(0, 20)) {
    console.error('- ' + item.suite + ' ' + item.file + ' ' + item.code + ': ' + item.message + ' :: ' + item.source + ' (x' + item.count + ')');
  }
  console.error('Review the warning change, then run npm run lint:baseline:update only when the new baseline is intentional.');
  process.exit(1);
}

console.log('Lint warning baseline OK: ' + actual.reduce((sum, item) => sum + item.count, 0) + ' reviewed warnings, no drift.');
