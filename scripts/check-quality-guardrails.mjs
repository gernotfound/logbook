import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const failures = [];
const root = process.cwd();

function git(args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
}

function parseJson(source, label) {
  try {
    return JSON.parse(source);
  } catch (error) {
    failures.push(label + ': invalid JSON: ' + String(error));
    return null;
  }
}

function parseJsonc(source, label) {
  if (source === null) return null;
  return parseJson(source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''), label);
}

function readCurrent(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    failures.push('Missing quality-control file: ' + path);
    return null;
  }
}

let baseSha = (process.env.QUALITY_BASE_SHA || '').trim();
if (!baseSha && process.env.GITHUB_EVENT_NAME === 'push') {
  try {
    baseSha = git(['rev-parse', 'HEAD^']);
  } catch {
    failures.push('Push verification must have its first parent available');
  }
}
if (!baseSha && process.env.GITHUB_EVENT_NAME === 'pull_request') {
  failures.push('Pull request verification requires QUALITY_BASE_SHA from the GitHub event');
}
if (!baseSha) {
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log('Quality guardrails: no comparison base supplied for local diagnostics; PR/push CI enforces monotonicity.');
  process.exit(0);
}
if (!/^[0-9a-f]{40}$/.test(baseSha)) {
  console.error('Quality guardrails: invalid comparison commit SHA');
  process.exit(1);
}
try {
  git(['cat-file', '-e', baseSha + '^{commit}']);
} catch {
  console.error('Quality guardrails: comparison commit unavailable (full Git history required): ' + baseSha);
  process.exit(1);
}

function readBase(path) {
  try {
    return git(['show', baseSha + ':' + path]);
  } catch {
    failures.push('Comparison commit missing quality-control file: ' + path);
    return null;
  }
}

function identity(item) {
  return JSON.stringify([item.suite, item.file, item.code, item.message, item.source]);
}

function warningCounts(items, label) {
  if (!Array.isArray(items)) {
    failures.push(label + ': warning baseline must be an array');
    return new Map();
  }
  const counts = new Map();
  for (const entry of items) {
    if (!entry || typeof entry !== 'object'
      || ['suite', 'file', 'code', 'message', 'source'].some(field => typeof entry[field] !== 'string')
      || !Number.isSafeInteger(entry.count) || entry.count < 1) {
      failures.push(label + ': malformed warning entry');
      continue;
    }
    const key = identity(entry);
    if (counts.has(key)) failures.push(label + ': duplicate warning identity: ' + key);
    counts.set(key, entry.count);
  }
  return counts;
}

const baselinePath = 'config/lint-warning-baseline.json';
const oldWarnings = warningCounts(parseJson(readBase(baselinePath), 'main warning baseline'), 'main warning baseline');
const newWarnings = warningCounts(parseJson(readCurrent(baselinePath), 'candidate warning baseline'), 'candidate warning baseline');
for (const [key, count] of newWarnings) {
  const permitted = oldWarnings.get(key) || 0;
  if (count > permitted) {
    failures.push('New or increased warning forbidden (' + permitted + ' -> ' + count + '): ' + key);
  }
}

function severity(value) {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === 0 || v === 'off') return 0;
  if (v === 1 || v === 'warn') return 1;
  if (v === 2 || v === 'error') return 2;
  return null;
}

for (const path of ['.oxlintrc.json', '.oxlintrc.a11y.json', '.oxlintrc.type-aware.json']) {
  const before = parseJson(readBase(path), 'main ' + path);
  const after = parseJson(readCurrent(path), 'candidate ' + path);
  if (!before || !after) continue;
  for (const plugin of before.plugins || []) {
    if (!Array.isArray(after.plugins) || !after.plugins.includes(plugin)) {
      failures.push(path + ': existing lint plugin removed: ' + plugin);
    }
  }
  for (const area of ['rules', 'categories']) {
    for (const [rule, oldValue] of Object.entries(before[area] || {})) {
      const oldSeverity = severity(oldValue);
      const newSeverity = severity(after[area]?.[rule]);
      if (oldSeverity === null || newSeverity === null || newSeverity < oldSeverity) {
        failures.push(path + ': lint ' + area + ' weakened or removed: ' + rule);
      }
    }
  }
  for (const key of ['ignorePatterns', 'ignore', 'overrides']) {
    if (JSON.stringify(after[key] || []) !== JSON.stringify(before[key] || [])) {
      failures.push(path + ': changes to lint exclusions/overrides require a dedicated reviewed policy change: ' + key);
    }
  }
}

