import { describe, expect, it } from 'vitest';
import type { DeletionJobStoreTestContext } from './m7_account_deletion_job_store.test';

export function registerDeletionReceiptCases({
  state, validateReceipt, hashReceipt, createOrRefreshDeletionJob,
  readAuthorizedDeletionJob, readDeletionStatus, readDeletionStatusForUid,
  acquireDeletionLease, markDeletionComplete,
}: DeletionJobStoreTestContext): void {
  describe('receipt ownership, status attestation and bounded recovery proofs', () => {
  it('validates opaque receipts and persists only their hash server-side', () => {
    const receipt = 'A'.repeat(43);
    expect(validateReceipt(receipt)).toBe(receipt);
    expect(hashReceipt(receipt)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashReceipt(receipt)).not.toContain(receipt);
    expect(() => validateReceipt('short')).toThrow('Ricevuta di cancellazione non valida.');
  });

  it('keeps independently issued deletion receipts valid for the same in-flight job', async () => {
    const receiptA = 'A'.repeat(43);
    const receiptB = 'B'.repeat(43);

    await createOrRefreshDeletionJob('u', receiptA);
    await createOrRefreshDeletionJob('u', receiptB);

    expect(await readAuthorizedDeletionJob('u', receiptA)).toMatchObject({ uid: 'u', status: 'requested' });
    expect(await readAuthorizedDeletionJob('u', receiptB)).toMatchObject({ uid: 'u', status: 'requested' });
    expect(await readDeletionStatus('u', receiptA)).toMatchObject({ uid: 'u', status: 'requested' });
    expect(await readDeletionStatus('u', receiptB)).toMatchObject({ uid: 'u', status: 'requested' });

    const stored = state.jobData.get('account_deletions/u') as { receiptHash: string; receiptHashes?: string[] };
    expect(stored.receiptHash).toBe(hashReceipt(receiptA));
    expect(stored.receiptHashes).toContain(hashReceipt(receiptB));
    expect(JSON.stringify(stored)).not.toContain(receiptA);
    expect(JSON.stringify(stored)).not.toContain(receiptB);
  });

  it('rejects false completion for both device and receipt polling, then accepts the leased worker proof', async () => {
    const receipt = 'A'.repeat(43);
    await createOrRefreshDeletionJob('u', receipt);
    const path = 'account_deletions/u';
    const initial = state.jobData.get(path);

    // A stale or damaged status field is not a worker-produced completion proof.
    state.jobData.set(path, { ...initial, status: 'complete', cursor: { phase: 'verifying' } });
    await expect(readDeletionStatusForUid('u')).rejects.toThrow('status integrity check failed');
    await expect(readDeletionStatus('u', receipt)).rejects.toThrow('status integrity check failed');

    // The cursor alone is also insufficient without the receipt-retention marker.
    state.jobData.set(path, { ...initial, status: 'complete', cursor: { phase: 'complete' } });
    await expect(readDeletionStatusForUid('u')).rejects.toThrow('status integrity check failed');
    await expect(readDeletionStatus('u', receipt)).rejects.toThrow('status integrity check failed');

    state.jobData.set(path, initial);
    await acquireDeletionLease('u', 'worker', Date.now() + 60_000);
    await markDeletionComplete('u', 'worker');
    await expect(readDeletionStatusForUid('u')).resolves.toMatchObject({ uid: 'u', status: 'complete' });
    await expect(readDeletionStatus('u', receipt)).resolves.toMatchObject({ uid: 'u', status: 'complete' });
  });

  it('does not return a foreign or malformed job as this owner account state', async () => {
    const receipt = 'B'.repeat(43);
    await createOrRefreshDeletionJob('u', receipt);
    const path = 'account_deletions/u';
    const original = state.jobData.get(path);

    state.jobData.set(path, { ...original, uid: 'other-owner' });
    await expect(readDeletionStatusForUid('u')).rejects.toThrow('status integrity check failed');
    await expect(readDeletionStatus('u', receipt)).rejects.toThrow('status integrity check failed');

    state.jobData.set(path, { ...original, status: 'unexpected' });
    await expect(readDeletionStatusForUid('u')).rejects.toThrow('status integrity check failed');
    await expect(readDeletionStatus('u', receipt)).rejects.toThrow('status integrity check failed');

    state.jobData.set(path, { ...original, status: 'deleting', cursor: { phase: 'complete' } });
    await expect(readDeletionStatusForUid('u')).rejects.toThrow('status integrity check failed');
    await expect(readDeletionStatus('u', receipt)).rejects.toThrow('status integrity check failed');

    state.jobData.set(path, original);
    await expect(readDeletionStatusForUid('u')).resolves.toMatchObject({ uid: 'u', status: 'requested' });
  });

  it('keeps the original receipt stable while bounding additional recovery proofs', async () => {
    const receipts = Array.from({ length: 24 }, (_, index) =>
      String.fromCharCode(65 + (index % 26)).repeat(42) + String(index % 10)
    );

    for (const receipt of receipts) await createOrRefreshDeletionJob('u', receipt);

    const stored = state.jobData.get('account_deletions/u') as { receiptHash: string; receiptHashes?: string[] };
    expect(stored.receiptHash).toBe(hashReceipt(receipts[0]));
    expect(stored.receiptHashes?.length ?? 0).toBeLessThanOrEqual(15);
    expect(await readAuthorizedDeletionJob('u', receipts[0])).not.toBeNull();
    expect(await readAuthorizedDeletionJob('u', receipts.at(-1)!)).not.toBeNull();
  });


    it('never authorizes a foreign receipt or leaks the valid receipt in persisted job state', async () => {
      const original = 'A'.repeat(43);
      const foreign = 'B'.repeat(43);
      await createOrRefreshDeletionJob('owner-a', original);
      await createOrRefreshDeletionJob('owner-b', foreign);

      expect(await readAuthorizedDeletionJob('owner-a', foreign)).toBeNull();
      expect(await readAuthorizedDeletionJob('owner-b', original)).toBeNull();
      expect(await readAuthorizedDeletionJob('owner-a', original)).toMatchObject({ uid: 'owner-a' });
      expect(await readAuthorizedDeletionJob('owner-b', foreign)).toMatchObject({ uid: 'owner-b' });
      for (const uid of ['owner-a', 'owner-b']) {
        const saved = state.jobData.get('account_deletions/' + uid);
        expect(JSON.stringify(saved)).not.toContain(original);
        expect(JSON.stringify(saved)).not.toContain(foreign);
        expect(saved.receiptHash).toMatch(/^[a-f0-9]{64}$/);
      }
      expect(state.docs.has('account_deletions/owner-a')).toBe(true);
      expect(state.docs.has('account_deletions/owner-b')).toBe(true);
    });
  });
}
