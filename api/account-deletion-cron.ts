import { listRecoverableDeletionJobs } from '../server/accountDeletion/jobStore';
import { processAccountDeletion } from '../server/accountDeletion/runner';

export const maxDuration = 300;

const CRON_BUDGET_MS = 270_000;
const SAFETY_BUFFER_MS = 10_000;

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
  const jobs = await listRecoverableDeletionJobs(25);
  const results: Array<{ uid: string; result: string }> = [];

  for (const job of jobs) {
    if (Date.now() + SAFETY_BUFFER_MS >= deadlineMs) break;
    const result = await processAccountDeletion(job.uid, deadlineMs);
    results.push({ uid: job.uid, result });
  }

  return Response.json({ scanned: jobs.length, processed: results.length, results });
}
