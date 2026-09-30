import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { handleAccountDeletionGet, handleAccountDeletionPost } from './accountDeletion/http.js';
import { runAccountDeletionMaintenance } from './maintenance.js';

const FUNCTION_REGION = process.env.LOGBOOK_FUNCTION_REGION?.trim() || 'europe-west1';
const MAINTENANCE_BUDGET_MS = 28 * 60 * 1000;
const ALLOWED_METHODS = 'GET, POST, OPTIONS';
const ALLOWED_HEADERS = [
  'authorization',
  'content-type',
  'x-firebase-appcheck',
  'x-account-deletion-uid',
  'x-account-deletion-receipt',
].join(', ');

function allowedOrigins(): Set<string> {
  return new Set(
    (process.env.LOGBOOK_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
  );
}

function applyCors(req: any, res: any): boolean {
  const origin = req.get('origin');
  if (!origin) return true;

  if (!allowedOrigins().has(origin)) {
    res.set('Cache-Control', 'no-store');
    res.status(403).json({ error: 'Origin non autorizzata.' });
    return false;
  }

  res.set('Access-Control-Allow-Origin', origin);
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Methods', ALLOWED_METHODS);
  res.set('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  res.set('Access-Control-Max-Age', '600');
  return true;
}

function toWebRequest(req: any): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers as Record<string, string | string[] | undefined>)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, String(value));
    }
  }

  const host = req.get('host') ?? 'localhost';
  const url = `${req.protocol}://${host}${req.originalUrl}`;
  const method = String(req.method).toUpperCase();
  const body = method === 'GET' || method === 'HEAD'
    ? undefined
    : req.rawBody?.length
      ? req.rawBody.toString('utf8')
      : JSON.stringify(req.body ?? {});

  return new Request(url, { method, headers, body });
}

async function sendWebResponse(response: Response, res: any): Promise<void> {
  response.headers.forEach((value, key) => res.set(key, value));
  res.set('Cache-Control', 'no-store');
  const body = await response.text();
  res.status(response.status).send(body);
}

export const accountDeletion = onRequest(
  {
    region: FUNCTION_REGION,
    timeoutSeconds: 3600,
    memory: '512MiB',
    concurrency: 10,
    maxInstances: 10,
    cors: false,
  },
  async (req, res) => {
    if (!applyCors(req, res)) return;

    if (req.method === 'OPTIONS') {
      res.set('Cache-Control', 'no-store');
      res.status(204).send('');
      return;
    }

    let response: Response;
    if (req.method === 'POST') {
      response = await handleAccountDeletionPost(toWebRequest(req));
    } else if (req.method === 'GET') {
      response = await handleAccountDeletionGet(toWebRequest(req));
    } else {
      response = Response.json(
        { error: 'Metodo non consentito.' },
        { status: 405, headers: { Allow: ALLOWED_METHODS } },
      );
    }

    await sendWebResponse(response, res);
  },
);

export const accountDeletionMaintenance = onSchedule(
  {
    schedule: '0 3 * * *',
    timeZone: 'Etc/UTC',
    region: FUNCTION_REGION,
    timeoutSeconds: 1800,
    memory: '512MiB',
    maxInstances: 1,
    retryCount: 3,
  },
  async () => {
    const summary = await runAccountDeletionMaintenance(Date.now() + MAINTENANCE_BUDGET_MS);
    logger.info('Account deletion maintenance completed', summary);
  },
);
