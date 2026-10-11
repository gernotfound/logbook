import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

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

// Rule-option objects are unordered; arrays retain their semantic order.
function stableOptions(value) {
  if (Array.isArray(value)) return value.map(stableOptions);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, stableOptions(entry)]));
  }
  return value;
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
  // Correctness rules are enabled by Oxlint even when "categories" is omitted.
  for (const category of new Set([
    'correctness', ...Object.keys(before.categories || {}), ...Object.keys(after.categories || {}),
  ])) {
    const defaultSeverity = category === 'correctness' ? 'warn' : 'off';
    const oldSeverity = severity(before.categories?.[category] ?? defaultSeverity);
    const newSeverity = severity(after.categories?.[category] ?? defaultSeverity);
    if (oldSeverity === null || newSeverity === null || newSeverity < oldSeverity) {
      failures.push(path + ': lint category weakened: ' + category);
    }
  }
  for (const [rule, oldValue] of Object.entries(before.rules || {})) {
    const oldSeverity = severity(oldValue);
    const newValue = after.rules?.[rule];
    const newSeverity = severity(newValue);
    if (oldSeverity === null || newSeverity === null || newSeverity < oldSeverity) {
      failures.push(path + ': lint rules weakened or removed: ' + rule);
    }
    const options = value => JSON.stringify(stableOptions(Array.isArray(value) ? value.slice(1) : []));
    if (options(oldValue) !== options(newValue)) {
      failures.push(path + ': existing lint rule options changed: ' + rule);
    }
  }
  for (const [rule, value] of Object.entries(after.rules || {})) {
    if (!Object.hasOwn(before.rules || {}, rule) && severity(value) === 0) {
      failures.push(path + ': newly disabled lint rule: ' + rule);
    }
  }
  for (const key of ['ignorePatterns', 'ignore', 'overrides']) {
    if (JSON.stringify(after[key] || []) !== JSON.stringify(before[key] || [])) {
      failures.push(path + ': changes to lint exclusions/overrides require a dedicated reviewed policy change: ' + key);
    }
  }
  if (before.options?.typeAware === true && after.options?.typeAware !== true) {
    failures.push(path + ': type-aware lint analysis disabled');
  }
}

// Oxlint may also obtain ignores outside JSON configuration.
for (const path of ['.oxlintignore', '.eslintignore']) {
  let baseContent = null;
  try {
    baseContent = git(['show', baseSha + ':' + path]);
  } catch {
    // An optional ignore file need not exist in the comparison commit.
  }
  const currentContent = existsSync(path) ? readCurrent(path)?.trimEnd() : null;
  if (currentContent !== baseContent) {
    failures.push(path + ': lint ignore-file contents changed');
  }
}

// Oxlint honors .gitignore during directory traversal, including for tracked files.
const ignoredCode = git(['ls-files', '--cached', '--ignored', '--exclude-standard', '-z'])
  .split('\0')
  .filter(path => /\.(?:[cm]?[jt]sx?)$/.test(path));
if (ignoredCode.length) {
  failures.push('Tracked JS/TS files hidden from lint by Git ignore rules: ' + ignoredCode.join(', '));
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
  if (after.compilerOptions?.noCheck === true) {
    failures.push(path + ': TypeScript full checking disabled by noCheck');
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
// Inspect all added source lines, including inline comments and root-level code.
try {
  const patch = git(['diff', '--no-ext-diff', '--unified=0', baseSha, 'HEAD', '--', '.']);
  let file = '';
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6);
      continue;
    }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    if (!/\.(?:[cm]?[jt]sx?)$/.test(file)) continue;
    const text = line.slice(1);
    if (/(?:\/\/|\/\*|\*)\s*(?:oxlint-disable|eslint-disable|@ts-(?:nocheck|ignore|expect-error)|istanbul ignore|c8 ignore)\b/i.test(text)) {
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