const typeSafetyFlags = [
  'strict', 'noImplicitAny', 'noUnusedLocals', 'noUnusedParameters',
  'noFallthroughCasesInSwitch', 'noEmit', 'isolatedModules',
  'alwaysStrict', 'strictNullChecks', 'strictFunctionTypes', 'noUncheckedIndexedAccess',
];
for (const path of ['tsconfig.json', 'tsconfig.m5-tests.json', 'tsconfig.m7-server.json']) {
  const before = parseJsonc(readBase(path), 'main ' + path);
  const after = parseJsonc(readCurrent(path), 'candidate ' + path);
  if (!before || !after) continue;
  for (const flag of typeSafetyFlags) {
    const oldValue = before.compilerOptions?.[flag];
    const newValue = after.compilerOptions?.[flag];
    if (oldValue === true && newValue !== true) {
      failures.push(path + ': required TypeScript check weakened: ' + flag);
    } else if (oldValue !== false && newValue === false) {
      failures.push(path + ': TypeScript safety check explicitly disabled: ' + flag);
    }
  }
  if (before.extends !== after.extends) {
    failures.push(path + ': TypeScript configuration inheritance changed');
  }
  const oldExclusions = before.exclude || [];
  for (const exclusion of after.exclude || []) {
    if (!oldExclusions.includes(exclusion)) {
      failures.push(path + ': new TypeScript exclusion: ' + exclusion);
    }
  }
}

function expandScript(pkg, name, stack = []) {
  if (stack.includes(name)) throw new Error('Recursive verification script: ' + [...stack, name].join(' -> '));
  const command = pkg.scripts?.[name];
  if (typeof command !== 'string') throw new Error('Missing mandatory script: ' + name);
  const leaves = [];
  for (const part of command.split(/\s*&&\s*/).map(x => x.trim()).filter(Boolean)) {
    const nested = /^npm run ([A-Za-z0-9:_-]+)$/.exec(part);
    if (nested) leaves.push(...expandScript(pkg, nested[1], [...stack, name]));
    else leaves.push(part);
  }
  return leaves;
}

const oldPackage = parseJson(readBase('package.json'), 'main package.json');
const newPackage = parseJson(readCurrent('package.json'), 'candidate package.json');
if (oldPackage && newPackage) {
  const mandatoryScripts = [
    'build', 'lint', 'lint:a11y', 'lint:type-aware', 'lint:baseline',
    'test:ci-contract', 'test:typecheck-coverage', 'test:typecheck:m5',
    'test:typecheck:m7', 'test:quality:m5', 'test:dead-code',
    'test:repo-hygiene', 'test:no-skips', 'test:security-static',
    'test:e2e', 'test:rules', 'test:domain-boundary:m8',
  ];
  for (const key of mandatoryScripts) {
    if (oldPackage.scripts?.[key] !== newPackage.scripts?.[key]) {
      failures.push('Mandatory package.json quality gate changed: ' + key);
    }
  }
  try {
    const required = new Map();
    for (const leaf of expandScript(oldPackage, 'verify:m8')) {
      required.set(leaf, (required.get(leaf) || 0) + 1);
    }
    const present = new Map();
    for (const leaf of expandScript(newPackage, 'verify:m8')) {
      present.set(leaf, (present.get(leaf) || 0) + 1);
    }
    for (const [leaf, minimum] of required) {
      if ((present.get(leaf) || 0) < minimum) {
        failures.push('Mandatory verification leaf removed or weakened: ' + leaf);
      }
    }
  } catch (error) {
    failures.push(String(error));
  }
}

// A new suppression is not an acceptable substitute for fixing a new warning.
// This check examines only added comment lines, preserving historical comments.
try {
  const patch = git(['diff', '--no-ext-diff', '--unified=0', baseSha, 'HEAD', '--',
    'src', 'tests', 'e2e', 'api', 'server', 'scripts']);
  let file = '';
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6);
      continue;
    }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const text = line.slice(1).trimStart();
    if (/^(?:\/\/|\/\*|\*)\s*(?:oxlint-disable|eslint-disable|@ts-nocheck|@ts-ignore|istanbul ignore|c8 ignore)\b/i.test(text)) {
      failures.push('New lint/typecheck/coverage suppression is forbidden: ' + file + ': ' + text.slice(0, 120));
    }
  }
} catch (error) {
  failures.push('Unable to inspect added suppression directives: ' + String(error));
}

if (failures.length) {
  console.error('Quality regression guard failed against ' + baseSha + ':');
  for (const finding of failures) console.error('- ' + finding);
  process.exit(1);
}
const reduced = [...oldWarnings].reduce((n, [, count]) => n + count, 0)
  - [...newWarnings].reduce((n, [, count]) => n + count, 0);
console.log('Quality guardrails OK: no new warning identities or counts, ' + reduced
  + ' warnings removed; existing lint, TypeScript and mandatory CI checks preserved against ' + baseSha + '.');
