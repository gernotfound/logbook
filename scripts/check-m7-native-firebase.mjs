import { existsSync, readFileSync } from 'node:fs';

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
const adminBootstrap = readFileSync('functions/src/accountDeletion/firebaseAdmin.ts', 'utf8');
const deploymentConfig = readFileSync('src/lib/deploymentConfig.ts', 'utf8');
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
const firebaseBridgeHeader = hostingHeaders.find(item => item?.source === '/migration-ready.json');
if (!JSON.stringify(firebaseBridgeHeader ?? {}).includes('no-store')) failures.push('Firebase bridge readiness marker must never be cached.');
const vercelBridgeHeader = (vercelConfig.headers ?? []).find(item => item?.source === '/migration-ready.json');
if (!JSON.stringify(vercelBridgeHeader ?? {}).includes('no-store')) failures.push('Legacy Vercel bridge must expose a no-store readiness marker.');
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
const cspTokens = new Set(String(cspHeader?.value ?? '').split(/\s+/).filter(Boolean));
if (!cspTokens.has('https://*.cloudfunctions.net')) {
  failures.push('CSP connect-src must allow the direct Cloud Functions endpoint.');
}
if (cspTokens.has('https://*.vercel-scripts.com') || cspTokens.has('https://vitals.vercel-insights.com')) {
  failures.push('Vercel analytics origins must not remain in Firebase CSP.');
}

if (!/export const accountDeletion = onRequest/.test(functionIndex)) failures.push('Missing Firebase HTTP accountDeletion function.');
if (!/timeoutSeconds:\s*3600/.test(functionIndex)) failures.push('HTTP deletion function must retain long-running capacity.');
if (!/invoker:\s*'public'/.test(functionIndex)) failures.push('Direct browser account-deletion Function must explicitly allow public invocation; Firebase Auth and App Check remain application-layer gates.');
if (!/export const accountDeletionMaintenance = onSchedule/.test(functionIndex)) failures.push('Missing Firebase scheduled maintenance function.');
if (!/timeoutSeconds:\s*1800/.test(functionIndex)) failures.push('Scheduled maintenance timeout must be explicit.');
if (!/schedule:\s*'0 3 \* \* \*'/.test(functionIndex) || !/timeZone:\s*'Etc\/UTC'/.test(functionIndex)) {
  failures.push('Scheduled maintenance must run daily at 03:00 UTC.');
}
if (!functionIndex.includes("defineString('LOGBOOK_FUNCTION_REGION')")) failures.push('Function region must be deployment-parameterized.');
if (!functionIndex.includes("defineString('LOGBOOK_ALLOWED_ORIGINS')")) failures.push('Direct HTTP CORS allowlist must be deployment-parameterized.');
if (functionIndex.includes('CRON_SECRET')) failures.push('Scheduled Firebase maintenance must not rely on CRON_SECRET.');

if (!adminBootstrap.includes("optionalEnv('FIREBASE_CONFIG')") || !adminBootstrap.includes('return initializeApp();')) {
  failures.push('Firebase-managed runtime must force Application Default Credentials using the automatic FIREBASE_CONFIG boundary.');
}
if (!adminBootstrap.includes('credential: cert(')) failures.push('Legacy Vercel adapter must retain its temporary server-only certificate fallback until Vercel is retired.');
if (!deploymentConfig.includes('VITE_ACCOUNT_DELETION_API_URL')) failures.push('Client deletion backend must be provider-neutral/configurable.');
if (!deploymentMetadata.includes('VERCEL_PROJECT_PRODUCTION_URL')) failures.push('Legacy Vercel bridge build must retain a production-origin fallback for deployment metadata until cutover.');
if (viteConfig.includes('logbook-gnf.vercel.app')) failures.push('Vite config must not hardcode the retired Vercel production origin.');
if (!viteConfig.includes('VERCEL_PROJECT_PRODUCTION_URL')) failures.push('Legacy Vercel build must derive any transitional origin fallback from provider metadata, not a hardcoded hostname.');
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
if (!firebaseProductionWorkflow.includes('--only functions:accountDeletion,functions:accountDeletionMaintenance') || !firebaseProductionWorkflow.includes('--only hosting')) {
  failures.push('Firebase Production must deploy only the owned account-deletion Functions and Hosting separately.');
}
if (/--only\s+(?:hosting,functions|functions,hosting)/.test(firebaseProductionWorkflow)) {
  failures.push('Firebase Production must not collapse Functions and Hosting into one unordered deploy step.');
}
if (!firebaseProductionWorkflow.includes('Require exact legacy bridge build before Hosting')
  || !firebaseProductionWorkflow.includes('/migration-ready.json')
  || !firebaseProductionWorkflow.includes('marker.buildSha === expectedSha')) {
  failures.push('Firebase Hosting cutover must wait for the exact legacy-origin bridge build.');
}
const sentrySecretReferences = firebaseProductionWorkflow.match(/SENTRY_AUTH_TOKEN:\s*\$\{\{ secrets\.SENTRY_AUTH_TOKEN \}\}/g) ?? [];
if (sentrySecretReferences.length !== 2) {
  failures.push('SENTRY_AUTH_TOKEN must be scoped only to Firebase config validation and the Production build.');
}
const jobEnvBeforeSteps = firebaseProductionWorkflow.split(/^    steps:/m)[0] ?? '';
if (jobEnvBeforeSteps.includes('SENTRY_AUTH_TOKEN')) {
  failures.push('SENTRY_AUTH_TOKEN must not be exposed as a job-wide Firebase Production environment variable.');
}

for (const output of ['dist/sw.js','dist/manifest.webmanifest','dist/index.html','dist/favicon.ico','dist/social-share.jpg','dist/robots.txt','dist/sitemap.xml','dist/migration-ready.json']) {
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

if (existsSync('dist/migration-ready.json')) {
  try {
    const marker = JSON.parse(readFileSync('dist/migration-ready.json', 'utf8'));
    if (marker?.version !== 1 || typeof marker?.buildSha !== 'string' || !marker.buildSha) {
      failures.push('migration readiness marker must contain version 1 and a build SHA.');
    }
    if (process.env.EXPECTED_SHA && marker.buildSha !== process.env.EXPECTED_SHA) {
      failures.push('migration readiness marker must carry the exact candidate SHA.');
    }
    if (typeof marker?.origin !== 'string' || !marker.origin.startsWith('https://')) {
      failures.push('migration readiness marker must identify its HTTPS deployment origin.');
    }
  } catch (error) {
    failures.push(`migration readiness marker invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (existsSync('dist/robots.txt') && readFileSync('dist/robots.txt','utf8').includes('vercel.app')) failures.push('robots.txt must not hardcode Vercel.');
if (existsSync('dist/sitemap.xml') && readFileSync('dist/sitemap.xml','utf8').includes('vercel.app')) failures.push('sitemap.xml must not hardcode Vercel.');

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
