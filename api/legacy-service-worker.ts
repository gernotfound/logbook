const LEGACY_SERVICE_WORKER = `
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();

    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith('workbox-'))
        .map((cacheName) => caches.delete(cacheName)),
    );

    await self.registration.unregister();
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
