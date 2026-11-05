// Check privileged production deployment identities without contacting providers.
export function checkProductionBuildSecrets(hosting, firestore) {
  const issues = [];
  // An explicit env allowlist keeps retired diagnostics credentials out of the
  // production build without coupling the rule to any particular vendor.
  const permittedHostingEnv = new Set([
    'EXPECTED_SHA', 'LOGBOOK_BUILD_SHA', 'FIREBASE_HOSTING_DEPLOY',
    'GCP_WORKLOAD_IDENTITY_PROVIDER', 'GCP_FIREBASE_DEPLOY_SERVICE_ACCOUNT',
    'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID',
    'VITE_ACCOUNT_DELETION_API_ORIGIN', 'VITE_RECAPTCHA_ENTERPRISE_SITE_KEY',
  ]);
  const jobEnv = hosting.match(/^ {4}env:\s*\r?\n([\s\S]*?)^ {4}steps:/m)?.[1];
  const names = [...(jobEnv?.matchAll(/^ {6}([A-Z][A-Z0-9_]*):/gm) ?? [])].map(match => match[1]);
  if (!jobEnv || names.length === 0 || names.some(name => !permittedHostingEnv.has(name))) {
    issues.push('Hosting: external error monitoring or an unreviewed build env binding');
  }
  if (!/^\s*service_account: \$\{\{ env\.GCP_FIREBASE_DEPLOY_SERVICE_ACCOUNT \}\}\s*$/m.test(hosting) ||
      /\bGCP_FIRESTORE_DEPLOY_SERVICE_ACCOUNT\b/.test(hosting)) {
    issues.push('Hosting: unexpected WIF service account binding');
  }
  if (!/^\s*service_account: \$\{\{ env\.GCP_FIRESTORE_DEPLOY_SERVICE_ACCOUNT \}\}\s*$/m.test(firestore) ||
      /\bGCP_FIREBASE_DEPLOY_SERVICE_ACCOUNT\b/.test(firestore)) {
    issues.push('Firestore: unexpected WIF service account binding');
  }
  return issues;
}
