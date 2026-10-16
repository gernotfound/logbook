import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const oidc = vi.hoisted(() => ({ getVercelOidcToken: vi.fn() }));
vi.mock('@vercel/oidc', () => oidc);

import {
  assertTestOidcEnvironment,
  createTestOidcCredential,
  TEST_FIREBASE_PROJECT_ID,
  TEST_SERVICE_ACCOUNT_EMAIL,
  TEST_VERCEL_PROJECT_ID,
} from '../server/accountDeletion/testOidcCredential';

const expectedAudience =
  'https://iam.googleapis.com/projects/1016481853013/locations/global/workloadIdentityPools/logbook-test-vercel/providers/vercel-test-backend';

function safeTestEnvironment(): NodeJS.ProcessEnv {
  return {
    FIREBASE_ADMIN_AUTH_MODE: 'vercel-oidc',
    FIREBASE_ADMIN_PROJECT_ID: TEST_FIREBASE_PROJECT_ID,
    FIREBASE_ADMIN_CLIENT_EMAIL: TEST_SERVICE_ACCOUNT_EMAIL,
    VERCEL: '1',
    VERCEL_ENV: 'production',
    VERCEL_PROJECT_ID: TEST_VERCEL_PROJECT_ID,
    PUBLIC_APP_ORIGIN: 'https://thelogbook-test.web.app',
  };
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function successFetch(): ReturnType<typeof vi.fn> {
  return vi.fn()
    .mockResolvedValueOnce(json({ access_token: 'temporary-wif-token', expires_in: 3600 }))
    .mockResolvedValueOnce(json({
      accessToken: 'impersonated-service-account-token',
      expireTime: new Date(Date.now() + 3_600_000).toISOString(),
    }));
}

describe('isolated Vercel Test Firebase Admin identity federation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    oidc.getVercelOidcToken.mockResolvedValue('signed-vercel-oidc-test-token');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects missing, Production and mixed environment variables before credentials are used', () => {
    expect(() => assertTestOidcEnvironment(safeTestEnvironment())).not.toThrow();
    const overrides: Array<[string, string | undefined]> = [
      ['FIREBASE_ADMIN_PROJECT_ID', 'logbook-db-98cc4'],
      ['FIREBASE_ADMIN_AUTH_MODE', undefined],
      ['FIREBASE_ADMIN_CLIENT_EMAIL', 'prod-admin@production.iam.gserviceaccount.com'],
      ['VERCEL', undefined],
      ['VERCEL_ENV', 'preview'],
      ['VERCEL_PROJECT_ID', 'prj_some-other-project'],
      ['PUBLIC_APP_ORIGIN', 'https://thelogbook.web.app'],
      ['FIREBASE_ADMIN_PRIVATE_KEY', 'accidental-secret'],
    ];
    for (const [key, value] of overrides) {
      const env = safeTestEnvironment();
      if (value === undefined) delete env[key];
      else env[key] = value;
      expect(() => assertTestOidcEnvironment(env), key).toThrow(/not configured safely/);
    }
  });

  it('requests provider-specific Vercel OIDC audience and two bounded token exchanges', async () => {
    const mockFetch = successFetch();
    vi.stubGlobal('fetch', mockFetch);
    const credential = createTestOidcCredential();
    const token = await credential.getAccessToken();
    expect(token.access_token).toBe('impersonated-service-account-token');
    expect(token.expires_in).toBeGreaterThan(3000);
    expect(oidc.getVercelOidcToken).toHaveBeenCalledWith({ audience: expectedAudience });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [stsUrl, stsOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(stsUrl).toBe('https://sts.googleapis.com/v1/token');
    expect(stsOptions.method).toBe('POST');
    const params = new URLSearchParams(stsOptions.body as URLSearchParams);
    expect(params.get('audience')).toBe(expectedAudience.replace('https:', ''));
    expect(params.get('subject_token')).toBe('signed-vercel-oidc-test-token');
    expect(params.get('scope')).toBe('https://www.googleapis.com/auth/cloud-platform');
    const [iamUrl, iamOptions] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(iamUrl).toContain('/serviceAccounts/logbook-test-vercel-runtime@thelogbook-test.iam.gserviceaccount.com:generateAccessToken');
    expect((iamOptions.headers as Record<string, string>).authorization).toBe('Bearer temporary-wif-token');
    expect(JSON.parse(iamOptions.body as string)).toEqual({
      scope: ['https://www.googleapis.com/auth/cloud-platform'], lifetime: '3600s',
    });
  });

  it('reuses a valid temporary credential without retrieving another Vercel JWT', async () => {
    const mockFetch = successFetch();
    vi.stubGlobal('fetch', mockFetch);
    const credential = createTestOidcCredential();
    const first = await credential.getAccessToken();
    const second = await credential.getAccessToken();
    expect(first).toEqual(second);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(oidc.getVercelOidcToken).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent credential refresh requests', async () => {
    const mockFetch = successFetch();
    vi.stubGlobal('fetch', mockFetch);
    const credential = createTestOidcCredential();
    const [a, b] = await Promise.all([credential.getAccessToken(), credential.getAccessToken()]);
    expect(a).toEqual(b);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(oidc.getVercelOidcToken).toHaveBeenCalledTimes(1);
  });

  it('fails closed for rejected STS exchange and retries instead of caching the error', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(json({ error: 'invalid_grant', secret: 'do-not-log' }, 403));
    vi.stubGlobal('fetch', mockFetch);
    const credential = createTestOidcCredential();
    await expect(credential.getAccessToken()).rejects.toThrow('Test WIF token exchange rejected.');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    mockFetch.mockResolvedValueOnce(json({ access_token: 'short-wif-token' }))
      .mockResolvedValueOnce(json({
        accessToken: 'impersonated-token', expireTime: new Date(Date.now() + 3600_000).toISOString(),
      }));
    await expect(credential.getAccessToken()).resolves.toMatchObject({ access_token: 'impersonated-token' });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('rejects malformed IAM responses, expired grants and missing Vercel tokens', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ access_token: 'wif' }))
      .mockResolvedValueOnce(json({ accessToken: 'bad', expireTime: 'not-a-date' })));
    await expect(createTestOidcCredential().getAccessToken()).rejects.toThrow(/invalid expiry/);
    vi.unstubAllGlobals();
    oidc.getVercelOidcToken.mockResolvedValueOnce('');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(createTestOidcCredential().getAccessToken()).rejects.toThrow(/unavailable/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
