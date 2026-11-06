import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative, resolve, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
const testFile = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const vitestExecutable = resolve(root, 'node_modules/vitest/vitest.mjs');

export function compareAssignments(expectedItems, assignments, label) {
  const expected = new Set(expectedItems);
  const owners = new Map();
  const failures = [];
  for (const [runner, items] of Object.entries(assignments)) {
    if (!items.length) failures.push(label + ': empty runner ' + runner);
    for (const item of items) {
      if (!expected.has(item)) failures.push(label + ': unexpected ' + item + ' in ' + runner);
      const previous = owners.get(item);
      if (previous) failures.push(label + ': duplicate ' + item + ' in ' + previous + ' and ' + runner);
      else owners.set(item, runner);
    }
  }
  for (const item of expected) {
    if (!owners.has(item)) failures.push(label + ': undiscovered ' + item);
  }
  return failures;
}

function execute(label, command, args, lifecycle) {
  const child = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, npm_lifecycle_event: lifecycle, NO_COLOR: '1', FORCE_COLOR: '0' },
    encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
  });
  if (child.error || child.status !== 0) {
    throw new Error(label + ': failed to list tests: ' + (child.error?.message || child.stderr || child.stdout || child.status));
  }
  return child.stdout;
}

function normalizeFile(file) {
  const unix = file.replaceAll('\\', '/').trim();
  return (isAbsolute(unix) ? relative(root, unix) : unix.replace(/^\.\//, '')).replaceAll('\\', '/');
}

function vitestList(label, lifecycle, config, filters = []) {
  const output = execute(label, process.execPath, [vitestExecutable, 'list', '--filesOnly', '--config', config, ...filters], lifecycle);
  const paths = output.split(/\r?\n/).map(normalizeFile).filter(path => testFile.test(path));
  if (!paths.length) throw new Error(label + ': Vitest reported no matching files: ' + output.slice(0, 1000));
  return paths;
}

function commandFiles(script) {
  const parts = script.trim().split(/\s+/);
  if (parts[0] !== 'vitest' || parts[1] !== 'run') throw new Error('unsupported explicit Vitest command: ' + script);
  const configIndex = parts.indexOf('--config');
  const config = configIndex === -1 ? 'vitest.config.ts' : parts[configIndex + 1];
  const files = parts.slice(2).filter((part, index, all) => part !== '--config' && (index === 0 || all[index - 1] !== '--config'));
  if (!files.length || files.some(file => !testFile.test(file))) throw new Error('explicit test list missing: ' + script);
  return { config, files };
}

function playwrightList(project, shard) {
  const args = [require.resolve('@playwright/test/cli'), 'test', '--list', '--project=' + project];
  if (shard) args.push('--shard=' + shard + '/4');
  const output = execute('Playwright ' + project + (shard || 'all'), process.execPath, args, 'test:e2e');
  const tests = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*\[(chromium|mobile-safari)\]\s+›\s+((?:e2e\/)?[^\s:]+\.spec\.ts:\d+:\d+)\s+›\s+(.+)$/);
    if (match) {
      if (match[1] !== project) throw new Error('Unexpected Playwright project ' + match[1]);
      tests.push((match[2].startsWith('e2e/') ? '' : 'e2e/') + match[2] + ' › ' + match[3].trim());
    }
  }
  if (!tests.length) throw new Error('No Playwright tests parsed for ' + project + ': ' + output.slice(0, 1500));
  return tests;
}

function verify() {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(Boolean).map(normalizeFile).filter(file => testFile.test(file));
  const nodeTests = tracked.filter(file => !file.startsWith('e2e/'));
  const browserFiles = tracked.filter(file => file.startsWith('e2e/'));
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const runners = {
    general: vitestList('general', 'test', 'vitest.config.ts'),
    isolated: vitestList('isolated', 'test:isolated', 'vitest.isolated.config.ts'),
    hardening: vitestList('hardening', 'test:hardening', 'vitest.hardening.config.ts'),
    stress: vitestList('stress', 'test:stress', 'vitest.stress.config.ts'),
    fuzz: vitestList('fuzz', 'test:fuzz', 'vitest.fuzz.config.ts'),
    recovery: vitestList('recovery', 'test:recovery', 'vitest.recovery.config.ts'),
    gc: vitestList('gc', 'test:gc', 'vitest.gc.config.ts'),
    emulator: vitestList('emulator', 'test:rules', 'vitest.emulator.config.ts'),
  };
  const m7 = commandFiles(pkg.scripts['test:m7']);
  runners.m7 = vitestList('m7', 'test:m7', m7.config, m7.files);
  for (const [index, script] of pkg.scripts['test:m8'].split(/\s*&&\s*/).entries()) {
    const m8 = commandFiles(script);
    runners['m8-' + (index + 1)] = vitestList('m8-' + (index + 1), 'test:m8', m8.config, m8.files);
  }
  const failures = compareAssignments(nodeTests, runners, 'Vitest/Node');
  const projectListings = {};
  for (const project of ['chromium', 'mobile-safari']) {
    const full = playwrightList(project);
    projectListings[project] = full;
    const shards = Object.fromEntries([1, 2, 3, 4].map(shard => [project + '-' + shard, playwrightList(project, shard)]));
    failures.push(...compareAssignments(full, shards, 'Playwright ' + project));
  }
  const browserSeen = [...new Set(Object.values(projectListings).flat().map(test => test.split(/:\d+:\d+/)[0]))];
  const browserMissing = browserFiles.filter(file => !browserSeen.includes(file));
  const browserUnexpected = browserSeen.filter(file => !browserFiles.includes(file));
  for (const file of browserMissing) failures.push('Playwright: spec without runnable tests ' + file);
  for (const file of browserUnexpected) failures.push('Playwright: untracked spec ' + file);
  if (failures.length) throw new Error(failures.join('\n'));
  console.log('Test discovery verified: ' + nodeTests.length + ' Vitest/Node files each assigned once to ' + Object.keys(runners).length + ' runners; ' + browserFiles.length + ' Playwright spec files, ' + projectListings.chromium.length + ' Chromium tests, ' + projectListings['mobile-safari'].length + ' WebKit tests across 4 shards per browser.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { verify(); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
