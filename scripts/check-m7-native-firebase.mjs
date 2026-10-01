import { existsSync, readFileSync, readdirSync } from 'node:fs';

const failures = [];
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const firebase = JSON.parse(readFileSync('firebase.json', 'utf8'));
const vercelConfig = JSON.parse(readFileSync('vercel.json', 'utf8'));
const functionsPackage = JSON.parse(readFileSync('functions/package.json', 'utf8'));
const functionsLockPath = 'functions/package-lock.json';
const functionsLock = existsSync(functionsLockPath)
  ? JSON.parse(readFileSync(functionsLockPath, 'utf8'))
  : null;
const functionIndex = readFileSync('functions/src/index.ts', 'utf8');
const deletionHttp = readFileSync('functions/src/accountDeletion/http.ts', 'utf8');
const deletionStore = readFileSync('functions/src/accountDeletion/jobStore.ts', 'utf8');
const firestoreRules = readFileSync('firestore.rules', 'utf8');
const adminBootstrap = readFileSync('functions/src/accountDeletion/firebaseAdmin.ts', 'utf8');
const deploymentConfig = readFileSync('src/lib/deploymentConfig.ts', 'utf8');
const firebaseClient = readFileSync('src/lib/firebase.ts', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');
const analyticsSource = readFileSync('src/lib/firebaseAnalytics.ts', 'utf8');
const analyticsSdkSource = readFileSync('src/lib/firebaseAnalyticsSdk.ts', 'utf8');
const analyticsConsentSource = readFileSync('src/lib/analyticsConsent.ts', 'utf8');
const viteConfig = readFileSync('vite.config.ts', 'utf8');
const serviceWorkerSource = readFileSync('src/sw.ts', 'utf8');
const deploymentMetadata = readFileSync('scripts/write-deployment-metadata.mjs', 'utf8');
const firebaseProductionWorkflow = readFileSync('.github/workflows/firebase-production.yml', 'utf8');

const functionConfig = Array.isArray(firebase.functions) ? firebase.functions[0] : firebase.functions;
if (firebase.firestore?.rules !== 'firestore.rules') failures.push('Firestore Rules configuration must be preserved.');
if (functionConfig?.source !== 'functions') failures.push('Firebase Functions source must be functions/.');
if (functionConfig?.runtime !== 'nodejs22') failures.push('Firebase Functions runtime must be Node.js 22.');
if (functionsPackage.engines?.node !== '>=22 <25') failures.push('functions/package.json must support Node 22-24 tooling while firebase.json pins the deployed runtime to Node.js 22.');
if (!functionsPackage.dependencies?.['firebase-admin']) failures.push('Functions must depend on firebase-admin.');
if (!functionsPackage.dependencies?.['firebase-functions']) failures.push('Functions must depend on firebase-functions.');
if (functionsPackage.overrides?.['@grpc/grpc-js'] !== '1.14.5') failures.push('Functions package must explicitly override @grpc/grpc-js to 1.14.5.');
if (functionsPackage.overrides?.['@grpc/proto-loader'] !== '0.8.1') failures.push('Functions package must explicitly override @grpc/proto-loader to 0.8.1.');
if (!functionsLock) {
  failures.push('Functions must commit functions/package-lock.json for reproducible Firebase builds.');
} else {
  if (functionsLock.lockfileVersion !== 3) failures.push('Functions package-lock must use lockfileVersion 3.');
  const lockedPackages = functionsLock.packages ?? {};
  for (const dependency of ['firebase-admin', 'firebase-functions']) {
    const expected = functionsPackage.dependencies?.[dependency];
    const actual = lockedPackages[`node_modules/${dependency}`]?.version;
    if (!expected || actual !== expected) {
      failures.push(`Functions lockfile must pin ${dependency} exactly to package.json (expected ${expected ?? 'missing'}, got ${actual ?? 'missing'}).`);
    }
  }
  if (lockedPackages['node_modules/@grpc/grpc-js']?.version !== '1.14.5') {
    failures.push('Functions lockfile must retain the patched @grpc/grpc-js 1.14.5 dependency.');
  }
  if (lockedPackages['node_modules/@grpc/proto-loader']?.version !== '0.8.1') {
    failures.push('Functions lockfile must retain the patched @grpc/proto-loader 0.8.1 dependency.');
  }
}
if (packageJson.scripts?.['functions:install'] !== 'npm ci --prefix functions --ignore-scripts --no-audit --no-fund') {
  failures.push('Functions install must use npm ci against the committed lockfile.');
}

const hosting = firebase.hosting;
if (hosting?.target !== 'production') failures.push('Firebase Hosting must use the explicit production target.');
if (hosting?.public !== 'dist') failures.push('Firebase Hosting must publish dist/.');
if (!Array.isArray(hosting?.rewrites) || hosting.rewrites.length !== 1 || hosting.rewrites[0]?.destination !== '/index.html') {
  failures.push('Hosting rewrites must contain only the SPA fallback.');
}
if (JSON.stringify(hosting?.rewrites ?? []).includes('function')) {
  failures.push('Account deletion must not use a Hosting-to-Function rewrite (60s Hosting ceiling).');
}

const hostingHeaders = Array.isArray(hosting?.headers) ? hosting.headers : [];
const serializedHeaders = JSON.stringify(hostingHeaders);
for (const requiredHeader of ['Content-Security-Policy','Strict-Transport-Security','X-Content-Type-Options','Referrer-Policy','Permissions-Policy']) {
  if (!serializedHeaders.includes(requiredHeader)) failures.push(`Missing Firebase Hosting security header: ${requiredHeader}`);
}
if (!serializedHeaders.includes('/sw.js') || !serializedHeaders.includes('no-cache')) failures.push('Service worker must be served with no-cache/no-store policy.');
const appRouteHeaders = hostingHeaders.find(item => item?.source === '!/@(assets|__)/**');
if (!JSON.stringify(appRouteHeaders ?? {}).includes('no-cache')) {
  failures.push('All non-fingerprinted app routes must revalidate, including SPA rewrites.');
}
const assetHeaders = hostingHeaders.find(item => item?.source === '/assets/**');
if (!JSON.stringify(assetHeaders ?? {}).includes('immutable')) failures.push('Fingerprint Vite assets must use immutable long-lived caching.');

const globalHeaderGroup = hostingHeaders.find(group => group?.source === '!/__/**');
const cspHeader = Array.isArray(globalHeaderGroup?.headers)
  ? globalHeaderGroup.headers.find(header => header?.key === 'Content-Security-Policy')
  : undefined;
if (!globalHeaderGroup) failures.push('Firebase reserved /__/* endpoints must be excluded from app-level framing/CSP headers.');
const cspValue = String(cspHeader?.value ?? '');
const cspTokens = new Set(cspValue.split(/\s+/).map(token => token.replace(/;$/, '')).filter(Boolean));
const cspDirectives = new Map(
  cspValue
    .split(';')
    .map(directive => directive.trim())
    .filter(Boolean)
    .map(directive => {
      const [name, ...values] = directive.split(/\s+/);
      return [name, new Set(values)];
    }),
);
const requireCspSource = (directive, source, message) => {
  if (!cspDirectives.get(directive)?.has(source)) failures.push(message);
};

requireCspSource(
  'connect-src',
  'https://logbook-function.invalid',
  'Tracked Firebase CSP connect-src must contain the fail-closed Function-origin placeholder.',
);
if (cspTokens.has('https://*.cloudfunctions.net')) {
  failures.push('Tracked Firebase CSP must not allow a wildcard Cloud Functions origin.');
}
if (cspTokens.has('https://*.vercel-scripts.com') || cspTokens.has('https://vitals.vercel-insights.com')) {
  failures.push('Vercel analytics origins must not remain in Firebase CSP.');
}

requireCspSource('script-src', 'https://www.googletagmanager.com', 'Firebase Analytics script-src must allow Google Tag Manager.');
for (const source of ['https://www.googletagmanager.com', 'https://*.google-analytics.com', 'https://*.google.com']) {
  requireCspSource('connect-src', source, `Firebase Analytics connect-src origin missing: ${source}`);
}
for (const source of ['https://www.googletagmanager.com', 'https://*.google-analytics.com']) {
  requireCspSource('img-src', source, `Firebase Analytics img-src origin missing: ${source}`);
}
requireCspSource('img-src', 'https://*.googleusercontent.com', 'Firebase Hosting img-src must allow Google account avatar images.');
if (cspDirectives.get('img-src')?.has('https://*')) {
  failures.push('Firebase Hosting img-src must not allow arbitrary HTTPS image origins.');
}
for (const forbiddenAdsOrigin of ['https://*.g.doubleclick.net', 'https://pagead2.googlesyndication.com', 'https://googleads.g.doubleclick.net']) {
  if (cspTokens.has(forbiddenAdsOrigin)) failures.push(`Google Ads origin must not be allowlisted for analytics-only telemetry: ${forbiddenAdsOrigin}`);
}

if (!/export const accountDeletion = onRequest/.test(functionIndex)) failures.push('Missing Firebase HTTP accountDeletion function.');
if (!/timeoutSeconds:\s*3600/.test(functionIndex)) failures.push('HTTP deletion function must retain long-running capacity.');
if (!/invoker:\s*'public'/.test(functionIndex)) failures.push('Direct browser account-deletion Function must explicitly allow public invocation; Firebase Auth and App Check remain application-layer gates.');
if (!/export const accountDeletionMaintenance = onSchedule/.test(functionIndex)) failures.push('Missing Firebase scheduled maintenance function.');
if (!/timeoutSeconds:\s*1800/.test(functionIndex)) failures.push('Scheduled maintenance timeout must be explicit.');
if (!/maxInstances:\s*1,[\s\S]*?concurrency:\s*1,[\s\S]*?retryCount:\s*3/.test(functionIndex)) failures.push('Scheduled maintenance must serialize invocations.');
if (!/schedule:\s*'0 3 \* \* \*'/.test(functionIndex) || !/timeZone:\s*'Etc\/UTC'/.test(functionIndex)) {
  failures.push('Scheduled maintenance must run daily at 03:00 UTC.');
}
if (!functionIndex.includes("defineString('LOGBOOK_FUNCTION_REGION')")) failures.push('Function region must be deployment-parameterized.');
if (!functionIndex.includes("defineString('LOGBOOK_FUNCTION_SERVICE_ACCOUNT')")) failures.push('Functions must bind a dedicated runtime service account.');
if (!/serviceAccount:\s*runtimeServiceAccount/.test(functionIndex)) failures.push('Both Firebase Functions must use the configured runtime service account.');
if (!functionIndex.includes("defineString('LOGBOOK_ALLOWED_ORIGINS')")) failures.push('Direct HTTP CORS allowlist must be deployment-parameterized.');
if (functionIndex.includes('CRON_SECRET')) failures.push('Scheduled Firebase maintenance must not rely on CRON_SECRET.');
if (!functionIndex.includes("const ALLOWED_METHODS = 'GET, POST, PUT, OPTIONS'")) {
  failures.push('Account deletion HTTP contract must expose preregistration PUT alongside legacy POST/GET.');
}
if (!functionIndex.includes("'x-account-deletion-recovery'")) {
  failures.push('Account deletion CORS contract must allow the recovery proof header.');
}
if (!deletionHttp.includes('handleAccountDeletionPut')
  || !deletionHttp.includes('readDeletionStatusWithRecoveryCredential')
  || !deletionHttp.includes('progressAndReadStatus')) {
  failures.push('Account deletion HTTP boundary must support preregistration and both status proof paths.');
}
const recoveryBranchStart = deletionHttp.indexOf('if (recoveryHeader)');
const receiptProgressStart = deletionHttp.indexOf('progressAndReadStatus');
if (recoveryBranchStart < 0 || receiptProgressStart < recoveryBranchStart) {
  failures.push('Recovery credential GET must remain proof-only and return before receipt-driven progress.');
}
if (!deletionStore.includes("const RECOVERY_COLLECTION = 'account_deletion_recovery'")
  || !deletionStore.includes(".where('nextAttemptAt', '<=', now)")
  || !deletionStore.includes(".where('purgeEligibleAt', '<=', now)")) {
  failures.push('Deletion durability must retain preregistered recovery, due scheduling and explicit retention eligibility.');
}
if (!firestoreRules.match(/match\s+\/account_deletion_recovery\/\{userId\}[\s\S]*?allow\s+read,\s*write:\s*if\s+false;/)) {
  failures.push('Preregistered account deletion recovery credentials must remain server-only in Firestore Rules.');
}

if (!adminBootstrap.includes('return initializeApp();')) {
  failures.push('Firebase Admin must initialize with Application Default Credentials.');
}
for (const forbidden of ['credential: cert(', 'FIREBASE_ADMIN_PROJECT_ID', 'FIREBASE_ADMIN_CLIENT_EMAIL', 'FIREBASE_ADMIN_PRIVATE_KEY']) {
  if (adminBootstrap.includes(forbidden)) failures.push(`Firebase Functions Admin runtime must not contain legacy credential path: ${forbidden}`);
}
if (!firebaseClient.includes('VITE_FIREBASE_MEASUREMENT_ID') || !firebaseClient.includes('measurementId:')) {
  failures.push('Firebase Web config must bind the explicit GA4 measurement ID.');
}
if (!analyticsSdkSource.includes("import('firebase/analytics')") || !analyticsSource.includes('createRetryableLazyLoader')) {
  failures.push('Firebase Analytics must remain retryable and lazy-loaded behind explicit consent.');
}
if (!analyticsSource.includes('setAnalyticsCollectionEnabled') || !analyticsSource.includes('setConsent')) {
  failures.push('Firebase Analytics must implement explicit collection and Consent Mode controls.');
}
if (!analyticsSource.includes('allow_google_signals: false') || !analyticsSource.includes('allow_ad_personalization_signals: false')) {
  failures.push('Firebase Analytics advertising signals/personalization must remain disabled.');
}
for (const deniedConsent of ['functionality_storage', 'personalization_storage', 'security_storage']) {
  if (!analyticsSource.includes(`${deniedConsent}: 'denied'`)) {
    failures.push(`Firebase Analytics non-essential consent must remain denied: ${deniedConsent}.`);
  }
}
if (!analyticsSource.includes('page_location: \`${window.location.origin}${window.location.pathname}\`')) {
  failures.push('Firebase Analytics automatic page views must strip query/hash state from page_location.');
}
if (/\blogEvent\s*\(/.test(analyticsSource) || /setUserId|setUserProperties/.test(analyticsSource)) {
  failures.push('Firebase Analytics must not add custom behavior/health events or user identifiers without a separate reviewed taxonomy.');
}
if (!analyticsConsentSource.includes('logbook_google_analytics_consent_v1') || !analyticsConsentSource.includes('logbook_analytics_consent')) {
  failures.push('Google Analytics consent must use a new provider-specific key and retire the Vercel consent key.');
}
if (!appSource.includes('applyFirebaseAnalyticsConsent') || /@vercel\/(?:analytics|speed-insights)/.test(appSource)) {
  failures.push('App runtime must use Firebase Analytics consent boundary and contain no Vercel analytics SDK.');
}

if (!deploymentConfig.includes('VITE_ACCOUNT_DELETION_API_URL')) failures.push('Client deletion backend must use the configured direct Firebase Function endpoint.');
if (/['"]\/api\/account-deletion['"]/.test(deploymentConfig)) {
  failures.push('Client deletion backend must not retain the removed Vercel /api/account-deletion fallback.');
}
for (const source of [deploymentMetadata, viteConfig, deploymentConfig]) {
  if (/VERCEL_|vercel\.app/i.test(source)) failures.push('Production build/config must not depend on Vercel metadata or origins.');
}
if (vercelConfig?.git?.deploymentEnabled !== false) failures.push('Vercel automatic Git deployments must be disabled after the clean cutover.');
const vercelTopLevelKeys = Object.keys(vercelConfig).filter(key => !['$schema', 'git'].includes(key));
const vercelGitKeys = Object.keys(vercelConfig?.git ?? {}).filter(key => key !== 'deploymentEnabled');
if (vercelTopLevelKeys.length || vercelGitKeys.length) {
  failures.push('vercel.json must remain a deployment-disable guardrail only; Functions, cron, rewrites and headers belong to Firebase.');
}
for (const retiredDirectory of ['api', 'server']) {
  if (existsSync(retiredDirectory)) failures.push(`Retired Vercel server directory must not exist in the Firebase target: ${retiredDirectory}/`);
}
function collectRuntimeFiles(dir) {
  if (!existsSync(dir)) return [];
  const entries = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = `${dir}/${item.name}`;
    if (item.isDirectory()) entries.push(...collectRuntimeFiles(fullPath));
    else if (/\.(?:ts|tsx|js|mjs|json)$/.test(item.name)) entries.push(fullPath);
  }
  return entries;
}
for (const file of [...collectRuntimeFiles('src'), ...collectRuntimeFiles('functions/src')]) {
  const source = readFileSync(file, 'utf8');
  if (/@vercel\/|\/_vercel\/|\bVERCEL_[A-Z0-9_]+\b|vercel\.app/i.test(source)) {
    failures.push(`Vercel runtime dependency remains in ${file}.`);
  }
}
const hasNavigationFallback = serviceWorkerSource.includes('NavigationRoute')
  || serviceWorkerSource.includes('navigateFallback')
  || viteConfig.includes('navigateFallback');
if (hasNavigationFallback && !serviceWorkerSource.includes('/__/') && !viteConfig.includes('/__/')) {
  failures.push('Any service-worker navigation fallback must explicitly exclude Firebase reserved /__/* auth/config endpoints.');
}
if (packageJson.dependencies?.['@vercel/analytics'] || packageJson.dependencies?.['@vercel/speed-insights']) {
  failures.push('Vercel Analytics/Speed Insights must not remain runtime dependencies.');
}

const functionsDeployIndex = firebaseProductionWorkflow.indexOf('name: Deploy Functions first');
const hostingDeployIndex = firebaseProductionWorkflow.indexOf('name: Deploy Hosting second');
if (functionsDeployIndex < 0 || hostingDeployIndex < 0 || functionsDeployIndex >= hostingDeployIndex) {
  failures.push('Firebase Production must deploy backward-compatible Functions before publishing Hosting.');
}
if (!firebaseProductionWorkflow.includes("node-version: '22'")) failures.push('Firebase Production must install/build Functions under Node.js 22.');
if (!firebaseProductionWorkflow.includes('FIREBASE_FUNCTION_SERVICE_ACCOUNT')) failures.push('Firebase Production must provide the dedicated Functions runtime service account.');
if (!firebaseProductionWorkflow.includes('VITE_FIREBASE_FUNCTION_REGION: ${{ vars.FIREBASE_FUNCTION_REGION }}')) {
  failures.push('Firebase Production must bind the client Function region to the deploy region.');
}
if (!firebaseProductionWorkflow.includes('--only functions:accountDeletion,functions:accountDeletionMaintenance') || !firebaseProductionWorkflow.includes('--only hosting')) {
  failures.push('Firebase Production must deploy only the owned account-deletion Functions and Hosting separately.');
}
if (/--only\s+(?:hosting,functions|functions,hosting)/.test(firebaseProductionWorkflow)) {
  failures.push('Firebase Production must not collapse Functions and Hosting into one unordered deploy step.');
}
if (/npx\s+--yes/.test(firebaseProductionWorkflow)) failures.push('Privileged Firebase deploy must not download CLI code through npx.');
for (const pinned of [
  'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
  'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
  'actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f',
  'actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131',
  'google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093',
]) {
  if (!firebaseProductionWorkflow.includes(pinned)) failures.push(`Firebase Production action is not full-SHA pinned: ${pinned}`);
}
const prepareJob = firebaseProductionWorkflow.split(/^  deploy:/m)[0] ?? '';
const deployJob = firebaseProductionWorkflow.split(/^  deploy:/m)[1] ?? '';
if (prepareJob.includes('id-token: write')) failures.push('Firebase release preparation must not receive OIDC token-minting permission.');
if (!deployJob.includes('id-token: write')) failures.push('Only the minimal Firebase deploy job may receive OIDC token-minting permission.');
if (!firebaseProductionWorkflow.includes('Prepare exact-SHA release directory')
  || !firebaseProductionWorkflow.includes('Verify artifact SHA binding')) {
  failures.push('Firebase Production must freeze and verify an exact-SHA release artifact before privileged deployment.');
}
const afterFunctions = firebaseProductionWorkflow.slice(functionsDeployIndex, hostingDeployIndex);
if (/Refusing stale|main advanced.*exit 1/i.test(afterFunctions)) {
  failures.push('Firebase Production must not deliberately abort between Functions and Hosting after the first mutation.');
}
const sentrySecretReferences = firebaseProductionWorkflow.match(/SENTRY_AUTH_TOKEN:\s*\$\{\{ secrets\.SENTRY_AUTH_TOKEN \}\}/g) ?? [];
if (sentrySecretReferences.length !== 2) failures.push('SENTRY_AUTH_TOKEN must be scoped only to Firebase config validation and the Production build.');


for (const output of ['dist/sw.js','dist/manifest.webmanifest','dist/index.html','dist/favicon.ico','dist/social-share.jpg','dist/robots.txt','dist/sitemap.xml']) {
  if (!existsSync(output)) failures.push(`PWA build artifact missing: ${output}`);
}

if (existsSync('dist/sw.js')) {
  const sw = readFileSync('dist/sw.js','utf8');
  if (sw.length < 500) failures.push(`generated service worker is unexpectedly small (${sw.length} bytes)`);
  if (sw.includes('__WB_MANIFEST')) failures.push('generated service worker still contains raw __WB_MANIFEST placeholder');
  if (!sw.includes('index.html')) failures.push('generated service worker does not precache index.html');
  if (!sw.includes('icon-maskable-512.png')) failures.push('generated service worker does not precache the maskable icon');
  if (sw.includes('social-share.jpg')) failures.push('social share card must not be precached by the offline shell');
}

if (existsSync('dist/index.html')) {
  const html=readFileSync('dist/index.html','utf8');
  if (html.includes('__LOGBOOK_PUBLIC_ORIGIN__')) failures.push('built HTML contains unresolved public-origin token');
  if (!/property="og:image" content="https:\/\/[^"]+\/social-share\.jpg\?v=20260929-chef"/.test(html)) {
    failures.push('built HTML must expose an absolute revisioned social share image');
  }
  if (!html.includes('name="twitter:card" content="summary_large_image"')) failures.push('built HTML must request a large social preview card');
  if (!/<link rel="canonical" href="https:\/\/[^"]+\/">/.test(html)) failures.push('built HTML must expose a canonical absolute URL from the deployment origin.');
}

if (existsSync('dist/robots.txt') && /vercel\.app/i.test(readFileSync('dist/robots.txt','utf8'))) failures.push('robots.txt must not reference Vercel.');
if (existsSync('dist/sitemap.xml') && /vercel\.app/i.test(readFileSync('dist/sitemap.xml','utf8'))) failures.push('sitemap.xml must not reference Vercel.');

if (existsSync('dist/manifest.webmanifest')) {
  try {
    const manifest=JSON.parse(readFileSync('dist/manifest.webmanifest','utf8'));
    if (manifest.name !== 'LogBook' || manifest.short_name !== 'LogBook') failures.push('PWA manifest app identity changed unexpectedly.');
    if (manifest.start_url !== '/' || manifest.scope !== '/') failures.push('PWA manifest must remain root-scoped.');
    if (manifest.display !== 'standalone') failures.push('PWA display mode must remain standalone.');
    const icons=Array.isArray(manifest.icons) ? manifest.icons : [];
    if (!icons.some(i => i?.src === 'icon-192.png?v=20260929-chef' && i?.sizes === '192x192')) failures.push('Missing 192x192 PWA icon.');
    if (!icons.some(i => i?.src === 'icon-maskable-512.png?v=20260929-chef' && i?.purpose === 'maskable')) failures.push('Missing dedicated maskable icon.');
  } catch (error) {
    failures.push(`PWA manifest invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length) {
  console.error('M7 Firebase/PWA contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('M7 Firebase/PWA contract OK: Hosting, Functions v2, direct long-running deletion API, scheduled recovery, security headers and PWA invariants preserved.');
