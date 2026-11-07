// Check privileged production deployment identities without contacting providers.
export function checkProductionBuildSecrets(hosting, firestore) {
  const issues = [];
  const build = hosting.match(/^  build:\\s*\\r?\\n([\\s\\S]*?)(?=^  deploy:\\s*$)/m)?.[1];
  const deploy = hosting.match(/^  deploy:\\s*\\r?\\n([\\s\\S]*)$/m)?.[1];
  if (!build || !deploy) {
    issues.push('Hosting: expected separate unprivileged build and privileged deploy jobs');
  } else {
    if (!/^    permissions:\\s*\\r?\\n      contents: read\\s*$/m.test(build) ||
        /\\bid-token:\\s*write\\b/.test(build) ||
        /\\bGCP_[A-Z_]+\\b|google-github-actions\\/auth/.test(build)) {
      issues.push('Hosting: build can access cloud identity instead of remaining unprivileged');
    }
    if (!/^    permissions:\\s*\\r?\\n      contents: read\\s*\\r?\\n      id-token: write\\s*$/m.test(deploy) ||
        /\\bnpm ci\\b/.test(deploy) ||
        /\\bnpm run build\\b/.test(deploy)) {
      issues.push('Hosting: deploy job must not install or compile app dependencies');
    }
    const uploaded = build.includes('actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9');
    const downloaded = deploy.includes('actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131');
    if (!uploaded || !downloaded ||
        !build.includes('hosting-frontend-${{ env.EXPECTED_SHA }}') ||
        !deploy.includes('hosting-frontend-${{ env.EXPECTED_SHA }}') ||
        !/^    needs: build\\s*$/m.test(deploy)) {
      issues.push('Hosting: verified same-run frontend artifact handoff is missing');
    }
    if (deploy.indexOf('      - name: Authenticate to Google Cloud') <=
        deploy.indexOf('      - name: Download same-run verified frontend') ||
        !deploy.includes('      - name: Recheck exact main SHA before Hosting deployment')) {
      issues.push('Hosting: trusted credentials or exact main SHA guard out of order');
    }
  }

  // An explicit env allowlist keeps retired diagnostics credentials out of the
  // production build without coupling the rule to any particular vendor.
  const permittedHostingEnv = new Set([
    'EXPECTED_SHA', 'LOGBOOK_BUILD_SHA', 'FIREBASE_HOSTING_DEPLOY',
    'GCP_WORKLOAD_IDENTITY_PROVIDER', 'GCP_FIREBASE_DEPLOY_SERVICE_ACCOUNT',
    'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID',
    'VITE_ACCOUNT_DELETION_API_ORIGIN', 'VITE_RECAPTCHA_ENTERPRISE_SITE_KEY',
    'VITE_ACCOUNT_INACTIVITY_TRACKING',
  ]);
  const jobEnv = hosting.match(/^ {4}env:\s*\r?\n([\s\S]*?)^ {4}steps:/m)?.[1];
  const names = [...(jobEnv?.matchAll(/^ {6}([A-Z][A-Z0-9_]*):/gm) ?? [])].map(match => match[1]);
  if (!jobEnv || names.length === 0 || names.some(name => !permittedHostingEnv.has(name))) {
    issues.push('Hosting: external error monitoring or an unreviewed build env binding');
  }
  const permittedGithubBindings = new Set([
    'GCP_WORKLOAD_IDENTITY_PROVIDER', 'GCP_FIREBASE_DEPLOY_SERVICE_ACCOUNT',
    'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID',
    'VITE_ACCOUNT_DELETION_API_ORIGIN', 'VITE_RECAPTCHA_ENTERPRISE_SITE_KEY',
    'VITE_ACCOUNT_INACTIVITY_TRACKING',
  ]);
  // Step-level env and arguments also resolve vars/secrets. Inspect the entire
  // workflow, not just the job env block, to catch unauthorized integrations.
  const bindings = [...hosting.matchAll(/\$\{\{\s*(?:vars|secrets)\.([A-Z][A-Z0-9_]*)\s*\}\}/g)];
  if (bindings.some(match => !permittedGithubBindings.has(match[1]))) {
    issues.push('Hosting: unreviewed GitHub variable or secret binding');
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
