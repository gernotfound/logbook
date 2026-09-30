import { runAccountDeletionMaintenance } from '../functions/src/maintenance.js';

const LEGACY_CRON_BUDGET_MS = 270_000;

function forbidden(status: number): Response {
  return Response.json({ error: status === 503 ? 'Cron non configurato.' : 'Non autorizzato.' }, { status });
}

export async function GET(request: Request): Promise<Response> {
  const configuredSecret = process.env.CRON_SECRET?.trim();
  if (!configuredSecret) return forbidden(503);

  const authorization = request.headers.get('authorization');
  if (authorization !== `Bearer ${configuredSecret}`) return forbidden(401);

  const summary = await runAccountDeletionMaintenance(Date.now() + LEGACY_CRON_BUDGET_MS);
  console.info('[account-deletion-cron] completed', summary);
  return Response.json(summary, { status: 200 });
}
