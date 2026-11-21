import { expect, it, vi } from 'vitest';
import type { CronRecoveryTestContext } from './m7_account_deletion_cron.test';

export function registerCronRetentionCases({
  GET, request, store, runner, retention, healthErasure,
}: CronRecoveryTestContext): void {
  it('uses only the residual cron budget for completed tombstone garbage collection', async () => {
    process.env.CRON_SECRET = 'expected-secret';
    const order: string[] = [];
    store.listRecoverableDeletionJobs.mockResolvedValue([{ uid: 'a' }]);
    runner.processAccountDeletion.mockImplementation(async () => {
      order.push('recover');
      return 'complete';
    });
    retention.purgeExpiredCompletedDeletionJobs.mockImplementation(async () => {
      order.push('purge');
      return 2;
    });

    const response = await GET(request('expected-secret'));

    expect(response.status).toBe(200);
    expect(order).toEqual(['recover', 'purge']);
    expect(await response.json()).toMatchObject({
      scanned: 1,
      processed: 1,
      purged: 2,
    });
  });

  it('advances beyond skipped expired receipts instead of exiting on zero deletions', async () => {
    process.env.CRON_SECRET = 'expected-secret';
    retention.purgeExpiredCompletedDeletionJobs
      .mockImplementationOnce(async (_limit: number, _now: unknown, _deadline: number, page: { scanned: number }) => {
        page.scanned = 400;
        return 0;
      })
      .mockImplementationOnce(async (_limit: number, _now: unknown, _deadline: number, page: { scanned: number }) => {
        page.scanned = 1;
        return 1;
      });
    const response = await GET(request('expected-secret'));
    expect(response.status).toBe(200);
    expect(retention.purgeExpiredCompletedDeletionJobs).toHaveBeenCalledTimes(2);
    expect((await response.json())).toMatchObject({ purged: 1, retentionErrors: 0 });
  });

  it('reserves time for health receipts when account receipt retention has an unbounded backlog', async () => {
    process.env.CRON_SECRET = 'expected-secret';
    let clockMs = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => clockMs);
    retention.purgeExpiredCompletedDeletionJobs.mockImplementation(
      async (_limit: number, _now: unknown, _deadline: number, page: { scanned: number }) => {
        page.scanned = 400;
        clockMs += 30_000;
        return 1;
      },
    );
    healthErasure.purgeExpiredCompletedHealthErasures.mockResolvedValue(2);
    try {
      const response = await GET(request('expected-secret'));
      expect(response.status).toBe(200);
      expect(retention.purgeExpiredCompletedDeletionJobs).toHaveBeenCalledTimes(2);
      expect(retention.purgeExpiredCompletedDeletionJobs.mock.calls.map(call => call[2]))
        .toEqual([1_060_000, 1_060_000]);
      expect(healthErasure.purgeExpiredCompletedHealthErasures).toHaveBeenCalledWith(1_270_000);
      expect(await response.json()).toMatchObject({
        purged: 2, erasureReceiptsPurged: 2, retentionErrors: 0, erasureErrors: 0,
      });
    } finally {
      clock.mockRestore();
    }
  });

  it('gives the final available window to health receipts after lengthy account recovery', async () => {
    process.env.CRON_SECRET = 'expected-secret';
    let clockMs = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => clockMs);
    runner.processAccountDeletion.mockImplementation(async () => {
      clockMs = 1_250_000;
      return 'pending';
    });
    try {
      const response = await GET(request('expected-secret'));
      expect(response.status).toBe(200);
      expect(retention.purgeExpiredCompletedDeletionJobs).not.toHaveBeenCalled();
      expect(healthErasure.purgeExpiredCompletedHealthErasures).toHaveBeenCalledWith(1_270_000);
      expect(await response.json()).toMatchObject({
        accountPending: 2, erasureReceiptsPurged: 0,
      });
    } finally {
      clock.mockRestore();
    }
  });

it('reports completed tombstone cleanup failure without stopping recovery', async () => {
  process.env.CRON_SECRET = 'expected-secret';
  retention.purgeExpiredCompletedDeletionJobs.mockRejectedValueOnce(new Error('cleanup failed'));
  const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const response = await GET(request('expected-secret'));
    expect((await response.json())).toMatchObject({ retentionErrors: 1, purged: 0 });
  } finally { err.mockRestore(); }
});

}
