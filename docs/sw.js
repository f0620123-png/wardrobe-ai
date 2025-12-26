/* docs/sw.js
   - Network-first for HTML/JS/CSS to avoid stale UI
   - Cache-first for images (with fallback)
   - Supports messages:
     - SKIP_WAITING
     - CLEAR_CACHES
*/

const VERSION = "sw-2025-12-26.1";
const CACHE_CORE = `wardrobe-core-${VERSION}`;
const CACHE_IMG = `wardrobe-img-${VERSION}`;

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_CORE);
    await cache.addAll(CORE_ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k.startsWith("wardrobe-") && k !== CACHE_CORE && k !== CACHE_IMG)
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (msg.type === "CLEAR_CACHES") {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k.startsWith("wardrobe-")).map(k => caches.delete(k)));
      // 清完後也 claim，讓下一次 reload 直接用新資源
      await self.clients.claim();
    })());
  }
});

function isHtmlRequest(req) {
  return req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html");
}

function isCoreAsset(url) {
  const p = url.pathname;
  return (
    p.endsWith("/index.html") ||
    p.endsWith("/styles.css") ||
    p.endsWith("/app.js") ||
    p.endsWith("/manifest.webmanifest") ||
    p.endsWith("/icon-192.png") ||
    p.endsWith("/icon-512.png")
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 只處理同源（GitHub Pages）
  if (url.origin !== self.location.origin) return;

  // HTML/核心檔案：network-first
  if (isHtmlRequest(req) || isCoreAsset(url)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        const cache = await caches.open(CACHE_CORE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        // 最後保底：回首頁
        const fallback = await caches.match("./index.html");
        return fallback || new Response("Offline", { status: 200 });
      }
    })());
    return;
  }

  // 圖片：cache-first + 背景更新
  if (req.destination === "image") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_IMG);
      const cached = await cache.match(req);
      if (cached) {
        event.waitUntil((async () => {
          try {
            const fresh = await fetch(req);
            cache.put(req, fresh.clone());
          } catch {}
        })());
        return cached;
      }
      try {
        const fresh = await fetch(req);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        return new Response("", { status: 200 });
      }
    })());
    return;
  }

  // 其他：stale-while-revalidate
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_CORE);
    const cached = await cache.match(req);
    const fetchPromise = (async () => {
      try {
        const fresh = await fetch(req);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        return null;
      }
    })();

    if (cached) {
      event.waitUntil(fetchPromise);
      return cached;
    }
    const fresh = await fetchPromise;
    return fresh || new Response("", { status: 200 });
  })());
});