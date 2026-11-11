import { readFileSync } from 'node:fs';

const failures = [];
const wrangler = JSON.parse(readFileSync('cloudflare/wrangler.jsonc', 'utf8'));
const firebase = JSON.parse(readFileSync('firebase.json', 'utf8'));
const headers = readFileSync('cloudflare/_headers', 'utf8');
const vite = readFileSync('vite.config.ts', 'utf8');
const sw = readFileSync('src/sw.ts', 'utf8');

if (wrangler.main !== './auth-proxy.mjs' || wrangler.assets?.directory !== '../dist' ||
    wrangler.assets?.binding !== 'ASSETS' || wrangler.assets?.not_found_handling !== 'single-page-application' ||
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
if (!readFileSync('cloudflare/.assetsignore', 'utf8').split('\\n').includes('_headers')) failures.push('Worker must not publicly expose _headers');
if (/Access-Control-Allow-Origin:\s*\*/i.test(headers)) failures.push('Wildcard CORS forbidden');
if (!sw.includes('denylist:') || !sw.includes('__')) failures.push('SW must exclude Firebase helper namespace');
if (!vite.includes('CLOUDFLARE_APP_ORIGIN') || !vite.includes('transformIndexHtml')) {
  failures.push('Canonical HTML must be transformed before PWA precache generation');
}
if (failures.length) { for (const problem of failures) console.error(problem); process.exit(1); }
console.log('Cloudflare static assets and Auth proxy configuration contract OK');
