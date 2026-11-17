import { createServer, request } from 'node:http';
import { assertLoopbackE2eUrl } from '../scripts/e2e-environment.mjs';
import { test as base, expect } from './fixtures';

type UpgradeServer = { origin: string; useNextBuild(): void };

/**
 * Each test owns one browser origin and can atomically change the release it
 * serves. A real service worker fetches the actual Vite bundles through HTTP;
 * there is no fake registration, waiting event or SKIP_WAITING in the test.
 */
export const test = base.extend<{ upgradeServer: UpgradeServer }>({
  upgradeServer: async ({ browserName }, provide) => {
    if (browserName !== 'chromium') throw new Error('The real PWA lifecycle suite requires Chromium');
    const previous = assertLoopbackE2eUrl(process.env.LOGBOOK_TEST_URL || 'http://127.0.0.1:4173');
    const next = assertLoopbackE2eUrl(process.env.LOGBOOK_E2E_NEXT_URL || '');
    let target = previous;
    const server = createServer((incoming, outgoing) => {
      // Forward paths only to the two validated loopback previews. Neither an
      // absolute request URL nor a Host header can select an external target.
      if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//')
        || (incoming.method !== 'GET' && incoming.method !== 'HEAD')) {
        outgoing.writeHead(400).end();
        return;
      }
      const destination = new URL(target);
      const upstream = request(destination, {
        path: incoming.url,
        method: incoming.method,
        headers: { ...incoming.headers, host: destination.host },
      }, response => {
        outgoing.writeHead(response.statusCode ?? 502, {
          ...response.headers,
          'cache-control': 'no-store',
        });
        response.pipe(outgoing);
      });
      upstream.on('error', () => {
        if (!outgoing.headersSent) outgoing.writeHead(502);
        outgoing.end();
      });
      outgoing.on('close', () => upstream.destroy());
      upstream.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Upgrade preview unavailable');
      await provide({
        origin: assertLoopbackE2eUrl(`http://127.0.0.1:${address.port}`),
        useNextBuild: () => { target = next; },
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    }
  },
  baseURL: async ({ upgradeServer }, provide) => {
    await provide(upgradeServer.origin);
  },
});

export { expect };
