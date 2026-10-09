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
const erasure = vi.hoisted(() => ({
  listPendingHealthErasures: vi.fn(),
  processHealthErasure: vi.fn(),
  hasBlockedHealthErasures: vi.fn(),
}));
vi.mock('../server/healthConsent/erasure', () => erasure);
const release = vi.hoisted(() => ({ enabled: true }));
vi.mock('../server/healthConsent/launch', () => ({ healthConsentReleaseEnabled: () => release.enabled }));

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
    release.enabled = true;
    delete process.env.CRON_SECRET;
    store.listRecoverableDeletionJobs.mockResolvedValue([{ uid: 'a' }, { uid: 'b' }]);
    runner.processAccountDeletion.mockResolvedValue('complete');
    retention.purgeExpiredCompletedDeletionJobs.mockResolvedValue(0);
    erasure.listPendingHealthErasures.mockResolvedValue([]);
    erasure.processHealthErasure.mockResolvedValue('complete');
    erasure.hasBlockedHealthErasures.mockResolvedValue(false);
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
      accountDiscoveryFailed: false,
      accountRunsFailed: 0,
      purged: 0,
      healthErasureEnabled: true,
      erasuresScanned: 0,
      erasuresComplete: 0,
      erasuresFailed: 0,
      erasuresPending: 0,
      erasuresBusy: 0,
      erasuresDiscoveryFailed: false,
      erasuresBlocked: false,
      erasuresBacklogPossible: false,
      telemetryUsersScanned: 0,
      telemetryPurged: 0,
      telemetryCycleCompleted: true,
    });
    expect(info).toHaveBeenCalledWith('[account-deletion-cron] completed', {
      scanned: 2,
      processed: 2,
      accountDiscoveryFailed: false,
      accountRunsFailed: 0,
      purged: 0,
      healthErasureEnabled: true,
      erasuresScanned: 0,
      erasuresComplete: 0,
      erasuresFailed: 0,
      erasuresPending: 0,
      erasuresBusy: 0,
      erasuresDiscoveryFailed: false,
      erasuresBlocked: false,
      erasuresBacklogPossible: false,
      telemetryUsersScanned: 0,
      telemetryPurged: 0,
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
      telemetryUsersScanned: 0,
      telemetryPurged: 0,
      telemetryCycleCompleted: false,
    });
    expect(error).toHaveBeenCalledWith('[account-deletion-cron] telemetry retention failed', {
      kind: 'Error',
    });
    error.mockRestore();
  });

  it('does not scan or delete health data before release while preserving account and telemetry maintenance', async () => {
    process.env.CRON_SECRET = 'expected-secret';
    release.enabled = false;
    erasure.listPendingHealthErasures.mockResolvedValue(['synthetic-revoked-owner']);
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    try {
      const response = await GET(request('expected-secret'));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        processed: 2, healthErasureEnabled: false,
        erasuresScanned: 0, erasuresBlocked: null,
        telemetryCycleCompleted: true,
      });
      expect(runner.processAccountDeletion).toHaveBeenCalledWith('a', start + 250_000);
      expect(retention.purgeExpiredCompletedDeletionJobs).toHaveBeenCalled();
      expect(erasure.listPendingHealthErasures).not.toHaveBeenCalled();
      expect(erasure.processHealthErasure).not.toHaveBeenCalled();
      expect(erasure.hasBlockedHealthErasures).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); }
  });

  it('retries health erasure without blocking account deletion or the other maintenance tasks', async () => {
    process.env.CRON_SECRET = 'expected-secret';
    erasure.listPendingHealthErasures.mockResolvedValue(['a', 'b']);
    erasure.processHealthErasure.mockResolvedValueOnce('complete').mockResolvedValueOnce('pending');
    const response = await GET(request('expected-secret'));
    expect(response.status).toBe(200);
    expect(erasure.listPendingHealthErasures).toHaveBeenCalledWith(25);
    expect(erasure.processHealthErasure).toHaveBeenCalledTimes(2);
    expect(await response.json()).toMatchObject({
      erasuresScanned: 2, erasuresComplete: 1, erasuresPending: 1,
      processed: 2, telemetryCycleCompleted: true,
    });
  });

  it('reserves time for health erasure even if an account deletion consumes its entire slot', async () => {
    process.env.CRON_SECRET = 'expected-secret';
    store.listRecoverableDeletionJobs.mockResolvedValue([{ uid: 'account-a' }, { uid: 'account-b' }]);
    erasure.listPendingHealthErasures.mockResolvedValue(['health-a']);
    const start = Date.now();
    let clock = start;
    const time = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      runner.processAccountDeletion.mockImplementation(async (_uid: string, deadline: number) => {
        expect(deadline).toBe(start + 270_000 - 95_000 - 20_000);
        clock = deadline - 5_000;
        return 'pending';
      });
      erasure.processHealthErasure.mockImplementation(async (_uid: string, deadline: number) => {
        expect(deadline).toBe(start + 270_000 - 20_000);
        return 'complete';
      });
      const response = await GET(request('expected-secret'));
      expect(response.status).toBe(200);
      expect(runner.processAccountDeletion).toHaveBeenCalledTimes(1);
      expect(erasure.processHealthErasure).toHaveBeenCalledWith('health-a', start + 250_000);
      expect(await response.json()).toMatchObject({ processed: 1, erasuresComplete: 1 });
    } finally { time.mockRestore(); }
  });

  it('emits a sanitized operational signal for failed or blocked health erasures', async () => {
    process.env.CRON_SECRET = 'expected-secret';
    erasure.listPendingHealthErasures.mockResolvedValue(['secret-owner-a', 'secret-owner-b']);
    erasure.processHealthErasure.mockRejectedValueOnce(new Error('private payload'))
      .mockResolvedValueOnce('busy');
    erasure.hasBlockedHealthErasures.mockResolvedValue(true);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await GET(request('expected-secret'));
      expect(await response.json()).toMatchObject({
        erasuresScanned: 2, erasuresFailed: 1, erasuresBusy: 1, erasuresBlocked: true,
      });
      expect(errors).toHaveBeenCalledWith(
        '[account-deletion-cron] manual health erasure intervention required', { blocked: true },
      );
      expect(JSON.stringify(errors.mock.calls)).not.toContain('secret-owner');
      expect(JSON.stringify(errors.mock.calls)).not.toContain('private payload');
    } finally { errors.mockRestore(); }
  });

  it('reports monitoring as unknown and continues other work if the blocked-status probe fails', async () => {
    process.env.CRON_SECRET = 'expected-secret';
    erasure.hasBlockedHealthErasures.mockRejectedValueOnce(new Error('internal private message'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await GET(request('expected-secret'));
      expect(await response.json()).toMatchObject({ erasuresBlocked: null, telemetryCycleCompleted: true });
      expect(retention.purgeExpiredCompletedDeletionJobs).toHaveBeenCalled();
      expect(JSON.stringify(errors.mock.calls)).not.toContain('internal private message');
    } finally { errors.mockRestore(); }
  });

  it('isolation: a failed account discovery cannot prevent health erasure or retention', async () => {
    process.env.CRON_SECRET = 'expected-secret';
    store.listRecoverableDeletionJobs.mockRejectedValueOnce(new Error('secret account data'));
    erasure.listPendingHealthErasures.mockResolvedValueOnce(['owner-a']);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await GET(request('expected-secret'));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        accountDiscoveryFailed: true, scanned: 0, erasuresComplete: 1, telemetryCycleCompleted: true,
      });
      expect(erasure.processHealthErasure).toHaveBeenCalledOnce();
      expect(retention.purgeExpiredCompletedDeletionJobs).toHaveBeenCalled();
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret account data');
    } finally { log.mockRestore(); }
  });

  it('isolation: a thrown account runner does not block other recovery jobs', async () => {
    process.env.CRON_SECRET = 'expected-secret';
    erasure.listPendingHealthErasures.mockResolvedValueOnce(['owner-health']);
    runner.processAccountDeletion.mockRejectedValueOnce(new Error('account private'))
      .mockResolvedValueOnce('complete');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await GET(request('expected-secret'));
      expect(await response.json()).toMatchObject({
        accountRunsFailed: 1, processed: 1, erasuresComplete: 1, telemetryCycleCompleted: true,
      });
      expect(runner.processAccountDeletion).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(log.mock.calls)).not.toContain('account private');
    } finally { log.mockRestore(); }
  });

  it('isolation: missing health recovery index does not stop unrelated maintenance', async () => {
    process.env.CRON_SECRET = 'expected-secret';
    erasure.listPendingHealthErasures.mockRejectedValueOnce(new Error('index missing confidential'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await GET(request('expected-secret'));
      expect(await response.json()).toMatchObject({
        erasuresDiscoveryFailed: true, erasuresScanned: 0,
        processed: 2, telemetryCycleCompleted: true,
      });
      expect(erasure.hasBlockedHealthErasures).toHaveBeenCalledOnce();
      expect(retention.purgeExpiredCompletedDeletionJobs).toHaveBeenCalled();
      expect(JSON.stringify(log.mock.calls)).not.toContain('index missing confidential');
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
