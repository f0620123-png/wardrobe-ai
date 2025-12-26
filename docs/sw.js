/* docs/sw.js */
const SW_VERSION = "sw-v6"; // 你每次要強制更新，就改這個字串
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SW_VERSION);
      await cache.addAll(CORE.map((u) => new Request(u, { cache: "reload" })));
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== SW_VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

function isCore(req) {
  const url = new URL(req.url);
  return CORE.some((p) => url.pathname.endsWith(p.replace("./", "")));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET
  if (req.method !== "GET") return;

  // Bypass cross-origin API calls (your Worker)
  if (url.origin !== self.location.origin) return;

  // Network-first for core files (avoid "更新卡住")
  if (isCore(req) || url.pathname.endsWith("/app.js") || url.pathname.endsWith("/styles.css") || url.pathname.endsWith("/index.html")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SW_VERSION);
        try {
          const fresh = await fetch(req, { cache: "no-store" });
          if (fresh && fresh.ok) cache.put(req, fresh.clone());
          return fresh;
        } catch {
          const cached = await cache.match(req);
          if (cached) return cached;
          return new Response("Offline", { status: 503 });
        }
      })()
    );
    return;
  }

  // Cache-first for other static assets
  event.respondWith(
    (async () => {
      const cache = await caches.open(SW_VERSION);
      const cached = await cache.match(req);
      if (cached) return cached;
      const fresh = await fetch(req);
      if (fresh && fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    })()
  );
});