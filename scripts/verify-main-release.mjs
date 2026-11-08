import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = /^[a-f0-9]{40}$/;
const RUN_URL = /^https:\/\/github\.com\/gernotfound\/logbook\/actions\/runs\/([0-9]+)\/job\/[0-9]+$/;

function requireValid(condition, reason) {
  if (!condition) throw new Error('Main release rejected: ' + reason);
}

function isVerifiedBeforeMerge(timestamp, mergedAt) {
  const observed = Date.parse(timestamp);
  const merged = Date.parse(mergedAt);
  return Number.isFinite(observed) && Number.isFinite(merged) && observed <= merged;
}

// The PR's exact file tree must be identical to main, and GitHub must have
// checked the same PR head against the same main parent before squash merge.
export async function verifyMainRelease({ repository, sha, api }) {
  requireValid(repository === 'gernotfound/logbook' && SHA.test(sha), 'unexpected repository or SHA');
  const root = '/repos/' + repository;
  const commit = await api(root + '/commits/' + sha);
  requireValid(commit.sha === sha && commit.parents?.length === 1 && SHA.test(commit.parents[0]?.sha), 'not a single-parent merge commit');
  const parent = commit.parents[0].sha;
  const associated = await api(root + '/commits/' + sha + '/pulls');
  const merged = associated.filter(pr => pr.merged_at && pr.merge_commit_sha === sha);
  requireValid(merged.length === 1, 'commit must identify exactly one merged PR');
  const pr = await api(root + '/pulls/' + merged[0].number);
  requireValid(pr.merged === true && pr.merge_commit_sha === sha && pr.base?.ref === 'main'
    && pr.base?.repo?.full_name === repository && pr.head?.repo?.full_name === repository
    && pr.base?.sha === parent && SHA.test(pr.head?.sha) && pr.merged_at,
    'PR identity, target or verified base mismatch');
  const head = pr.head.sha;
  const candidate = await api(root + '/commits/' + head);
  requireValid(candidate.sha === head && SHA.test(candidate.commit?.tree?.sha)
    && candidate.commit.tree.sha === commit.commit?.tree?.sha,
    'merged file tree differs from PR candidate');

  const checks = await api(root + '/commits/' + head + '/check-runs?check_name=Canonical%20Verification&per_page=100');
  requireValid(Array.isArray(checks.check_runs), 'missing GitHub Checks data');
  const accepted = [];
  for (const check of checks.check_runs) {
    if (check.name !== 'Canonical Verification' || check.app?.id !== 15368
      || check.head_sha !== head || check.status !== 'completed' || check.conclusion !== 'success'
      || !check.check_suite?.id || !isVerifiedBeforeMerge(check.completed_at, pr.merged_at)) continue;
    const match = RUN_URL.exec(check.details_url || '');
    if (!match) continue;
    const run = await api(root + '/actions/runs/' + match[1]);
    if (run.id !== Number(match[1]) || run.check_suite_id !== check.check_suite.id
      || run.name !== 'Milestone Verification' || run.path !== '.github/workflows/verification.yml'
      || run.event !== 'pull_request' || run.head_sha !== head
      || run.head_repository?.full_name !== repository || run.status !== 'completed'
      || run.conclusion !== 'success'
      || !isVerifiedBeforeMerge(run.created_at, pr.merged_at)) continue;
    accepted.push(run.id);
  }
  requireValid(accepted.length > 0, 'no completed trusted PR verification predating the merge');

  const current = await api(root + '/branches/main');
  requireValid(current.commit?.sha === sha, 'main advanced during release attestation');
  return { sha, pr: pr.number, head, parent, tree: candidate.commit.tree.sha, verificationRuns: accepted };
}

async function githubApi(path) {
  const token = process.env.GH_TOKEN;
  requireValid(typeof token === 'string' && token.length > 0, 'missing read-only GitHub token');
  const response = await fetch('https://api.github.com' + path, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('GitHub API verification failed: HTTP ' + response.status);
  return response.json();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyMainRelease({
    repository: process.env.GITHUB_REPOSITORY,
    sha: process.env.EXPECTED_SHA,
    api: githubApi,
  }).then(result => {
    console.log('Main release attested: ' + JSON.stringify(result));
  }).catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
