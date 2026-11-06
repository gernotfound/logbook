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
const inactivity = vi.hoisted(() => ({ queueInactiveAccountDeletions: vi.fn() }));
const healthErasure = vi.hoisted(() => ({
  listRecoverableHealthErasures: vi.fn(),
  processHealthDataErasure: vi.fn(),
  purgeExpiredCompletedHealthErasures: vi.fn(),
}));

vi.mock('../server/accountDeletion/jobStore', () => store);
vi.mock('../server/accountDeletion/runner', () => runner);
vi.mock('../server/accountDeletion/retention', () => retention);
vi.mock('../server/healthConsent/erasure', () => healthErasure);
vi.mock('../server/accountInactivity', () => inactivity);

import { GET } from '../api/account-deletion-cron';

function request(secret?: string): Request {
  return new Request('https://example.test/api/account-deletion-cron', {
    headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
  });
}

describe('M7 daily account deletion recovery cron', () => {
  const originalSecret = process.env.CRON_SECRET;
  const originalTracking = process.env.ACCOUNT_INACTIVITY_TRACKING_ENABLED;
  const originalDeletion = process.env.ACCOUNT_INACTIVITY_DELETION_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    delete process.env.ACCOUNT_INACTIVITY_TRACKING_ENABLED;
    delete process.env.ACCOUNT_INACTIVITY_DELETION_ENABLED;
    inactivity.queueInactiveAccountDeletions.mockResolvedValue({ scanned: 1, queued: 1 });
    store.listRecoverableDeletionJobs.mockResolvedValue([{ uid: 'a' }, { uid: 'b' }]);
    runner.processAccountDeletion.mockResolvedValue('complete');
    healthErasure.listRecoverableHealthErasures.mockResolvedValue([]);
    healthErasure.processHealthDataErasure.mockResolvedValue('complete');
    healthErasure.purgeExpiredCompletedHealthErasures.mockResolvedValue(0);
    retention.purgeExpiredCompletedDeletionJobs.mockResolvedValue(0);
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
    if (originalTracking === undefined) delete process.env.ACCOUNT_INACTIVITY_TRACKING_ENABLED;
    else process.env.ACCOUNT_INACTIVITY_TRACKING_ENABLED = originalTracking;
    if (originalDeletion === undefined) delete process.env.ACCOUNT_INACTIVITY_DELETION_ENABLED;
    else process.env.ACCOUNT_INACTIVITY_DELETION_ENABLED = originalDeletion;
  });

  it('never queues automatic deletion unless BOTH independent rollout flags are true', async () => {
    process.env.CRON_SECRET = 'expected-secret';

    const disabled = await GET(request('expected-secret'));
    expect(disabled.status).toBe(200);
    expect(inactivity.queueInactiveAccountDeletions).not.toHaveBeenCalled();

    process.env.ACCOUNT_INACTIVITY_TRACKING_ENABLED = 'true';
    await GET(request('expected-secret'));
    expect(inactivity.queueInactiveAccountDeletions).not.toHaveBeenCalled();

    delete process.env.ACCOUNT_INACTIVITY_TRACKING_ENABLED;
    process.env.ACCOUNT_INACTIVITY_DELETION_ENABLED = 'true';
    await GET(request('expected-secret'));
    expect(inactivity.queueInactiveAccountDeletions).not.toHaveBeenCalled();

    process.env.ACCOUNT_INACTIVITY_TRACKING_ENABLED = 'true';
    const enabled = await GET(request('expected-secret'));
    expect(enabled.status).toBe(200);
    expect(inactivity.queueInactiveAccountDeletions).toHaveBeenCalledTimes(1);
    expect(await enabled.json()).toMatchObject({
      inactiveScanned: 1, inactiveQueued: 1, inactivityErrors: 0,
    });
  });

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

  it('fails closed when CRON_SECRET is not configured', async () => {
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(store.listRecoverableDeletionJobs).not.toHaveBeenCalled();
    expect(retention.purgeExpiredCompletedDeletionJobs).not.toHaveBeenCalled();
  });

  it('rejects callers that do not present the configured bearer secret', async () => {
    process.env.CRON_SECRET = 'expected-secret';
    const response = await GET(request('wrong-secret'));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Non autorizzato.' });
    expect(store.listRecoverableDeletionJobs).not.toHaveBeenCalled();
    expect(retention.purgeExpiredCompletedDeletionJobs).not.toHaveBeenCalled();
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
    expect(retention.purgeExpiredCompletedDeletionJobs).toHaveBeenCalledWith(400, undefined, expect.any(Number), expect.objectContaining({ scanned: 0 }));
    expect(await response.json()).toMatchObject({
      scanned: 2,
      processed: 2,
      erasureScanned: 0,
      erasureProcessed: 0,
      erasureCompleted: 0,
      erasurePending: 0,
      erasureBusy: 0,
      erasureFailed: 0,
      erasureErrors: 0,
      erasureReceiptsPurged: 0,
      recoveryErrors: 0,
      retentionErrors: 0,
      purged: 0,
    });
    expect(info).toHaveBeenCalledWith('[account-deletion-cron] completed', {
      scanned: 2,
      processed: 2,
      erasureScanned: 0,
      erasureProcessed: 0,
      erasureCompleted: 0,
      erasurePending: 0,
      erasureBusy: 0,
      erasureFailed: 0,
      erasureErrors: 0,
      erasureReceiptsPurged: 0,
      recoveryErrors: 0,
      retentionErrors: 0,
      purged: 0,
    });
    info.mockRestore();
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
    expect((await response.json())).toMatchObject({ recoveryErrors: 1, processed: 2 });
    expect(runner.processAccountDeletion).toHaveBeenCalledTimes(2);
  } finally { err.mockRestore(); }
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

  it('gives account deletion the full cron budget without reducing the safety buffer', async () => {
    process.env.CRON_SECRET = 'expected-secret';
    runner.processAccountDeletion.mockImplementation(async (_uid: string, deadline: number) => {
      expect(deadline).toBeGreaterThan(Date.now() + 260_000);
      expect(deadline).toBeLessThan(Date.now() + 270_000);
      return 'pending';
    });
    const response = await GET(request('expected-secret'));
    expect(response.status).toBe(200);
    expect(runner.processAccountDeletion).toHaveBeenCalledTimes(2);
  });
});
