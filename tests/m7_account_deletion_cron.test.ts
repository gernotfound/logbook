import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  listRecoverableDeletionJobs: vi.fn(),
}));
const runner = vi.hoisted(() => ({
  processAccountDeletion: vi.fn(),
}));
const retention = vi.hoisted(() => ({
  ACCOUNT_DELETION_RETENTION_PAGE_SIZE: 400,
  purgeExpiredCompletedDeletionJobs: vi.fn(),
}));
const telemetryRetention = vi.hoisted(() => ({
  purgeExpiredTelemetry: vi.fn(),
}));

vi.mock('../functions/src/accountDeletion/jobStore', () => store);
vi.mock('../functions/src/accountDeletion/runner', () => runner);
vi.mock('../functions/src/accountDeletion/retention', () => retention);
vi.mock('../functions/src/telemetryRetention', () => telemetryRetention);

import { runAccountDeletionMaintenance } from '../functions/src/maintenance';

describe('M7 Firebase scheduled account deletion maintenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.listRecoverableDeletionJobs
      .mockResolvedValueOnce([{ uid: 'a' }, { uid: 'b' }])
      .mockResolvedValue([]);
    runner.processAccountDeletion.mockResolvedValue('complete');
    retention.purgeExpiredCompletedDeletionJobs.mockResolvedValue(0);
    telemetryRetention.purgeExpiredTelemetry.mockResolvedValue({
      usersScanned: 0,
      documentsDeleted: 0,
      completedCycle: true,
    });
  });

  it('processes recoverable jobs with the shared idempotent runner', async () => {
    const summary = await runAccountDeletionMaintenance(Date.now() + 60_000);

    expect(store.listRecoverableDeletionJobs).toHaveBeenCalledWith(25);
    expect(runner.processAccountDeletion).toHaveBeenCalledTimes(2);
    expect(runner.processAccountDeletion).toHaveBeenNthCalledWith(1, 'a', expect.any(Number));
    expect(runner.processAccountDeletion).toHaveBeenNthCalledWith(2, 'b', expect.any(Number));
    expect(retention.purgeExpiredCompletedDeletionJobs).toHaveBeenCalledWith(400);
    expect(telemetryRetention.purgeExpiredTelemetry).toHaveBeenCalledWith(expect.any(Number));
    expect(summary).toMatchObject({
      scanned: 2,
      processed: 2,
      completed: 2,
      pending: 0,
      failed: 0,
      busy: 0,
      purged: 0,
      telemetryUsersScanned: 0,
      telemetryPurged: 0,
      telemetryCycleCompleted: true,
    });
  });

  it('drains additional full recovery pages before spending residual budget on retention', async () => {
    vi.clearAllMocks();
    store.listRecoverableDeletionJobs.mockReset();
    const firstPage = Array.from({ length: 25 }, (_, index) => ({ uid: `p1-${index}` }));
    const secondPage = [{ uid: 'p2' }];
    store.listRecoverableDeletionJobs
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage);
    runner.processAccountDeletion.mockResolvedValue('pending');
    retention.purgeExpiredCompletedDeletionJobs.mockResolvedValue(0);
    telemetryRetention.purgeExpiredTelemetry.mockResolvedValue({
      usersScanned: 0,
      documentsDeleted: 0,
      completedCycle: true,
    });

    const summary = await runAccountDeletionMaintenance(Date.now() + 120_000);

    expect(store.listRecoverableDeletionJobs).toHaveBeenCalledTimes(2);
    expect(runner.processAccountDeletion).toHaveBeenCalledTimes(26);
    expect(summary.scanned).toBe(26);
    expect(summary.processed).toBe(26);
    expect(summary.pending).toBe(26);
  });

  it('keeps deletion recovery successful when telemetry retention fails', async () => {
    store.listRecoverableDeletionJobs.mockReset().mockResolvedValueOnce([{ uid: 'a' }]);
    telemetryRetention.purgeExpiredTelemetry.mockRejectedValue(new Error('telemetry unavailable'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const summary = await runAccountDeletionMaintenance(Date.now() + 60_000);

    expect(runner.processAccountDeletion).toHaveBeenCalledWith('a', expect.any(Number));
    expect(summary).toMatchObject({
      scanned: 1,
      processed: 1,
      completed: 1,
      telemetryCycleCompleted: false,
    });
    expect(error).toHaveBeenCalledWith('[account-deletion-maintenance] telemetry retention failed', {
      kind: 'Error',
    });
    error.mockRestore();
  });

  it('uses only the residual maintenance budget for tombstone and telemetry cleanup', async () => {
    const order: string[] = [];
    store.listRecoverableDeletionJobs.mockReset().mockResolvedValueOnce([{ uid: 'a' }]);
    runner.processAccountDeletion.mockImplementation(async () => {
      order.push('recover');
      return 'complete';
    });
    retention.purgeExpiredCompletedDeletionJobs.mockImplementation(async () => {
      order.push('purge');
      return 2;
    });
    telemetryRetention.purgeExpiredTelemetry.mockImplementation(async () => {
      order.push('telemetry');
      return { usersScanned: 1, documentsDeleted: 3, completedCycle: true };
    });

    const summary = await runAccountDeletionMaintenance(Date.now() + 60_000);

    expect(order).toEqual(['recover', 'purge', 'telemetry']);
    expect(summary).toMatchObject({
      scanned: 1,
      processed: 1,
      purged: 2,
      telemetryUsersScanned: 1,
      telemetryPurged: 3,
      telemetryCycleCompleted: true,
    });
  });

  it('stops before destructive work when there is no safe budget left', async () => {
    const summary = await runAccountDeletionMaintenance(Date.now() + 5_000);

    expect(runner.processAccountDeletion).not.toHaveBeenCalled();
    expect(retention.purgeExpiredCompletedDeletionJobs).not.toHaveBeenCalled();
    expect(telemetryRetention.purgeExpiredTelemetry).not.toHaveBeenCalled();
    expect(summary.processed).toBe(0);
  });
});
