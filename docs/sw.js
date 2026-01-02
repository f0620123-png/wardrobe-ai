/* docs/sw.js - cache busting + safe offline */

const CACHE_NAME = "wardrobe-ai-cache-v7"; // 每次你更新檔案，改這個版本號
const ASSETS = [
  "./",
  "./index.html",
  "./style.css?v=1",
  "./app.js?v=1",
  "./db.js?v=1",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(ASSETS);
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
      await self.clients.claim();
    })()
  );
});

// 注意：不要快取 worker API（天氣/AI），避免拿到舊資料或 CORS 問題
function isApiRequest(req) {
  const url = new URL(req.url);
  return url.hostname.endsWith("workers.dev");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;

  if (req.method !== "GET") return;
  if (isApiRequest(req)) return; // API 走網路

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // HTML：network-first，避免你更新後還拿到舊版 index.html
      if (req.headers.get("accept")?.includes("text/html")) {
        try {
          const fresh = await fetch(req, { cache: "no-store" });
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          const cached = await cache.match("./index.html");
          return cached || new Response("Offline", { status: 503 });
        }
      }

      // 其他資源：cache-first
      const cached = await cache.match(req);
      if (cached) return cached;

      try {
        const fresh = await fetch(req);
        // 只快取同源資源
        if (new URL(req.url).origin === self.location.origin) {
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch {
        // fallback
        const fallback = await cache.match("./index.html");
        return fallback || new Response("Offline", { status: 503 });
      }
    })()
  );
});