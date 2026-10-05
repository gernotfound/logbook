import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { GET } from '../api/legacy-service-worker';

describe('legacy Vercel service-worker retirement endpoint', () => {
  it('retires the old worker without forcing navigation or touching user-data storage', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/javascript');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('cache-control')).toContain('must-revalidate');
    expect(response.headers.get('service-worker-allowed')).toBe('/');

    const body = await response.text();
    expect(body).toContain('self.skipWaiting()');
    expect(body).toContain('self.clients.claim()');
    expect(body).toContain('caches.keys()');
    expect(body).toContain("cacheName.startsWith('workbox-')");
    expect(body).toContain('self.registration.unregister()');
    expect(body).not.toContain('client.navigate(');
    expect(body).not.toContain('indexedDB');
    expect(body).not.toContain('localStorage');
    expect(body).not.toContain('precacheAndRoute');
    expect(body).not.toContain('__WB_MANIFEST');
  });


  it('executes the retirement lifecycle and deletes only legacy Workbox caches', async () => {
    const response = await GET();
    const source = await response.text();
    const handlers = new Map<string, (event: { waitUntil: (promise: Promise<unknown>) => void }) => void>();
    const calls: string[] = [];
    const deletedCaches: string[] = [];

    const clients = new Proxy({
      claim: vi.fn(async () => { calls.push('claim'); }),
    }, {
      get(target, property, receiver) {
        if (property in target) return Reflect.get(target, property, receiver);
        throw new Error(`Unexpected clients access: ${String(property)}`);
      },
    });

    const registration = {
      unregister: vi.fn(async () => {
        calls.push('unregister');
        return true;
      }),
    };

    const self = {
      addEventListener: vi.fn((type: string, handler: (event: { waitUntil: (promise: Promise<unknown>) => void }) => void) => {
        handlers.set(type, handler);
      }),
      skipWaiting: vi.fn(async () => { calls.push('skipWaiting'); }),
      clients,
      registration,
    };

    const caches = {
      keys: vi.fn(async () => {
        calls.push('keys');
        return [
          'workbox-precache-v1',
          'custom-app-cache',
          'workbox-runtime-v2',
          'user-owned-cache',
        ];
      }),
      delete: vi.fn(async (name: string) => {
        calls.push(`delete:${name}`);
        deletedCaches.push(name);
        return true;
      }),
    };

    const sandbox: Record<string, unknown> = { self, caches, Promise };
    Object.defineProperty(sandbox, 'indexedDB', {
      configurable: true,
      get: () => { throw new Error('retirement worker must not access IndexedDB'); },
    });
    Object.defineProperty(sandbox, 'localStorage', {
      configurable: true,
      get: () => { throw new Error('retirement worker must not access localStorage'); },
    });

    runInNewContext(source, sandbox);

    expect(handlers.has('install')).toBe(true);
    expect(handlers.has('activate')).toBe(true);

    const runLifecycle = async (type: 'install' | 'activate') => {
      const pending: Promise<unknown>[] = [];
      handlers.get(type)!({ waitUntil: promise => pending.push(Promise.resolve(promise)) });
      await Promise.all(pending);
    };

    await runLifecycle('install');
    expect(self.skipWaiting).toHaveBeenCalledTimes(1);

    await runLifecycle('activate');

    expect(clients.claim).toHaveBeenCalledTimes(1);
    expect(caches.keys).toHaveBeenCalledTimes(1);
    expect(deletedCaches).toEqual(['workbox-precache-v1', 'workbox-runtime-v2']);
    expect(caches.delete).not.toHaveBeenCalledWith('custom-app-cache');
    expect(caches.delete).not.toHaveBeenCalledWith('user-owned-cache');
    expect(registration.unregister).toHaveBeenCalledTimes(1);

    expect(calls.indexOf('claim')).toBeLessThan(calls.indexOf('keys'));
    expect(calls.indexOf('delete:workbox-precache-v1')).toBeLessThan(calls.indexOf('unregister'));
    expect(calls.indexOf('delete:workbox-runtime-v2')).toBeLessThan(calls.indexOf('unregister'));
  });
});
