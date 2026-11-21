import { afterEach, beforeEach, describe, vi } from 'vitest';
import { registerCronAccessCases } from './cronAccessCases';
import { registerCronHealthCases } from './cronHealthCases';
import { registerCronAccountCases } from './cronAccountCases';
import { registerCronRetentionCases } from './cronRetentionCases';

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

vi.mock('../../../server/accountDeletion/jobStore', () => store);
vi.mock('../../../server/accountDeletion/runner', () => runner);
vi.mock('../../../server/accountDeletion/retention', () => retention);
vi.mock('../../../server/healthConsent/erasure', () => healthErasure);
vi.mock('../../../server/accountInactivity', () => inactivity);

import { GET } from '../../../api/account-deletion-cron';

function request(secret?: string): Request {
  return new Request('https://example.test/api/account-deletion-cron', {
    headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
  });
}

const sharedCronFixture = { store, runner, retention, inactivity, healthErasure, GET, request };
export type CronRecoveryTestContext = typeof sharedCronFixture;

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

  registerCronAccessCases(sharedCronFixture);
  registerCronHealthCases(sharedCronFixture);
  registerCronAccountCases(sharedCronFixture);
  registerCronRetentionCases(sharedCronFixture);
});
