const CACHE_NAME = 'xpoint-remote-v2';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') return;

  const url = new URL(event.request.url);
  const isStaticAsset =
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/icons/') ||
      url.pathname === '/favicon.png' ||
      url.pathname === '/manifest.json');

  if (!isStaticAsset) return;

  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      return Response.error();
    })
  );
});

