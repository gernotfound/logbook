import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outputDirectory = resolve(process.argv[2] || '.vercel-static');

const retirementWorker = `
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();

    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));

    const windows = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    await self.registration.unregister();

    await Promise.all(windows.map(async (client) => {
      try {
        await client.navigate('/');
      } catch {
        // The retired origin root is intentionally redirected to Firebase Hosting.
      }
    }));
  })());
});
`.trim();

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(resolve(outputDirectory, 'sw.js'), retirementWorker + '\n', 'utf8');

console.log(`Prepared Vercel backend-only static output at ${outputDirectory}: sw.js retirement worker only.`);
