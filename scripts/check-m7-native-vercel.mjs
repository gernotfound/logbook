import { existsSync, readFileSync } from 'node:fs';

const failures = [];
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const firebase = JSON.parse(readFileSync('firebase.json', 'utf8'));
const hostingWorkflow = readFileSync('.github/workflows/firebase-hosting-production.yml', 'utf8');
const firestoreWorkflow = readFileSync('.github/workflows/firebase-firestore-production.yml', 'utf8');
const firestoreVerifier = readFileSync('scripts/verify-firestore-production.mjs', 'utf8');
const firestoreProductionState = readFileSync('scripts/firestore-production-state.mjs', 'utf8');
const firestoreIndexes = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'));
const vite = readFileSync('vite.config.ts', 'utf8');
const swSource = readFileSync('src/sw.ts', 'utf8');
const accountApi = readFileSync('api/account-deletion.ts', 'utf8');
const accountClient = readFileSync('src/lib/db/db_account.ts', 'utf8');
const cronApi = readFileSync('api/account-deletion-cron.ts', 'utf8');
const legacyServiceWorkerApi = readFileSync('api/legacy-service-worker.ts', 'utf8');
const vercelBackendBuild = readFileSync('scripts/prepare-vercel-backend-static.mjs', 'utf8');

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
if (!existsSync('api/legacy-service-worker.ts')) failures.push('missing legacy Vercel service-worker retirement endpoint');
if (vercel.functions?.['api/legacy-service-worker.ts']?.maxDuration !== 10) failures.push('api/legacy-service-worker.ts must use the minimal 10s function ceiling');
if (vercel.git?.deploymentEnabled?.main !== true || vercel.git?.deploymentEnabled?.['**'] !== false) failures.push('Vercel Git deployments must remain enabled only for main');
if (vercel.ignoreCommand !== 'node scripts/vercel-ignore-build.mjs') failures.push('Vercel must skip Git deployments that do not change the backend contract');
if (!existsSync('scripts/vercel-ignore-build.mjs')) failures.push('missing Vercel selective deployment guard');
else {
  const vercelIgnoreBuild = readFileSync('scripts/vercel-ignore-build.mjs', 'utf8');
  for (const requiredPath of ['api', 'server', 'vercel.json', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.m7-server.json', 'scripts/prepare-vercel-backend-static.mjs']) {
    if (!vercelIgnoreBuild.includes(`'${requiredPath}'`)) failures.push(`Vercel selective deployment guard missing backend-sensitive path: ${requiredPath}`);
  }
  if (!vercelIgnoreBuild.includes('VERCEL_GIT_PREVIOUS_SHA') || !vercelIgnoreBuild.includes('VERCEL_GIT_COMMIT_SHA')) {
    failures.push('Vercel selective deployment guard must compare against the previous successful deployment SHA');
  }
  if (!vercelIgnoreBuild.includes("process.exit(0)") || !vercelIgnoreBuild.includes("process.exit(1)")) {
    failures.push('Vercel selective deployment guard must skip unchanged frontend-only commits and deploy backend changes');
  }
}
if (vercel.framework !== null) failures.push('Vercel must use the Other framework preset so Production is backend-only instead of rebuilding the Vite frontend');
if (vercel.buildCommand !== 'node scripts/prepare-vercel-backend-static.mjs') failures.push('Vercel must override the project build command with the backend-only static-output preparer');
if (vercel.outputDirectory !== 'vercel-backend-static') failures.push('Vercel must publish only the dedicated backend static output instead of the Vite dist directory');
if (!existsSync('scripts/prepare-vercel-backend-static.mjs')) failures.push('missing Vercel backend-only static-output preparer');
for (const marker of ["const outputDirectory = 'vercel-backend-static'", 'rmSync(outputDirectory', 'mkdirSync(outputDirectory', 'backend-only.txt']) {
  if (!vercelBackendBuild.includes(marker)) failures.push(`Vercel backend-only build preparer missing marker: ${marker}`);
}
if (vercelBackendBuild.includes('npm run build') || vercelBackendBuild.includes('vite build') || vercel.outputDirectory === 'dist') {
  failures.push('Vercel backend deployment must never build or publish the Firebase/Vite frontend');
}
if (vercel.fluid !== true) failures.push('Vercel Fluid compute must be explicitly enabled to preserve the 300s Hobby function ceiling');

const legacyFrontendRedirect = vercel.redirects?.find(item => item.source === '/');
if (!legacyFrontendRedirect) failures.push('missing retired Vercel frontend root redirect');
else {
  if (legacyFrontendRedirect.destination !== 'https://thelogbook.web.app/') failures.push('retired Vercel frontend root must redirect to the Firebase Hosting canonical origin');
  if (legacyFrontendRedirect.statusCode !== 301) failures.push('retired Vercel frontend root redirect must use HTTP 301 for the Search Console Change of Address pre-check');
  if ('permanent' in legacyFrontendRedirect) failures.push('retired Vercel frontend root redirect must use explicit statusCode 301 instead of permanent 307/308 mode');
}

const legacySwRewrite = vercel.rewrites?.find(item => item.source === '/sw.js');
if (legacySwRewrite?.destination !== '/api/legacy-service-worker') {
  failures.push('retired Vercel origin must replace the old PWA worker at /sw.js with the retirement endpoint');
}
const legacySwHeaders = vercel.headers?.find(item => item.source === '/sw.js')?.headers ?? [];
const legacySwCacheControl = legacySwHeaders.find(item => item.key === 'Cache-Control')?.value ?? '';
if (!legacySwCacheControl.includes('no-store') || !legacySwCacheControl.includes('must-revalidate')) {
  failures.push('retired Vercel /sw.js must never be served from a stale browser/CDN cache');
}
if (!legacySwHeaders.some(item => item.key === 'Service-Worker-Allowed' && item.value === '/')) {
  failures.push('retired Vercel /sw.js must preserve root scope while replacing the legacy worker');
}
for (const marker of ['caches.keys()', 'self.clients.claim()', 'self.registration.unregister()', 'self.skipWaiting()']) {
  if (!legacyServiceWorkerApi.includes(marker)) failures.push(`legacy service-worker retirement endpoint missing cleanup marker: ${marker}`);
}
if (!legacyServiceWorkerApi.includes("cacheName.startsWith('workbox-')")) failures.push('legacy service-worker retirement must limit cache cleanup to Workbox caches');
if (legacyServiceWorkerApi.includes('client.navigate(')) failures.push('legacy service-worker retirement must not force-navigate an already open client');
if (legacyServiceWorkerApi.includes('indexedDB') || legacyServiceWorkerApi.includes('localStorage')) failures.push('legacy service-worker retirement must not touch user-data storage');

const deletionCron = vercel.crons?.find(item => item.path === '/api/account-deletion-cron');
if (!deletionCron) failures.push('missing daily account deletion recovery cron');
else if (deletionCron.schedule !== '0 3 * * *') failures.push('account deletion recovery cron must run once daily at 03:00 UTC');

if (!accountApi.includes('const POST_BUDGET_MS = 5_000;')) failures.push('POST deletion budget must remain bounded to 5s for the interactive request');
if (!accountApi.includes('const GET_PROGRESS_BUDGET_MS = 5_000;')) failures.push('GET deletion progress budget must remain bounded to 5s for the interactive request');
if (!accountApi.includes('export async function POST') || !accountApi.includes('export async function GET')) failures.push('account deletion API must expose native POST and GET handlers');
if (accountClient.includes("store/useAppStore")) failures.push('account deletion infrastructure must not import the Zustand store');
if (!accountClient.includes('context.cancelPendingSyncs()') || !accountClient.includes('context.resetStore()')) {
  failures.push('account deletion infrastructure must receive application lifecycle callbacks through its context');
}
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
if (!hostingWorkflow.includes('      - Firebase Firestore Production') || !hostingWorkflow.includes("github.event.workflow_run.event == 'workflow_run'") || !hostingWorkflow.includes("github.event.workflow_run.head_branch == 'main'")) {
  failures.push('Firebase Hosting workflow must activate only after the exact-main Firestore production reconciliation');
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

if (!firestoreWorkflow.includes('    branches:\n      - main') || !firestoreWorkflow.includes("github.event.workflow_run.event == 'push'") || !firestoreWorkflow.includes("github.event.workflow_run.head_branch == 'main'")) {
  failures.push('Firestore Production workflow must only activate after the canonical push-to-main verification run');
}
if (!firestoreWorkflow.includes('git ls-remote --exit-code origin refs/heads/main') || !firestoreWorkflow.includes('Refusing to deploy a stale or mismatched main SHA')) {
  failures.push('Firestore Production workflow must re-check the exact current main SHA without mutating checkout history before any live operation');
}
if (!firestoreWorkflow.includes('GCP_FIRESTORE_DEPLOY_SERVICE_ACCOUNT') || firestoreWorkflow.includes('service_account: ${{ env.GCP_FIREBASE_DEPLOY_SERVICE_ACCOUNT }}')) {
  failures.push('Firestore Production must use a dedicated deployer identity instead of the Hosting service account');
}
if (firestoreWorkflow.includes('git rev-parse "${EXPECTED_SHA}^"') || firestoreWorkflow.includes('git diff --quiet "${parent}"')) {
  failures.push('Firestore Production must not use the immediate parent commit as the deployment baseline');
}
if (!firestoreWorkflow.includes('scripts/verify-firestore-production.mjs status') || !firestoreWorkflow.includes("steps.reconcile.outputs.deploy == 'true'")) {
  failures.push('Firestore Production workflow must reconcile the desired exact-main state against the live provider before deciding to deploy');
}
if (!firestoreWorkflow.includes('firebase-tools@15.30.2 deploy') || !firestoreWorkflow.includes('--only firestore:rules,firestore:indexes') || !firestoreWorkflow.includes('--non-interactive')) {
  failures.push('Firestore Production workflow must use the pinned Firebase CLI and deploy only Rules/indexes');
}
if (firestoreWorkflow.includes('--force')) {
  failures.push('Firestore Production workflow must never force-delete unmanaged indexes');
}
for (const actionPin of requiredHostingActionPins) {
  if (!firestoreWorkflow.includes(actionPin)) failures.push(`Firestore Production workflow must pin privileged action: ${actionPin}`);
}
if (!firestoreWorkflow.includes('scripts/verify-firestore-production.mjs status') || !firestoreWorkflow.includes('scripts/verify-firestore-production.mjs verify')) {
  failures.push('Firestore Production workflow must reconcile and verify the live target');
}
if (!firestoreVerifier.includes("process.exit(10)") || !firestoreVerifier.includes("process.exit(11)")) {
  failures.push('Firestore Production verifier must distinguish deploy-required drift from index convergence');
}
if (!firestoreVerifier.includes('releases/cloud.firestore') || !firestoreVerifier.includes('/indexes') || !firestoreVerifier.includes('Authorization:')) {
  failures.push('Firestore Production verifier must read back authenticated live Rules and composite indexes');
}
if (!firestoreVerifier.includes('/fields') || !firestoreVerifier.includes('fieldOverrideListParent') || !firestoreVerifier.includes('mismatchedFieldOverrides')) {
  failures.push('Firestore Production verifier must read back and compare explicit field exemptions');
}
if (!firestoreProductionState.includes('collectionGroups/-') || !firestoreProductionState.includes('indexConfig.usesAncestorConfig=false OR ttlConfig:*')) {
  failures.push('Firestore Production field exemption readback must use the database-wide explicit-override list scope');
}
if (!firestoreVerifier.includes('/operations') || !firestoreVerifier.includes("filter', 'done:false'") || !firestoreVerifier.includes('pendingFieldOverrides')) {
  failures.push('Firestore Production verifier must distinguish active field-index convergence from stable field exemption drift');
}
if (!firestoreProductionState.includes('indexConfigDeltas') || !firestoreProductionState.includes("changeType === 'REMOVE'")) {
  failures.push('Firestore Production field convergence must be tied to an exact active REMOVE operation');
}
if (!firestoreWorkflow.includes('deadline=$((SECONDS + 2100))') || !firestoreWorkflow.includes('did not converge within 35 minutes')) {
  failures.push('Firestore Production must allow the documented bounded convergence window for field-index operations');
}
const requiredIndexExemptions = ['users', 'history_months', 'nutrition_months', 'sync_control', 'global_catalog'];
for (const collectionGroup of requiredIndexExemptions) {
  const exemption = firestoreIndexes.fieldOverrides?.find(item =>
    item.collectionGroup === collectionGroup
    && item.fieldPath === '*'
    && Array.isArray(item.indexes)
    && item.indexes.length === 0
  );
  if (!exemption) failures.push(`Firestore automatic-index exemption missing for path-read collection group: ${collectionGroup}`);
}
if (!firestoreVerifier.includes("status.state !== 'READY'")) {
  failures.push('Firestore Production verifier must require desired composite indexes to be READY');
}
if (firestoreVerifier.includes("searchParams.set('pageSize'")) {
  failures.push('Firestore Production verifier must not send unsupported pageSize when listing composite indexes');
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
  const requiredBranding = [
    '<title>TheLogBook</title>',
    'name="apple-mobile-web-app-title" content="TheLogBook"',
    'name="description" content="Traccia i tuoi allenamenti, l\'alimentazione e i progressi corporei con TheLogBook."',
    'property="og:title" content="TheLogBook"',
    'property="og:site_name" content="TheLogBook"',
    'property="og:description" content="Traccia i tuoi allenamenti, l\'alimentazione e i progressi corporei con TheLogBook."',
    'property="og:image:alt" content="Icona TheLogBook con stickman chef su sfondo nero"',
    'name="twitter:title" content="TheLogBook"',
    'name="twitter:description" content="Traccia i tuoi allenamenti, l\'alimentazione e i progressi corporei con TheLogBook."',
    'name="twitter:image:alt" content="Icona TheLogBook con stickman chef su sfondo nero"',
    '<h1>TheLogBook</h1>',
  ];
  for (const branding of requiredBranding) {
    if (!builtHtml.includes(branding)) failures.push(`built HTML missing canonical TheLogBook branding: ${branding}`);
  }
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
