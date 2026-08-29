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
  // data/（ui_i18n、字幕表等）會隨 app 更新而變動 → network-first，
  // 失敗才退快取；其餘大型資產（spine/voice/bgm…immutable tag 內容）維持 cache-first。
  const networkFirst = url.pathname.includes('/assets/data/');
  e.respondWith((async () => {
    if (networkFirst) {
      try {
        const fresh = await fetch(e.request);
        if (fresh.ok) {
          const cacheNames = await caches.keys();
          for (const n of cacheNames) {
            if (!n.startsWith(CACHE_PREFIX)) continue;
            const c = await caches.open(n);
            c.put(e.request, fresh.clone());
            break;
          }
        }
        return fresh;
      } catch {
        // offline → fall through to cache
      }
    }
    const cacheNames = await caches.keys();
    for (const n of cacheNames) {
      if (!n.startsWith(CACHE_PREFIX)) continue;
      const hit = await caches.open(n).then((c) => c.match(e.request));
      if (hit) return hit;
    }
    return fetch(e.request);
  })());
});
