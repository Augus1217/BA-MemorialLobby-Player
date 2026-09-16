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

// iOS Safari <audio>/<video> 播快取檔必帶 Range（先 bytes=0-1 探路）。
// 直接回整包 200 會被拒播（Chrome 寬鬆、Safari 嚴格——iOS 無聲的主因）。
// 快取命中的 Range 請求一律手動切 206；快取沒有才透傳 origin
//（Pages 靜態自己會回 206）。注意：Range 回應絕不寫入 cache（key 不帶
// Range，下次裸請求會誤命中 206）。
async function rangeResponse(request, full) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((request.headers.get('range') || '').trim());
  const buf = await full.arrayBuffer();
  const total = buf.byteLength;
  let start = 0, end = total - 1;
  if (m) {
    if (m[1] === '' && m[2] !== '') {
      const n = parseInt(m[2], 10);                       // suffix：最後 N bytes
      if (!Number.isFinite(n)) return new Response('invalid range', { status: 416 });
      start = Math.max(0, total - n);
    } else {
      start = parseInt(m[1] || '0', 10);
      end = m[2] !== '' ? parseInt(m[2], 10) : total - 1;
    }
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
    return new Response('range not satisfiable', { status: 416, headers: {
      'Content-Range': `bytes */${total}`, 'Accept-Ranges': 'bytes' } });
  }
  end = Math.min(end, total - 1);
  return new Response(buf.slice(start, end + 1), {
    status: m ? 206 : 200,
    headers: {
      'Content-Type': full.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
      ...(m ? { 'Content-Range': `bytes ${start}-${end}/${total}` } : {}),
    },
  });
}

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
      if (hit) {
        return e.request.headers.has('range') ? rangeResponse(e.request, hit) : hit;
      }
    }
    const fresh = await fetch(e.request);
    if (fresh.status === 200 && !e.request.headers.has('range')) {
      const active2 = await activeName();
      if (active2) {
        const c = await caches.open(active2);
        await c.put(e.request, fresh.clone());
      }
    }
    if (e.request.headers.has('range') && fresh.status === 200) {
      return rangeResponse(e.request, fresh);
    }
    return fresh;
  })());
});
