// Keep the built PWA realistic while making accidental Production egress impossible.
// Vite loads .env files by default; the E2E runner also disables that load.
/** @param {Record<string, string | undefined>} source */
export function createIsolatedE2eEnvironment(source) {
  const isolated = {};
  for (const [key, value] of Object.entries(source)) {
    if (/^(VITE_|SENTRY_|FIREBASE_ADMIN_)/.test(key)) continue;
    if ([
      'FIREBASE_HOSTING_DEPLOY', 'CRON_SECRET', 'PUBLIC_APP_ORIGIN',
      'GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_CONFIG', 'GCLOUD_PROJECT',
      'GOOGLE_CLOUD_PROJECT', 'LOGBOOK_TEST_URL',
    ].includes(key)) continue;
    if (value !== undefined) isolated[key] = value;
  }
  return {
    ...isolated,
    VITE_FIREBASE_API_KEY: 'dummy-key',
    VITE_FIREBASE_AUTH_DOMAIN: 'dummy-domain.firebaseapp.com',
    VITE_FIREBASE_PROJECT_ID: 'demo-logbook-audit',
    VITE_FIREBASE_APP_ID: '1:1234567890:web:123456',
    VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: 'dummy-recaptcha-key',
    VITE_ACCOUNT_DELETION_API_ORIGIN: 'http://127.0.0.1:9',
  };
}

/** @param {string} value */
export function assertLoopbackE2eUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('E2E base URL non valido.');
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
    || !url.port || url.pathname !== '/' || url.search || url.hash
    || url.username || url.password) {
    throw new Error('E2E base URL deve essere http://127.0.0.1:<porta>/ (mai Production).');
  }
  return url.origin;
}
