import { existsSync, readFileSync } from 'node:fs';

const workflowPath = '.github/workflows/verification.yml';
const failures = [];

if (!existsSync(workflowPath)) {
  console.error(`M6 CI contract failed: missing ${workflowPath}`);
  process.exit(1);
}

const workflow = readFileSync(workflowPath, 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

function requireText(label, text) {
  if (!workflow.includes(text)) failures.push(`${label}: missing ${JSON.stringify(text)}`);
}

function forbidText(label, text) {
  if (workflow.includes(text)) failures.push(`${label}: forbidden ${JSON.stringify(text)}`);
}

const pullRequestBlock = workflow.match(/^  pull_request:\s*\n([\s\S]*?)(?=^  (?:push|workflow_dispatch):|^[^\s])/m)?.[1];
if (!pullRequestBlock) {
  failures.push('PR trigger: missing pull_request block under on');
} else {
  if (!pullRequestBlock.includes('- main')) failures.push('PR trigger: main target is missing from pull_request branches');
  if (!pullRequestBlock.includes('- feat/ui-workout-guest-flow')) {
    failures.push('PR trigger: feat/ui-workout-guest-flow target is missing from pull_request branches');
  }
}

forbidText('privileged PR trigger', 'pull_request_target');
requireText('read-only repository permission', 'permissions:\n  contents: read');
requireText('exact PR-head checkout', 'ref: ${{ github.event.pull_request.head.sha || github.sha }}');
requireText('expected SHA binding', 'EXPECTED_SHA: ${{ github.event.pull_request.head.sha || github.sha }}');
requireText('runtime SHA read', 'git rev-parse HEAD');
requireText('runtime SHA comparison', 'if [ "${actual_sha}" != "${EXPECTED_SHA}" ]; then');
requireText('canonical M6 gate', 'npm run verify:m6');
requireText('concurrency cancellation', 'cancel-in-progress: true');
requireText('checkout action', 'actions/checkout@v7');
requireText('Node setup', 'actions/setup-node@v7');
requireText('explicit Java setup', 'actions/setup-java@v6');
requireText('Playwright Chromium install', 'npx playwright install --with-deps chromium');
requireText('security audit', 'npm audit --audit-level=high');

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

console.log('M6 CI contract OK: PR targets, exact-head checkout, canonical gate, permissions and legacy-workflow removal verified.');
