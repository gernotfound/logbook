// MODIFICA QUESTO NUMERO DI VERSIONE SE VUOI FORZARE UNA PULIZIA PROFONDA DELLA CACHE SUI DISPOSITIVI
const APP_VERSION = 'v1.1.0';
const CACHE_NAME = `logbook-cache-${APP_VERSION}`;

// File critici da memorizzare subito all'installazione
const urlsToCache = [
  './',
  './index.html',
  './css/styles.css',
  './js/logic.js',
  './js/db.js',
  './js/app.js',
  './js/firebase-config.js',
  './manifest.json'
];

self.addEventListener('install', event => {
  // skipWaiting forza il Service Worker ad attivarsi subito (Fondamentale su Smartphone,
  // altrimenti l'app aspetta che tutte le schede e le app in background vengano chiuse)
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener('activate', event => {
  // Prende il controllo immediato della pagina senza aspettare un refresh
  event.waitUntil(clients.claim());
  
  // Pulisce le vecchie cache
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

self.addEventListener('fetch', event => {
  // Ignora le chiamate alle API esterne di Google e Firebase (devono essere gestite online o dall'SDK offline di Firebase)
  if (event.request.method !== 'GET' || 
      event.request.url.includes('firestore') || 
      event.request.url.includes('googleapis') || 
      event.request.url.includes('gstatic')) {
      return;
  }

  // STRATEGIA PER SMARTPHONE: "Network-First, fallback to Cache"
  // Prova sempre a scaricare i file aggiornati da internet (se sei connesso).
  // Se sei offline in palestra, fallisce e ti restituisce subito il file dalla cache salvata.
  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        // Se la rete risponde correttamente, aggiorniamo la cache con il nuovo file
        // in modo da avere sempre l'ultimissima versione pronta per quando si andrà offline.
        if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone);
            });
        }
        return networkResponse;
      })
      .catch(() => {
        // Se la connessione manca o fallisce, pesca dalla cache
        return caches.match(event.request);
      })
  );
});
