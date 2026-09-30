const required = [
  'EXPECTED_SHA',
  'LOGBOOK_BUILD_SHA',
  'VITE_PUBLIC_ORIGIN',
  'VITE_ORIGIN_MIGRATION_SOURCE',
  'VITE_ORIGIN_MIGRATION_TARGET',
  'VITE_ACCOUNT_DELETION_API_URL',
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_DATABASE_URL',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_RECAPTCHA_ENTERPRISE_SITE_KEY',
  'VITE_SENTRY_DSN',
  'SENTRY_AUTH_TOKEN',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_HOSTING_SITE',
  'FIREBASE_FUNCTION_REGION',
  'LOGBOOK_ALLOWED_ORIGINS',
];

const missing = required.filter(name => !process.env[name]?.trim());
if (missing.length) {
  console.error('Firebase deploy configuration missing:', missing.join(', '));
  process.exit(1);
}

if (process.env.EXPECTED_SHA !== process.env.LOGBOOK_BUILD_SHA) {
  console.error('Build SHA does not match the exact verified SHA.');
  process.exit(1);
}

if (process.env.LOGBOOK_DEPLOY_ENV !== 'production') {
  console.error('LOGBOOK_DEPLOY_ENV must be production for a live deployment.');
  process.exit(1);
}

function httpsUrl(name) {
  const url = new URL(process.env[name]);
  if (url.protocol !== 'https:') throw new Error(`${name} must use HTTPS`);
  return url;
}

const publicOrigin = httpsUrl('VITE_PUBLIC_ORIGIN');
const migrationSource = httpsUrl('VITE_ORIGIN_MIGRATION_SOURCE');
const migrationTarget = httpsUrl('VITE_ORIGIN_MIGRATION_TARGET');
const deletionUrl = httpsUrl('VITE_ACCOUNT_DELETION_API_URL');

if (migrationTarget.origin !== publicOrigin.origin) {
  console.error('VITE_ORIGIN_MIGRATION_TARGET must equal VITE_PUBLIC_ORIGIN.');
  process.exit(1);
}
if (migrationSource.origin === migrationTarget.origin) {
  console.error('Origin migration source and target must be different origins.');
  process.exit(1);
}
if (!deletionUrl.hostname.endsWith('.cloudfunctions.net') || !deletionUrl.pathname.endsWith('/accountDeletion')) {
  console.error('Account deletion must use the direct Cloud Functions accountDeletion HTTPS endpoint.');
  process.exit(1);
}

if (process.env.VITE_FIREBASE_PROJECT_ID !== process.env.FIREBASE_PROJECT_ID) {
  console.error('Client and deploy Firebase project IDs must match.');
  process.exit(1);
}
if (process.env.VITE_FIREBASE_AUTH_DOMAIN !== publicOrigin.hostname) {
  console.error('VITE_FIREBASE_AUTH_DOMAIN must match the canonical public hostname.');
  process.exit(1);
}
if (process.env.VITE_FIREBASE_AUTH_DOMAIN.endsWith('.firebaseapp.com')) {
  console.error('Production Auth domain must not expose the legacy firebaseapp.com helper domain.');
  process.exit(1);
}

const allowed = new Set(process.env.LOGBOOK_ALLOWED_ORIGINS.split(',').map(v => v.trim()).filter(Boolean));
for (const requiredOrigin of [publicOrigin.origin, migrationSource.origin]) {
  if (!allowed.has(requiredOrigin)) {
    console.error('LOGBOOK_ALLOWED_ORIGINS must include:', requiredOrigin);
    process.exit(1);
  }
}

console.log('Firebase Production deploy environment OK:', {
  sha: process.env.LOGBOOK_BUILD_SHA,
  origin: publicOrigin.origin,
  migrationSource: migrationSource.origin,
  project: process.env.FIREBASE_PROJECT_ID,
  site: process.env.FIREBASE_HOSTING_SITE,
  region: process.env.FIREBASE_FUNCTION_REGION,
});
