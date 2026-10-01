import { describe, expect, it } from 'vitest';

process.env.LOGBOOK_FUNCTION_REGION = 'europe-west1';
process.env.LOGBOOK_FUNCTION_SERVICE_ACCOUNT =
  'logbook-runtime@example-project.iam.gserviceaccount.com';
process.env.LOGBOOK_ALLOWED_ORIGINS = 'https://app.example';

const {
  accountDeletion,
  accountDeletionHttpHandler,
  accountDeletionOptions,
  accountDeletionMaintenance,
  accountDeletionMaintenanceOptions,
} = await import('../functions/src/index.ts');

type TestResponse = {
  headers: Map<string, string>;
  statusCode: number;
  body: unknown;
  set(name: string, value: string): TestResponse;
  status(code: number): TestResponse;
  json(body: unknown): TestResponse;
  send(body: unknown): TestResponse;
};

function request(method: string, origin = 'https://app.example') {
  const headers: Record<string, string> = origin ? { origin } : {};
  return {
    method,
    protocol: 'https',
    originalUrl: '/accountDeletion',
    headers,
    rawBody: method === 'POST' ? Buffer.from('{}') : undefined,
    body: {},
    get(name: string) {
      return headers[name.toLowerCase()];
    },
  } as any;
}

function response(): TestResponse {
  return {
    headers: new Map<string, string>(),
    statusCode: 200,
    body: undefined,
    set(name: string, value: string) {
      this.headers.set(name, value);
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    send(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

describe('Firebase Functions production entrypoint', () => {
  it('declares an explicitly public direct HTTPS Function with bounded scaling', () => {
    expect(accountDeletionOptions).toMatchObject({
      timeoutSeconds: 3600,
      memory: '512MiB',
      concurrency: 10,
      maxInstances: 10,
      invoker: 'public',
      cors: false,
    });

    const endpoint = (accountDeletion as any).__endpoint;
    expect(endpoint).toMatchObject({
      platform: 'gcfv2',
      availableMemoryMb: 512,
      timeoutSeconds: 3600,
      maxInstances: 10,
      concurrency: 10,
      httpsTrigger: { invoker: ['public'] },
    });
    expect(endpoint.region?.name).toBe('LOGBOOK_FUNCTION_REGION');
    expect(endpoint.serviceAccountEmail?.name).toBe('LOGBOOK_FUNCTION_SERVICE_ACCOUNT');
  });

  it('allows configured origins and fails closed before destructive work without auth', async () => {
    const res = response();
    await accountDeletionHttpHandler(request('POST'), res as any);

    expect(res.statusCode).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example');
    expect(res.headers.get('Vary')).toBe('Origin');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rejects an unlisted browser origin before the deletion core is reached', async () => {
    const res = response();
    await accountDeletionHttpHandler(request('POST', 'https://evil.example'), res as any);

    expect(res.statusCode).toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeUndefined();
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('handles preflight without invoking destructive logic', async () => {
    const res = response();
    await accountDeletionHttpHandler(request('OPTIONS'), res as any);

    expect(res.statusCode).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rejects unsupported methods with an explicit Allow contract', async () => {
    const res = response();
    await accountDeletionHttpHandler(request('PATCH'), res as any);

    expect(res.statusCode).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, POST, PUT, OPTIONS');
  });
  it('keeps scheduled maintenance private to the scheduler trigger', () => {
    expect(accountDeletionMaintenanceOptions).toMatchObject({
      schedule: '0 3 * * *',
      timeZone: 'Etc/UTC',
      timeoutSeconds: 1800,
      memory: '512MiB',
      maxInstances: 1,
      concurrency: 1,
      retryCount: 3,
    });

    const endpoint = (accountDeletionMaintenance as any).__endpoint;
    expect(endpoint).toMatchObject({
      platform: 'gcfv2',
      availableMemoryMb: 512,
      timeoutSeconds: 1800,
      maxInstances: 1,
      concurrency: 1,
      scheduleTrigger: {
        schedule: '0 3 * * *',
        retryConfig: { retryCount: 3 },
        timeZone: 'Etc/UTC',
      },
    });
    expect(endpoint.region?.name).toBe('LOGBOOK_FUNCTION_REGION');
    expect(endpoint.serviceAccountEmail?.name).toBe('LOGBOOK_FUNCTION_SERVICE_ACCOUNT');
  });
});
