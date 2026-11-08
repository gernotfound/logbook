import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { regressionScriptPath } from './verify-main-release-regressions.mjs';
import { checkProductionBuildSecrets } from './check-production-build-secrets.mjs';

const workflowPath = '.github/workflows/verification.yml';
const failures = [];

if (!existsSync(workflowPath)) {
  console.error(`M8 CI contract failed: missing ${workflowPath}`);
  process.exit(1);
}

const workflow = readFileSync(workflowPath, 'utf8');
const hostingWorkflow = readFileSync('.github/workflows/firebase-hosting-production.yml', 'utf8');
const firestoreWorkflow = readFileSync('.github/workflows/firebase-firestore-production.yml', 'utf8');
failures.push(...checkProductionBuildSecrets(hostingWorkflow, firestoreWorkflow));
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const packageLock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const lockedPlaywrightVersion = packageLock.packages?.['node_modules/@playwright/test']?.version;
const nvmrc = existsSync('.nvmrc') ? readFileSync('.nvmrc', 'utf8').trim() : '';
const nodeVersionFile = existsSync('.node-version') ? readFileSync('.node-version', 'utf8').trim() : '';

if (packageJson.engines?.node !== '>=24.11.0 <25') failures.push(`package engines.node: expected >=24.11.0 <25, got ${packageJson.engines?.node ?? 'missing'}`);
if (packageJson.engines?.npm !== '11.x') failures.push(`package engines.npm: expected 11.x, got ${packageJson.engines?.npm ?? 'missing'}`);
if (packageJson.packageManager !== 'npm@11.21.0') failures.push(`packageManager: expected npm@11.21.0, got ${packageJson.packageManager ?? 'missing'}`);
if (nvmrc !== '24') failures.push(`.nvmrc: expected 24, got ${nvmrc || 'missing'}`);
if (nodeVersionFile !== '24') failures.push(`.node-version: expected 24, got ${nodeVersionFile || 'missing'}`);
if (!lockedPlaywrightVersion) failures.push('package-lock: missing node_modules/@playwright/test version');
if (packageJson.scripts?.['lint:type-aware'] !== 'oxlint --config .oxlintrc.type-aware.json') {
  failures.push('lint:type-aware must not use a warning-count threshold; lint:baseline owns reviewed warning drift');
}
if (packageJson.scripts?.['lint:baseline'] !== 'node scripts/check-lint-baseline.mjs') {
  failures.push('lint:baseline: expected node scripts/check-lint-baseline.mjs');
}
if (packageJson.scripts?.['test:quality-guardrails'] !== 'node --test scripts/quality-guardrail-regressions.mjs && node scripts/check-quality-guardrails.mjs') {
  failures.push('test:quality-guardrails: mandatory regression suite and main-relative policy checker missing');
}
if (!packageJson.scripts?.['verify:m6']?.includes('npm run test:quality-guardrails')) {
  failures.push('verify:m6: quality guardrails must run in the canonical verification chain');
}
if (packageJson.scripts?.['test:typecheck-coverage'] !== 'node --test scripts/typecheck-coverage-regressions.mjs && node scripts/check-typecheck-coverage.mjs') {
  failures.push('test:typecheck-coverage must run regressions and check tracked TypeScript files');
}
if (!existsSync('config/lint-warning-baseline.json')) {
  failures.push('lint warning baseline: missing config/lint-warning-baseline.json');
}

