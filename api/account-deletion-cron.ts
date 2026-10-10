import { listRecoverableDeletionJobs } from '../server/accountDeletion/jobStore.js';
import {
  ACCOUNT_DELETION_RETENTION_PAGE_SIZE,
  purgeExpiredCompletedDeletionJobs,
} from '../server/accountDeletion/retention.js';
import { processAccountDeletion } from '../server/accountDeletion/runner.js';
import { purgeExpiredTelemetry } from '../server/telemetryRetention.js';

export const maxDuration = 300;

const CRON_BUDGET_MS = 270_000;
const SAFETY_BUFFER_MS = 10_000;
// Keep a dedicated window for legacy telemetry retention even when deletion jobs are busy.
const TELEMETRY_RESERVE_MS = 30_000;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request): Promise<Response> {
  if (!process.env.CRON_SECRET) {
    return Response.json({ error: 'CRON_SECRET non configurato.' }, { status: 503 });
  }
  if (!authorized(request)) {
    return Response.json({ error: 'Non autorizzato.' }, { status: 401 });
  }

  const deadlineMs = Date.now() + CRON_BUDGET_MS;
  const deletionDeadlineMs = deadlineMs - TELEMETRY_RESERVE_MS;
  let jobs: Awaited<ReturnType<typeof listRecoverableDeletionJobs>> = [];
  const results: Array<{ uid: string; result: string }> = [];
  let recoveryErrors = 0;
  let retentionErrors = 0;

  try {
    jobs = await listRecoverableDeletionJobs(25);
  } catch (error) {
    recoveryErrors += 1;
    console.error('[account-deletion-cron] recovery query failed', {
      kind: error instanceof Error ? error.name : typeof error,
    });
  }

  for (const job of jobs) {
    if (Date.now() + SAFETY_BUFFER_MS >= deletionDeadlineMs) break;
    try {
      const result = await processAccountDeletion(job.uid, deletionDeadlineMs);
      results.push({ uid: job.uid, result });
    } catch (error) {
      recoveryErrors += 1;
      results.push({ uid: job.uid, result: 'failed' });
      console.error('[account-deletion-cron] recovery job failed', {
        kind: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  let purged = 0;
  while (Date.now() + SAFETY_BUFFER_MS < deletionDeadlineMs) {
    try {
      const deleted = await purgeExpiredCompletedDeletionJobs(
        ACCOUNT_DELETION_RETENTION_PAGE_SIZE, undefined, deletionDeadlineMs,
      );
      purged += deleted;
      if (deleted < ACCOUNT_DELETION_RETENTION_PAGE_SIZE) break;
    } catch (error) {
      retentionErrors += 1;
      console.error('[account-deletion-cron] tombstone retention failed', {
        kind: error instanceof Error ? error.name : typeof error,
      });
      break;
    }
  }

  let telemetryRetention = {
    documentsScanned: 0,
    documentsDeleted: 0,
    unexpectedDocuments: 0,
    completedCycle: false,
  };
  if (Date.now() + SAFETY_BUFFER_MS < deadlineMs) {
    try {
      telemetryRetention = await purgeExpiredTelemetry(deadlineMs);
    } catch (error) {
      console.error('[account-deletion-cron] telemetry retention failed', {
        kind: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  console.info('[account-deletion-cron] completed', {
    scanned: jobs.length,
    processed: results.length,
    recoveryErrors,
    retentionErrors,
    purged,
    telemetryDocumentsScanned: telemetryRetention.documentsScanned,
    telemetryPurged: telemetryRetention.documentsDeleted,
    telemetryUnexpectedDocuments: telemetryRetention.unexpectedDocuments,
    telemetryCycleCompleted: telemetryRetention.completedCycle,
  });

  return Response.json({
    scanned: jobs.length,
    processed: results.length,
    recoveryErrors,
    retentionErrors,
    purged,
    telemetryDocumentsScanned: telemetryRetention.documentsScanned,
    telemetryPurged: telemetryRetention.documentsDeleted,
    telemetryUnexpectedDocuments: telemetryRetention.unexpectedDocuments,
    telemetryCycleCompleted: telemetryRetention.completedCycle,
    results,
  });
}
