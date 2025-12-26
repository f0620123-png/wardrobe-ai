// sw.js (no-cache / fast-update version)
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// 不攔截 fetch：避免快取導致「驗收卡住」
self.addEventListener("fetch", () => {});
