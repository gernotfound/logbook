import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// These packages currently execute install-time code under npm ci. Review every
// lockfile upgrade before changing this explicit versioned approval list.
export const approvedInstallScripts = Object.freeze({
  'node_modules/@firebase/util': '1.15.3',
  'node_modules/@sentry/cli': '2.58.6',
  'node_modules/fsevents': '2.3.3',
  'node_modules/protobufjs': '7.6.5',
});

export function checkInstallScripts(lockfile, manifest = {}) {
  const failures = [];
  for (const name of ['preinstall', 'install', 'postinstall', 'prepublish', 'preprepare', 'prepare', 'postprepare']) {
    if (Object.hasOwn(manifest.scripts ?? {}, name)) {
      failures.push('Unreviewed root npm ci lifecycle hook: ' + name);
    }
  }
  if (lockfile?.lockfileVersion !== 3 || !lockfile.packages) {
    return ['Expected a v3 npm lockfile with a packages map'];
  }

  const found = new Set();
  for (const [path, info] of Object.entries(lockfile.packages)) {
    if (!info?.hasInstallScript) continue;
    found.add(path);
    if (!Object.hasOwn(approvedInstallScripts, path)) {
      failures.push('Unreviewed lifecycle script: ' + path + '@' + (info.version ?? 'unknown'));
      continue;
    }
    if (info.version !== approvedInstallScripts[path]) {
      failures.push('Lifecycle script version changed: ' + path + '@' + (info.version ?? 'unknown'));
    }
  }
  for (const path of Object.keys(approvedInstallScripts)) {
    if (!found.has(path)) failures.push('Approved lifecycle script no longer present: ' + path);
  }
  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = checkInstallScripts(
    JSON.parse(readFileSync('package-lock.json', 'utf8')),
    JSON.parse(readFileSync('package.json', 'utf8')),
  );
  if (failures.length) {
    console.error('npm lifecycle-script review required:\n' + failures.map(issue => '- ' + issue).join('\n'));
    process.exitCode = 1;
  } else {
    console.log('npm lifecycle scripts match the approved package names and locked versions.');
  }
}
