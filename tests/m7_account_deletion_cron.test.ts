import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../server/accountDeletion/jobStore', () => store);
vi.mock('../server/accountDeletion/runner', () => runner);
vi.mock('../server/accountDeletion/retention', () => retention);
vi.mock('../server/telemetryRetention', () => telemetryRetention);

import { GET } from '../api/account-deletion-cron';

function request(secret?: string): Request {
  return new Request('https://example.test/api/account-deletion-cron', {
    headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
  });
}

describe('M7 daily account deletion recovery cron', () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    store.listRecoverableDeletionJobs.mockResolvedValue([{ uid: 'a' }, { uid: 'b' }]);
    runner.processAccountDeletion.mockResolvedValue('complete');
    retention.purgeExpiredCompletedDeletionJobs.mockResolvedValue(0);
    telemetryRetention.purgeExpiredTelemetry.mockResolvedValue({
      usersScanned: 0,
      documentsDeleted: 0,
      completedCycle: true,
    });
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it('fails closed when CRON_SECRET is not configured', async () => {
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(store.listRecoverableDeletionJobs).not.toHaveBeenCalled();
    expect(retention.purgeExpiredCompletedDeletionJobs).not.toHaveBeenCalled();
    expect(telemetryRetention.purgeExpiredTelemetry).not.toHaveBeenCalled();
  });

  it('rejects callers that do not present the configured bearer secret', async () => {
    process.env.CRON_SECRET = 'expected-secret';
    const response = await GET(request('wrong-secret'));
    expect(response.status).toBe(401);
    expect(store.listRecoverableDeletionJobs).not.toHaveBeenCalled();
    expect(retention.purgeExpiredCompletedDeletionJobs).not.toHaveBeenCalled();
    expect(telemetryRetention.purgeExpiredTelemetry).not.toHaveBeenCalled();
  });

  it('processes recoverable jobs with the shared idempotent runner when authorized', async () => {
    process.env.CRON_SECRET = 'expected-secret';
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const response = await GET(request('expected-secret'));

    expect(response.status).toBe(200);
    expect(store.listRecoverableDeletionJobs).toHaveBeenCalledWith(25);
    expect(runner.processAccountDeletion).toHaveBeenCalledTimes(2);
    expect(runner.processAccountDeletion).toHaveBeenNthCalledWith(1, 'a', expect.any(Number));
    expect(runner.processAccountDeletion).toHaveBeenNthCalledWith(2, 'b', expect.any(Number));
    expect(retention.purgeExpiredCompletedDeletionJobs).toHaveBeenCalledWith(400);
    expect(telemetryRetention.purgeExpiredTelemetry).toHaveBeenCalledWith(expect.any(Number));
    expect(await response.json()).toMatchObject({
      scanned: 2,
      processed: 2,
      purged: 0,
      telemetryUsersScanned: 0,
      telemetryPurged: 0,
      telemetryCycleCompleted: true,
    });
    expect(info).toHaveBeenCalledWith('[account-deletion-cron] completed', {
      scanned: 2,
      processed: 2,
      purged: 0,
      telemetryUsersScanned: 0,
      telemetryPurged: 0,
      telemetryCycleCompleted: true,
    });
    info.mockRestore();
  });

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
    telemetryRetention.purgeExpiredTelemetry.mockImplementation(async () => {
      order.push('telemetry');
      return { usersScanned: 1, documentsDeleted: 3, completedCycle: true };
    });

    const response = await GET(request('expected-secret'));

    expect(response.status).toBe(200);
    expect(order).toEqual(['recover', 'purge', 'telemetry']);
    expect(await response.json()).toMatchObject({
      scanned: 1,
      processed: 1,
      purged: 2,
      telemetryUsersScanned: 1,
      telemetryPurged: 3,
      telemetryCycleCompleted: true,
    });
  });
});
