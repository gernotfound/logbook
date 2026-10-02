import { existsSync, readFileSync } from 'node:fs';

const failures = [];
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const firebase = JSON.parse(readFileSync('firebase.json', 'utf8'));
const hostingWorkflow = readFileSync('.github/workflows/firebase-hosting-production.yml', 'utf8');
const vite = readFileSync('vite.config.ts', 'utf8');
const swSource = readFileSync('src/sw.ts', 'utf8');
const accountApi = readFileSync('api/account-deletion.ts', 'utf8');
const cronApi = readFileSync('api/account-deletion-cron.ts', 'utf8');

const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
for (const forbidden of ['nitro', 'workflow']) {
  if (allDeps[forbidden]) failures.push(`forbidden M7 dependency present: ${forbidden}`);
}
if (/workflow\/vite|nitro\/vite|\bnitro\s*\(/.test(vite)) failures.push('vite.config.ts must remain a plain Vite/PWA configuration without Nitro/Workflow');
if (!swSource.includes("createHandlerBoundToURL('/index.html')") || !swSource.includes('new NavigationRoute(')) failures.push('service worker must route document navigations to the precached SPA shell');
if (!swSource.includes("{ denylist: [/^\\/__\\//] }")) failures.push('service worker SPA navigation fallback must exclude Firebase /__/ helpers');
if (!packageJson.dependencies?.['firebase-admin']) failures.push('firebase-admin must be a runtime dependency for native Vercel Functions');
if (packageJson.devDependencies?.['firebase-admin']) failures.push('firebase-admin must not remain dev-only');

for (const path of ['api/account-deletion.ts', 'api/account-deletion-cron.ts']) {
  if (!existsSync(path)) failures.push(`missing native Vercel Function: ${path}`);
  if (vercel.functions?.[path]?.maxDuration !== 300) failures.push(`${path} must have maxDuration 300`);
}
if (!existsSync('api/account-deletion-device.ts')) failures.push('missing native Vercel Function: api/account-deletion-device.ts');
if (vercel.functions?.['api/account-deletion-device.ts']?.maxDuration !== 30) failures.push('api/account-deletion-device.ts must have maxDuration 30');
if (vercel.git?.deploymentEnabled?.main !== true || vercel.git?.deploymentEnabled?.['**'] !== false) failures.push('Vercel Git deployments must remain enabled only for main');
if (vercel.framework !== null) failures.push('Vercel must use the Other framework preset so Production is backend-only instead of rebuilding the Vite frontend');
if (vercel.fluid !== true) failures.push('Vercel Fluid compute must be explicitly enabled to preserve the 300s Hobby function ceiling');

const deletionCron = vercel.crons?.find(item => item.path === '/api/account-deletion-cron');
if (!deletionCron) failures.push('missing daily account deletion recovery cron');
else if (deletionCron.schedule !== '0 3 * * *') failures.push('account deletion recovery cron must run once daily at 03:00 UTC');

if (!accountApi.includes('const POST_BUDGET_MS = 275_000;')) failures.push('POST deletion budget must remain below the 300s platform ceiling');
if (!accountApi.includes('export async function POST') || !accountApi.includes('export async function GET')) failures.push('account deletion API must expose native POST and GET handlers');
if (!cronApi.includes('CRON_SECRET')) failures.push('cron endpoint must require CRON_SECRET');
const hostingSecurityHeaders = firebase.hosting?.headers?.find(item => item.source === '/**')?.headers ?? [];
const csp = hostingSecurityHeaders.find(item => item.key === 'Content-Security-Policy')?.value ?? '';
for (const source of ['/', '/index.html', '/manifest.webmanifest', '/sw.js']) {
  const rule = firebase.hosting?.headers?.find(item => item.source === source)?.headers ?? [];
  const cacheControl = rule.find(item => item.key === 'Cache-Control')?.value ?? '';
  if (!cacheControl.includes('no-cache') || !cacheControl.includes('no-store') || !cacheControl.includes('must-revalidate')) {
    failures.push(`Firebase Hosting ${source} must explicitly disable caching/revalidate to prevent a stale app shell`);
  }
}
const requiredCspOrigins = [
  'https://apis.google.com',
  'https://lh3.googleusercontent.com',
];
for (const origin of requiredCspOrigins) {
  if (!csp.includes(origin)) failures.push(`Firebase Hosting CSP missing required Auth/UI origin: ${origin}`);
}
const requiredConnectOrigins = [
  'https://firestore.googleapis.com',
  'https://identitytoolkit.googleapis.com',
  'https://securetoken.googleapis.com',
  'https://www.googleapis.com',
  'https://content-firebaseappcheck.googleapis.com',
  'https://firebaseappcheck.googleapis.com',
  'https://firebaseinstallations.googleapis.com',
  'https://firebase.googleapis.com',
  'https://apis.google.com',
  'https://www.google-analytics.com',
  'https://region1.google-analytics.com',
  'https://logbook-gnf.vercel.app',
];
if (csp.includes('*.googleapis.com')) failures.push('Firebase Hosting CSP must not use a broad googleapis wildcard');
for (const origin of requiredConnectOrigins) {
  if (!csp.includes(origin)) failures.push(`Firebase Hosting CSP missing required connect origin: ${origin}`);
}
if (!hostingWorkflow.includes("github.event.workflow_run.event == 'push'") || !hostingWorkflow.includes("github.event.workflow_run.head_branch == 'main'")) {
  failures.push('Firebase Hosting workflow must only activate after the canonical push-to-main verification run');
}
if (!hostingWorkflow.includes('git rev-parse origin/main') || !hostingWorkflow.includes('firebase-tools@15.30.2 deploy --only hosting')) {
  failures.push('Firebase Hosting workflow must re-check exact main and deploy only Hosting with the pinned CLI');
}
if (!hostingWorkflow.includes('thelogbook-index-headers.txt') || !hostingWorkflow.includes("^cache-control: .*no-cache.*no-store.*must-revalidate")) {
  failures.push('Firebase Hosting post-deploy smoke must verify app-shell cache revalidation');
}
const requiredHostingActionPins = [
  'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7',
  'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7',
  'google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093 # v3',
];
for (const actionPin of requiredHostingActionPins) {
  if (!hostingWorkflow.includes(actionPin)) failures.push(`Firebase Hosting production workflow must pin privileged action: ${actionPin}`);
}
if (!hostingWorkflow.includes('GCP_WORKLOAD_IDENTITY_PROVIDER')) {
  failures.push('Firebase Hosting workflow must use Workload Identity Federation');
}
if (!hostingWorkflow.includes('VITE_FIREBASE_AUTH_DOMAIN') || !hostingWorkflow.includes('thelogbook.web.app')) {
  failures.push('Firebase Hosting production workflow must enforce the Firebase Hosting origin as authDomain');
}

if (!vite.includes("process.env.FIREBASE_HOSTING_DEPLOY === 'production'")) failures.push('Sentry production source-map build must be bound to Firebase Hosting production');
if (vite.includes("process.env.VERCEL_ENV === 'production'")) failures.push('Vercel backend deployments must not trigger frontend Sentry source-map builds');

for (const output of ['dist/sw.js', 'dist/manifest.webmanifest', 'dist/index.html', 'dist/favicon.ico', 'dist/social-share.jpg']) {
  if (!existsSync(output)) failures.push(`PWA build artifact missing after verify:m6 build: ${output}`);
}

if (existsSync('dist/sw.js')) {
  const sw = readFileSync('dist/sw.js', 'utf8');
  if (sw.length < 500) failures.push(`generated service worker is unexpectedly small (${sw.length} bytes)`);
  if (sw.includes('__WB_MANIFEST')) failures.push('generated service worker still contains raw __WB_MANIFEST placeholder');
  if (!sw.includes('index.html')) failures.push('generated service worker does not include index.html in its precache payload');
  if (!sw.includes('icon-maskable-512.png')) failures.push('generated service worker does not precache the dedicated maskable icon');
  if (sw.includes('social-share.jpg')) failures.push('social share card should not be precached by the offline app shell');
}

if (existsSync('dist/index.html')) {
  const builtHtml = readFileSync('dist/index.html', 'utf8');
  if (!builtHtml.includes('https://thelogbook.web.app/social-share.jpg?v=20260929-chef')) failures.push('built HTML must expose the revisioned social share card URL');
  if (!builtHtml.includes('name="twitter:card" content="summary_large_image"')) failures.push('built HTML must request a large Twitter/social preview card');
  if (!builtHtml.includes('apple-touch-icon.png?v=20260929-chef')) failures.push('built HTML must revision the Apple touch icon URL');
  if (!builtHtml.includes('favicon.png?v=20260929-chef')) failures.push('built HTML must revision the PNG favicon URL');
  if (!builtHtml.includes('favicon.ico?v=20260929-chef')) failures.push('built HTML must expose the ICO favicon fallback');
}

if (existsSync('dist/manifest.webmanifest')) {
  try {
    const manifest = JSON.parse(readFileSync('dist/manifest.webmanifest', 'utf8'));
    if (manifest.name !== 'TheLogBook') failures.push(`PWA manifest name changed: ${String(manifest.name)}`);
    if (manifest.short_name !== 'TheLogBook') failures.push(`PWA manifest short_name changed: ${String(manifest.short_name)}`);
    if (manifest.start_url !== '/') failures.push(`PWA manifest start_url changed: ${String(manifest.start_url)}`);
    if (manifest.scope !== '/') failures.push(`PWA manifest scope changed: ${String(manifest.scope)}`);
    if (manifest.display !== 'standalone') failures.push(`PWA manifest display changed: ${String(manifest.display)}`);
    if ('orientation' in manifest) failures.push('PWA manifest must not lock the app to a single screen orientation');
    if ('display_override' in manifest) failures.push('PWA manifest must not request desktop display overrides');

    const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
    const hasStandard192 = icons.some(icon => icon?.src === 'icon-192.png?v=20260929-chef' && icon?.sizes === '192x192' && icon?.type === 'image/png');
    const standard512Icons = icons.filter(icon => icon?.src === 'icon-512.png?v=20260929-chef' && icon?.sizes === '512x512' && icon?.type === 'image/png' && icon?.purpose !== 'maskable');
    const hasDedicatedMaskable = icons.some(icon => icon?.src === 'icon-maskable-512.png?v=20260929-chef' && icon?.sizes === '512x512' && icon?.type === 'image/png' && icon?.purpose === 'maskable');
    if (!hasStandard192) failures.push('PWA manifest missing standard 192x192 PNG icon');
    if (standard512Icons.length !== 1) failures.push(`PWA manifest must contain exactly one standard 512x512 PNG icon; found ${standard512Icons.length}`);
    if (!hasDedicatedMaskable) failures.push('PWA manifest missing dedicated 512x512 maskable PNG icon');
  } catch (error) {
    failures.push(`PWA manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length) {
  console.error('M7 hybrid Firebase Hosting/Vercel backend contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('M7 hybrid Firebase Hosting/Vercel backend contract OK: mobile standalone manifest, Firebase-only production frontend build, SW precache, icons/scope, main-only native Functions and daily recovery preserved.');
