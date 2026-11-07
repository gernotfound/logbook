import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { checkMarkdownLinks } from './markdown-links.mjs';
import './markdown-links-regressions.mjs';
import { basename, extname } from 'node:path';
import { TextDecoder } from 'node:util';

function gitText(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

const failures = [];
const status = gitText(['status', '--porcelain=v1', '--untracked-files=all']).trimEnd();
if (status) {
  failures.push(`working tree is not clean:\n${status}`);
}

const tracked = execFileSync('git', ['ls-files', '-z'])
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

const markdownFiles = tracked.filter(path => path.endsWith('.md'));
const linkFailures = checkMarkdownLinks(markdownFiles, {
  read: path => readFileSync(path, 'utf8'),
  exists: path => existsSync(path),
});
if (linkFailures.length) {
  failures.push('broken internal documentation links:' + String.fromCharCode(10) + linkFailures.map(x => '  ' + x).join(String.fromCharCode(10)));
}

const taskSpecificAnalysisArtifacts = tracked.filter(path => (
  /^implementation_plan(?:_.*)?\.md$/.test(path)
  || /^audit_logbook_.*\.md$/.test(path)
  || /^remediation_logbook_.*\.md$/.test(path)
  || path.startsWith('audit-report/')
  || path.startsWith('docs/ai/')
));
if (taskSpecificAnalysisArtifacts.length > 0) {
  failures.push(
    `task-specific analysis artifacts must not be tracked in the final repository:\n${taskSpecificAnalysisArtifacts
      .map(path => `  ${path}`)
      .join('\n')}`,
  );
}

// Tracked files bypass Git ignore. Probe future paths to catch accidental
// omission of project rules and disclosure of local agent/build credentials.
const visiblePaths = [
  '.agents/rules/__new_contract__.md',
  '.agents/rules/nested/__new_contract__.md',
  '.agents/rules/nested/deeper/__new_contract__.md',
  '.env.example',
  '.env.test',
  'AGENTS.md',
  'assets/brand/thelogbook-icon-master.svg',
  'public/appearance.js',
  'src/App.tsx',
];
const ignoredPaths = [
  '.agents/__local_workspace__.md',
  '.agents/workspace/__private__.json',
  '.agents/rules/__private__.json',
  '.agents/rules/nested/__private__.json',
  '.env',
  '.env.production',
  '.env.production.local',
  '.env.preview.local',
  'service-account.json',
  'server/service-account.json',
  'gha-creds-example.json',
  'node_modules/example/index.js',
  'dist/assets/example.js',
  'vercel-backend-static/backend-only.txt',
  'public/icon.svg',
  'public/favicon.ico',
  'public/social-share.png',
  'coverage/mutation-trial/mutation.json',
  'playwright-report/index.html',
  'test-results/example.png',
];
for (const [paths, shouldIgnore] of [[visiblePaths, false], [ignoredPaths, true]]) {
  for (const path of paths) {
    const result = spawnSync('git', ['-c', 'core.excludesFile=', 'check-ignore', '--no-index', '-q', path]);
    if (result.error || (result.status !== 0 && result.status !== 1)) {
      failures.push('Git ignore policy could not be verified for ' + path);
    } else if ((result.status === 0) !== shouldIgnore) {
      failures.push('Git ignore policy unexpectedly ' + (shouldIgnore ? 'tracks ' : 'hides ') + path);
    }
  }
}

const deploymentEnvSnapshots = tracked.filter(path => /^\.env\.(?:production|preview)(?:\.local)?$/.test(path));
if (deploymentEnvSnapshots.length > 0) {
  failures.push(
    `deployment environment snapshots must not be tracked; use .env.example plus provider-managed values:\n${deploymentEnvSnapshots
      .map(path => `  ${path}`)
      .join('\n')}`,
  );
}

// Let Git identify non-binary tracked content, then union that set with known
// repository text formats so explicitly-text files are still checked even if
// their current bytes would make Git's binary heuristic conservative.
const gitDetectedText = new Set(
  execFileSync('git', ['grep', '-I', '-l', '-z', '-e', '', '--'])
    .toString('utf8')
    .split('\0')
    .filter(Boolean),
);

const textExtensions = new Set([
  '.cjs', '.css', '.csv', '.html', '.ini', '.js', '.jsx', '.json', '.md', '.mjs',
  '.properties', '.rules', '.scss', '.svg', '.toml', '.ts', '.tsx', '.txt', '.xml',
  '.yaml', '.yml',
]);
const textBasenames = new Set([
  '.firebaserc', '.gitattributes', '.gitignore', '.snyk', 'Dockerfile', 'LICENSE',
]);

function isKnownTextPath(path) {
  const base = basename(path);
  return base.startsWith('.env') || textBasenames.has(base) || textExtensions.has(extname(base).toLowerCase());
}

const decoder = new TextDecoder('utf-8', { fatal: true });
let checked = 0;
for (const path of tracked.filter(path => gitDetectedText.has(path) || isKnownTextPath(path))) {
  const bytes = readFileSync(path);
  checked += 1;

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    failures.push(`${path}: UTF-8 BOM is not allowed`);
    continue;
  }

  try {
    decoder.decode(bytes);
  } catch {
    failures.push(`${path}: content is not valid UTF-8`);
  }
}

if (failures.length > 0) {
  console.error('M6 repository hygiene check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`M6 repository hygiene OK: clean worktree; ${checked} tracked text files are UTF-8 without BOM; ${markdownFiles.length} Markdown files checked for local links; no task-specific analysis artifacts.`);
