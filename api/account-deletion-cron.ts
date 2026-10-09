import { listRecoverableDeletionJobs } from '../server/accountDeletion/jobStore.js';
import {
  ACCOUNT_DELETION_RETENTION_PAGE_SIZE,
  purgeExpiredCompletedDeletionJobs,
} from '../server/accountDeletion/retention.js';
import { processAccountDeletion } from '../server/accountDeletion/runner.js';
import { purgeExpiredTelemetry } from '../server/telemetryRetention.js';
import { hasBlockedHealthErasures, listPendingHealthErasures, processHealthErasure } from '../server/healthConsent/erasure.js';
import { healthConsentReleaseEnabled } from '../server/healthConsent/launch.js';

export const maxDuration = 300;

const CRON_BUDGET_MS = 270_000;
const SAFETY_BUFFER_MS = 10_000;
// Preserve a health-erasure window even when account deletion consumes its full
// allotted budget. Retention gets a separate tail window.
const HEALTH_RESERVED_MS = 95_000;
const MAINTENANCE_RESERVED_MS = 20_000;

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
  const healthErasureEnabled = healthConsentReleaseEnabled();
  const accountDeadlineMs = deadlineMs - (healthErasureEnabled ? HEALTH_RESERVED_MS : 0) - MAINTENANCE_RESERVED_MS;
  const healthDeadlineMs = deadlineMs - MAINTENANCE_RESERVED_MS;
  let jobs: Awaited<ReturnType<typeof listRecoverableDeletionJobs>> = [];
  let accountDiscoveryFailed = false;
  try {
    jobs = await listRecoverableDeletionJobs(25);
  } catch (error) {
    accountDiscoveryFailed = true;
    console.error('[account-deletion-cron] account deletion discovery failed', {
      kind: error instanceof Error ? error.name : 'UnknownError',
    });
  }
  let accountRunsFailed = 0;
  const results: Array<{ uid: string; result: string }> = [];

  for (const job of jobs) {
    if (Date.now() + SAFETY_BUFFER_MS >= accountDeadlineMs) break;
    try {
      const result = await processAccountDeletion(job.uid, accountDeadlineMs);
      results.push({ uid: job.uid, result });
    } catch (error) {
      accountRunsFailed++;
      console.error('[account-deletion-cron] account deletion retry failed', {
        kind: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  // Health-data erasure has its own marker and lease, distinct from account
  // deletion. Use the remaining bounded cron budget to retry interrupted jobs.
  let erasuresScanned = 0;
  let erasuresComplete = 0;
  let erasuresFailed = 0;
  let erasuresPending = 0;
  let erasuresBusy = 0;
  let erasuresDiscoveryFailed = false;
  if (healthErasureEnabled && Date.now() + SAFETY_BUFFER_MS < healthDeadlineMs) {
    let pending: string[] = [];
    try {
      pending = await listPendingHealthErasures(25);
    } catch (error) {
      erasuresDiscoveryFailed = true;
      console.error('[account-deletion-cron] health erasure discovery failed', {
        kind: error instanceof Error ? error.name : 'UnknownError',
      });
    }
    erasuresScanned = pending.length;
    for (const uid of pending) {
      if (Date.now() + SAFETY_BUFFER_MS >= healthDeadlineMs) break;
      try {
        const outcome = await processHealthErasure(uid, healthDeadlineMs);
        if (outcome === 'complete') erasuresComplete++;
        else if (outcome === 'pending') erasuresPending++;
        else erasuresBusy++;
      } catch (error) {
        erasuresFailed++;
        console.error('[account-deletion-cron] health erasure retry failed', {
          kind: error instanceof Error ? error.name : 'UnknownError',
        });
      }
    }
  }

  // A blocked job is intentionally excluded from automatic retries: it
  // requires a reviewed schema/data cleanup. Surface that state every day.
  let erasuresBlocked: boolean | null = null;
  if (healthErasureEnabled && Date.now() + SAFETY_BUFFER_MS < deadlineMs) {
    try {
      erasuresBlocked = await hasBlockedHealthErasures();
      if (erasuresBlocked) console.error('[account-deletion-cron] manual health erasure intervention required', { blocked: true });
    } catch (error) {
      console.error('[account-deletion-cron] health erasure monitoring unavailable', {
        kind: error instanceof Error ? error.name : 'UnknownError',
      });
    }
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
      console.error('[account-deletion-cron] telemetry retention failed', {
        kind: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  console.info('[account-deletion-cron] completed', {
    scanned: jobs.length,
    processed: results.length,
    accountDiscoveryFailed,
    accountRunsFailed,
    purged,
    healthErasureEnabled,
    erasuresScanned,
    erasuresComplete,
    erasuresFailed,
    erasuresPending,
    erasuresBusy,
    erasuresDiscoveryFailed,
    erasuresBlocked,
    erasuresBacklogPossible: erasuresScanned === 25,
    telemetryUsersScanned: telemetryRetention.usersScanned,
    telemetryPurged: telemetryRetention.documentsDeleted,
    telemetryCycleCompleted: telemetryRetention.completedCycle,
  });

  return Response.json({
    scanned: jobs.length,
    processed: results.length,
    accountDiscoveryFailed,
    accountRunsFailed,
    purged,
    healthErasureEnabled,
    erasuresScanned,
    erasuresComplete,
    erasuresFailed,
    erasuresPending,
    erasuresBusy,
    erasuresDiscoveryFailed,
    erasuresBlocked,
    erasuresBacklogPossible: erasuresScanned === 25,
    telemetryUsersScanned: telemetryRetention.usersScanned,
    telemetryPurged: telemetryRetention.documentsDeleted,
    telemetryCycleCompleted: telemetryRetention.completedCycle,
    results,
  });
}
