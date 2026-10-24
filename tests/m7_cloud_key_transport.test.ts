import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  user: { uid: 'owner-a', getIdToken: vi.fn(async () => 'id-token') },
  check: vi.fn(async () => 'one-use-appcheck'),
  init: vi.fn(async () => {}),
  revision: 1,
  writable: true,
  epoch: 'epoch-1',
}));
vi.mock('../src/lib/firebase', () => ({
  auth: { currentUser: h.user }, ensureAppCheck: h.init,
}));
vi.mock('../src/lib/appCheck', () => ({ getLimitedUseAppCheckToken: h.check }));
vi.mock('../src/lib/healthConsent', () => ({
  getVerifiedHealthConsentRevision: () => h.revision,
  isHealthConsentCloudWritable: () => h.writable,
}));
vi.mock('../src/lib/sync/session', () => ({
  userOwner: (uid: string) => 'user:' + uid,
  captureSessionForOwner: (owner: string) => ({ owner, epoch: h.epoch }),
  isCurrentSession: (session: { epoch: string; owner: string }) =>
    session.epoch === h.epoch && session.owner === 'user:' + h.user.uid,
}));

import {
  requireCloudAccountDataKey, requireRightsExportAccountDataKey,
  CloudKeyAccessUnavailableError,
} from '../src/lib/sync/cloudAccountKeyAccess';

const originalKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const payload = (key = originalKey) => ({
  format: 'thelogbook-account-data-key', version: 1,
  key: btoa(String.fromCharCode(...key)),
});

beforeEach(() => {
  vi.clearAllMocks();
  h.user.uid = 'owner-a';
  h.user.getIdToken.mockResolvedValue('id-token');
  h.check.mockResolvedValue('one-use-appcheck');
  h.revision = 1;
  h.writable = true;
  h.epoch = 'epoch-1';
});

afterEach(() => vi.unstubAllGlobals());

describe('online account-key access without a second device-persisted key', () => {
  it('fetches a fresh authenticated key for each online operation, with no persistent cache', async () => {
    const fetch = vi.fn(async () => Response.json(payload()));
    vi.stubGlobal('fetch', fetch);
    expect(await requireCloudAccountDataKey('owner-a', () => {})).toEqual(originalKey);
    expect(await requireCloudAccountDataKey('owner-a', () => {})).toEqual(originalKey);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(h.check).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/cloud-key$/);
    expect(init.method).toBe('POST');
    expect(init.cache).toBe('no-store');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer id-token');
    expect(new Headers(init.headers).get('x-firebase-appcheck')).toBe('one-use-appcheck');
  });

  it('recovers a rotated ADK after completed health-data erasure and a new consent generation', async () => {
    const rotated = Uint8Array.from({ length: 32 }, (_, i) => (i + 41) % 256);
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json(payload()))
      .mockResolvedValueOnce(Response.json(payload(rotated)));
    vi.stubGlobal('fetch', fetch);
    const first = await requireCloudAccountDataKey('owner-a', () => {});
    h.revision = 3;
    const second = await requireCloudAccountDataKey('owner-a', () => {});
    expect(first).toEqual(originalKey);
    expect(second).toEqual(rotated);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(first).toEqual(originalKey);
  });

  it('gets an existing key for explicit rights export after withdrawal without normal sync privileges', async () => {
    h.writable = false;
    const fetch = vi.fn(async () => Response.json(payload()));
    vi.stubGlobal('fetch', fetch);
    await expect(requireCloudAccountDataKey('owner-a', () => {}))
      .rejects.toBeInstanceOf(CloudKeyAccessUnavailableError);
    expect(await requireRightsExportAccountDataKey('owner-a', () => {})).toEqual(originalKey);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toContain('?purpose=rights-export');
  });

  it('blocks foreign accounts, unverified consent and HTTP denial before releasing an ADK', async () => {
    const fetch = vi.fn(async () => Response.json({ error: 'not available' }, { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    await expect(requireCloudAccountDataKey('owner-b', () => {}))
      .rejects.toBeInstanceOf(CloudKeyAccessUnavailableError);
    h.writable = false;
    await expect(requireCloudAccountDataKey('owner-a', () => {}))
      .rejects.toBeInstanceOf(CloudKeyAccessUnavailableError);
    expect(fetch).not.toHaveBeenCalled();
    h.writable = true;
    await expect(requireCloudAccountDataKey('owner-a', () => {}))
      .rejects.toBeInstanceOf(CloudKeyAccessUnavailableError);
  });

  it('rejects malformed and attacker-controlled server key material', async () => {
    const fetch = vi.fn(async () => Response.json({ ...payload(), key: 'not-base64' }));
    vi.stubGlobal('fetch', fetch);
    await expect(requireCloudAccountDataKey('owner-a', () => {}))
      .rejects.toBeInstanceOf(CloudKeyAccessUnavailableError);
    fetch.mockResolvedValueOnce(Response.json({ ...payload(), uid: 'owner-a' }));
    await expect(requireCloudAccountDataKey('owner-a', () => {}))
      .rejects.toBeInstanceOf(CloudKeyAccessUnavailableError);
  });

  it('rejects late responses after a session switch, even when the UID changes back', async () => {
    const fetch = vi.fn(async () => {
      h.epoch = 'epoch-2';
      return Response.json(payload());
    });
    vi.stubGlobal('fetch', fetch);
    await expect(requireCloudAccountDataKey('owner-a', () => {}))
      .rejects.toBeInstanceOf(CloudKeyAccessUnavailableError);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects a consent revision change while an App Check request is in flight', async () => {
    h.check.mockImplementationOnce(async () => {
      h.revision = 3;
      return 'one-use-appcheck';
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(requireCloudAccountDataKey('owner-a', () => {}))
      .rejects.toBeInstanceOf(CloudKeyAccessUnavailableError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
