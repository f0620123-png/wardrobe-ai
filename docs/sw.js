"use strict";

/* v7.3：換 cache name + 改 asset 清單（使用 style.v73.css） */
const VERSION = "v7.3";
const CACHE_NAME = `wardrobe-ai-${VERSION}`;
const ASSETS = [
  "./",
  "./index.html",
  "./style.v73.css",
  "./app.js",
  "./db.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(ASSETS.map(async (u) => {
      try {
        const req = new Request(u, { cache: "reload" });
        const res = await fetch(req);
        if (res.ok) await cache.put(u, res.clone());
      } catch (_) {}
    }));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (k.startsWith("wardrobe-ai-") && k !== CACHE_NAME) return caches.delete(k);
    }));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // navigation：network-first，失敗回 cache
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        await cache.put("./index.html", fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match("./index.html", { ignoreSearch: true });
        return cached || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
      }
    })());
    return;
  }

  // assets：stale-while-revalidate + ignoreSearch
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await caches.match(req, { ignoreSearch: true });

    const fetchPromise = (async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const key = url.pathname === "/" ? "./index.html" : url.pathname;
          await cache.put(key, fresh.clone());
        }
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
    if (fresh) return fresh;

    return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
  })());
});