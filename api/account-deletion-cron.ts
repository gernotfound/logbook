import { listRecoverableDeletionJobs } from '../server/accountDeletion/jobStore.js';
import {
  ACCOUNT_DELETION_RETENTION_PAGE_SIZE,
  purgeExpiredCompletedDeletionJobs,
} from '../server/accountDeletion/retention.js';
import { processAccountDeletion } from '../server/accountDeletion/runner.js';
import { queueInactiveAccountDeletions } from '../server/accountInactivity.js';
import { listRecoverableHealthErasures, processHealthDataErasure, purgeExpiredCompletedHealthErasures } from '../server/healthConsent/erasure.js';

export const maxDuration = 300;

const CRON_BUDGET_MS = 270_000;
const SAFETY_BUFFER_MS = 10_000;
const ACCOUNT_RECEIPT_RETENTION_BUDGET_MS = 60_000;
const HEALTH_RECEIPT_RETENTION_RESERVE_MS = 20_000;

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

  const deletionDeadlineMs = Date.now() + CRON_BUDGET_MS;
  let jobs: Awaited<ReturnType<typeof listRecoverableDeletionJobs>> = [];
  let accountProcessed = 0;
  let accountCompleted = 0;
  let accountPending = 0;
  let accountBusy = 0;
  let accountFailed = 0;
  let recoveryErrors = 0;
  let retentionErrors = 0;
  let erasureScanned = 0;
  let erasureProcessed = 0;
  let erasureCompleted = 0;
  let erasurePending = 0;
  let erasureBusy = 0;
  let erasureFailed = 0;
  let erasureErrors = 0;
  let erasureReceiptsPurged = 0;
  let inactiveScanned = 0;
  let inactiveQueued = 0;
  let inactivityErrors = 0;

  // Prioritize a bounded slice of requested health-data erasures without
  // starving account deletion recovery.
  try {
    const erasureUids = await listRecoverableHealthErasures(8);
    erasureScanned = erasureUids.length;
    for (const uid of erasureUids) {
      if (Date.now() + SAFETY_BUFFER_MS >= deletionDeadlineMs) break;
      try {
        const outcome = await processHealthDataErasure(uid, Math.min(deletionDeadlineMs, Date.now() + 10_000));
        erasureProcessed++;
        switch (outcome) {
          case 'complete': erasureCompleted++; break;
          case 'pending': erasurePending++; break;
          case 'busy': erasureBusy++; break;
          case 'failed': erasureFailed++; break;
        }
      } catch (error) {
        erasureErrors++;
        console.error('[account-deletion-cron] health data erasure recovery failed', {
          kind: error instanceof Error ? error.name : typeof error,
        });
      }
    }
  } catch (error) {
    erasureErrors++;
    console.error('[account-deletion-cron] health erasure query failed', {
      kind: error instanceof Error ? error.name : typeof error,
    });
  }

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
    accountProcessed++;
    try {
      const outcome = await processAccountDeletion(job.uid, deletionDeadlineMs);
      switch (outcome) {
        case 'complete': accountCompleted++; break;
        case 'pending': accountPending++; break;
        case 'busy': accountBusy++; break;
        case 'failed': accountFailed++; break;
      }
    } catch (error) {
      recoveryErrors++;
      console.error('[account-deletion-cron] recovery job failed', {
        kind: error instanceof Error ? error.name : typeof error,
      });
    }
  }
  if (accountFailed > 0) {
    // The worker persists these failures and returns normally. Emit a warning
    // without revealing account identities.
    console.error('[account-deletion-cron] recovery workers reported failed outcomes', {
      failed: accountFailed,
    });
  }

  // Do not schedule irreversible account deletion until the legal rollout is enabled.
  if (process.env.ACCOUNT_INACTIVITY_TRACKING_ENABLED === 'true'
    && process.env.ACCOUNT_INACTIVITY_DELETION_ENABLED === 'true'
    && Date.now() + SAFETY_BUFFER_MS < deletionDeadlineMs) {
    try {
      // Stop starting new inactivity transactions before the cron safety margin;
      // the scanner may still persist its last verified cursor.
      const outcome = await queueInactiveAccountDeletions(
        undefined, undefined, deletionDeadlineMs - SAFETY_BUFFER_MS,
      );
      inactiveScanned = outcome.scanned;
      inactiveQueued = outcome.queued;
    } catch (error) {
      inactivityErrors++;
      console.error('[account-deletion-cron] inactivity scheduling failed', {
        kind: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  // Do not let a large account-receipt backlog consume the whole cron window:
  // the independent health-erasure receipt sweep needs its own opportunity.
  // The retention worker itself stops starting work near this deadline,
  // without aborting a transaction already in flight.
  const accountRetentionDeadlineMs = Math.min(
    deletionDeadlineMs - HEALTH_RECEIPT_RETENTION_RESERVE_MS,
    Date.now() + ACCOUNT_RECEIPT_RETENTION_BUDGET_MS,
  );
  let purged = 0;
  const retentionPage = { scanned: 0 } as import('../server/accountDeletion/retention.js').AccountDeletionRetentionPage;
  while (Date.now() + SAFETY_BUFFER_MS < accountRetentionDeadlineMs) {
    try {
      const deleted = await purgeExpiredCompletedDeletionJobs(
        ACCOUNT_DELETION_RETENTION_PAGE_SIZE, undefined, accountRetentionDeadlineMs, retentionPage,
      );
      purged += deleted;
      // Continue after a full page even when every receipt was skipped because
      // its owner identity was corrupt. Do not retry that same page indefinitely.
      if (retentionPage.scanned < ACCOUNT_DELETION_RETENTION_PAGE_SIZE) break;
    } catch (error) {
      retentionErrors += 1;
      console.error('[account-deletion-cron] tombstone retention failed', {
        kind: error instanceof Error ? error.name : typeof error,
      });
      break;
    }
  }

  // Receipt retention is independent of account deletion recovery.
  if (Date.now() + SAFETY_BUFFER_MS < deletionDeadlineMs) {
    try {
      erasureReceiptsPurged = await purgeExpiredCompletedHealthErasures(deletionDeadlineMs);
    } catch (error) {
      erasureErrors++;
      console.error('[account-deletion-cron] erasure receipt retention failed', {
        kind: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  // Every count is emitted from one summary so diagnostics and the protected
  // JSON response cannot silently diverge when another phase is added.
  // "processed" counts attempted account workers, while accountFailed counts
  // returned failures and recoveryErrors counts exceptions.
  const summary = {
    scanned: jobs.length,
    processed: accountProcessed,
    accountCompleted,
    accountPending,
    accountBusy,
    accountFailed,
    erasureScanned,
    erasureProcessed,
    erasureCompleted,
    erasurePending,
    erasureBusy,
    erasureFailed,
    erasureErrors,
    erasureReceiptsPurged,
    inactiveScanned,
    inactiveQueued,
    inactivityErrors,
    recoveryErrors,
    retentionErrors,
    purged,
  };
  console.info('[account-deletion-cron] completed', summary);

  return Response.json(summary);
}
