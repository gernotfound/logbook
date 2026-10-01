import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempRoots: string[] = [];
async function put(root: string, relative: string, content = '{}') {
  const target = join(root, relative);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('Firebase exact-SHA release artifact', () => {
  it('freezes compiled deploy inputs and strips repository predeploy hooks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'logbook-firebase-release-'));
    tempRoots.push(root);
    const expectedSha = 'a'.repeat(40);
    await put(root, 'dist/index.html', '<!doctype html>');
    await put(root, 'firestore.rules', 'rules_version = "2";');
    await put(root, 'functions/package.json');
    await put(root, 'functions/package-lock.json');
    await put(root, 'functions/.env', 'LOGBOOK_FUNCTION_REGION=europe-west1\n');
    await put(root, 'functions/lib/index.js', 'export {};\n');
    await put(root, 'functions/node_modules/firebase-functions/package.json');
    await put(root, 'functions/node_modules/firebase-admin/package.json');
    await put(root, 'tools/firebase-deploy/package.json');
    await put(root, 'tools/firebase-deploy/node_modules/firebase-tools/package.json', JSON.stringify({ version: '15.32.0' }));
    await put(root, '.firebase-deploy.json', JSON.stringify({
      functions: { source: 'functions', runtime: 'nodejs22', predeploy: ['npm --prefix functions run build'] },
      hosting: { public: 'dist', site: 'example-site' },
      firestore: { rules: 'firestore.rules' },
    }));

    execFileSync(process.execPath, [resolve(process.cwd(), 'scripts/prepare-firebase-release.mjs')], {
      cwd: root,
      env: { ...process.env, EXPECTED_SHA: expectedSha },
      stdio: 'pipe',
    });

    const frozen = JSON.parse(await readFile(join(root, '.firebase-release/firebase.json'), 'utf8'));
    expect(frozen.functions.predeploy).toBeUndefined();
    expect(frozen.functions.source).toBe('functions');
    expect(frozen.hosting.site).toBe('example-site');
    expect(await readFile(join(root, '.firebase-release/verified-sha.txt'), 'utf8')).toBe(expectedSha + '\n');
  });
});
