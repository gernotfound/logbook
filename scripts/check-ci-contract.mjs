import { existsSync, readFileSync } from 'node:fs';

const workflowPath = '.github/workflows/verification.yml';
const failures = [];

if (!existsSync(workflowPath)) {
  console.error(`M8 CI contract failed: missing ${workflowPath}`);
  process.exit(1);
}

const workflow = readFileSync(workflowPath, 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const nvmrc = existsSync('.nvmrc') ? readFileSync('.nvmrc', 'utf8').trim() : '';
const nodeVersionFile = existsSync('.node-version') ? readFileSync('.node-version', 'utf8').trim() : '';

if (packageJson.engines?.node !== '24.x') failures.push(`package engines.node: expected 24.x, got ${packageJson.engines?.node ?? 'missing'}`);
if (packageJson.engines?.npm !== '11.x') failures.push(`package engines.npm: expected 11.x, got ${packageJson.engines?.npm ?? 'missing'}`);
if (packageJson.packageManager !== 'npm@11.21.0') failures.push(`packageManager: expected npm@11.21.0, got ${packageJson.packageManager ?? 'missing'}`);
if (nvmrc !== '24') failures.push(`.nvmrc: expected 24, got ${nvmrc || 'missing'}`);
if (nodeVersionFile !== '24') failures.push(`.node-version: expected 24, got ${nodeVersionFile || 'missing'}`);
if (packageJson.scripts?.['lint:type-aware'] !== 'oxlint --config .oxlintrc.type-aware.json') {
  failures.push('lint:type-aware must not use a warning-count threshold; lint:baseline owns reviewed warning drift');
}
if (packageJson.scripts?.['lint:baseline'] !== 'node scripts/check-lint-baseline.mjs') {
  failures.push('lint:baseline: expected node scripts/check-lint-baseline.mjs');
}
if (!existsSync('config/lint-warning-baseline.json')) {
  failures.push('lint warning baseline: missing config/lint-warning-baseline.json');
}

function requirePattern(label, source, pattern) {
  if (!pattern.test(source)) failures.push(`${label}: missing structure matching ${pattern}`);
}

function forbidPattern(label, source, pattern) {
  if (pattern.test(source)) failures.push(`${label}: forbidden structure matching ${pattern}`);
}

function splitChain(command) {
  return command.split(/\s*&&\s*/).map(part => part.trim()).filter(Boolean);
}

function expandScript(name, stack = []) {
  if (stack.includes(name)) throw new Error(`recursive npm script chain: ${[...stack, name].join(' -> ')}`);
  const command = packageJson.scripts?.[name];
  if (!command) throw new Error(`missing npm script: ${name}`);

  const leaves = [];
  for (const part of splitChain(command)) {
    const match = part.match(/^npm run ([A-Za-z0-9:_-]+)$/);
    if (match && packageJson.scripts?.[match[1]]) {
      leaves.push(...expandScript(match[1], [...stack, name]));
    } else {
      leaves.push(part);
    }
  }
  return leaves;
}

function multiset(items) {
  const result = new Map();
  for (const item of items) result.set(item, (result.get(item) ?? 0) + 1);
  return result;
}

function sameMultiset(left, right) {
  if (left.size !== right.size) return false;
  for (const [key, count] of left) if (right.get(key) !== count) return false;
  return true;
}

const pullRequestBlock = workflow.match(/^  pull_request:\s*\n([\s\S]*?)(?=^  (?:push|workflow_dispatch):|^[^\s])/m)?.[1];
if (!pullRequestBlock) failures.push('PR trigger: missing pull_request block');
else requirePattern('PR trigger main target', pullRequestBlock, /^      - main\s*$/m);

const pushBlock = workflow.match(/^  push:\s*\n([\s\S]*?)(?=^  (?:pull_request|workflow_dispatch):|^[^\s])/m)?.[1];
if (!pushBlock) failures.push('push trigger: missing push block');
else requirePattern('push main target', pushBlock, /^      - main\s*$/m);

forbidPattern('privileged PR trigger', workflow, /^\s*pull_request_target:\s*$/m);
forbidPattern('secret references', workflow, /\$\{\{\s*secrets\./);
forbidPattern('continue-on-error', workflow, /^\s+continue-on-error\s*:/m);

if (pullRequestBlock) {
  forbidPattern('PR trigger event-type filter', pullRequestBlock, /^    types\s*:/m);
  forbidPattern('PR trigger path filter', pullRequestBlock, /^    paths\s*:/m);
  forbidPattern('PR trigger path-ignore filter', pullRequestBlock, /^    paths-ignore\s*:/m);
  forbidPattern('PR trigger obsolete integration target', pullRequestBlock, /^      - feat\/ui-workout-guest-flow\s*$/m);
}
if (pushBlock) {
  forbidPattern('push obsolete M8 branch target', pushBlock, /^      - feat\/m8-domain-operations-v4\s*$/m);
  forbidPattern('push obsolete M7 branch target', pushBlock, /^      - feat\/m7-server-account-deletion\s*$/m);
}

const permissionDeclarations = workflow.match(/^\s*permissions\s*:/gm) ?? [];
if (permissionDeclarations.length !== 2) {
  failures.push(`repository permissions: expected default + CodeQL declarations, found ${permissionDeclarations.length}`);
}
requirePattern('default read-only permissions', workflow, /^permissions:\s*\n  contents: read\s*$/m);
requirePattern('CodeQL scoped security-events permission', workflow, /^      security-events: write\s*$/m);
requirePattern('concurrency cancellation', workflow, /^  cancel-in-progress: true\s*$/m);
requirePattern('matrix fail-fast disabled', workflow, /^      fail-fast: false\s*$/m);
requirePattern('Ubuntu 24.04 shard runner', workflow, /^    runs-on: ubuntu-24\.04\s*$/m);
requirePattern('checkout action pin', workflow, /^        uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\s*$/m);
requirePattern('full checkout history', workflow, /^          fetch-depth: 0\s*$/m);
const checkoutCredentialGuards = workflow.match(/^          persist-credentials: false\s*$/gm) ?? [];
if (checkoutCredentialGuards.length !== 2) failures.push(`checkout credential persistence: expected two disabled checkout credentials, found ${checkoutCredentialGuards.length}`);
requirePattern('Node setup action pin', workflow, /^        uses: actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7\s*$/m);
requirePattern('Node 24 runtime', workflow, /^          node-version: ['"]?24['"]?\s*$/m);
requirePattern('npm cache', workflow, /^          cache: npm\s*$/m);
requirePattern('dependency install', workflow, /^        run: npm ci\s*$/m);
requirePattern('failure artifact action pin', workflow, /^        uses: actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7\s*$/m);
requirePattern('exact event SHA binding', workflow, /^      EXPECTED_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}\s*$/m);
requirePattern('Gitleaks event base binding', workflow, /^      GITLEAKS_BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.before \}\}\s*$/m);
requirePattern('exact checkout ref', workflow, /^          ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}\s*$/m);
requirePattern('runtime SHA read', workflow, /^          actual_sha="\$\(git rev-parse HEAD\)"\s*$/m);
requirePattern('runtime SHA comparison', workflow, /^          if \[ "\$\{actual_sha\}" != "\$\{EXPECTED_SHA\}" \]; then\s*$/m);
const actualShaAssignments = workflow.match(/^\s*actual_sha=/gm) ?? [];
if (actualShaAssignments.length !== 2) failures.push(`runtime SHA guard: expected shard + CodeQL assignments, found ${actualShaAssignments.length}`);
requirePattern('conditional Java setup', workflow, /^        if: matrix\.java == true\s*$/m);
requirePattern('Java setup action pin', workflow, /^        uses: actions\/setup-java@de7274f081f381c8f8158605e0321c36c376e2e6 # v6\s*$/m);
requirePattern('Temurin distribution', workflow, /^          distribution: temurin\s*$/m);
requirePattern('Java 21 runtime', workflow, /^          java-version: ['"]?21['"]?\s*$/m);
requirePattern('conditional Playwright setup', workflow, /^        if: matrix\.playwright == true\s*$/m);
requirePattern('Playwright Chromium and WebKit install', workflow, /^        run: npx playwright install --with-deps chromium webkit\s*$/m);
requirePattern('matrix command execution', workflow, /^          \$\{\{ matrix\.command \}\} 2>&1 \| tee "verification-\$\{\{ matrix\.id \}\}\.log"\s*$/m);
requirePattern('CodeQL job', workflow, /^  codeql:\s*$/m);
requirePattern('CodeQL JavaScript-TypeScript language', workflow, /^          languages: javascript-typescript\s*$/m);
requirePattern('CodeQL extended security queries', workflow, /^          queries: security-extended\s*$/m);
requirePattern('CodeQL init action pin', workflow, /^        uses: github\/codeql-action\/init@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2 # v4\s*$/m);
requirePattern('CodeQL analyze action pin', workflow, /^        uses: github\/codeql-action\/analyze@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2 # v4\s*$/m);

const allowedIfLines = new Set([
  'if: matrix.java == true',
  'if: matrix.playwright == true',
  'if: failure()',
  'if: ${{ always() }}',
]);
for (const line of workflow.match(/^\s+if:\s*.+$/gm) ?? []) {
  const normalized = line.trim();
  if (!allowedIfLines.has(normalized)) failures.push(`unexpected conditional gate: ${normalized}`);
}

const includeMatch = workflow.match(/^        include:\s*\n([\s\S]*?)(?=^    env:)/m);
if (!includeMatch) {
  failures.push('parallel matrix: include block missing');
} else {
  const shardBlocks = includeMatch[1].trim().split(/\n(?=          - id: )/);
  const shards = shardBlocks.map(block => {
    const id = block.match(/^- id: ([A-Za-z0-9-]+)/)?.[1] ?? block.match(/^          - id: ([A-Za-z0-9-]+)/)?.[1];
    const command = block.match(/^            command: "([^"]+)"\s*$/m)?.[1];
    const java = block.match(/^            java: (true|false)\s*$/m)?.[1];
    const playwright = block.match(/^            playwright: (true|false)\s*$/m)?.[1];
    return { id, command, java, playwright };
  });

  const expectedIds = ['core', 'unit-1', 'unit-2', 'hardening-stress', 'rules', 'e2e', 'm7-m8'];
  const ids = shards.map(shard => shard.id);
  if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) {
    failures.push(`parallel matrix: expected shard ids ${expectedIds.join(', ')}, got ${ids.join(', ')}`);
  }

  const ciLeaves = [];
  const unitShardCommands = [];
  for (const shard of shards) {
    if (!shard.id || !shard.command || !shard.java || !shard.playwright) {
      failures.push(`parallel matrix: malformed shard ${JSON.stringify(shard)}`);
      continue;
    }
    if (/npm run verify:m\d/.test(shard.command)) {
      failures.push(`${shard.id}: shard must use leaf commands, not a serial milestone umbrella`);
    }
    for (const part of splitChain(shard.command)) {
      if (part === 'npm audit --audit-level=high' || part === 'npm run test:security-static') continue;
      if (/^npm run test -- --shard=[12]\/2$/.test(part)) {
        unitShardCommands.push(part);
        continue;
      }
      const scriptMatch = part.match(/^npm run ([A-Za-z0-9:_-]+)$/);
      if (scriptMatch && packageJson.scripts?.[scriptMatch[1]]) {
        ciLeaves.push(...expandScript(scriptMatch[1]));
      } else {
        ciLeaves.push(part);
      }
    }
  }

  const expectedUnitShardCommands = [
    'npm run test -- --shard=1/2',
    'npm run test -- --shard=2/2',
  ];
  if (JSON.stringify([...unitShardCommands].sort()) !== JSON.stringify(expectedUnitShardCommands)) {
    failures.push(`unit suite: expected deterministic 1/2 + 2/2 Vitest shards exactly once, got ${unitShardCommands.join(', ')}`);
  } else {
    ciLeaves.push(...expandScript('test'));
  }

  let canonicalLeaves = [];
  try {
    canonicalLeaves = expandScript('verify:m8');
  } catch (error) {
    failures.push(`package verification expansion failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!sameMultiset(multiset(ciLeaves), multiset(canonicalLeaves))) {
    const missing = canonicalLeaves.filter(item => !ciLeaves.includes(item));
    const extra = ciLeaves.filter(item => !canonicalLeaves.includes(item));
    failures.push(`parallel matrix must be leaf-equivalent to npm run verify:m8; missing=[${missing.join(', ')}], extra=[${extra.join(', ')}]`);
  }

  if (shards.find(shard => shard.id === 'rules')?.java !== 'true') failures.push('rules shard must enable Java');
  if (shards.find(shard => shard.id === 'e2e')?.playwright !== 'true') failures.push('e2e shard must enable Playwright');
  if (shards.filter(shard => shard.java === 'true').map(shard => shard.id).join(',') !== 'rules') failures.push('Java must be limited to the rules shard');
  if (shards.filter(shard => shard.playwright === 'true').map(shard => shard.id).join(',') !== 'e2e') failures.push('Playwright must be limited to the e2e shard');
}

const auditOccurrences = workflow.match(/npm audit --audit-level=high/g) ?? [];
if (auditOccurrences.length !== 1) failures.push(`security audit: expected once, found ${auditOccurrences.length}`);
const staticSecurityOccurrences = workflow.match(/npm run test:security-static/g) ?? [];
if (staticSecurityOccurrences.length !== 1) failures.push(`static security scan: expected once, found ${staticSecurityOccurrences.length}`);

const canonicalNames = workflow.match(/name: ["']Canonical Verification["']/g) ?? [];
if (canonicalNames.length !== 1) failures.push(`canonical aggregate: expected one stable check name, found ${canonicalNames.length}`);
requirePattern('canonical needs verification shards', workflow, /^      - shards\s*$/m);
requirePattern('canonical needs CodeQL', workflow, /^      - codeql\s*$/m);
requirePattern('canonical always evaluates', workflow, /^    if: \$\{\{ always\(\) \}\}\s*$/m);
requirePattern('canonical shard result binding', workflow, /^          SHARD_RESULT: \$\{\{ needs\.shards\.result \}\}\s*$/m);
requirePattern('canonical CodeQL result binding', workflow, /^          CODEQL_RESULT: \$\{\{ needs\.codeql\.result \}\}\s*$/m);
requirePattern('canonical rejects failed shards', workflow, /^          if \[ "\$\{SHARD_RESULT\}" != "success" \]; then\s*$/m);
requirePattern('canonical rejects failed CodeQL', workflow, /^          if \[ "\$\{CODEQL_RESULT\}" != "success" \]; then\s*$/m);

for (const legacy of [
  '.github/workflows/test.yml',
  '.github/workflows/playwright.yml',
  '.github/workflows/m7-lockfile-generator.yml',
  '.github/workflows/m8-consumer-migration.yml',
  '.github/workflows/m8-final-consumer-migration.yml',
  '.github/workflows/m8-core-hardening.yml',
]) {
  if (existsSync(legacy)) failures.push(`legacy/divergent workflow still exists: ${legacy}`);
}

if (failures.length > 0) {
  console.error('M8 CI contract check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('M8 CI contract OK: exact-SHA parallel shards are leaf-equivalent to verify:m8, CodeQL plus the supplemental static-security gate are required, specialized dependencies stay isolated, and Canonical Verification remains the single aggregate gate.');
