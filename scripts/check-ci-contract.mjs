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

requireText('PR trigger', 'pull_request:');
requireText('main target', '- main');
requireText('milestone integration target', '- feat/ui-workout-guest-flow');
forbidText('privileged PR trigger', 'pull_request_target');
requireText('read-only repository permission', 'permissions:\n  contents: read');
requireText('exact PR-head checkout', 'ref: ${{ github.event.pull_request.head.sha || github.sha }}');
requireText('expected SHA binding', 'EXPECTED_SHA: ${{ github.event.pull_request.head.sha || github.sha }}');
requireText('runtime SHA guard', 'git rev-parse HEAD');
requireText('canonical M6 gate', 'npm run verify:m6');
requireText('concurrency cancellation', 'cancel-in-progress: true');
requireText('explicit Java setup', 'actions/setup-java@v6');
requireText('Playwright Chromium install', 'npx playwright install --with-deps chromium');

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

console.log('M6 CI contract OK: exact-head checkout, canonical gate, triggers, permissions and legacy-workflow removal verified.');
