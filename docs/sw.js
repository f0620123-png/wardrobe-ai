/* docs/sw.js */
const CACHE_VERSION = 'wardrobe-ai-v7';
const STATIC_CACHE = `static-${CACHE_VERSION}`;

// 這些檔案不存在也不要讓 install 失敗，所以用逐一 add
const PRECACHE_URLS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './db.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    for (const url of PRECACHE_URLS) {
      try { await cache.add(url); } catch (_) {}
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (k !== STATIC_CACHE) return caches.delete(k);
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event?.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

function isSameOrigin(url) {
  try { return new URL(url).origin === self.location.origin; }
  catch { return false; }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 只處理同網域
  if (!isSameOrigin(req.url)) return;

  // 導覽頁：Network First（避免卡舊 HTML）
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(STATIC_CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (_) {
        const cached = await caches.match('./index.html');
        return cached || new Response('Offline', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  // 靜態資源：Cache First + 背景更新
  const isStatic =
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.jpeg') ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.webmanifest');

  if (isStatic) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) {
        event.waitUntil((async () => {
          try {
            const fresh = await fetch(req);
            const cache = await caches.open(STATIC_CACHE);
            cache.put(req, fresh.clone());
          } catch (_) {}
        })());
        return cached;
      }

      try {
        const fresh = await fetch(req);
        const cache = await caches.open(STATIC_CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (_) {
        return cached || new Response('', { status: 504 });
      }
    })());
  }
});