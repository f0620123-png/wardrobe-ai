/* docs/sw.js - v7.2 */
"use strict";

const VERSION = "v7.2";
const CACHE_NAME = `wardrobe-ai-${VERSION}`;
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./db.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // 用 {cache:'reload'} 讓瀏覽器拿最新（避免 iOS/Proxy 亂回舊）
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

// Stale-While-Revalidate（同源 assets）
// Navigation（HTML）優先 network，失敗回 cache，避免離線空白
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // 只處理同源 (GitHub Pages)
  if (url.origin !== self.location.origin) return;

  // navigation：network-first
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        // 用 pathname 當 key，避免 ?update= 造成多份 cache
        await cache.put(url.pathname === "/" ? "./index.html" : url.pathname, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match("./index.html", { ignoreSearch: true });
        return cached || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
      }
    })());
    return;
  }

  // 其他同源資源：stale-while-revalidate
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    // ignoreSearch：避免 ?v=7.2 / ?update=1 造成 cache 分裂
    const cached = await caches.match(req, { ignoreSearch: true });
    const fetchPromise = (async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          // 用 pathname 當 key（最穩）
          const key = url.pathname === "/" ? "./index.html" : url.pathname;
          await cache.put(key, fresh.clone());
        }
        return fresh;
      } catch (e) {
        return null;
      }
    })();

    if (cached) {
      // 背景更新
      event.waitUntil(fetchPromise);
      return cached;
    }

    const fresh = await fetchPromise;
    if (fresh) return fresh;

    return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
  })());
});