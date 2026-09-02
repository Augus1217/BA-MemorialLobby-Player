// sw.js — Service Worker: single active cache + network fallback
// ba-web.js posts 'ba-active-cache' after installing packs; from that point
// all /assets/ requests resolve from that one cache (O(1) lookup).  On miss
// the response comes from network and is cached for next time.

const CACHE_PREFIX = 'ba-assets-v';

let _activeCacheName = null;

self.addEventListener('install', (e) => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    if (_activeCacheName) {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== _activeCacheName)
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
    if (_activeCacheName) {
      const c = await caches.open(_activeCacheName);
      const hit = await c.match(e.request);
      if (hit) return hit;
    }
    const fresh = await fetch(e.request);
    if (fresh.status === 200 && _activeCacheName) {
      const c = await caches.open(_activeCacheName);
      await c.put(e.request, fresh.clone());
    }
    return fresh;
  })());
});
