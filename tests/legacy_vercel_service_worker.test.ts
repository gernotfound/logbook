import { describe, expect, it } from 'vitest';
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
});
