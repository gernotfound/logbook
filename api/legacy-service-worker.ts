const LEGACY_SERVICE_WORKER = `
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
    await self.registration.unregister();

    const windows = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    await Promise.all(windows.map(async (client) => {
      try {
        await client.navigate('/');
      } catch {
        // The root request is intentionally handled by the Vercel 301 redirect.
      }
    }));
  })());
});
`.trim();

export async function GET(): Promise<Response> {
  return new Response(LEGACY_SERVICE_WORKER, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Service-Worker-Allowed': '/',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
