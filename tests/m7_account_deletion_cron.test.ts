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
      documentsScanned: 0,
      documentsDeleted: 0,
      unexpectedDocuments: 0,
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
    expect(retention.purgeExpiredCompletedDeletionJobs).toHaveBeenCalledWith(400, undefined, expect.any(Number));
    expect(telemetryRetention.purgeExpiredTelemetry).toHaveBeenCalledWith(expect.any(Number));
    expect(await response.json()).toMatchObject({
      scanned: 2,
      processed: 2,
      recoveryErrors: 0,
      retentionErrors: 0,
      purged: 0,
      telemetryDocumentsScanned: 0,
      telemetryPurged: 0,
      telemetryUnexpectedDocuments: 0,
      telemetryCycleCompleted: true,
    });
    expect(info).toHaveBeenCalledWith('[account-deletion-cron] completed', {
      scanned: 2,
      processed: 2,
      recoveryErrors: 0,
      retentionErrors: 0,
      purged: 0,
      telemetryDocumentsScanned: 0,
      telemetryPurged: 0,
      telemetryUnexpectedDocuments: 0,
      telemetryCycleCompleted: true,
    });
    info.mockRestore();
  });

  it('keeps account deletion recovery successful when telemetry retention fails', async () => {
    process.env.CRON_SECRET = 'expected-secret';
    store.listRecoverableDeletionJobs.mockResolvedValue([{ uid: 'a' }]);
    telemetryRetention.purgeExpiredTelemetry.mockRejectedValue(new Error('telemetry unavailable'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await GET(request('expected-secret'));

    expect(response.status).toBe(200);
    expect(runner.processAccountDeletion).toHaveBeenCalledWith('a', expect.any(Number));
    expect(await response.json()).toMatchObject({
      scanned: 1,
      processed: 1,
      purged: 0,
      telemetryDocumentsScanned: 0,
      telemetryPurged: 0,
      telemetryUnexpectedDocuments: 0,
      telemetryCycleCompleted: false,
    });
    expect(error).toHaveBeenCalledWith('[account-deletion-cron] telemetry retention failed', {
      kind: 'Error',
    });
    error.mockRestore();
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
      return { documentsScanned: 1, documentsDeleted: 3, unexpectedDocuments: 0, completedCycle: true };
    });

    const response = await GET(request('expected-secret'));

    expect(response.status).toBe(200);
    expect(order).toEqual(['recover', 'purge', 'telemetry']);
    expect(await response.json()).toMatchObject({
      scanned: 1,
      processed: 1,
      purged: 2,
      telemetryDocumentsScanned: 1,
      telemetryPurged: 3,
      telemetryUnexpectedDocuments: 0,
      telemetryCycleCompleted: true,
    });
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
    expect(telemetryRetention.purgeExpiredTelemetry).toHaveBeenCalled();
  } finally { err.mockRestore(); }
});

it('continues other jobs and telemetry if one runner fails before lease acquisition', async () => {
  process.env.CRON_SECRET = 'expected-secret';
  runner.processAccountDeletion.mockRejectedValueOnce(new Error('lease failed')).mockResolvedValueOnce('complete');
  const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const response = await GET(request('expected-secret'));
    expect((await response.json())).toMatchObject({ recoveryErrors: 1, processed: 2 });
    expect(runner.processAccountDeletion).toHaveBeenCalledTimes(2);
    expect(telemetryRetention.purgeExpiredTelemetry).toHaveBeenCalled();
  } finally { err.mockRestore(); }
});

it('continues telemetry if completed tombstone cleanup fails', async () => {
  process.env.CRON_SECRET = 'expected-secret';
  retention.purgeExpiredCompletedDeletionJobs.mockRejectedValueOnce(new Error('cleanup failed'));
  const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const response = await GET(request('expected-secret'));
    expect((await response.json())).toMatchObject({ retentionErrors: 1, purged: 0 });
    expect(telemetryRetention.purgeExpiredTelemetry).toHaveBeenCalled();
  } finally { err.mockRestore(); }
});

  it('reserves the final 30 seconds of cron budget for legacy telemetry retention', async () => {
    process.env.CRON_SECRET = 'expected-secret';
    runner.processAccountDeletion.mockImplementation(async (_uid: string, deadline: number) => {
      expect(deadline).toBeGreaterThan(Date.now() + 200_000);
      expect(deadline).toBeLessThan(Date.now() + 250_000);
      return 'pending';
    });
    const response = await GET(request('expected-secret'));
    expect(response.status).toBe(200);
    expect(telemetryRetention.purgeExpiredTelemetry).toHaveBeenCalled();
  });
});
