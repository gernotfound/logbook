import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyMainRelease } from './verify-main-release.mjs';

const repository = 'gernotfound/logbook';
const sha = 'a'.repeat(40);
const parent = 'b'.repeat(40);
const head = 'c'.repeat(40);
const tree = 'd'.repeat(40);
const root = '/repos/' + repository;

function fixture() {
  const responses = new Map([
    [root + '/commits/' + sha, { sha, parents: [{ sha: parent }], commit: { tree: { sha: tree } } }],
    [root + '/commits/' + sha + '/pulls', [{ number: 8, merged_at: '2026-11-04T11:00:00Z', merge_commit_sha: sha }]],
    [root + '/pulls/8', {
      number: 8, merged: true, merged_at: '2026-11-04T11:00:00Z', merge_commit_sha: sha,
      base: { ref: 'main', sha: parent, repo: { full_name: repository } },
      head: { sha: head, repo: { full_name: repository } },
    }],
    [root + '/commits/' + head, { sha: head, commit: { tree: { sha: tree } } }],
    [root + '/commits/' + head + '/check-runs?check_name=Canonical%20Verification&per_page=100', {
      check_runs: [{
        name: 'Canonical Verification', head_sha: head, app: { id: 15368 },
        status: 'completed', conclusion: 'success', check_suite: { id: 55 },
        completed_at: '2026-11-04T10:55:00Z',
        details_url: 'https://github.com/gernotfound/logbook/actions/runs/77/job/88',
      }],
    }],
    [root + '/actions/runs/77', {
      id: 77, check_suite_id: 55, name: 'Milestone Verification',
      path: '.github/workflows/verification.yml', event: 'pull_request',
      head_repository: { full_name: repository }, head_sha: head,
      status: 'completed', conclusion: 'success', created_at: '2026-11-04T10:50:00Z',
    }],
    [root + '/branches/main', { commit: { sha } }],
  ]);
  return {
    responses,
    api: async path => {
      if (!responses.has(path)) throw new Error('Unexpected GitHub API request: ' + path);
      return responses.get(path);
    },
    run: () => verifyMainRelease({ repository, sha, api: async path => {
      if (!responses.has(path)) throw new Error('Unexpected GitHub API request: ' + path);
      return responses.get(path);
    } }),
  };
}

test('attests a completed GitHub PR check and byte-identical squash tree', async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.sha, sha);
  assert.equal(result.pr, 8);
  assert.equal(result.tree, tree);
  assert.deepEqual(result.verificationRuns, [77]);
});

const rejects = [
  ['unassociated direct push', f => f.responses.set(root + '/commits/' + sha + '/pulls', [])],
  ['multiple associated merges', f => f.responses.set(root + '/commits/' + sha + '/pulls',
    [f.responses.get(root + '/commits/' + sha + '/pulls')[0], { number: 9, merged_at: '2026-11-04T11:00:00Z', merge_commit_sha: sha }])],
  ['non-squash merge', f => f.responses.get(root + '/commits/' + sha).parents.push({ sha: 'e'.repeat(40) })],
  ['different base', f => { f.responses.get(root + '/pulls/8').base.sha = 'e'.repeat(40); }],
  ['wrong target', f => { f.responses.get(root + '/pulls/8').base.ref = 'develop'; }],
  ['different file tree', f => { f.responses.get(root + '/commits/' + head).commit.tree.sha = 'e'.repeat(40); }],
  ['no successful PR check', f => { f.responses.get(root + '/commits/' + head + '/check-runs?check_name=Canonical%20Verification&per_page=100').check_runs = []; }],
  ['failed PR check', f => { f.responses.get(root + '/commits/' + head + '/check-runs?check_name=Canonical%20Verification&per_page=100').check_runs[0].conclusion = 'failure'; }],
  ['untrusted check provider', f => { f.responses.get(root + '/commits/' + head + '/check-runs?check_name=Canonical%20Verification&per_page=100').check_runs[0].app.id = 123; }],
  ['post-merge recheck', f => { f.responses.get(root + '/commits/' + head + '/check-runs?check_name=Canonical%20Verification&per_page=100').check_runs[0].completed_at = '2026-11-04T11:05:00Z'; }],
  ['wrong workflow run event', f => { f.responses.get(root + '/actions/runs/77').event = 'push'; }],
  ['wrong workflow file', f => { f.responses.get(root + '/actions/runs/77').path = '.github/workflows/unsafe.yml'; }],
  ['wrong checked head', f => { f.responses.get(root + '/actions/runs/77').head_sha = 'e'.repeat(40); }],
  ['mismatched check suite', f => { f.responses.get(root + '/actions/runs/77').check_suite_id = 44; }],
  ['main advanced', f => { f.responses.get(root + '/branches/main').commit.sha = 'e'.repeat(40); }],
];
for (const [name, mutate] of rejects) {
  test('fail closed: ' + name, async () => {
    const f = fixture();
    mutate(f);
    await assert.rejects(f.run(), /Main release rejected:/);
  });
}
test('fails closed when GitHub API becomes unavailable', async () => {
  const f = fixture();
  f.responses.delete(root + '/actions/runs/77');
  await assert.rejects(f.run(), /Unexpected GitHub API request:/);
});
