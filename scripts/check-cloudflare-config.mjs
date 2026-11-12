import { readFileSync } from 'node:fs';

const failures = [];
const wrangler = JSON.parse(readFileSync('cloudflare/wrangler.jsonc', 'utf8'));
const firebase = JSON.parse(readFileSync('firebase.json', 'utf8'));
const headers = readFileSync('cloudflare/_headers', 'utf8');
const vite = readFileSync('vite.config.ts', 'utf8');
const sw = readFileSync('src/sw.ts', 'utf8');
const candidateWorkflow = readFileSync('.github/workflows/cloudflare-candidate.yml', 'utf8');

if (wrangler.main !== './auth-proxy.mjs' || wrangler.assets?.directory !== '../dist' ||
    wrangler.assets?.binding !== 'ASSETS' || wrangler.assets?.not_found_handling !== '404-page' ||
    JSON.stringify(wrangler.assets?.run_worker_first) !== JSON.stringify(['/__/auth', '/__/auth/*'])) {
  failures.push('Wrangler must serve static assets first and invoke only the Firebase Auth proxy explicitly');
}
if (wrangler.workers_dev !== true || wrangler.routes || wrangler.route || wrangler.triggers) {
  failures.push('Candidate must not create custom routes or cron');
}
const baselineHeaders = firebase.hosting?.headers?.find(item => item.source === '/**')?.headers ?? [];
for (const header of baselineHeaders) {
  if (!headers.includes('  ' + header.key + ': ' + header.value)) {
    failures.push('Cloudflare headers must preserve Firebase security header: ' + header.key);
  }
}
for (const path of ['/', '/index.html', '/sw.js', '/manifest.webmanifest', '/appearance.js', '/appearance.css', '/workbox-*.js']) {
  if (!headers.includes(path + '\n  Cache-Control: no-cache, no-store, must-revalidate')) {
    failures.push('No-store policy missing for ' + path);
  }
}
if (!headers.includes('/assets/*\n  Cache-Control: public, max-age=31536000, immutable')) failures.push('Immutable hashed assets required');
if (!headers.includes('X-Robots-Tag: noindex, nofollow')) failures.push('Candidate must not be indexed before authorized cutover');
if (!readFileSync('cloudflare/.assetsignore', 'utf8').split('\n').includes('_headers')) failures.push('Worker must not publicly expose _headers');
if (/Access-Control-Allow-Origin:\s*\*/i.test(headers)) failures.push('Wildcard CORS forbidden');
if (!sw.includes('denylist:') || !sw.includes('__')) failures.push('SW must exclude Firebase helper namespace');
if (!vite.includes('CLOUDFLARE_APP_ORIGIN') || !vite.includes('transformIndexHtml')) {
  failures.push('Canonical HTML must be transformed before PWA precache generation');
}
// The current app routes by root query parameters, not pathname. Absent
// assets and unsupported deep links must fail on the static edge without
// consuming Worker invocations or returning the app shell to module loads.
if (!candidateWorkflow.includes('"${CLOUDFLARE_APP_ORIGIN}/?tab=training"') ||
    !candidateWorkflow.includes('for missing_path in /assets/missing-synthetic.js /assets/missing-synthetic.css /training; do') ||
    !candidateWorkflow.includes('test "${miss_status}" = 404')) {
  failures.push('Cloudflare smoke must cover the real PWA shortcut and strict 404 for absent JS, CSS and pathnames');
}
const mismatchDiagnostics = readFileSync('scripts/cloudflare-asset-mismatch-diagnostics.sh', 'utf8');
if (!candidateWorkflow.includes('cmp -s "${local_file}" /tmp/cloudflare-served-asset ||') ||
    !candidateWorkflow.includes('bash scripts/cloudflare-asset-mismatch-diagnostics.sh') ||
    !candidateWorkflow.includes('"${CLOUDFLARE_APP_ORIGIN}${path}" "${EXPECTED_SHA}" "${initial_http}"') ||
    !mismatchDiagnostics.includes('sha256sum') ||
    !mismatchDiagnostics.includes('--dump-header') ||
    !mismatchDiagnostics.includes('for probe in exact cache-busted; do') ||
    !mismatchDiagnostics.includes('exit 1')) {
  failures.push('Cloudflare byte mismatch must remain a failing gate with bounded SHA-256, HTTP and cache diagnostics');
}
if (failures.length) { for (const problem of failures) console.error(problem); process.exit(1); }
console.log('Cloudflare static assets and Auth proxy configuration contract OK');
