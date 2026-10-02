const CACHE_NAME = 'xpoint-remote-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Let browser handle normal navigation and API calls, cache static icons and css if offline
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    })
  );
});
