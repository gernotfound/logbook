import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const failures = [];
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const vite = readFileSync('vite.config.ts', 'utf8');
const accountApi = readFileSync('api/account-deletion.ts', 'utf8');
const cronApi = readFileSync('api/account-deletion-cron.ts', 'utf8');

const M6_VITE_BLOB = '230bc894e60ce05a08bfde621cae73625ec812cd';
const currentViteBlob = execFileSync('git', ['hash-object', 'vite.config.ts'], { encoding: 'utf8' }).trim();
if (currentViteBlob !== M6_VITE_BLOB) {
  failures.push(`vite.config.ts changed from validated M6 baseline: expected ${M6_VITE_BLOB}, got ${currentViteBlob}`);
}

const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
for (const forbidden of ['nitro', 'workflow']) {
  if (allDeps[forbidden]) failures.push(`forbidden M7 dependency present: ${forbidden}`);
}
if (/workflow\/vite|nitro\/vite|\bnitro\s*\(/.test(vite)) {
  failures.push('vite.config.ts must remain a plain Vite/PWA configuration without Nitro/Workflow');
}
if (!packageJson.dependencies?.['firebase-admin']) {
  failures.push('firebase-admin must be a runtime dependency for native Vercel Functions');
}
if (packageJson.devDependencies?.['firebase-admin']) {
  failures.push('firebase-admin must not remain dev-only');
}

for (const path of ['api/account-deletion.ts', 'api/account-deletion-cron.ts']) {
  if (!existsSync(path)) failures.push(`missing native Vercel Function: ${path}`);
  if (vercel.functions?.[path]?.maxDuration !== 300) failures.push(`${path} must have maxDuration 300`);
}

const deletionCron = vercel.crons?.find(item => item.path === '/api/account-deletion-cron');
if (!deletionCron) failures.push('missing daily account deletion recovery cron');
else if (deletionCron.schedule !== '0 3 * * *') failures.push('account deletion recovery cron must run once daily at 03:00 UTC');

if (!accountApi.includes('const POST_BUDGET_MS = 275_000;')) failures.push('POST deletion budget must remain below the 300s platform ceiling');
if (!accountApi.includes('export async function POST') || !accountApi.includes('export async function GET')) failures.push('account deletion API must expose native POST and GET handlers');
if (!cronApi.includes('CRON_SECRET')) failures.push('cron endpoint must require CRON_SECRET');

for (const output of ['dist/sw.js', 'dist/manifest.webmanifest']) {
  if (!existsSync(output)) failures.push(`PWA build artifact missing after verify:m6 build: ${output}`);
}

if (existsSync('dist/sw.js')) {
  const sw = readFileSync('dist/sw.js', 'utf8');
  if (sw.length < 500) failures.push(`generated service worker is unexpectedly small (${sw.length} bytes)`);
  if (sw.includes('__WB_MANIFEST')) failures.push('generated service worker still contains raw __WB_MANIFEST placeholder');
  if (!sw.includes('index.html')) failures.push('generated service worker does not include index.html in its precache payload');
}

if (existsSync('dist/manifest.webmanifest')) {
  try {
    const manifest = JSON.parse(readFileSync('dist/manifest.webmanifest', 'utf8'));
    if (manifest.start_url !== '/') failures.push(`PWA manifest start_url changed: ${String(manifest.start_url)}`);
    if (manifest.scope !== '/') failures.push(`PWA manifest scope changed: ${String(manifest.scope)}`);
    if (manifest.display !== 'standalone') failures.push(`PWA manifest display changed: ${String(manifest.display)}`);
  } catch (error) {
    failures.push(`PWA manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length) {
  console.error('M7 native Vercel/PWA contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('M7 native Vercel/PWA contract OK: M6 Vite/PWA config byte-identical, SW precache injected, manifest scope preserved, native Functions bounded to 300s, daily recovery configured.');
