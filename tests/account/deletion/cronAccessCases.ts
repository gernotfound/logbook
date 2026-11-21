import { expect, it, vi } from 'vitest';
import type { CronRecoveryTestContext } from './m7_account_deletion_cron.test';

export function registerCronAccessCases({
  GET, request, store, runner, retention, healthErasure, inactivity,
}: CronRecoveryTestContext): void {
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
    expect(inactivity.queueInactiveAccountDeletions).toHaveBeenCalledWith(
      undefined, undefined, expect.any(Number),
    );
    const phaseCutoff = inactivity.queueInactiveAccountDeletions.mock.calls[0][2] as number;
    const accountDeadline = runner.processAccountDeletion.mock.calls.at(-1)?.[1] as number;
    expect(phaseCutoff).toBe(accountDeadline - 10_000);
    expect(await enabled.json()).toMatchObject({
      inactiveScanned: 1, inactiveQueued: 1, inactivityErrors: 0,
    });
  });

  it('fails closed when CRON_SECRET is not configured', async () => {
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(store.listRecoverableDeletionJobs).not.toHaveBeenCalled();
    expect(retention.purgeExpiredCompletedDeletionJobs).not.toHaveBeenCalled();
    expect(healthErasure.listRecoverableHealthErasures).not.toHaveBeenCalled();
    expect(healthErasure.purgeExpiredCompletedHealthErasures).not.toHaveBeenCalled();
    expect(healthErasure.processHealthDataErasure).not.toHaveBeenCalled();
    expect(runner.processAccountDeletion).not.toHaveBeenCalled();
    expect(inactivity.queueInactiveAccountDeletions).not.toHaveBeenCalled();
  });

  it('rejects callers that do not present the configured bearer secret', async () => {
    process.env.CRON_SECRET = 'expected-secret';
    const response = await GET(request('wrong-secret'));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Non autorizzato.' });
    expect(store.listRecoverableDeletionJobs).not.toHaveBeenCalled();
    expect(retention.purgeExpiredCompletedDeletionJobs).not.toHaveBeenCalled();
    expect(healthErasure.listRecoverableHealthErasures).not.toHaveBeenCalled();
    expect(healthErasure.purgeExpiredCompletedHealthErasures).not.toHaveBeenCalled();
    expect(healthErasure.processHealthDataErasure).not.toHaveBeenCalled();
    expect(runner.processAccountDeletion).not.toHaveBeenCalled();
    expect(inactivity.queueInactiveAccountDeletions).not.toHaveBeenCalled();
  });

  it('counts an inactivity scheduler failure without suppressing independent recovery phases', async () => {
    process.env.CRON_SECRET = 'expected-secret';
    process.env.ACCOUNT_INACTIVITY_TRACKING_ENABLED = 'true';
    process.env.ACCOUNT_INACTIVITY_DELETION_ENABLED = 'true';
    inactivity.queueInactiveAccountDeletions.mockRejectedValueOnce(new Error('private scheduler failure'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await GET(request('expected-secret'));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        scanned: 2, processed: 2, accountCompleted: 2,
        inactivityErrors: 1, inactiveQueued: 0, inactiveScanned: 0, retentionErrors: 0,
      });
      expect(inactivity.queueInactiveAccountDeletions).toHaveBeenCalledOnce();
      expect(retention.purgeExpiredCompletedDeletionJobs).toHaveBeenCalledOnce();
      expect(healthErasure.purgeExpiredCompletedHealthErasures).toHaveBeenCalledOnce();
      expect(JSON.stringify(body)).not.toContain('private scheduler failure');
      expect(errors).toHaveBeenCalledWith('[account-deletion-cron] inactivity scheduling failed', { kind: 'Error' });
    } finally {
      errors.mockRestore();
    }
  });
}
