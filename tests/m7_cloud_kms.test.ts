import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cloud = vi.hoisted(() => ({ oauth: vi.fn(async () => 'test-cloud-access-token') }));
vi.mock('../server/accountDeletion/firebaseAdmin', () => ({
  adminGoogleCloudAccessToken: cloud.oauth,
}));

import {
  AccountKeyUnavailableError, wrapAccountDataKey, unwrapAccountDataKey,
} from '../server/cloudKeys/kmsEnvelope';

const keyName = 'projects/test-app-1234/locations/europe-west1/keyRings/fitness/cryptoKeys/account';
const testKey = () => Buffer.alloc(32, 37);

beforeEach(() => {
  vi.stubEnv('CLOUD_KMS_KEY_NAME', keyName);
  vi.resetAllMocks();
  cloud.oauth.mockResolvedValue('test-cloud-access-token');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Cloud KMS envelope transport and validation', () => {
  it('binds account uid in AAD and never sends a raw key to an arbitrary origin', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown>; headers: Headers }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown>,
        headers: new Headers(init.headers) });
      if (url.endsWith(':encrypt')) return Response.json({
        name: keyName + '/cryptoKeyVersions/1', ciphertext: Buffer.from('enveloped-key').toString('base64'),
      });
      return Response.json({ plaintext: testKey().toString('base64') });
    }));
    const wrapped = await wrapAccountDataKey('owner-a', testKey());
    expect(wrapped).toEqual({
      format: 'thelogbook-wrapped-account-key', version: 1, uid: 'owner-a',
      kmsKeyName: keyName, ciphertext: Buffer.from('enveloped-key').toString('base64'),
    });
    expect(await unwrapAccountDataKey('owner-a', wrapped)).toEqual(testKey());
    expect(calls).toHaveLength(2);
    expect(calls.map(x => x.url)).toEqual([
      'https://cloudkms.googleapis.com/v1/' + keyName + ':encrypt',
      'https://cloudkms.googleapis.com/v1/' + keyName + ':decrypt',
    ]);
    expect(calls[0].headers.get('authorization')).toBe('Bearer test-cloud-access-token');
    expect(calls[0].body.plaintext).toBe(testKey().toString('base64'));
    expect(calls[0].body.additionalAuthenticatedData)
      .toBe(Buffer.from('thelogbook:cloud-adk:v1:owner-a').toString('base64'));
    expect(calls[1].body.additionalAuthenticatedData).toBe(calls[0].body.additionalAuthenticatedData);
  });

  it('never unwraps an envelope addressed to a different account or KMS key', async () => {
    const wrapped = {
      format: 'thelogbook-wrapped-account-key', version: 1, uid: 'owner-a',
      kmsKeyName: keyName, ciphertext: Buffer.from('ciphertext').toString('base64'),
    };
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(unwrapAccountDataKey('owner-b', wrapped)).rejects.toBeInstanceOf(AccountKeyUnavailableError);
    await expect(unwrapAccountDataKey('owner-a', { ...wrapped, kmsKeyName: 'projects/other' }))
      .rejects.toBeInstanceOf(AccountKeyUnavailableError);
    await expect(unwrapAccountDataKey('owner-a', { ...wrapped, ciphertext: '!' }))
      .rejects.toBeInstanceOf(AccountKeyUnavailableError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects nonexistent configuration, malicious key names, KMS errors and corrupted key sizes', async () => {
    vi.stubEnv('CLOUD_KMS_KEY_NAME', '');
    await expect(wrapAccountDataKey('owner-a', testKey())).rejects.toBeInstanceOf(AccountKeyUnavailableError);
    vi.stubEnv('CLOUD_KMS_KEY_NAME', 'https://attacker.example/private');
    await expect(wrapAccountDataKey('owner-a', testKey())).rejects.toBeInstanceOf(AccountKeyUnavailableError);
    vi.stubEnv('CLOUD_KMS_KEY_NAME', keyName);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'denied' }, { status: 403 })));
    await expect(wrapAccountDataKey('owner-a', testKey())).rejects.toBeInstanceOf(AccountKeyUnavailableError);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      name: 'projects/another-project/locations/europe-west1/keyRings/fitness/cryptoKeys/account/cryptoKeyVersions/1',
      ciphertext: Buffer.from('x').toString('base64'),
    })));
    await expect(wrapAccountDataKey('owner-a', testKey())).rejects.toBeInstanceOf(AccountKeyUnavailableError);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ plaintext: Buffer.alloc(31).toString('base64') })));
    const wrapped = {
      format: 'thelogbook-wrapped-account-key', version: 1, uid: 'owner-a',
      kmsKeyName: keyName, ciphertext: Buffer.from('enveloped').toString('base64'),
    };
    await expect(unwrapAccountDataKey('owner-a', wrapped)).rejects.toBeInstanceOf(AccountKeyUnavailableError);
  });
});