// The umbrella gate retains its leaf commands but partitions their discovery.
// Focused test:m7, test:m8 and test:hardening must still execute the dedicated files.
const dedicatedUnitFiles = [
  "tests/logout_protection.test.ts",
  "tests/guest_bootstrap_lifecycle.test.tsx",
  "tests/guest_account_migration_v3.test.tsx",
  "tests/catalog_resolution_pipeline.test.ts",
  "tests/hardening/**/*.test.{ts,tsx}",
  "tests/m7_account_deletion_job_store.test.ts",
  "tests/m7_account_deletion_fairness.test.ts",
  "tests/m7_account_deletion_retention.test.ts",
  "tests/m7_account_deletion_runner.test.ts",
  "tests/m7_account_deletion_api.test.ts",
  "tests/m7_account_deletion_http_auth.test.ts",
  "tests/m7_account_deletion_device.test.ts",
  "tests/m7_account_deletion_cron.test.ts",
  "tests/m8_domain_operations.test.ts"
];
const standardVitest = readFileSync('vitest.config.ts', 'utf8');
const isolatedVitest = readFileSync('vitest.isolated.config.ts', 'utf8');
const dedicatedBlock = standardVitest.match(/const dedicatedSuiteExclusions = process\.env\.npm_lifecycle_event === 'test' \? \[([\s\S]*?)\] : \[\];/);
const actualDedicated = dedicatedBlock ? [...dedicatedBlock[1].matchAll(/'([^']+)'/g)].map(match => match[1]) : [];
if (JSON.stringify(actualDedicated) !== JSON.stringify(dedicatedUnitFiles)
  || !standardVitest.includes('...dedicatedSuiteExclusions')) {
  failures.push('vitest default: dedicated M5/M7/M8 files must be excluded only from npm run test');
}
if (packageJson.scripts?.['test:discovery'] !== 'node --test scripts/test-discovery-regressions.mjs && node scripts/check-test-discovery.mjs') {
  failures.push('test:discovery: real test discovery and negative regressions must run together');
}
if (packageJson.scripts?.['test:coverage:critical'] !== 'node scripts/run-critical-coverage.mjs') {
  failures.push('test:coverage:critical: diagnostic coverage runner missing');
}
if (!packageJson.scripts?.['verify:m6']?.includes('npm run test:discovery') || !packageJson.scripts?.['verify:m6']?.includes('npm run test:coverage:critical')) {
  failures.push('verify:m6 must include discovery and critical coverage leaves');
}
if (packageJson.scripts?.test !== 'vitest run') {
  failures.push('test: canonical general Vitest leaf must remain unmodified');
}
if (packageJson.scripts?.['test:isolated'] !== 'vitest run --config vitest.isolated.config.ts') {
  failures.push('test:isolated canonical leaf must remain unmodified');
}
if (!isolatedVitest.includes("exclude: process.env.npm_lifecycle_event === 'test:isolated' ? ['tests/isolated/m8_domain_commit.test.ts'] : []")) {
  failures.push('vitest isolated: m8_domain_commit must run only in dedicated M8 gate');
}
for (const file of dedicatedUnitFiles.filter(path => path.startsWith('tests/m7_account_deletion_'))) {
  if (!packageJson.scripts?.['test:m7']?.includes(file)) {
    failures.push(`test:m7: missing dedicated file ${file}`);
  }
}
for (const name of ['m8_domain_operations', 'm8_domain_commit']) {
  if (!packageJson.scripts?.['test:m8']?.includes(name)) {
    failures.push(`test:m8: missing dedicated file ${name}`);
  }
}
const hardeningConfig = readFileSync('vitest.hardening.config.ts', 'utf8');
for (const file of dedicatedUnitFiles.filter(path => !path.startsWith('tests/m7_') && !path.startsWith('tests/m8_') && !path.startsWith('tests/hardening/'))) {
  if (!hardeningConfig.includes(`'${file}'`)) failures.push(`test:hardening: missing dedicated file ${file}`);
}
if (!hardeningConfig.includes("'tests/hardening/**/*.test.{ts,tsx}'")) {
  failures.push('test:hardening: missing dedicated nutrition guest flow discovery');
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
if (permissionDeclarations.length !== 3) {
  failures.push(`repository permissions: expected default + CodeQL + read-only release declarations, found ${permissionDeclarations.length}`);
}
requirePattern('default read-only permissions', workflow, /^permissions:\s*\n  contents: read\s*$/m);
requirePattern('CodeQL scoped security-events permission', workflow, /^      security-events: write\s*$/m);
requirePattern('concurrency cancellation', workflow, /^  cancel-in-progress: true\s*$/m);
requirePattern('matrix fail-fast disabled', workflow, /^      fail-fast: false\s*$/m);
requirePattern('Ubuntu 24.04 shard runner', workflow, /^    runs-on: ubuntu-24\.04\s*$/m);
requirePattern('checkout action pin', workflow, /^        uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\s*$/m);
requirePattern('full checkout history', workflow, /^          fetch-depth: 0\s*$/m);
const checkoutCredentialGuards = workflow.match(/^          persist-credentials: false\s*$/gm) ?? [];
if (checkoutCredentialGuards.length !== 4) failures.push(`checkout credential persistence: expected four disabled checkout credentials, found ${checkoutCredentialGuards.length}`);
requirePattern('Node setup action pin', workflow, /^        uses: actions\/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7\s*$/m);
requirePattern('Node 24 runtime', workflow, /^          node-version: ['"]?24['"]?\s*$/m);
requirePattern('npm cache', workflow, /^          cache: npm\s*$/m);
const preinstallReviews = workflow.match(/^      - name: Reject unreviewed dependency install scripts\n        run: node scripts\/check-install-scripts\.mjs$/gm) ?? [];
if (preinstallReviews.length !== 2) failures.push('Missing pre-install lifecycle review in one or more CI jobs');
const dependencyInstalls = workflow.match(/^        run: npm ci\s*$/gm) ?? [];
if (dependencyInstalls.length !== 2) failures.push(`dependency install: expected matrix + E2E npm ci steps, found ${dependencyInstalls.length}`);
requirePattern('failure artifact action pin', workflow, /^        uses: actions\/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7\s*$/m);
requirePattern('exact event SHA binding', workflow, /^      EXPECTED_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}\s*$/m);
requirePattern('Gitleaks event base binding', workflow, /^      GITLEAKS_BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.before \}\}\s*$/m);
requirePattern('trusted quality baseline event binding', workflow, /^      QUALITY_BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \|\| '' \}\}\s*$/m);
requirePattern('exact checkout ref', workflow, /^          ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}\s*$/m);
requirePattern('runtime SHA read', workflow, /^          actual_sha="\$\(git rev-parse HEAD\)"\s*$/m);
requirePattern('container runtime SHA read', workflow, /^          actual_sha="\$\(git -c safe\.directory="\$\{GITHUB_WORKSPACE\}" rev-parse HEAD\)"\s*$/m);
requirePattern('runtime SHA comparison', workflow, /^          if \[ "\$\{actual_sha\}" != "\$\{EXPECTED_SHA\}" \]; then\s*$/m);
const actualShaAssignments = workflow.match(/^\s*actual_sha=/gm) ?? [];
if (actualShaAssignments.length !== 3) failures.push(`runtime SHA guard: expected matrix + E2E + CodeQL assignments, found ${actualShaAssignments.length}`);
requirePattern('release exact checkout', workflow, /^          test "\$\(git rev-parse HEAD\)" = "\$EXPECTED_SHA"\s*$/m);
requirePattern('conditional Java setup', workflow, /^        if: matrix\.java == true\s*$/m);
requirePattern('Java setup action pin', workflow, /^        uses: actions\/setup-java@77dd5b2ce225ea11469928ac317850245a74ae78 # v6.2.0\s*$/m);
requirePattern('Temurin distribution', workflow, /^          distribution: temurin\s*$/m);
requirePattern('Java 21 runtime', workflow, /^          java-version: ['"]?21['"]?\s*$/m);
requirePattern('dedicated Playwright E2E job', workflow, /^  e2e:\s*$/m);
requirePattern('Playwright container IPC sharing', workflow, /^      options: --ipc=host\s*$/m);
requirePattern('E2E matrix complete for both browser projects', workflow, /^  e2e:\n    if: github\.event_name == 'pull_request'\n    name: "Verification \/ Playwright E2E \$\{\{ matrix\.project \}\} \$\{\{ matrix\.shard \}\}\/4"\n    runs-on: ubuntu-24\.04\n    timeout-minutes: 30\n    strategy:\n      fail-fast: false\n      matrix:\n        project: \[chromium, mobile-safari\]\n        shard: \[1, 2, 3, 4\]\s*$/m);
requirePattern('Playwright E2E project sharded execution', workflow, /^          npm run test:e2e -- --project=\$\{\{ matrix\.project \}\} --shard=\$\{\{ matrix\.shard \}\}\/4 2>&1 \| tee "verification-e2e-\$\{\{ matrix\.project \}\}-\$\{\{ matrix\.shard \}\}\.log"\s*$/m);
requirePattern('Playwright unique project and shard artifacts', workflow, /^          name: verification-e2e-\$\{\{ matrix\.project \}\}-\$\{\{ matrix\.shard \}\}-\$\{\{ env\.EXPECTED_SHA \}\}\s*$/m);
requirePattern('Playwright project and shard log retained', workflow, /^            verification-e2e-\$\{\{ matrix\.project \}\}-\$\{\{ matrix\.shard \}\}\.log\s*$/m);
forbidPattern('host Playwright dependency install', workflow, /playwright install --with-deps/);
const playwrightImageMatch = workflow.match(/^      image: mcr\.microsoft\.com\/playwright:v([0-9]+\.[0-9]+\.[0-9]+)-noble\s*$/m);
if (!playwrightImageMatch) {
  failures.push('Playwright E2E container: missing pinned mcr.microsoft.com/playwright:vX.Y.Z-noble image');
} else if (lockedPlaywrightVersion && playwrightImageMatch[1] !== lockedPlaywrightVersion) {
  failures.push(`Playwright E2E container version ${playwrightImageMatch[1]} does not match package-lock @playwright/test ${lockedPlaywrightVersion}`);
}
requirePattern('matrix command execution', workflow, /^          \$\{\{ matrix\.command \}\} 2>&1 \| tee "verification-\$\{\{ matrix\.id \}\}\.log"\s*$/m);
requirePattern('CodeQL job', workflow, /^  codeql:\s*$/m);
requirePattern('CodeQL JavaScript-TypeScript language', workflow, /^          languages: javascript-typescript\s*$/m);
requirePattern('CodeQL extended security queries', workflow, /^          queries: security-extended\s*$/m);
requirePattern('CodeQL init action pin', workflow, /^        uses: github\/codeql-action\/init@33d7b85da1a04171e211befe2c739303b9a4c066 # v4\s*$/m);
requirePattern('CodeQL analyze action pin', workflow, /^        uses: github\/codeql-action\/analyze@33d7b85da1a04171e211befe2c739303b9a4c066 # v4\s*$/m);

const allowedIfLines = new Set([
  "if: github.event_name == 'pull_request'",
  "if: github.event_name == 'push'",
  "if: ${{ always() && github.event_name == 'pull_request' }}",
  'if: matrix.java == true',
  "if: matrix.id == 'core'",
  "if: matrix.id == 'critical-coverage'",
  'if: failure()',
  'if: ${{ always() }}',
]);
for (const line of workflow.match(/^\s+if:\s*.+$/gm) ?? []) {
  const normalized = line.trim();
  if (!allowedIfLines.has(normalized)) failures.push(`unexpected conditional gate: ${normalized}`);
}

const coreOnlyConditions = workflow.match(/^        if: matrix\.id == 'core'\s*$/gm) ?? [];
if (coreOnlyConditions.length !== 2) failures.push('SBOM: exactly two core-only conditions required');
requirePattern('core-only CycloneDX generation', workflow, /^      - name: Generate CycloneDX dependency SBOM\n        if: matrix\.id == 'core'\n        shell: bash\n        run: npm sbom --sbom-format cyclonedx --sbom-type application > sbom\.cdx\.json\s*$/m);
requirePattern('core-only SBOM upload action pin', workflow, /^      - name: Upload dependency SBOM\n        if: matrix\.id == 'core'\n        uses: actions\/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7\s*$/m);

const includeMatch = workflow.match(/^        include:\s*\n([\s\S]*?)(?=^    env:)/m);
if (!includeMatch) {
  failures.push('parallel matrix: include block missing');
} else {
  const shardBlocks = includeMatch[1].trim().split(/\n(?=          - id: )/);
  const shards = shardBlocks.map(block => {
    const id = block.match(/^- id: ([A-Za-z0-9-]+)/)?.[1] ?? block.match(/^          - id: ([A-Za-z0-9-]+)/)?.[1];
    const command = block.match(/^            command: "([^"]+)"\s*$/m)?.[1];
    const java = block.match(/^            java: (true|false)\s*$/m)?.[1];
    return { id, command, java };
  });

  const expectedIds = ['core', 'unit-1', 'unit-2', 'unit-3', 'hardening-stress', 'rules', 'm7-m8', 'critical-coverage'];
  const ids = shards.map(shard => shard.id);
  if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) {
    failures.push(`parallel matrix: expected shard ids ${expectedIds.join(', ')}, got ${ids.join(', ')}`);
  }

  const ciLeaves = [];
  const unitShardCommands = [];
  for (const shard of shards) {
    if (!shard.id || !shard.command || !shard.java) {
      failures.push(`parallel matrix: malformed shard ${JSON.stringify(shard)}`);
      continue;
    }
    if (/npm run verify:m\d/.test(shard.command)) {
      failures.push(`${shard.id}: shard must use leaf commands, not a serial milestone umbrella`);
    }
    for (const part of splitChain(shard.command)) {
      if (part === 'npm audit --audit-level=high' || part === 'npm run test:security-static') continue;
      if (/^npm run test -- --shard=[123]\/3$/.test(part)) {
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
    'npm run test -- --shard=1/3',
    'npm run test -- --shard=2/3',
    'npm run test -- --shard=3/3',
  ];
  if (JSON.stringify([...unitShardCommands].sort()) !== JSON.stringify(expectedUnitShardCommands)) {
    failures.push(`unit suite: expected deterministic 1/3 + 2/3 + 3/3 Vitest shards exactly once, got ${unitShardCommands.join(', ')}`);
  } else {
    ciLeaves.push(...expandScript('test'));
  }

  ciLeaves.push(...expandScript('test:e2e'));

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
  if (shards.filter(shard => shard.java === 'true').map(shard => shard.id).join(',') !== 'rules') failures.push('Java must be limited to the rules shard');
}

const guardOccurrences = workflow.match(/npm run test:quality-guardrails/g) ?? [];
if (guardOccurrences.length !== 1) failures.push(`quality regression gate: expected once in CI matrix, found ${guardOccurrences.length}`);
const coverageOccurrences = workflow.match(/npm run test:typecheck-coverage/g) ?? [];
if (coverageOccurrences.length !== 1) failures.push(`TypeScript coverage gate: expected once, found ${coverageOccurrences.length}`);
const discoveryOccurrences = workflow.match(/npm run test:discovery/g) ?? [];
if (discoveryOccurrences.length !== 1) failures.push('test discovery: expected once in CI core');
const criticalCoverageOccurrences = workflow.match(/npm run test:coverage:critical/g) ?? [];
if (criticalCoverageOccurrences.length !== 1) failures.push('critical coverage: expected once in CI matrix');
requirePattern('critical coverage artifact bound to exact SHA', workflow, /^          name: critical-coverage-\$\{\{ env\.EXPECTED_SHA \}\}\s*$/m);
requirePattern('critical coverage JSON evidence', workflow, /^          path: coverage\/critical\/coverage-summary\.json\s*$/m);
const auditOccurrences = workflow.match(/npm audit --audit-level=high/g) ?? [];
if (auditOccurrences.length !== 1) failures.push(`security audit: expected once, found ${auditOccurrences.length}`);
const staticSecurityOccurrences = workflow.match(/npm run test:security-static/g) ?? [];
if (staticSecurityOccurrences.length !== 1) failures.push(`static security scan: expected once, found ${staticSecurityOccurrences.length}`);
const e2eOccurrences = workflow.match(/npm run test:e2e/g) ?? [];
if (e2eOccurrences.length !== 1) failures.push(`Playwright E2E: expected one dedicated execution, found ${e2eOccurrences.length}`);

const canonicalNames = workflow.match(/name: ["']Canonical Verification["']/g) ?? [];
if (canonicalNames.length !== 1) failures.push(`canonical aggregate: expected one stable check name, found ${canonicalNames.length}`);
requirePattern('canonical needs verification shards', workflow, /^      - shards\s*$/m);
requirePattern('canonical needs Playwright E2E', workflow, /^      - e2e\s*$/m);
requirePattern('canonical needs CodeQL', workflow, /^      - codeql\s*$/m);
requirePattern('canonical PR-only evaluation', workflow, /^    if: \$\{\{ always\(\) && github\.event_name == 'pull_request' \}\}\s*$/m);
requirePattern('canonical shard result binding', workflow, /^          SHARD_RESULT: \$\{\{ needs\.shards\.result \}\}\s*$/m);
requirePattern('canonical E2E result binding', workflow, /^          E2E_RESULT: \$\{\{ needs\.e2e\.result \}\}\s*$/m);
requirePattern('canonical CodeQL result binding', workflow, /^          CODEQL_RESULT: \$\{\{ needs\.codeql\.result \}\}\s*$/m);
requirePattern('canonical rejects failed shards', workflow, /^          if \[ "\$\{SHARD_RESULT\}" != "success" \]; then\s*$/m);
requirePattern('canonical rejects failed E2E', workflow, /^          if \[ "\$\{E2E_RESULT\}" != "success" \]; then\s*$/m);
requirePattern('canonical rejects failed CodeQL', workflow, /^          if \[ "\$\{CODEQL_RESULT\}" != "success" \]; then\s*$/m);


requirePattern('PR-only verification shards', workflow, /^  shards:\n    if: github\.event_name == 'pull_request'\s*$/m);
requirePattern('PR-only E2E', workflow, /^  e2e:\n    if: github\.event_name == 'pull_request'\s*$/m);
requirePattern('main release gate job', workflow, /^  release:\n    name: "Main Release Gate"\n    if: github\.event_name == 'push'\s*$/m);
requirePattern('main release gate script', workflow, /^        run: node scripts\/verify-main-release\.mjs\s*$/m);
requirePattern('release token scope', workflow, /^          GH_TOKEN: \$\{\{ github\.token \}\}\s*$/m);
for (const permission of ['contents', 'actions', 'checks', 'pull-requests']) {
  requirePattern('release permission ' + permission, workflow, new RegExp('^      ' + permission + ': read\\s*$', 'm'));
}
if (!existsSync('scripts/verify-main-release.mjs')) failures.push('missing fail-closed main release attestation script');
if (!existsSync('scripts/verify-main-release-regressions.mjs')) failures.push('missing main release gate regressions');
const releaseGateTests = spawnSync(process.execPath, ['--test', regressionScriptPath], { stdio: 'inherit' });
if (releaseGateTests.status !== 0) failures.push('main release gate regressions failed');

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

console.log('M8 CI contract OK: exact-SHA verification, three unit shards, eight project-isolated Playwright shards, runtime discovery checks and critical coverage are leaf-equivalent to verify:m8; CodeQL and Canonical Verification remain required.');
