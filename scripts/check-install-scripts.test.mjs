import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approvedInstallScripts, checkInstallScripts } from './check-install-scripts.mjs';

function expectedLockfile() {
  return {
    lockfileVersion: 3,
    packages: Object.fromEntries(
      Object.entries(approvedInstallScripts).map(([path, version]) => [path, { version, hasInstallScript: true }]),
    ),
  };
}

test('accepts only approved lifecycle scripts at approved versions', () => {
  assert.deepEqual(checkInstallScripts(expectedLockfile()), []);
});

test('rejects a newly introduced install script', () => {
  const lockfile = expectedLockfile();
  lockfile.packages['node_modules/unreviewed'] = { version: '1.0.0', hasInstallScript: true };
  assert.match(checkInstallScripts(lockfile).join('\n'), /Unreviewed lifecycle script/);
});

test('rejects changes to previously approved script versions', () => {
  const lockfile = expectedLockfile();
  lockfile.packages['node_modules/protobufjs'].version = '7.6.6';
  assert.match(checkInstallScripts(lockfile).join('\n'), /version changed/);
});

test('rejects removal of a previously approved script', () => {
  const lockfile = expectedLockfile();
  lockfile.packages['node_modules/protobufjs'].hasInstallScript = false;
  assert.match(checkInstallScripts(lockfile).join('\n'), /no longer present/);
});

test('rejects malformed lockfiles', () => {
  assert.notDeepEqual(checkInstallScripts({ lockfileVersion: 2 }), []);
});
