import { existsSync, readFileSync } from 'node:fs';

const failures = [];
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const firebase = JSON.parse(readFileSync('firebase.json', 'utf8'));
const functionsPackage = JSON.parse(readFileSync('functions/package.json', 'utf8'));
const functionIndex = readFileSync('functions/src/index.ts', 'utf8');
const adminBootstrap = readFileSync('functions/src/accountDeletion/firebaseAdmin.ts', 'utf8');
const deploymentConfig = readFileSync('src/lib/deploymentConfig.ts', 'utf8');

const functionConfig = Array.isArray(firebase.functions) ? firebase.functions[0] : firebase.functions;
if (firebase.firestore?.rules !== 'firestore.rules') failures.push('Firestore Rules configuration must be preserved.');
if (functionConfig?.source !== 'functions') failures.push('Firebase Functions source must be functions/.');
if (functionConfig?.runtime !== 'nodejs22') failures.push('Firebase Functions runtime must be Node.js 22.');
if (functionsPackage.engines?.node !== '22') failures.push('functions/package.json must pin Node.js 22.');
if (!functionsPackage.dependencies?.['firebase-admin']) failures.push('Functions must depend on firebase-admin.');
if (!functionsPackage.dependencies?.['firebase-functions']) failures.push('Functions must depend on firebase-functions.');

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

const globalHeaderGroup = hostingHeaders.find(group => group?.source === '/**');
const cspHeader = Array.isArray(globalHeaderGroup?.headers)
  ? globalHeaderGroup.headers.find(header => header?.key === 'Content-Security-Policy')
  : undefined;
const cspTokens = new Set(String(cspHeader?.value ?? '').split(/\s+/).filter(Boolean));
if (!cspTokens.has('https://*.cloudfunctions.net')) {
  failures.push('CSP connect-src must allow the direct Cloud Functions endpoint.');
}
if (cspTokens.has('https://*.vercel-scripts.com') || cspTokens.has('https://vitals.vercel-insights.com')) {
  failures.push('Vercel analytics origins must not remain in Firebase CSP.');
}

if (!/export const accountDeletion = onRequest/.test(functionIndex)) failures.push('Missing Firebase HTTP accountDeletion function.');
if (!/timeoutSeconds:\s*3600/.test(functionIndex)) failures.push('HTTP deletion function must retain long-running capacity.');
if (!/export const accountDeletionMaintenance = onSchedule/.test(functionIndex)) failures.push('Missing Firebase scheduled maintenance function.');
if (!/timeoutSeconds:\s*1800/.test(functionIndex)) failures.push('Scheduled maintenance timeout must be explicit.');
if (!/schedule:\s*'0 3 \* \* \*'/.test(functionIndex) || !/timeZone:\s*'Etc\/UTC'/.test(functionIndex)) {
  failures.push('Scheduled maintenance must run daily at 03:00 UTC.');
}
if (!functionIndex.includes("defineString('LOGBOOK_FUNCTION_REGION')")) failures.push('Function region must be deployment-parameterized.');
if (!functionIndex.includes("defineString('LOGBOOK_ALLOWED_ORIGINS')")) failures.push('Direct HTTP CORS allowlist must be deployment-parameterized.');
if (functionIndex.includes('CRON_SECRET')) failures.push('Scheduled Firebase maintenance must not rely on CRON_SECRET.');

if (!adminBootstrap.includes('return initializeApp();')) failures.push('Firebase runtime must support Application Default Credentials.');
if (!deploymentConfig.includes('VITE_ACCOUNT_DELETION_API_URL')) failures.push('Client deletion backend must be provider-neutral/configurable.');
if (packageJson.dependencies?.['@vercel/analytics'] || packageJson.dependencies?.['@vercel/speed-insights']) {
  failures.push('Vercel Analytics/Speed Insights must not remain runtime dependencies.');
}

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
