import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

const textExtensions = new Set([
  '.cjs', '.css', '.html', '.ini', '.js', '.jsx', '.json', '.md', '.mjs',
  '.properties', '.rules', '.scss', '.toml', '.ts', '.tsx', '.txt', '.xml',
  '.yaml', '.yml',
]);
const textBasenames = new Set([
  '.firebaserc', '.gitattributes', '.gitignore', '.snyk', 'Dockerfile', 'LICENSE',
]);

function isTrackedTextPath(path) {
  const base = basename(path);
  return base.startsWith('.env') || textBasenames.has(base) || textExtensions.has(extname(base).toLowerCase());
}

const decoder = new TextDecoder('utf-8', { fatal: true });
let checked = 0;
for (const path of tracked.filter(isTrackedTextPath)) {
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

console.log(`M6 repository hygiene OK: clean worktree; ${checked} tracked text files are UTF-8 without BOM.`);
