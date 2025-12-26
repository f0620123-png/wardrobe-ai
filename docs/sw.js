/* docs/sw.js
 * GitHub Pages friendly Service Worker
 * - Precaches core shell with resilient cache (skip missing files)
 * - Network-first for navigation (HTML)
 * - Cache-first for same-origin static assets
 * - skipWaiting + clientsClaim
 */

const CACHE_VERSION = "wardrobe-ai-v7";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./db.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);

      // 不用 addAll（缺檔會整個 install 失敗）
      await Promise.allSettled(
        CORE_ASSETS.map(async (url) => {
          try {
            const req = new Request(url, { cache: "no-cache" });
            const res = await fetch(req);
            if (res && res.ok) {
              await cache.put(req, res.clone());
            }
          } catch (_) {
            // ignore
          }
        })
      );

      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k !== CACHE_VERSION ? caches.delete(k) : Promise.resolve())));
      await self.clients.claim();
    })()
  );
});

// 讓 app.js 可以叫 SW 立刻生效
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 只處理 GET
  if (req.method !== "GET") return;

  // 導航（HTML）=> network-first，避免更新卡住
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(networkFirst(req));
    return;
  }

  // 同源靜態資源（css/js/png/...）=> cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // 其他來源 => 直接走網路
  event.respondWith(fetch(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (_) {
    // ignoreSearch: 讓 ./?v=xxx 也能命中 ./ 或 index.html
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    // 兜底：回傳首頁
    const fallback = await cache.match("./", { ignoreSearch: true });
    return fallback || new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(req, { ignoreSearch: true });
  if (cached) return cached;

  const fresh = await fetch(req);
  if (fresh && fresh.ok) {
    cache.put(req, fresh.clone());
  }
  return fresh;
}