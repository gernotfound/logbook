import { logger } from 'firebase-functions';
import { defineString } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { handleAccountDeletionGet, handleAccountDeletionPost } from './accountDeletion/http.js';
import { runAccountDeletionMaintenance } from './maintenance.js';

const functionRegion = defineString('LOGBOOK_FUNCTION_REGION');
const allowedOriginsConfig = defineString('LOGBOOK_ALLOWED_ORIGINS');

const MAINTENANCE_BUDGET_MS = 28 * 60 * 1000;
const ALLOWED_METHODS = 'GET, POST, OPTIONS';
const ALLOWED_HEADERS = [
  'authorization',
  'content-type',
  'x-firebase-appcheck',
  'x-account-deletion-uid',
  'x-account-deletion-receipt',
].join(', ');

type HeaderValue = string | string[] | undefined;

type FirebaseHttpRequest = {
  get(name: string): string | undefined;
  headers: Record<string, HeaderValue>;
  protocol: string;
  originalUrl: string;
  method: string;
  rawBody?: Buffer;
  body?: unknown;
};

type FirebaseHttpResponse = {
  set(name: string, value: string): FirebaseHttpResponse;
  status(code: number): FirebaseHttpResponse;
  json(body: unknown): void;
  send(body: string): void;
};

function allowedOrigins(): Set<string> {
  return new Set(
    allowedOriginsConfig.value()
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
  );
}

function applyCors(req: FirebaseHttpRequest, res: FirebaseHttpResponse): boolean {
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

function toWebRequest(req: FirebaseHttpRequest): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, String(value));
    }
  }

  const host = req.get('host') ?? 'localhost';
  const url = `${req.protocol}://${host}${req.originalUrl}`;
  const method = req.method.toUpperCase();
  const body = method === 'GET' || method === 'HEAD'
    ? undefined
    : req.rawBody?.length
      ? req.rawBody.toString('utf8')
      : JSON.stringify(req.body ?? {});

  return new Request(url, { method, headers, body });
}

async function sendWebResponse(response: Response, res: FirebaseHttpResponse): Promise<void> {
  response.headers.forEach((value, key) => res.set(key, value));
  res.set('Cache-Control', 'no-store');
  const body = await response.text();
  res.status(response.status).send(body);
}

export const accountDeletion = onRequest(
  {
    region: functionRegion,
    timeoutSeconds: 3600,
    memory: '512MiB',
    concurrency: 10,
    maxInstances: 10,
    invoker: 'public',
    cors: false,
  },
  async (req, res) => {
    const request = req as unknown as FirebaseHttpRequest;
    const response = res as unknown as FirebaseHttpResponse;

    if (!applyCors(request, response)) return;

    if (request.method === 'OPTIONS') {
      response.set('Cache-Control', 'no-store');
      response.status(204).send('');
      return;
    }

    let webResponse: Response;
    if (request.method === 'POST') {
      webResponse = await handleAccountDeletionPost(toWebRequest(request));
    } else if (request.method === 'GET') {
      webResponse = await handleAccountDeletionGet(toWebRequest(request));
    } else {
      webResponse = Response.json(
        { error: 'Metodo non consentito.' },
        { status: 405, headers: { Allow: ALLOWED_METHODS } },
      );
    }

    await sendWebResponse(webResponse, response);
  },
);

export const accountDeletionMaintenance = onSchedule(
  {
    schedule: '0 3 * * *',
    timeZone: 'Etc/UTC',
    region: functionRegion,
    timeoutSeconds: 1800,
    memory: '512MiB',
    maxInstances: 1,
    concurrency: 1,
    retryCount: 3,
  },
  async () => {
    const summary = await runAccountDeletionMaintenance(Date.now() + MAINTENANCE_BUDGET_MS);
    logger.info('Account deletion maintenance completed', summary);
  },
);
