import { existsSync, readFileSync } from 'node:fs';

const workflowPath = '.github/workflows/verification.yml';
const failures = [];

if (!existsSync(workflowPath)) {
  console.error(`M6 CI contract failed: missing ${workflowPath}`);
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
  return workflow.match(new RegExp(`^      - name: ${escaped}\\s*\\n([\\s\\S]*?)(?=^      - name:|^$|\\z)`, 'm'))?.[0] ?? '';
}

const pullRequestBlock = workflow.match(/^  pull_request:\s*\n([\s\S]*?)(?=^  (?:push|workflow_dispatch):|^[^\s])/m)?.[1];
if (!pullRequestBlock) {
  failures.push('PR trigger: missing pull_request block under on');
} else {
  requirePattern('PR trigger main target', pullRequestBlock, /^      - main\s*$/m);
  requirePattern(
    'PR trigger integration target',
    pullRequestBlock,
    /^      - feat\/ui-workout-guest-flow\s*$/m,
  );
}

forbidPattern('privileged PR trigger', workflow, /^\s*pull_request_target:\s*$/m);
forbidPattern('secret references', workflow, /\$\{\{\s*secrets\./);
requirePattern('read-only repository permission', workflow, /^permissions:\s*\n  contents: read\s*$/m);
requirePattern('concurrency cancellation', workflow, /^  cancel-in-progress: true\s*$/m);
requirePattern(
  'expected SHA binding',
  workflow,
  /^      EXPECTED_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}\s*$/m,
);

const checkoutStep = stepBlock('Checkout exact event head');
if (!checkoutStep) failures.push('exact PR-head checkout: named checkout step is missing');
else {
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
  requirePattern('runtime SHA read', verifyStep, /^          actual_sha="\$\(git rev-parse HEAD\)"\s*$/m);
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
  requirePattern('security audit command', auditStep, /^        run: npm audit --audit-level=high\s*$/m);
}

const verificationStep = stepBlock('Run canonical M6 verification');
if (!verificationStep) failures.push('canonical M6 gate: named verification step is missing');
else {
  requirePattern(
    'canonical M6 gate command',
    verificationStep,
    /^          npm run verify:m6(?:\s|$)/m,
  );
  requirePattern('pipeline failure propagation', verificationStep, /^          set -o pipefail\s*$/m);
}

for (const legacy of ['.github/workflows/test.yml', '.github/workflows/playwright.yml']) {
  if (existsSync(legacy)) failures.push(`legacy divergent workflow still exists: ${legacy}`);
}

if (packageJson.scripts?.['verify:m6'] !== 'npm run test:repo-hygiene && npm run test:ci-contract && npm run verify:m5') {
  failures.push('package.json verify:m6 must compose repo hygiene, CI contract, then verify:m5 exactly');
}

if (failures.length > 0) {
  console.error('M6 CI contract check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('M6 CI contract OK: active PR targets, exact-head guard, canonical gate, runtime setup, permissions and legacy-workflow removal verified.');
