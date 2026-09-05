// sw.js — Service Worker: single active cache + network fallback
// ba-web.js posts 'ba-active-cache' after installing packs; from that point
// all /assets/ requests resolve from that one cache (O(1) lookup).  On miss
// the response comes from network and is cached for next time.

const CACHE_PREFIX = 'ba-assets-v';

let _activeCacheName = null;

// ba-web 安裝成功後會 postMessage 通知 active cache；但 SW 隨時可能被瀏覽器
// 終止/重啟（記憶體狀態歸零）。ba-web 的清理邏輯保證同時只有一個
// ba-assets-v* 快取，故重啟後可從 Cache Storage 自行找回，避免
// 「active cache 不知道 → 全部 network → Pages 上 assets/ 404」的風暴。
async function activeName() {
  if (_activeCacheName) return _activeCacheName;
  try {
    const names = await caches.keys();
    const mine = names.filter((n) => n.startsWith(CACHE_PREFIX));
    if (mine.length) _activeCacheName = mine.sort().pop();
  } catch {}
  return _activeCacheName;
}

self.addEventListener('install', (e) => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const active = await activeName();
    if (active) {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== active)
          .map((n) => caches.delete(n))
      );
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  const d = e.data;
  if (d && (d.type === 'ba-active-cache' || d.type === 'ba-cache')
      && typeof d.cache === 'string') {
    _activeCacheName = d.cache;
  }
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (!url.pathname.includes('/assets/')) return;
  if (e.request.method !== 'GET') return;

  e.respondWith((async () => {
    const active = await activeName();
    // Player 自有、獨立於 assets release 更新的檔案（ui_i18n.json 由 Player
    // repo 維護）：走 network-first，否則 SW 快取釘死舊版、新 key 永遠送不到
    // （症狀：設定頁顯示 set.about 這類 raw key）。失敗才退回快取。
    if (url.pathname.endsWith('/assets/ui/ui_i18n.json')) {
      try {
        const fresh = await fetch(e.request);
        if (fresh.status === 200) {
          if (active) await (await caches.open(active)).put(e.request, fresh.clone());
          return fresh;
        }
      } catch {}
      if (active) {
        const hit = await (await caches.open(active)).match(e.request);
        if (hit) return hit;
      }
      return fetch(e.request);
    }
    if (active) {
      const c = await caches.open(active);
      const hit = await c.match(e.request);
      if (hit) return hit;
    }
    const fresh = await fetch(e.request);
    if (fresh.status === 200) {
      const active2 = await activeName();
      if (active2) {
        const c = await caches.open(active2);
        await c.put(e.request, fresh.clone());
      }
    }
    return fresh;
  })());
});
