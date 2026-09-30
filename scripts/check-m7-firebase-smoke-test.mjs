import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
try {
  execFileSync(npm, ['--prefix','functions','run','build'], { stdio:'inherit', shell:process.platform === 'win32' });
} catch {
  console.error('Failed to compile Firebase Functions');
  process.exit(1);
}

const runner = `
import { handleAccountDeletionGet, handleAccountDeletionPost } from './functions/lib/accountDeletion/http.js';

async function run() {
  const getReq = new Request('https://example.test/accountDeletion', {
    method: 'GET',
    headers: {
      'x-account-deletion-uid': 'u',
      'x-account-deletion-receipt': 'A'.repeat(43),
    },
  });
  const getRes = await handleAccountDeletionGet(getReq);
  if (getRes.status !== 403) throw new Error('Expected App Check 403 for unauthenticated GET, got ' + getRes.status);

  const postReq = new Request('https://example.test/accountDeletion', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ receiptToken: 'A'.repeat(43) }),
  });
  const postRes = await handleAccountDeletionPost(postReq);
  if (postRes.status !== 401) throw new Error('Expected Auth 401 for unauthenticated POST, got ' + postRes.status);
}
run().catch(error => { console.error(error); process.exit(1); });
`;
writeFileSync('.firebase-smoke-runner.mjs', runner);

let ok=false;
try {
  execFileSync('node',['.firebase-smoke-runner.mjs'],{stdio:'inherit'});
  console.log('M7 Firebase smoke test passed: compiled HTTP core loads and fails closed before Admin I/O.');
  ok=true;
} finally {
  if (existsSync('.firebase-smoke-runner.mjs')) rmSync('.firebase-smoke-runner.mjs');
  if (!ok) process.exit(1);
}
