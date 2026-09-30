import { listRecoverableDeletionJobs } from './accountDeletion/jobStore.js';
import {
  ACCOUNT_DELETION_RETENTION_PAGE_SIZE,
  purgeExpiredCompletedDeletionJobs,
} from './accountDeletion/retention.js';
import { processAccountDeletion } from './accountDeletion/runner.js';
import { purgeExpiredTelemetry } from './telemetryRetention.js';

const SAFETY_BUFFER_MS = 10_000;

export interface MaintenanceSummary {
  scanned: number;
  processed: number;
  completed: number;
  pending: number;
  failed: number;
  busy: number;
  purged: number;
  telemetryUsersScanned: number;
  telemetryPurged: number;
  telemetryCycleCompleted: boolean;
}

export async function runAccountDeletionMaintenance(deadlineMs: number): Promise<MaintenanceSummary> {
  const jobs = await listRecoverableDeletionJobs(25);
  const counts = { complete: 0, pending: 0, failed: 0, busy: 0 };

  for (const job of jobs) {
    if (Date.now() + SAFETY_BUFFER_MS >= deadlineMs) break;
    const result = await processAccountDeletion(job.uid, deadlineMs);
    counts[result] += 1;
  }

  let purged = 0;
  while (Date.now() + SAFETY_BUFFER_MS < deadlineMs) {
    const deleted = await purgeExpiredCompletedDeletionJobs(ACCOUNT_DELETION_RETENTION_PAGE_SIZE);
    purged += deleted;
    if (deleted < ACCOUNT_DELETION_RETENTION_PAGE_SIZE) break;
  }

  let telemetryRetention = { usersScanned: 0, documentsDeleted: 0, completedCycle: false };
  if (Date.now() + SAFETY_BUFFER_MS < deadlineMs) {
    try {
      telemetryRetention = await purgeExpiredTelemetry(deadlineMs);
    } catch (error) {
      console.error('[account-deletion-maintenance] telemetry retention failed', {
        kind: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  return {
    scanned: jobs.length,
    processed: counts.complete + counts.pending + counts.failed + counts.busy,
    completed: counts.complete,
    pending: counts.pending,
    failed: counts.failed,
    busy: counts.busy,
    purged,
    telemetryUsersScanned: telemetryRetention.usersScanned,
    telemetryPurged: telemetryRetention.documentsDeleted,
    telemetryCycleCompleted: telemetryRetention.completedCycle,
  };
}
