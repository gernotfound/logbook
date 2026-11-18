// Daily, read-only checks of the official GHSA and npm release. A confirmed
// fix creates a tracking issue, never a dependency change, merge or deployment.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ADVISORY = 'GHSA-fc5q-39xc-vjpf';
const ISSUE_TITLE = '[Security] picomatch: replace local GHSA-fc5q-39xc-vjpf backport';
const API = 'https://api.github.com';

const parseStableVersion = value =>
  typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value)
    ? value.split('.').map(Number) : null;

const compareVersions = (a, b) => {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
};

export function selectPublishedFix(advisory) {
  if (advisory?.ghsa_id !== ADVISORY || advisory.withdrawn_at) return null;
  if (!Array.isArray(advisory.vulnerabilities)) throw Error('Incomplete advisory response');
  const patched = advisory.vulnerabilities
    .filter(item => item?.package?.ecosystem === 'npm' && item.package.name === 'picomatch')
    .map(item => item.first_patched_version?.identifier)
    .filter(version => parseStableVersion(version)
      && compareVersions(parseStableVersion(version), [4, 0, 7]) > 0)
    .sort((a, b) => compareVersions(parseStableVersion(a), parseStableVersion(b)));
  return patched[0] ?? null;
}

export function isOfficialPublishedFix(release, version) {
  return release?.name === 'picomatch' && release.version === version
    && typeof release.dist?.integrity === 'string'
    && /^sha512-[A-Za-z0-9+/=]+$/.test(release.dist.integrity)
    && typeof release.dist?.tarball === 'string'
    && release.dist.tarball.startsWith('https://registry.npmjs.org/picomatch/-/');
}

export function issueAlreadyExists(items) {
  return items.some(item => !item.pull_request && item.title === ISSUE_TITLE);
}

async function request(url, token, method = 'GET', body) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'TheLogBook-picomatch-watch',
  };
  if (token) {
    headers.Authorization = 'Bearer ' + token;
    headers['X-GitHub-Api-Version'] = '2022-11-28';
  }
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404 && url.startsWith('https://registry.npmjs.org/')) return null;
  if (!response.ok) throw Error('Upstream API HTTP ' + response.status + ' from ' + new URL(url).host);
  return await response.json();
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (process.env.GITHUB_REF !== 'refs/heads/main' || repo !== 'gernotfound/logbook' || !token) {
    throw Error('Monitor requires main and scoped GitHub Actions token');
  }
  const advisory = await request(API + '/advisories/' + ADVISORY);
  const fixed = selectPublishedFix(advisory);
  if (!fixed) {
    console.log('Official advisory has no stable patched release for the affected line');
    return;
  }
  const release = await request('https://registry.npmjs.org/picomatch/' + fixed);
  if (!release) {
    console.log('Advisory patched version is not yet published to official npm registry');
    return;
  }
  if (!isOfficialPublishedFix(release, fixed)) {
    throw Error('Inconsistent official npm metadata: no issue generated');
  }
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  if (manifest.overrides?.picomatch !== 'file:vendor/picomatch') {
    console.log('Local backport already removed; no issue generated');
    return;
  }

  const query = encodeURIComponent('repo:' + repo +
    ' is:issue in:title "GHSA-fc5q-39xc-vjpf" "picomatch"');
  const search = await request(API + '/search/issues?q=' + query + '&per_page=100', token);
  if (search.incomplete_results || search.total_count > 100 || !Array.isArray(search.items)) {
    throw Error('Incomplete tracking issue search: refusing duplicate creation');
  }
  if (issueAlreadyExists(search.items)) {
    console.log('Tracking issue already exists');
    return;
  }
  const body = [
    'The official GitHub advisory now identifies a fixed stable version that is published to npm.',
    '',
    '- Advisory: https://github.com/advisories/' + ADVISORY,
    '- First patched release (per GitHub advisory): picomatch@' + fixed,
    '- Temporary fork: vendor/picomatch, pinned by the root npm override.',
    '',
    'This is a notification, NOT evidence of safe upgrade or release approval.',
    'Review upstream source and advisories. Remove the fork, override, temporary tests',
    'and monitor once a safe replacement is verified. Regenerate the lockfile and run',
    'npm ci, npm audit --audit-level=high, CodeQL, browser regressions and canonical',
    'exact-SHA CI before merging. Check for additional advisories and API breakage.',
    '',
    'No automatic changes, merges, deployments or Production actions were performed.',
  ].join('\n');
  await request(API + '/repos/' + repo + '/issues', token, 'POST',
    { title: ISSUE_TITLE, body });
  console.log('Created upstream picomatch replacement tracking issue');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error('picomatch monitor failed: ' + error.message);
    process.exitCode = 1;
  });
}
