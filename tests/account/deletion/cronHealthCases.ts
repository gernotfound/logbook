import { expect, it, vi } from 'vitest';
import type { CronRecoveryTestContext } from './m7_account_deletion_cron.test';

export function registerCronHealthCases({
  GET, request, healthErasure, runner, retention, inactivity, store,
}: CronRecoveryTestContext): void {
  it('resumes bounded health-data erasures without blocking independent account-deletion recovery', async () => {
    process.env.CRON_SECRET = 'test-secret';
    healthErasure.listRecoverableHealthErasures.mockResolvedValue(['health-1', 'health-2']);
    healthErasure.processHealthDataErasure.mockResolvedValueOnce('complete').mockRejectedValueOnce(new Error('temporary'));
    const logger = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await GET(request('test-secret'));
      expect(response.status).toBe(200);
      expect(healthErasure.processHealthDataErasure).toHaveBeenCalledTimes(2);
      expect(store.listRecoverableDeletionJobs).toHaveBeenCalledTimes(1);
      expect(runner.processAccountDeletion).toHaveBeenCalledTimes(2);
      expect(await response.json()).toMatchObject({
        erasureScanned: 2,
        erasureProcessed: 1,
        erasureCompleted: 1,
        erasurePending: 0,
        erasureBusy: 0,
        erasureFailed: 0,
        erasureErrors: 1,
        erasureReceiptsPurged: 0,
        processed: 2,
      });
    } finally { logger.mockRestore(); }
  });

  it('reports busy/pending health attempts separately from completed receipt purges', async () => {
    process.env.CRON_SECRET = 'test-secret';
    healthErasure.listRecoverableHealthErasures.mockResolvedValue(['health-1', 'health-2']);
    healthErasure.processHealthDataErasure
      .mockResolvedValueOnce('busy').mockResolvedValueOnce('pending');
    healthErasure.purgeExpiredCompletedHealthErasures.mockResolvedValue(3);

    const response = await GET(request('test-secret'));
    expect(response.status).toBe(200);
    expect(healthErasure.processHealthDataErasure).toHaveBeenCalledTimes(2);
    expect(healthErasure.purgeExpiredCompletedHealthErasures).toHaveBeenCalledOnce();
    const body = await response.json();
    expect(body).toMatchObject({
      erasureScanned: 2,
      erasureProcessed: 2,
      erasureCompleted: 0,
      erasurePending: 1,
      erasureBusy: 1,
      erasureFailed: 0,
      erasureErrors: 0,
      erasureReceiptsPurged: 3,
      processed: 2,
    });
    expect(JSON.stringify(body)).not.toContain('health-1');
    expect(JSON.stringify(body)).not.toContain('health-2');
  });

  it('exposes returned failed erasure outcomes even when no exception is thrown', async () => {
    process.env.CRON_SECRET = 'test-secret';
    healthErasure.listRecoverableHealthErasures.mockResolvedValue(['failed-owner', 'completed-owner']);
    healthErasure.processHealthDataErasure
      .mockResolvedValueOnce('failed').mockResolvedValueOnce('complete');

    const response = await GET(request('test-secret'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      erasureScanned: 2,
      erasureProcessed: 2,
      erasureCompleted: 1,
      erasurePending: 0,
      erasureBusy: 0,
      erasureFailed: 1,
      erasureErrors: 0,
    });
    expect(JSON.stringify(body)).not.toContain('failed-owner');
    expect(JSON.stringify(body)).not.toContain('completed-owner');
    expect(runner.processAccountDeletion).toHaveBeenCalledTimes(2);
  });

  it('reports independent health query and receipt-retention failures without stopping account recovery', async () => {
    process.env.CRON_SECRET = 'test-secret';
    healthErasure.listRecoverableHealthErasures.mockRejectedValue(new Error('query unavailable'));
    healthErasure.purgeExpiredCompletedHealthErasures.mockRejectedValue(new Error('retention unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await GET(request('test-secret'));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        erasureScanned: 0,
        erasureProcessed: 0,
        erasureCompleted: 0,
        erasurePending: 0,
        erasureBusy: 0,
        erasureFailed: 0,
        erasureErrors: 2,
        erasureReceiptsPurged: 0,
        processed: 2,
      });
      expect(runner.processAccountDeletion).toHaveBeenCalledTimes(2);
    } finally { log.mockRestore(); }
  });


  it('stops starting new account work and retention after the health phase exhausts the safety margin', async () => {
    process.env.CRON_SECRET = 'test-secret';
    process.env.ACCOUNT_INACTIVITY_TRACKING_ENABLED = 'true';
    process.env.ACCOUNT_INACTIVITY_DELETION_ENABLED = 'true';
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    healthErasure.listRecoverableHealthErasures.mockResolvedValue(['health-one', 'health-two']);
    healthErasure.processHealthDataErasure.mockImplementationOnce(async () => {
      now = 1_260_000;
      return 'pending';
    });
    try {
      const response = await GET(request('test-secret'));
      expect(response.status).toBe(200);
      expect(healthErasure.listRecoverableHealthErasures).toHaveBeenCalledWith(8);
      expect(healthErasure.processHealthDataErasure).toHaveBeenCalledExactlyOnceWith('health-one', 1_010_000);
      expect(store.listRecoverableDeletionJobs).toHaveBeenCalledWith(25);
      expect(runner.processAccountDeletion).not.toHaveBeenCalled();
      expect(inactivity.queueInactiveAccountDeletions).not.toHaveBeenCalled();
      expect(retention.purgeExpiredCompletedDeletionJobs).not.toHaveBeenCalled();
      expect(healthErasure.purgeExpiredCompletedHealthErasures).not.toHaveBeenCalled();
      expect(await response.json()).toMatchObject({
        scanned: 2, processed: 0, accountCompleted: 0,
        erasureScanned: 2, erasureProcessed: 1, erasurePending: 1,
        inactiveQueued: 0, purged: 0, erasureReceiptsPurged: 0,
      });
    } finally {
      clock.mockRestore();
    }
  });
}
