// MODIFICA QUESTO NUMERO DI VERSIONE PER FORZARE L'AGGIORNAMENTO DELLA PWA SUI DISPOSITIVI
const APP_VERSION = 'v1.0.0';
const CACHE_NAME = `gym-pro-cache-${APP_VERSION}`;
const urlsToCache = [
  './index.html',
  './css/styles.css',
  './js/logic.js',
  './js/db.js',
  './js/app.js',
  './js/firebase-config.js',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
