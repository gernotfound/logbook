import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const oidc = vi.hoisted(() => ({ getVercelOidcToken: vi.fn() }));
vi.mock('@vercel/oidc', () => oidc);

import { adminDb } from '../server/accountDeletion/firebaseAdmin';
import { TEST_FIREBASE_PROJECT_ID, TEST_SERVICE_ACCOUNT_EMAIL, TEST_VERCEL_PROJECT_ID } from '../server/accountDeletion/testOidcCredential';

type InspectableFirestore = ReturnType<typeof adminDb> & {
  _settings: { authClient: { getRequestHeaders(): Promise<Headers> } };
  _clientPool: {
    acquire(requestTag: string, requiresGrpc: boolean): { auth: { getClient(): Promise<unknown> } };
    release(requestTag: string, client: unknown): Promise<void>;
  };
};

describe('keyless Test Firestore Admin compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const env: Record<string, string> = {
      FIREBASE_ADMIN_AUTH_MODE: 'vercel-oidc',
      FIREBASE_ADMIN_PROJECT_ID: TEST_FIREBASE_PROJECT_ID,
      FIREBASE_ADMIN_CLIENT_EMAIL: TEST_SERVICE_ACCOUNT_EMAIL,
      VERCEL: '1',
      VERCEL_ENV: 'production',
      VERCEL_PROJECT_ID: TEST_VERCEL_PROJECT_ID,
      PUBLIC_APP_ORIGIN: 'https://thelogbook-test.web.app',
    };
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    oidc.getVercelOidcToken.mockResolvedValue('synthetic-test-oidc');
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'synthetic-sts-token' }))
      .mockResolvedValueOnce(Response.json({
        accessToken: 'synthetic-short-lived-service-token',
        expireTime: new Date(Date.now() + 3_600_000).toISOString(),
      })));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    for (const app of getApps()) await deleteApp(app);
  });

  it('routes the Test Admin Firestore singleton through Google-GAX OIDC credentials', async () => {
    const db = adminDb() as InspectableFirestore;
    expect(adminDb()).toBe(db);
    expect(db.projectId).toBe(TEST_FIREBASE_PROJECT_ID);
    expect(typeof db.runTransaction).toBe('function');
    // Demonstrates the prior defect: Firebase Admin Firestore refuses the
    // custom Admin Credential, while the isolated Google-GAX bridge accepts it.
    expect(() => getFirestore(getApps()[0])).toThrow(/available credentials/);

    // Pin the actual installed Firestore/GAX compatibility contract:
    // GoogleAuth must receive the very same OAuth2Client configured by Test.
    const gaxClient = db._clientPool.acquire('test', false);
    const authClient = await gaxClient.auth.getClient();
    expect(authClient).toBe(db._settings.authClient);
    const headers = await db._settings.authClient.getRequestHeaders();
    expect(headers.get('authorization')).toBe('Bearer synthetic-short-lived-service-token');
    expect(oidc.getVercelOidcToken).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(db._settings);
    expect(serialized).not.toContain('synthetic-short-lived-service-token');
    expect(serialized).not.toContain('synthetic-sts-token');
    await db._clientPool.release('test', gaxClient);
    await db.terminate();
  });
});
