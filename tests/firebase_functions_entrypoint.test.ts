import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  httpsOptions: undefined as any,
  httpsHandler: undefined as any,
  scheduleOptions: undefined as any,
  scheduleHandler: undefined as any,
  post: vi.fn(),
  get: vi.fn(),
  maintenance: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock('firebase-functions/v2/https', () => ({
  onRequest: vi.fn((options: unknown, handler: unknown) => {
    state.httpsOptions = options;
    state.httpsHandler = handler;
    return handler;
  }),
}));
vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: vi.fn((options: unknown, handler: unknown) => {
    state.scheduleOptions = options;
    state.scheduleHandler = handler;
    return handler;
  }),
}));
vi.mock('firebase-functions/params', () => ({
  defineString: vi.fn((name: string) => ({
    value: () => {
      if (name === 'LOGBOOK_ALLOWED_ORIGINS') return 'https://app.example';
      if (name === 'LOGBOOK_FUNCTION_SERVICE_ACCOUNT') return 'logbook-runtime@example-project.iam.gserviceaccount.com';
      return 'europe-west1';
    },
  })),
}));
vi.mock('firebase-functions', () => ({
  logger: { info: state.loggerInfo },
}));
vi.mock('../functions/src/accountDeletion/http', () => ({
  handleAccountDeletionPost: state.post,
  handleAccountDeletionGet: state.get,
}));
vi.mock('../functions/src/maintenance', () => ({
  runAccountDeletionMaintenance: state.maintenance,
}));

await import('../functions/src/index');

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

function response() {
  const result: any = {
    headers: new Map<string, string>(),
    statusCode: 200,
    body: undefined,
  };
  result.set = vi.fn((name: string, value: string) => {
    result.headers.set(name, value);
    return result;
  });
  result.status = vi.fn((code: number) => {
    result.statusCode = code;
    return result;
  });
  result.json = vi.fn((body: unknown) => {
    result.body = body;
  });
  result.send = vi.fn((body: unknown) => {
    result.body = body;
  });
  return result;
}

describe('Firebase Functions production entrypoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.post.mockResolvedValue(Response.json({ status: 'deleting' }, { status: 202 }));
    state.get.mockResolvedValue(Response.json({ status: 'complete' }, { status: 200 }));
    state.maintenance.mockResolvedValue({ processed: 0 });
  });

  it('declares an explicitly public direct HTTPS Function with bounded scaling', () => {
    expect(state.httpsOptions).toMatchObject({
      timeoutSeconds: 3600,
      memory: '512MiB',
      concurrency: 10,
      maxInstances: 10,
      invoker: 'public',
      cors: false,
      serviceAccount: 'logbook-runtime@example-project.iam.gserviceaccount.com',
    });
  });

  it('allows only configured origins and preserves CORS on the shared HTTP response', async () => {
    const res = response();
    await state.httpsHandler(request('POST'), res);

    expect(state.post).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(202);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example');
    expect(res.headers.get('Vary')).toBe('Origin');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rejects an unlisted browser origin before the deletion core is reached', async () => {
    const res = response();
    await state.httpsHandler(request('POST', 'https://evil.example'), res);

    expect(res.statusCode).toBe(403);
    expect(state.post).not.toHaveBeenCalled();
    expect(state.get).not.toHaveBeenCalled();
  });

  it('handles preflight without invoking destructive logic', async () => {
    const res = response();
    await state.httpsHandler(request('OPTIONS'), res);

    expect(res.statusCode).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(state.post).not.toHaveBeenCalled();
    expect(state.get).not.toHaveBeenCalled();
  });

  it('keeps scheduled maintenance private to the scheduler trigger and logs only its summary', async () => {
    await state.scheduleHandler();

    expect(state.scheduleOptions).toMatchObject({
      schedule: '0 3 * * *',
      timeZone: 'Etc/UTC',
      timeoutSeconds: 1800,
      memory: '512MiB',
      maxInstances: 1,
      concurrency: 1,
      retryCount: 3,
      serviceAccount: 'logbook-runtime@example-project.iam.gserviceaccount.com',
    });
    expect(state.maintenance).toHaveBeenCalledWith(expect.any(Number));
    expect(state.loggerInfo).toHaveBeenCalledWith('Account deletion maintenance completed', { processed: 0 });
  });
});
