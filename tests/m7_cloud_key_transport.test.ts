import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  user: { uid: 'owner-a', getIdToken: vi.fn(async () => 'id-token') },
  cached: null as Uint8Array | null,
  read: vi.fn(async () => harness.cached),
  store: vi.fn(async (_owner: string, data: Uint8Array) => { harness.cached = Uint8Array.from(data); }),
  appCheck: vi.fn(async () => 'one-use-appcheck'),
  init: vi.fn(async () => {}),
  revision: 1,
  writable: true,
}));
vi.mock('../src/lib/firebase', () => ({
  auth: { currentUser: harness.user }, ensureAppCheck: harness.init,
}));
vi.mock('../src/lib/appCheck', () => ({ getLimitedUseAppCheckToken: harness.appCheck }));
vi.mock('../src/lib/healthConsent', () => ({
  getVerifiedHealthConsentRevision: () => harness.revision,
  isHealthConsentCloudWritable: () => harness.writable,
}));
vi.mock('../src/lib/sync/cloudAccountKeyCache', () => ({
  readCachedAccountDataKey: harness.read,
  rememberAccountDataKey: harness.store,
}));
import { requireCloudAccountDataKey, requireRightsExportAccountDataKey, CloudKeyAccessUnavailableError } from '../src/lib/sync/cloudAccountKeyAccess';

const accountKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const payload = () => ({
  format: 'thelogbook-account-data-key', version: 1,
  key: btoa(String.fromCharCode(...accountKey)),
});

beforeEach(() => {
  vi.clearAllMocks();
  harness.cached = null;
  harness.revision = 1;
  harness.writable = true;
  harness.user.uid = 'owner-a';
  harness.user.getIdToken.mockResolvedValue('id-token');
  harness.appCheck.mockResolvedValue('one-use-appcheck');
  harness.init.mockResolvedValue(undefined);
});

describe('lazy cloud account key acquisition', () => {
  it('unlocks an existing key fully offline and never contacts KMS or Vercel', async () => {
    harness.cached = Uint8Array.from(accountKey);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    try {
      expect(await requireCloudAccountDataKey('owner-a', () => {})).toEqual(accountKey);
      expect(fetch).not.toHaveBeenCalled();
      expect(harness.appCheck).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('acquires key from trusted endpoint with disposable App Check and stores only in owner vault', async () => {
    const fetch = vi.fn(async () => Response.json(payload()));
    vi.stubGlobal('fetch', fetch);
    try {
      const result = await requireCloudAccountDataKey('owner-a', () => {});
      expect(result).toEqual(accountKey);
      expect(harness.store).toHaveBeenCalledWith('user:owner-a', accountKey);
      expect(fetch).toHaveBeenCalledOnce();
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toMatch(/\/api\/cloud-key$/);
      expect(init.method).toBe('POST');
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer id-token');
      expect(new Headers(init.headers).get('x-firebase-appcheck')).toBe('one-use-appcheck');
      expect(await requireCloudAccountDataKey('owner-a', () => {})).toEqual(accountKey);
      expect(fetch).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });

  it('requests a rights-only key after consent withdrawal on a fresh device', async () => {
    const fetch = vi.fn(async () => Response.json(payload()));
    vi.stubGlobal('fetch', fetch);
    try {
      const returned = await requireRightsExportAccountDataKey('owner-a', () => {});
      expect(returned).toEqual(accountKey);
      expect(fetch).toHaveBeenCalledOnce();
      const [url] = fetch.mock.calls[0] as unknown as [string];
      expect(url).toContain('/api/cloud-key?purpose=rights-export');
      expect(harness.store).toHaveBeenCalledWith('user:owner-a', accountKey);
    } finally { vi.unstubAllGlobals(); }
  });

  it('refuses foreign owner, malformed response and lost session without persisting keys', async () => {
    const fetch = vi.fn(async () => Response.json({ ...payload(), key: 'too-short' }));
    vi.stubGlobal('fetch', fetch);
    try {
      await expect(requireCloudAccountDataKey('owner-b', () => {}))
        .rejects.toBeInstanceOf(CloudKeyAccessUnavailableError);
      expect(fetch).not.toHaveBeenCalled();
      await expect(requireCloudAccountDataKey('owner-a', () => {}))
        .rejects.toBeInstanceOf(CloudKeyAccessUnavailableError);
      expect(harness.store).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('requires new backend proof after reacceptance before trusting a previously cached key', async () => {
    harness.revision = 42;
    harness.cached = Uint8Array.from(accountKey);
    const fetch = vi.fn(async () => Response.json(payload()));
    vi.stubGlobal('fetch', fetch);
    try {
      expect(await requireCloudAccountDataKey('owner-a', () => {})).toEqual(accountKey);
      expect(fetch).toHaveBeenCalledOnce();
      // A matched key can be used for repeated sync within the same verified
      // session+consent revision; no extra KMS request on every journal drain.
      expect(await requireCloudAccountDataKey('owner-a', () => {})).toEqual(accountKey);
      expect(fetch).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });

  it('never uses an old cached key after an erasure/reacceptance when the server returns a different ADK', async () => {
    harness.revision = 99;
    harness.cached = Uint8Array.from(accountKey);
    harness.store.mockImplementationOnce(async (_owner: string, updated: Uint8Array) => {
      if (Buffer.from(updated).equals(Buffer.from(harness.cached!))) return;
      throw new Error('cloud-account-key-mismatch');
    });
    const newKey = Uint8Array.from({ length: 32 }, (_, index) => (index + 7) % 256);
    const fetch = vi.fn(async () => Response.json({
      ...payload(), key: btoa(String.fromCharCode(...newKey)),
    }));
    vi.stubGlobal('fetch', fetch);
    try {
      await expect(requireCloudAccountDataKey('owner-a', () => {}))
        .rejects.toThrow('cloud-account-key-mismatch');
      expect(fetch).toHaveBeenCalledOnce();
      expect(harness.cached).toEqual(accountKey);
    } finally { vi.unstubAllGlobals(); }
  });

  it('refuses cached account keys if current verified consent is missing', async () => {
    harness.writable = false;
    harness.cached = Uint8Array.from(accountKey);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    try {
      await expect(requireCloudAccountDataKey('owner-a', () => {}))
        .rejects.toBeInstanceOf(CloudKeyAccessUnavailableError);
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('rejects stale request after a session epoch change before the key can be cached', async () => {
    const fetch = vi.fn(async () => Response.json(payload()));
    vi.stubGlobal('fetch', fetch);
    try {
      let checks = 0;
      await expect(requireCloudAccountDataKey('owner-a', () => {
        checks++;
        if (checks >= 5) throw new Error('Sessione cambiata');
      })).rejects.toThrow('Sessione cambiata');
      expect(harness.store).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
