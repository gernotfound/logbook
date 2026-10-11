import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import ts from 'typescript';

const projectConfigs = ['tsconfig.m5-tests.json', 'tsconfig.m7-server.json'];
const root = process.cwd();
const trackedTypeScriptFiles = execFileSync('git', ['ls-files', '-z'], { cwd: root })
  .toString('utf8')
  .split('\0')
  .filter(path => /\.(?:ts|tsx|mts|cts)$/.test(path))
  .sort();

const includedFiles = new Set();
const failures = [];

for (const configName of projectConfigs) {
  const diagnostics = [];
  const parsed = ts.getParsedCommandLineOfConfigFile(resolve(root, configName), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: diagnostic => diagnostics.push(diagnostic),
  });

  if (!parsed) {
    failures.push(`${configName}: TypeScript could not read the project configuration`);
  } else {
    diagnostics.push(...parsed.errors);
    for (const file of parsed.fileNames) includedFiles.add(resolve(file));
  }

  for (const diagnostic of diagnostics) {
    failures.push(`${configName}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
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
