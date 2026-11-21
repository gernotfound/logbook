import { describe, expect, it } from 'vitest';
import type { LegacyCloudKeyTestContext } from './m7_cloud_key_api.test';

export function registerLegacyCloudKeyConcurrencyCases({
  harness, consent, request, POST,
}: LegacyCloudKeyTestContext): void {
  describe('consent epoch changes, concurrent provisioning and key release', () => {
  it('does not release an old ADK when a new active consent epoch replaces the transacted epoch', async () => {
    const unwrappedKeys: Buffer[] = [];
    harness.unwrap.mockImplementationOnce(async (_uid, wrapped) => {
      const bytes = Buffer.from(wrapped.ciphertext, 'base64');
      unwrappedKeys.push(bytes);
      return bytes;
    });
    // Simulate a new, server-owned consent generation between the successful
    // Firestore transaction and the final release check. The same status is
    // insufficient evidence that the selected key still belongs to this epoch.
    harness.afterTransaction = () => {
      // Model the real trusted sequence: withdraw revision 2, complete erasure
      // at revision 3 (destroying the old wrapped key), reaccept revision 4.
      harness.documents.delete('user_data_keys/owner-a');
      harness.documents.set('health_data_erasures/owner-a', {
        uid: 'owner-a', consentRevision: 2, completedRevision: 3, status: 'complete',
      });
      harness.documents.set('health_consent_withdrawals/owner-a', {
        ...consent(), revision: 4, erasedBeforeRevision: 2,
      });
    };
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/[A-Za-z0-9+/]{43}=/);
    expect(unwrappedKeys).toHaveLength(1);
    expect(unwrappedKeys[0].every(byte => byte === 0)).toBe(true);
    expect(harness.documents.has('user_data_keys/owner-a')).toBe(false);
    expect(harness.wrap).toHaveBeenCalledTimes(1);
  });


  it('rechecks consent in the provisioning transaction after the first key check', async () => {
    const wrap = harness.wrap.getMockImplementation();
    harness.wrap.mockImplementationOnce(async (uid, secret) => {
      const result = await wrap!(uid, secret);
      harness.beforeTransaction = () => harness.documents.set(
        'health_consent_withdrawals/owner-a', { ...consent(), status: 'withdrawn' },
      );
      return result;
    });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(harness.wrap).toHaveBeenCalledTimes(1);
    expect(harness.documents.has('user_data_keys/owner-a')).toBe(false);
  });

  it('adopts a concurrent provisioning winner without replacing its wrapped key', async () => {
    const concurrentKey = Buffer.alloc(32, 77);
    const wrapper = harness.wrap.getMockImplementation();
    harness.wrap.mockImplementationOnce(async (uid, secret) => {
      const candidate = await wrapper!(uid, secret);
      harness.beforeTransaction = () => {
        harness.documents.set('user_data_keys/owner-a', {
          ...candidate, ciphertext: concurrentKey.toString('base64'),
        });
      };
      return candidate;
    });

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(Buffer.from((await response.json() as { key: string }).key, 'base64')).toEqual(concurrentKey);
    expect(harness.documents.get('user_data_keys/owner-a')?.ciphertext).toBe(concurrentKey.toString('base64'));
    expect(harness.wrap).toHaveBeenCalledTimes(1);
    expect(harness.documentReads.get('user_data_keys/owner-a')).toBe(2);
  });

  it('never releases key bytes if consent is withdrawn immediately after transaction commit', async () => {
    harness.afterTransaction = () => harness.documents.set(
      'health_consent_withdrawals/owner-a', { ...consent(), status: 'withdrawn' },
    );
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect((await response.text())).not.toMatch(/[A-Za-z0-9+/]{43}=/);
    // Provisioning was atomic before withdrawal, but the final read must
    // still reject releasing its bytes under now-withdrawn consent.
    expect(harness.documents.has('user_data_keys/owner-a')).toBe(true);
    expect((await POST(request())).status).toBe(503);
  });
  });
}
