import type { Credential } from 'firebase-admin/app';
import { getVercelOidcToken } from '@vercel/oidc';

// This credential is permitted only inside the isolated Vercel Test project.
// Production continues to use its existing Firebase Admin service-account cert.
export const TEST_FIREBASE_PROJECT_ID = 'thelogbook-test';
export const TEST_VERCEL_PROJECT_ID = 'prj_o232EaPmYkrn04zev3Sw9iL2ympj';
export const TEST_SERVICE_ACCOUNT_EMAIL =
  'logbook-test-vercel-runtime@thelogbook-test.iam.gserviceaccount.com';

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const PROVIDER_PATH =
  'projects/1016481853013/locations/global/workloadIdentityPools/logbook-test-vercel/providers/vercel-test-backend';
const TOKEN_AUDIENCE = `https://iam.googleapis.com/${PROVIDER_PATH}`;
const STS_AUDIENCE = `//iam.googleapis.com/${PROVIDER_PATH}`;
const STS_URL = 'https://sts.googleapis.com/v1/token';
const IMPERSONATION_URL =
  `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${TEST_SERVICE_ACCOUNT_EMAIL}:generateAccessToken`;

export function assertTestOidcEnvironment(env: NodeJS.ProcessEnv): void {
  if (env.FIREBASE_ADMIN_PROJECT_ID !== TEST_FIREBASE_PROJECT_ID
    || env.FIREBASE_ADMIN_CLIENT_EMAIL !== TEST_SERVICE_ACCOUNT_EMAIL
    || env.FIREBASE_ADMIN_AUTH_MODE !== 'vercel-oidc'
    || env.VERCEL !== '1'
    || env.VERCEL_ENV !== 'production'
    || env.VERCEL_PROJECT_ID !== TEST_VERCEL_PROJECT_ID
    || env.PUBLIC_APP_ORIGIN !== 'https://thelogbook-test.web.app'
    || Boolean(env.FIREBASE_ADMIN_PRIVATE_KEY?.trim())) {
    throw new Error('Isolated Vercel Test OIDC environment is not configured safely.');
  }
}

type AccessToken = Awaited<ReturnType<Credential['getAccessToken']>>;

async function exchangeForImpersonatedToken(): Promise<AccessToken> {
  // Vercel issues a separate short-lived token with this GCP-only audience.
  // The GCP provider also verifies issuer + the exact Test project subject.
  const oidcToken = await getVercelOidcToken({ audience: TOKEN_AUDIENCE });
  if (!oidcToken) throw new Error('Vercel OIDC token unavailable.');

  const stsResponse = await fetch(STS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      audience: STS_AUDIENCE,
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
      subject_token: oidcToken,
      scope: GOOGLE_SCOPE,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!stsResponse.ok) throw new Error('Test WIF token exchange rejected.');
  const sts: unknown = await stsResponse.json();
  if (!sts || typeof sts !== 'object' || !('access_token' in sts)
    || typeof sts.access_token !== 'string' || !sts.access_token) {
    throw new Error('Test WIF token exchange returned no access token.');
  }

  const impersonationResponse = await fetch(IMPERSONATION_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${sts.access_token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ scope: [GOOGLE_SCOPE], lifetime: '3600s' }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!impersonationResponse.ok) throw new Error('Test service-account impersonation rejected.');
  const impersonation: unknown = await impersonationResponse.json();
  if (!impersonation || typeof impersonation !== 'object'
    || !('accessToken' in impersonation) || typeof impersonation.accessToken !== 'string'
    || !impersonation.accessToken || !('expireTime' in impersonation)
    || typeof impersonation.expireTime !== 'string') {
    throw new Error('Test service-account impersonation returned an invalid response.');
  }
  const expiresAt = Date.parse(impersonation.expireTime);
  const expiresIn = Math.floor((expiresAt - Date.now()) / 1000);
  if (!Number.isFinite(expiresIn) || expiresIn <= 60 || expiresIn > 3600) {
    throw new Error('Test service-account access token has an invalid expiry.');
  }
  return { access_token: impersonation.accessToken, expires_in: expiresIn };
}

export function createTestOidcCredential(): Credential {
  // Firebase Admin shares a singleton app within one Vercel function instance.
  // Cache temporary Google access tokens, but never cache the Vercel source JWT.
  let cached: { token: AccessToken; until: number } | undefined;
  let inFlight: Promise<AccessToken> | undefined;
  return {
    getAccessToken() {
      if (cached && cached.until > Date.now() + 60_000) {
        return Promise.resolve(cached.token);
      }
      if (!inFlight) {
        inFlight = exchangeForImpersonatedToken()
          .then(token => {
            cached = { token, until: Date.now() + token.expires_in * 1000 };
            return token;
          })
          .finally(() => { inFlight = undefined; });
      }
      return inFlight;
    },
  };
}
