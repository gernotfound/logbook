import { describe, expect, it } from 'vitest';
import type { LegacyCloudKeyTestContext } from './m7_cloud_key_api.test';

export function registerLegacyCloudKeyCustodyCases({
  harness, consent, request, POST,
}: LegacyCloudKeyTestContext): void {
  describe('trusted per-owner key custody and consent restrictions', () => {
  it('creates one wrapped server-only key then returns same key on next login without re-encrypting', async () => {
    const first = await POST(request());
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toContain('no-store');
    const a = await first.json();
    expect(a).toMatchObject({ format: 'thelogbook-account-data-key', version: 1 });
    expect(Buffer.from(a.key as string, 'base64')).toHaveLength(32);
    const stored = harness.documents.get('user_data_keys/owner-a');
    expect(stored?.ciphertext).toBeTruthy();
    expect(stored).not.toHaveProperty('plaintext');
    const second = await POST(request());
    expect(second.status).toBe(200);
    expect((await second.json()).key).toBe(a.key);
    expect(harness.wrap).toHaveBeenCalledTimes(1);
    expect(harness.unwrap).toHaveBeenCalledTimes(2);
  });

  it('avoids duplicate preflight reads when the wrapped key already exists', async () => {
    expect((await POST(request())).status).toBe(200);
    harness.documentReads.clear();

    expect((await POST(request())).status).toBe(200);
    // The existing key is read only inside the consent/deletion-fenced
    // transaction; the non-transactional preflight has been removed.
    expect(harness.documentReads.get('user_data_keys/owner-a')).toBe(1);
    expect(harness.documentReads.get('health_consent_withdrawals/owner-a')).toBe(1);
    expect(harness.documentReads.get('account_deletions/owner-a')).toBe(2);
    expect(harness.documentReads.get('health_data_erasures/owner-a')).toBe(2);
    expect(harness.wrap).toHaveBeenCalledTimes(1);
  });

  it.each(['withdrawal', 'account deletion', 'health erasure'] as const)(
    'still refuses a stored key if %s begins before the fenced transaction', async scenario => {
      expect((await POST(request())).status).toBe(200);
      const existing = harness.documents.get('user_data_keys/owner-a');
      harness.beforeTransaction = () => {
        if (scenario === 'withdrawal') {
          harness.documents.set('health_consent_withdrawals/owner-a', { ...consent(), status: 'withdrawn' });
        } else if (scenario === 'account deletion') {
          harness.documents.set('account_deletions/owner-a', { uid: 'owner-a', status: 'requested' });
        } else {
          harness.documents.set('health_data_erasures/owner-a', { uid: 'owner-a', status: 'deleting' });
        }
      };

      expect((await POST(request())).status).toBe(503);
      expect(harness.documents.get('user_data_keys/owner-a')).toEqual(existing);
      expect(harness.wrap).toHaveBeenCalledTimes(1);
    },
  );


  it('refuses provisioning over ANY existing plaintext or encrypted cloud state', async () => {
    for (const path of [
      'users/owner-a',
      'users/owner-a/sync_control/state',
      'users/owner-a/history_months/2026-10',
      'users/owner-a/nutrition_months/2026-10',
    ]) {
      harness.documents.set(path, { _sealed: 'existing-patient-data' });
      expect((await POST(request())).status).toBe(409);
      expect(harness.documents.has('user_data_keys/owner-a')).toBe(false);
      harness.documents.delete(path);
    }
  });

  it.each([
    ['known history', 'users/owner-a/history_months/2026-10/orphan/secret'],
    ['known nutrition', 'users/owner-a/nutrition_months/2026-10/orphan/secret'],
    ['unexpected', 'users/owner-a/undocumented/ghost/private/secret'],
  ])('refuses key provisioning over missing parent documents in %s collections', async (_type, path) => {
    harness.documents.set(path, { _sealed: 'orphaned-health-data' });

    const result = await POST(request());

    expect(result.status).toBe(409);
    expect(harness.documents.has('user_data_keys/owner-a')).toBe(false);
    expect(harness.documents.get(path)).toMatchObject({ _sealed: 'orphaned-health-data' });
    expect(harness.wrap).not.toHaveBeenCalled();
  });

  it('blocks missing/withdrawn consent, account deletion and incomplete erasure', async () => {
    harness.documents.delete('health_consent_withdrawals/owner-a');
    expect((await POST(request())).status).toBe(503);
    harness.documents.set('health_consent_withdrawals/owner-a', { ...consent(), status: 'withdrawn' });
    expect((await POST(request())).status).toBe(503);
    harness.documents.set('health_consent_withdrawals/owner-a', consent());
    harness.documents.set('account_deletions/owner-a', { status: 'requested' });
    expect((await POST(request())).status).toBe(503);
    harness.documents.delete('account_deletions/owner-a');
    harness.documents.set('health_data_erasures/owner-a', { status: 'deleting' });
    expect((await POST(request())).status).toBe(503);
    expect(harness.documents.has('user_data_keys/owner-a')).toBe(false);
    // Neither invalid consent nor an in-progress deletion spends a secret-dependent
    // wrapping call; the transaction rechecks those fences after preflight.
    expect(harness.wrap).not.toHaveBeenCalled();
  });

  it('does not regenerate malformed envelopes or expose backend key errors', async () => {
    harness.documents.set('user_data_keys/owner-a', { uid: 'owner-a', version: 999, ciphertext: 'invalid' });
    expect((await POST(request())).status).toBe(503);
    expect(harness.wrap).not.toHaveBeenCalled();
    harness.documents.delete('user_data_keys/owner-a');
    harness.wrap.mockRejectedValueOnce(new Error('missing protected server secret'));
    const result = await POST(request());
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain('protected server secret');
    expect(harness.documents.has('user_data_keys/owner-a')).toBe(false);
  });

  it('permits authenticated rights-only recovery after withdrawal without ever provisioning a new key', async () => {
    const first = await POST(request());
    expect(first.status).toBe(200);
    const original = (await first.json() as { key: string }).key;
    harness.documents.set('health_consent_withdrawals/owner-a', {
      uid: 'owner-a', status: 'withdrawn', revision: 2,
    });
    harness.verify.mockResolvedValue({ uid: 'owner-a', emailVerified: false });
    const rights = await POST(new Request('https://backend.test/api/cloud-key?purpose=rights-export', {
      method: 'POST', headers: { origin: 'https://thelogbook.web.app' },
    }));
    expect(rights.status).toBe(200);
    expect((await rights.json() as { key: string }).key).toBe(original);
    expect(harness.wrap).toHaveBeenCalledTimes(1);
    expect((await POST(request())).status).toBe(403);

    harness.documents.delete('user_data_keys/owner-a');
    const missing = await POST(new Request('https://backend.test/api/cloud-key?purpose=rights-export', {
      method: 'POST', headers: { origin: 'https://thelogbook.web.app' },
    }));
    expect(missing.status).toBe(503);
    expect(harness.documents.has('user_data_keys/owner-a')).toBe(false);
  });


  it('does not release an ADK or provision new keys during the actual withdrawal/erasure protocol', async () => {
    expect((await POST(request())).status).toBe(200);
    const existingKey = harness.documents.get('user_data_keys/owner-a');
    harness.documents.set('health_consent_withdrawals/owner-a', {
      uid: 'owner-a', status: 'withdrawn', revision: 2,
    });
    // Production withdrawal atomically queues the erasure job; a synthetic
    // withdrawn-only state is not a valid substitute for that transition.
    harness.documents.set('health_data_erasures/owner-a', {
      uid: 'owner-a', consentRevision: 2, status: 'requested',
    });
    harness.verify.mockResolvedValue({ uid: 'owner-a', emailVerified: false });
    const rights = () => new Request('https://backend.test/api/cloud-key?purpose=rights-export', {
      method: 'POST', headers: { origin: 'https://thelogbook.web.app' },
    });
    expect((await POST(rights())).status).toBe(503);
    expect(harness.documents.get('user_data_keys/owner-a')).toEqual(existingKey);

    // Successful erasure removes the wrapped key before a new consent.
    harness.documents.delete('user_data_keys/owner-a');
    harness.documents.set('health_data_erasures/owner-a', {
      uid: 'owner-a', consentRevision: 2, completedRevision: 3, status: 'complete',
    });
    harness.documents.set('health_consent_withdrawals/owner-a', {
      uid: 'owner-a', status: 'withdrawn', revision: 3, erasedBeforeRevision: 2,
    });
    expect((await POST(rights())).status).toBe(503);
    expect(harness.documents.has('user_data_keys/owner-a')).toBe(false);
    expect(harness.wrap).toHaveBeenCalledTimes(1);
  });

  it('separates independently authenticated owners without overwriting either wrapped key', async () => {
    harness.documents.set('health_consent_withdrawals/owner-b', { ...consent(), uid: 'owner-b' });
    harness.verify.mockResolvedValueOnce({ uid: 'owner-b', emailVerified: true });

    const ownerB = await POST(request());
    expect(ownerB.status).toBe(200);
    const keyB = (await ownerB.json() as { key: string }).key;
    const storedB = harness.documents.get('user_data_keys/owner-b');
    expect(storedB).toMatchObject({ uid: 'owner-b', version: 1, keyVersion: 1 });
    expect(harness.documents.has('user_data_keys/owner-a')).toBe(false);

    const ownerA = await POST(request());
    expect(ownerA.status).toBe(200);
    const keyA = (await ownerA.json() as { key: string }).key;
    expect(keyA).not.toBe(keyB);
    expect(harness.documents.get('user_data_keys/owner-b')).toEqual(storedB);
    expect(harness.documents.get('user_data_keys/owner-a')).toMatchObject({
      uid: 'owner-a', version: 1, keyVersion: 1,
    });
    expect(harness.wrap).toHaveBeenCalledTimes(2);
    expect(harness.wrap).toHaveBeenNthCalledWith(1, 'owner-b', expect.any(Buffer));
    expect(harness.wrap).toHaveBeenNthCalledWith(2, 'owner-a', expect.any(Buffer));
  });

  it('zeroizes temporary unwrapped key bytes after successfully forming the authenticated response', async () => {
    const originalUnwrap = harness.unwrap.getMockImplementation();
    let unwrapped: Buffer | undefined;
    harness.unwrap.mockImplementationOnce(async (uid, envelope) => {
      // Retain the mock's production-compatible Buffer type while observing
      // the exact bytes later zeroized by the response finalizer.
      const bytes = await originalUnwrap!(uid, envelope);
      unwrapped = bytes;
      return bytes;
    });

    const response = await POST(request());
    expect(response.status).toBe(200);
    const key = Buffer.from((await response.json() as { key: string }).key, 'base64');
    expect(key).toHaveLength(32);
    expect(unwrapped).toBeDefined();
    expect(unwrapped).toHaveLength(32);
    expect(unwrapped?.every(byte => byte === 0)).toBe(true);
    expect(key.equals(Buffer.alloc(32, 0))).toBe(false);
    expect(harness.documents.get('user_data_keys/owner-a')).toHaveProperty('ciphertext');
  });
  });
}
