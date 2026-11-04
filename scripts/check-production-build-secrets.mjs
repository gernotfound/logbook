// Check privileged production deployment identities without contacting providers.
export function checkProductionBuildSecrets(hosting, firestore) {
  const issues = [];
  if (/SENTRY_/.test(hosting) || /@sentry\//.test(hosting)) {
    issues.push('Hosting: external error monitoring must not be reintroduced');
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
