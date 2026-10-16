// Validate secret exposure boundaries in privileged workflows without contacting providers.
// Static checks cannot establish the actual Google Cloud IAM grants or WIF claims.
export function checkProductionBuildSecrets(hosting, firestore) {
  const issues = [];
  const header = hosting.split(/^    steps:\s*$/m)[0];
  if (!header || /\bSENTRY_AUTH_TOKEN\b/.test(header)) {
    issues.push('Hosting: SENTRY_AUTH_TOKEN must not be inherited by the job');
  }

  const authorized = new Set(['Require production build configuration', 'Build exact production frontend']);
  const pieces = hosting.split(/^      - name: /m).slice(1);
  const seen = new Set();
  for (const part of pieces) {
    const stepName = part.split('\n', 1)[0].trim();
    const containsToken = /\bSENTRY_AUTH_TOKEN\b/.test(part);
    const envToken = /^        env:\s*\n          SENTRY_AUTH_TOKEN: \$\{\{ secrets\.SENTRY_AUTH_TOKEN \}\}\s*$/m.test(part);
    if (authorized.has(stepName)) {
      seen.add(stepName);
      if (!envToken) issues.push(`Hosting: ${stepName} must receive Sentry token only as step env`);
    } else if (containsToken) {
      issues.push(`Hosting: token exposed to unapproved step ${stepName}`);
    }
  }
  for (const name of authorized) {
    if (!seen.has(name)) issues.push(`Hosting: missing authorized step ${name}`);
  }
  const references = hosting.match(/\$\{\{\s*secrets\.SENTRY_AUTH_TOKEN\s*\}\}/g) ?? [];
  if (references.length !== 2) issues.push('Hosting: exactly two approved Sentry secret references required');

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
