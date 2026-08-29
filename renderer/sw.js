// sw.js — GitHub Pages 版資產攔截：Cache Storage 優先，miss 走網路。
// 只攔同源 assets/ 請求；Worker（跨域）與程式本身不碰。
const CACHE_PREFIX = 'ba-assets-v';

self.addEventListener('install', (e) => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // 清掉舊版本快取。__baActiveCache 未定義時（SW 剛安裝、尚未收到
    // ba-web 廣播）不可刪——否则會把所有 ba-* 快取清光，使用者卡死。
    const names = await caches.keys();
    const keep = self.__baActiveCache;
    if (typeof keep === 'string') {
      await Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== keep).map((n) => caches.delete(n)));
    }
    await self.clients.claim();
  })());
});

// ba-web.js 開新快取後廣播，讓 SW 更新 __baActiveCache
self.addEventListener('message', (e) => {
  if (e.data?.type === 'ba-cache' && typeof e.data.cache === 'string') {
    self.__baActiveCache = e.data.cache;
  }
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (!url.pathname.includes('/assets/')) return;
  if (e.request.method !== 'GET') return;
  // 全部同源 assets 一律 cache-first（含 data/）：資料走 private Assets repo 的
  // 版本化 core pack（ba-assets-v<ver>），activate 時已清掉舊版快取，故 cache
  // 內容與 app/js 版本一致；network 只作離線/未安裝時的兜底。此模式回傳
  // pack 安裝的內容，避免 Pages 上無 assets/data 而 network-first 產生 404。
  e.respondWith((async () => {
    const cacheNames = await caches.keys();
    for (const n of cacheNames) {
      if (!n.startsWith(CACHE_PREFIX)) continue;
      const c = await caches.open(n);
      const hit = await c.match(e.request);
      if (hit) return hit;
    }
    const fresh = await fetch(e.request);
    if (fresh.ok) {
      const cacheNames2 = await caches.keys();
      for (const n of cacheNames2) {
        if (!n.startsWith(CACHE_PREFIX)) continue;
        await caches.open(n).then((c) => c.put(e.request, fresh.clone()));
        break;
      }
    }
    return fresh;
  })());
});
