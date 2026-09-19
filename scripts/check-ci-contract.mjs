import { existsSync, readFileSync } from 'node:fs';

const workflowPath = '.github/workflows/verification.yml';
const failures = [];

if (!existsSync(workflowPath)) {
  console.error(`M8 CI contract failed: missing ${workflowPath}`);
  process.exit(1);
}

const workflow = readFileSync(workflowPath, 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

function requirePattern(label, source, pattern) {
  if (!pattern.test(source)) failures.push(`${label}: missing active workflow structure matching ${pattern}`);
}

function forbidPattern(label, source, pattern) {
  if (pattern.test(source)) failures.push(`${label}: forbidden active workflow structure matching ${pattern}`);
}

function stepBlock(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return workflow.match(new RegExp(`^      - name: ${escaped}\\s*\\n([\\s\\S]*?)(?=^      - name:|(?![\\s\\S]))`, 'm'))?.[0] ?? '';
}

function forbidCriticalStepBypasses(label, block) {
  forbidPattern(`${label} conditional skip`, block, /^        if\s*:/m);
  forbidPattern(`${label} continue-on-error`, block, /^        continue-on-error\s*:/m);
}

const pullRequestBlock = workflow.match(/^  pull_request:\s*\n([\s\S]*?)(?=^  (?:push|workflow_dispatch):|^[^\s])/m)?.[1];
if (!pullRequestBlock) {
  failures.push('PR trigger: missing pull_request block under on');
} else {
  requirePattern('PR trigger main target', pullRequestBlock, /^      - main\s*$/m);
  forbidPattern('PR trigger obsolete integration target', pullRequestBlock, /^      - feat\/ui-workout-guest-flow\s*$/m);
  forbidPattern('PR trigger event-type filter', pullRequestBlock, /^    types\s*:/m);
  forbidPattern('PR trigger path filter', pullRequestBlock, /^    paths\s*:/m);
  forbidPattern('PR trigger path-ignore filter', pullRequestBlock, /^    paths-ignore\s*:/m);
}

const pushBlock = workflow.match(/^  push:\s*\n([\s\S]*?)(?=^  (?:pull_request|workflow_dispatch):|^[^\s])/m)?.[1];
if (!pushBlock) failures.push('push trigger: missing push block under on');
else {
  requirePattern('push main target', pushBlock, /^      - main\s*$/m);
  forbidPattern('push obsolete M8 branch target', pushBlock, /^      - feat\/m8-domain-operations-v4\s*$/m);
  forbidPattern('push obsolete M7 branch target', pushBlock, /^      - feat\/m7-server-account-deletion\s*$/m);
}

forbidPattern('privileged PR trigger', workflow, /^\s*pull_request_target:\s*$/m);
forbidPattern('secret references', workflow, /\$\{\{\s*secrets\./);
forbidPattern('job-level conditional skip', workflow, /^    if\s*:/m);
forbidPattern('continue-on-error', workflow, /^\s+continue-on-error\s*:/m);

const permissionDeclarations = workflow.match(/^\s*permissions\s*:/gm) ?? [];
if (permissionDeclarations.length !== 1) {
  failures.push(`repository permissions: expected exactly one permissions declaration, found ${permissionDeclarations.length}`);
}
requirePattern(
  'read-only repository permission',
  workflow,
  /^permissions:\s*\n  contents: read\s*\n(?=\S)/m,
);

requirePattern('stable canonical job identity', workflow, /^    name: ["']Canonical Verification["']\s*$/m);
requirePattern('concurrency cancellation', workflow, /^  cancel-in-progress: true\s*$/m);
requirePattern(
  'expected SHA binding',
  workflow,
  /^      EXPECTED_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}\s*$/m,
);

const checkoutStep = stepBlock('Checkout exact event head');
if (!checkoutStep) failures.push('exact PR-head checkout: named checkout step is missing');
else {
  forbidCriticalStepBypasses('exact PR-head checkout', checkoutStep);
  requirePattern('checkout action', checkoutStep, /^        uses: actions\/checkout@v7\s*$/m);
  requirePattern(
    'exact PR-head checkout ref',
    checkoutStep,
    /^          ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}\s*$/m,
  );
  requirePattern('full checkout history', checkoutStep, /^          fetch-depth: 0\s*$/m);
}

const verifyStep = stepBlock('Verify exact checkout');
if (!verifyStep) failures.push('runtime SHA guard: named verification step is missing');
else {
  forbidCriticalStepBypasses('runtime SHA guard', verifyStep);
  forbidPattern('runtime SHA guard step env override', verifyStep, /^        env\s*:/m);
  requirePattern('runtime SHA read', verifyStep, /^          actual_sha="\$\(git rev-parse HEAD\)"\s*$/m);
  const actualShaAssignments = verifyStep.match(/^\s*actual_sha=/gm) ?? [];
  if (actualShaAssignments.length !== 1) {
    failures.push(`runtime SHA guard: expected exactly one actual_sha assignment, found ${actualShaAssignments.length}`);
  }
  forbidPattern('runtime expected SHA reassignment', verifyStep, /^\s*EXPECTED_SHA=/m);
  requirePattern(
    'runtime SHA comparison',
    verifyStep,
    /^          if \[ "\$\{actual_sha\}" != "\$\{EXPECTED_SHA\}" \]; then\s*$/m,
  );
  requirePattern('runtime SHA mismatch failure', verifyStep, /^            exit 1\s*$/m);
}

const nodeStep = stepBlock('Setup Node.js');
if (!nodeStep) failures.push('Node setup: named setup step is missing');
else {
  requirePattern('Node setup action', nodeStep, /^        uses: actions\/setup-node@v7\s*$/m);
  requirePattern('Node 24 runtime', nodeStep, /^          node-version: ['"]?24['"]?\s*$/m);
}

const javaStep = stepBlock('Setup Java for Firebase Emulator');
if (!javaStep) failures.push('Java setup: named setup step is missing');
else {
  requirePattern('Java setup action', javaStep, /^        uses: actions\/setup-java@v6\s*$/m);
  requirePattern('Temurin distribution', javaStep, /^          distribution: temurin\s*$/m);
  requirePattern('Java 21 runtime', javaStep, /^          java-version: ['"]?21['"]?\s*$/m);
}

const playwrightStep = stepBlock('Install Playwright Chromium');
if (!playwrightStep) failures.push('Playwright setup: named install step is missing');
else {
  requirePattern(
    'Playwright Chromium install',
    playwrightStep,
    /^        run: npx playwright install --with-deps chromium\s*$/m,
  );
}

const auditStep = stepBlock('Run security audit');
if (!auditStep) failures.push('security audit: named audit step is missing');
else {
  forbidCriticalStepBypasses('security audit', auditStep);
  requirePattern('security audit command', auditStep, /^        run: npm audit --audit-level=high\s*$/m);
}

const verificationStep = stepBlock('Run canonical M8 verification');
if (!verificationStep) failures.push('canonical M8 gate: named verification step is missing');
else {
  forbidCriticalStepBypasses('canonical M8 gate', verificationStep);
  requirePattern(
    'canonical M8 gate command',
    verificationStep,
    /^          npm run verify:m8 2>&1 \| tee m8-verification\.log\s*$/m,
  );
  requirePattern('pipeline failure propagation', verificationStep, /^          set -o pipefail\s*$/m);
}

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

if (packageJson.scripts?.['verify:m6'] !== 'npm run test:repo-hygiene && npm run test:ci-contract && npm run verify:m5') {
  failures.push('package.json verify:m6 must preserve the validated M6 composition exactly');
}
if (packageJson.scripts?.['verify:m7'] !== 'npm run verify:m6 && npm run test:typecheck:m7 && npm run test:m7 && npm run test:pwa:m7 && npm run test:smoke:m7' && packageJson.scripts?.['verify:m7'] !== 'npm run verify:m6 && npm run test:typecheck:m7 && npm run test:m7 && npm run test:pwa:m7') {
  failures.push('package.json verify:m7 must preserve the validated M7 composition exactly');
}
if (packageJson.scripts?.['verify:m8'] !== 'npm run verify:m7 && npm run test:m8 && npm run test:domain-boundary:m8') {
  failures.push('package.json verify:m8 must compose verify:m7, targeted M8 tests and Domain Operation boundary contract exactly');
}

if (failures.length > 0) {
  console.error('M8 CI contract check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('M8 CI contract OK: main PRs and pushes, exact-head guard, stable Canonical Verification job, canonical M8 gate, transitive M7 contract, failure propagation, read-only permissions and temporary workflow removal verified.');
