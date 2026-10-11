import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectConfigs = ['tsconfig.m5-tests.json', 'tsconfig.m7-server.json'];
const root = process.cwd();
const compiler = fileURLToPath(new URL('../node_modules/.bin/tsc', import.meta.url));
const trackedTypeScriptFiles = execFileSync('git', ['ls-files', '-z'], { cwd: root })
  .toString('utf8')
  .split('\0')
  .filter(path => /\.(?:ts|tsx|mts|cts)$/.test(path))
  .sort();

const includedFiles = new Set();
const failures = [];

for (const configName of projectConfigs) {
  try {
    // TypeScript 7 exposes the authoritative compiler file list through its CLI,
    // not through the pre-7 JavaScript compiler API.
    const output = execFileSync(compiler, ['--listFilesOnly', '--project', resolve(root, configName)], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });

    for (const file of output.trim().split(/\r?\n/).filter(Boolean)) {
      includedFiles.add(resolve(root, file));
    }
  } catch (error) {
    const detail = String(error.stdout || error.stderr || error.message).trim();
    failures.push(`${configName}: compiler file listing failed: ${detail}`);
  }
}

if (trackedTypeScriptFiles.length === 0) {
  failures.push('Git reports no tracked TypeScript files');
}

const uncoveredFiles = trackedTypeScriptFiles.filter(path => !includedFiles.has(resolve(root, path)));
if (uncoveredFiles.length > 0) {
  failures.push(
    `Tracked TypeScript files outside both typecheck projects:\n${uncoveredFiles
      .map(path => `  ${path}`)
      .join('\n')}`,
  );
}

if (failures.length > 0) {
  console.error('TypeScript coverage check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `TypeScript coverage OK: all ${trackedTypeScriptFiles.length} tracked .ts/.tsx/.mts/.cts files are included in the configured typecheck projects.`,
);
