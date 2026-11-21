import { expect, it, vi } from 'vitest';
import type { CronRecoveryTestContext } from './m7_account_deletion_cron.test';

export function registerCronAccountCases({
  GET, request, store, runner, retention,
}: CronRecoveryTestContext): void {
  it('processes recoverable jobs with the shared idempotent runner when authorized', async () => {
    process.env.CRON_SECRET = 'expected-secret';
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const response = await GET(request('expected-secret'));

    expect(response.status).toBe(200);
    expect(store.listRecoverableDeletionJobs).toHaveBeenCalledWith(25);
    expect(runner.processAccountDeletion).toHaveBeenCalledTimes(2);
    expect(runner.processAccountDeletion).toHaveBeenNthCalledWith(1, 'a', expect.any(Number));
    expect(runner.processAccountDeletion).toHaveBeenNthCalledWith(2, 'b', expect.any(Number));
    expect(retention.purgeExpiredCompletedDeletionJobs).toHaveBeenCalledWith(400, undefined, expect.any(Number), expect.objectContaining({ scanned: 0 }));
    expect(await response.json()).toMatchObject({
      scanned: 2,
      processed: 2,
      accountCompleted: 2,
      accountPending: 0,
      accountBusy: 0,
      accountFailed: 0,
      erasureScanned: 0,
      erasureProcessed: 0,
      erasureCompleted: 0,
      erasurePending: 0,
      erasureBusy: 0,
      erasureFailed: 0,
      erasureErrors: 0,
      erasureReceiptsPurged: 0,
      inactiveScanned: 0,
      inactiveQueued: 0,
      inactivityErrors: 0,
      recoveryErrors: 0,
      retentionErrors: 0,
      purged: 0,
    });
    expect(info).toHaveBeenCalledWith('[account-deletion-cron] completed', {
      scanned: 2,
      processed: 2,
      accountCompleted: 2,
      accountPending: 0,
      accountBusy: 0,
      accountFailed: 0,
      erasureScanned: 0,
      erasureProcessed: 0,
      erasureCompleted: 0,
      erasurePending: 0,
      erasureBusy: 0,
      erasureFailed: 0,
      erasureErrors: 0,
      erasureReceiptsPurged: 0,
      inactiveScanned: 0,
      inactiveQueued: 0,
      inactivityErrors: 0,
      recoveryErrors: 0,
      retentionErrors: 0,
      purged: 0,
    });
    info.mockRestore();
  });

  it('counts account worker outcomes without exposing owner identifiers', async () => {
    process.env.CRON_SECRET = 'test-secret';
    store.listRecoverableDeletionJobs.mockResolvedValue([
      { uid: 'private-owner-a' }, { uid: 'private-owner-b' },
      { uid: 'private-owner-c' }, { uid: 'private-owner-d' },
    ]);
    runner.processAccountDeletion.mockResolvedValueOnce('complete')
      .mockResolvedValueOnce('pending')
      .mockResolvedValueOnce('busy')
      .mockResolvedValueOnce('failed');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const response = await GET(request('test-secret'));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        scanned: 4, processed: 4, accountCompleted: 1, accountPending: 1,
        accountBusy: 1, accountFailed: 1, recoveryErrors: 0,
      });
      expect(body).not.toHaveProperty('results');
      expect(JSON.stringify(body)).not.toContain('private-owner-');
      expect(info).toHaveBeenCalledWith('[account-deletion-cron] completed', body);
      expect(errors).toHaveBeenCalledWith(
        '[account-deletion-cron] recovery workers reported failed outcomes', { failed: 1 },
      );
      expect(retention.purgeExpiredCompletedDeletionJobs).toHaveBeenCalledOnce();
    } finally { errors.mockRestore(); info.mockRestore(); }
  });

  it('continues independent cron phases if job selection fails', async () => {
  process.env.CRON_SECRET = 'expected-secret';
  store.listRecoverableDeletionJobs.mockRejectedValueOnce(new Error('list unavailable'));
  const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const response = await GET(request('expected-secret'));
    expect(response.status).toBe(200);
    expect((await response.json())).toMatchObject({ recoveryErrors: 1, processed: 0 });
    expect(retention.purgeExpiredCompletedDeletionJobs).toHaveBeenCalled();
  } finally { err.mockRestore(); }
});

it('continues other jobs if one runner fails before lease acquisition', async () => {
  process.env.CRON_SECRET = 'expected-secret';
  runner.processAccountDeletion.mockRejectedValueOnce(new Error('lease failed')).mockResolvedValueOnce('complete');
  const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const response = await GET(request('expected-secret'));
    expect((await response.json())).toMatchObject({
      recoveryErrors: 1, processed: 2, accountCompleted: 1, accountFailed: 0,
    });
    expect(runner.processAccountDeletion).toHaveBeenCalledTimes(2);
  } finally { err.mockRestore(); }
});

  it('gives account deletion the full cron budget without reducing the safety buffer', async () => {
    process.env.CRON_SECRET = 'expected-secret';
    runner.processAccountDeletion.mockResolvedValue('pending');
    const startedAt = Date.now();
    const response = await GET(request('expected-secret'));
    const finishedAt = Date.now();
    expect(response.status).toBe(200);
    expect(runner.processAccountDeletion).toHaveBeenCalledTimes(2);
    const deadlines = runner.processAccountDeletion.mock.calls.map(call => call[1] as number);
    expect(deadlines[0]).toBe(deadlines[1]);
    expect(deadlines[0]).toBeGreaterThanOrEqual(startedAt + 270_000);
    expect(deadlines[0]).toBeLessThanOrEqual(finishedAt + 270_000);
    expect(await response.json()).toMatchObject({
      processed: 2, accountPending: 2, accountFailed: 0, recoveryErrors: 0,
    });
  });
}
