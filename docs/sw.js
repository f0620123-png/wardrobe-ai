/* docs/sw.js
   Cache strategy tuned for GitHub Pages:
   - Navigations (HTML): Network First (fallback cache)
   - Static assets (js/css/png/webmanifest): Stale-While-Revalidate
*/

const CACHE_NAME = "wardrobe-ai-cache-v20251226-1";

function getBasePath() {
  // scope like: https://f0620123-png.github.io/wardrobe-ai/
  const u = new URL(self.registration.scope);
  return u.pathname.endsWith("/") ? u.pathname : (u.pathname + "/");
}

const BASE = getBasePath();

// Core assets (best effort)
const CORE = [
  BASE,
  BASE + "index.html",
  BASE + "styles.css",
  BASE + "app.js",
  BASE + "db.js",
  BASE + "sw.js",
  BASE + "manifest.webmanifest",
  BASE + "icon-192.png",
  BASE + "icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      await cache.addAll(CORE);
    } catch {
      // GitHub Pages 有時 addAll 會因單一檔案失敗而全失敗，容錯
      await cache.add(BASE).catch(() => {});
    }
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg === "SKIP_WAITING") self.skipWaiting();
  if (msg === "CLEAR_CACHES") {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    })());
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // only handle same-origin
  if (url.origin !== self.location.origin) return;

  // HTML navigations: network first
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(req);
        return cached || caches.match(BASE + "index.html") || new Response("Offline", { status: 503 });
      }
    })());
    return;
  }

  const isAsset =
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".webmanifest") ||
    url.pathname.endsWith(".ico") ||
    url.pathname.endsWith(".svg");

  if (isAsset) {
    // stale-while-revalidate
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      const fetchPromise = (async () => {
        try {
          const fresh = await fetch(req, { cache: "no-store" });
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          return null;
        }
      })();

      // return cached immediately if exists; else wait network
      return cached || (await fetchPromise) || new Response("Offline", { status: 503 });
    })());
    return;
  }

  // default: try cache first then network
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      return await fetch(req);
    } catch {
      return new Response("Offline", { status: 503 });
    }
  })());
});