const CACHE_NAME = 'heres-cache-v2';
const urlsToCache = [
  '/manifest.json',
  '/logo-white.png',
  '/logo-black.png',
  '/favicon.svg',
  '/logos/solana.svg',
  '/logos/phantom.svg',
  '/logos/alchemy-logo.svg',
  '/logos/backpack.png',
  '/logos/magicblock.svg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isDocument = event.request.mode === 'navigate' || event.request.destination === 'document';
  const isNextData = url.pathname.startsWith('/_next') || url.searchParams.has('rsc');
  if (isDocument || isNextData) {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith(
    caches.match(event.request).then((response) => response || fetch(event.request))
  );
});

self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
