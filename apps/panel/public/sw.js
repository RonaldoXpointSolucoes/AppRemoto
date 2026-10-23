const CACHE_NAME = 'xpoint-remote-v1-7-8';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const oldKeys = keys.filter((k) => k !== CACHE_NAME);
      await Promise.all(oldKeys.map((k) => caches.delete(k)));
      await self.clients.claim();
      if (oldKeys.length > 0) {
        const windowClients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });
        for (const client of windowClients) {
          if ('navigate' in client && client.url) {
            try {
              await client.navigate(client.url);
            } catch {
              // ignore navigation error
            }
          }
        }
      }
    })()
  );
});

function buildSelfHealingHtml() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <title>XPoint Remote â€” Retomando sessÃ£o...</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0b1320;
      color: #f8fafc;
      font-family: system-ui, -apple-system, sans-serif;
      padding: 24px;
      text-align: center;
    }
    .card {
      max-width: 360px;
      padding: 24px;
      border-radius: 16px;
      background: rgba(15, 23, 42, 0.9);
      border: 1px solid rgba(56, 189, 248, 0.25);
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
    }
    .spinner {
      width: 32px;
      height: 32px;
      margin: 0 auto 14px;
      border: 3px solid rgba(56, 189, 248, 0.2);
      border-top-color: #38bdf8;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    h1 { font-size: 16px; margin: 0 0 6px; font-weight: 700; }
    p { font-size: 13px; margin: 0; color: #94a3b8; line-height: 1.45; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h1>Retomando XPoint Remote...</h1>
    <p>Sincronizando painel apÃ³s retorno do aplicativo RustDesk.</p>
  </div>
  <script>
    (function() {
      var reloaded = false;
      function resumeNow() {
        if (reloaded) return;
        if (document.visibilityState === 'hidden') return;
        reloaded = true;
        window.location.replace(window.location.href);
      }
      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') setTimeout(resumeNow, 250);
      });
      window.addEventListener('focus', function() { setTimeout(resumeNow, 250); });
      window.addEventListener('online', function() { setTimeout(resumeNow, 250); });
      setTimeout(resumeNow, 600);
    })();
  </script>
</body>
</html>`;
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Navigation resilience when switching between browser and RustDesk Android/Desktop app
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cacheKey = url.pathname || '/devices';
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && networkResponse.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(cacheKey, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          // Wait briefly in case network socket is waking up after returning from RustDesk
          await new Promise((resolve) => setTimeout(resolve, 400));
          try {
            const retryResponse = await fetch(event.request);
            if (retryResponse && retryResponse.ok) {
              const cache = await caches.open(CACHE_NAME);
              await cache.put(cacheKey, retryResponse.clone());
            }
            return retryResponse;
          } catch {
            const cached =
              (await caches.match(cacheKey)) ||
              (await caches.match('/devices')) ||
              (await caches.match(event.request));
            if (cached) return cached;
            return new Response(buildSelfHealingHtml(), {
              status: 200,
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
              },
            });
          }
        }
      })()
    );
    return;
  }

  const isStaticAsset =
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/favicon.png' ||
    url.pathname === '/favicon.ico' ||
    url.pathname === '/manifest.json';

  if (!isStaticAsset) return;

  event.respondWith(
    fetch(event.request)
      .then(async (response) => {
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, response.clone());
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        return Response.error();
      })
  );
});


