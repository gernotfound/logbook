import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const sha = 'a'.repeat(40);
const project = 'logbook-db-98cc4';
const region = 'europe-west1';
const publicOrigin = 'https://thelogbook.web.app';

function env(overrides: Record<string, string> = {}) {
  return {
    ...process.env,
    EXPECTED_SHA: sha,
    LOGBOOK_BUILD_SHA: sha,
    LOGBOOK_DEPLOY_ENV: 'production',
    VITE_PUBLIC_ORIGIN: publicOrigin,
    VITE_ACCOUNT_DELETION_API_URL: `https://${region}-${project}.cloudfunctions.net/accountDeletion`,
    VITE_FIREBASE_API_KEY: 'public-test-key',
    VITE_FIREBASE_AUTH_DOMAIN: 'thelogbook.web.app',
    VITE_FIREBASE_PROJECT_ID: project,
    VITE_FIREBASE_APP_ID: '1:123:web:test',
    VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: 'public-site-key',
    VITE_SENTRY_DSN: 'https://public@example.invalid/1',
    SENTRY_AUTH_TOKEN: 'test-token',
    SENTRY_ORG: 'test-org',
    SENTRY_PROJECT: 'test-project',
    FIREBASE_PROJECT_ID: project,
    FIREBASE_HOSTING_SITE: 'thelogbook',
    FIREBASE_FUNCTION_REGION: region,
    LOGBOOK_ALLOWED_ORIGINS: publicOrigin,
    FIREBASE_FUNCTION_SERVICE_ACCOUNT: 'logbook-runtime@logbook-db-98cc4.iam.gserviceaccount.com',
    GCP_WORKLOAD_IDENTITY_PROVIDER: 'projects/123/locations/global/workloadIdentityPools/test/providers/github',
    GCP_DEPLOY_SERVICE_ACCOUNT: 'firebase-deploy@example.invalid',
    ...overrides,
  };
}

function run(overrides: Record<string, string> = {}) {
  return execFileSync(process.execPath, ['scripts/check-firebase-deploy-env.mjs'], {
    cwd: process.cwd(),
    env: env(overrides),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('Firebase Production deploy environment guard', () => {
  it('accepts the exact configured Hosting origin and Functions endpoint without echoing configuration values', () => {
    const output = run();
    expect(output.trim()).toBe('Firebase Production deploy environment OK.');

    for (const value of [
      sha,
      project,
      region,
      publicOrigin,
      'public-test-key',
      'public-site-key',
      'test-token',
      'logbook-runtime@logbook-db-98cc4.iam.gserviceaccount.com',
      'firebase-deploy@example.invalid',
    ]) {
      expect(output).not.toContain(value);
    }
  });

  it('rejects an account deletion endpoint from another Firebase project', () => {
    expect(() => run({
      VITE_ACCOUNT_DELETION_API_URL: `https://${region}-other-project.cloudfunctions.net/accountDeletion`,
    })).toThrow();
  });

  it('rejects extra path segments on the account deletion endpoint', () => {
    expect(() => run({
      VITE_ACCOUNT_DELETION_API_URL: `https://${region}-${project}.cloudfunctions.net/other/accountDeletion`,
    })).toThrow();
  });

  it('rejects widening the CORS allowlist beyond the migration source and canonical origin', () => {
    expect(() => run({
      LOGBOOK_ALLOWED_ORIGINS: `${publicOrigin},https://unexpected.example`,
    })).toThrow();
  });

  it('rejects a Functions runtime identity from another project', () => {
    expect(() => run({
      FIREBASE_FUNCTION_SERVICE_ACCOUNT: 'logbook-runtime@other-project.iam.gserviceaccount.com',
    })).toThrow();
  });

  it('rejects reusing the deployment identity as the Functions runtime identity', () => {
    expect(() => run({
      FIREBASE_FUNCTION_SERVICE_ACCOUNT: 'firebase-deploy@example.invalid',
    })).toThrow();
  });

  it('rejects an invalid Functions runtime service-account identity', () => {
    expect(() => run({
      FIREBASE_FUNCTION_SERVICE_ACCOUNT: 'not-a-service-account',
    })).toThrow();
  });

  it('rejects a Hosting site that does not match a *.web.app canonical origin', () => {
    expect(() => run({
      FIREBASE_HOSTING_SITE: 'different-site',
    })).toThrow();
  });
});
