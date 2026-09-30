const required = [
  'EXPECTED_SHA',
  'LOGBOOK_BUILD_SHA',
  'VITE_PUBLIC_ORIGIN',
  'VITE_ACCOUNT_DELETION_API_URL',
  'VITE_FIREBASE_AUTH_DOMAIN',
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
const deletionUrl = httpsUrl('VITE_ACCOUNT_DELETION_API_URL');
if (deletionUrl.origin === publicOrigin.origin && deletionUrl.pathname.startsWith('/api/')) {
  console.error('Account deletion must call the direct Cloud Function endpoint, not a Hosting rewrite.');
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
if (!allowed.has(publicOrigin.origin)) {
  console.error('LOGBOOK_ALLOWED_ORIGINS must include the canonical Production origin.');
  process.exit(1);
}

console.log('Firebase Production deploy environment OK:', {
  sha: process.env.LOGBOOK_BUILD_SHA,
  origin: publicOrigin.origin,
  project: process.env.FIREBASE_PROJECT_ID,
  site: process.env.FIREBASE_HOSTING_SITE,
  region: process.env.FIREBASE_FUNCTION_REGION,
});
