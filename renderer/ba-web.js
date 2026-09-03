// ba-web.js — GitHub Pages 版的 window.ba shim
// 資產狀態全部寫在 Cache Storage 的 __meta 內（不再依賴 localStorage）。
// ensureAssets(neededPacks, onProgress) 是唯一的啟動 gate：併發下載、去重、
// 完成後只寫一次 __meta。SW 只看 active cache（O(1) 查找）。
import { gunzipSync } from 'fflate';

const WORKER_BASE = 'https://ba-assets.imlindora.workers.dev';
const LATEST_VERSION_URL = `${WORKER_BASE}/latest/assets_version.json`;
const CACHE_PREFIX = 'ba-assets-v';

let _cache = null;
let _versionMeta = null;
const _inflight = new Map();          // "version:name" → Promise (去重)

// ---- cache helpers (no localStorage) ----
async function activeCache() {
  return _cache;
}

async function openCache(ver) {
  _cache = await caches.open(CACHE_PREFIX + ver);
  // 通知 SW 指向新快取（同時兼容舊版 'ba-cache' 類型）
  try {
    navigator.serviceWorker?.controller?.postMessage({
      type: 'ba-active-cache',
      cache: CACHE_PREFIX + ver,
    });
  } catch {}
  return _cache;
}

// ---- __meta：寫在 cache 內，替代 localStorage LS_INSTALLED/LS_VERSION ----
async function readMeta(c) {
  if (!c) return {};
  const r = await c.match('__meta');
  if (!r) return {};
  try { return await r.json(); } catch { return {}; }
}
async function writeMeta(c, obj) {
  await c.put('__meta', new Response(JSON.stringify(obj), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'immutable' },
  }));
}

// ---- version manifest ----
async function fetchRemoteVersion() {
  if (_versionMeta) return _versionMeta;
  const r = await fetch(LATEST_VERSION_URL, { cache: 'no-store' });
  if (!r.ok) throw new Error('assets_version.json unavailable');
  const meta = await r.json();
  if (!meta?.version) throw new Error('assets_version.json invalid');
  meta._base = `${WORKER_BASE}/v${meta.version}`;
  _versionMeta = meta;
  return meta;
}

function packUrl(meta, name) {
  return `${meta._base}/assets-${name.replace(/\//g, '_')}-v${meta.version}.tar.gz`;
}

// ---- mini tar parser（ustar；strip:1） ----
function untarGz(buf, onEntry) {
  const files = gunzipSync(new Uint8Array(buf));
  let off = 0;
  while (off + 512 <= files.length) {
    const header = files.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    let name = '';
    for (const b of header.subarray(0, 100)) { if (!b) break; name += String.fromCharCode(b); }
    let prefix = '';
    for (const b of header.subarray(345, 345 + 155)) { if (!b) break; prefix += String.fromCharCode(b); }
    if (prefix) name = prefix + '/' + name;
    const sizeStr = String.fromCharCode(...header.subarray(124, 136)).replace(/\0.*$/, '').trim();
    const size = parseInt(sizeStr, 8) || 0;
    const typeFlag = String.fromCharCode(header[156]);
    off += 512;
    if (typeFlag === '0' || typeFlag === '\0' || typeFlag === '') {
      onEntry(name, files.subarray(off, off + size));
    }
    off += Math.ceil(size / 512) * 512;
  }
}

function guessMime(p) {
  const ext = p.split('.').pop().toLowerCase();
  return ({
    mp4: 'video/mp4', webm: 'video/webm', ogg: 'audio/ogg', m4a: 'audio/mp4',
    png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', json: 'application/json',
    js: 'application/javascript', css: 'text/css', svg: 'image/svg+xml',
    atlas: 'text/plain', skel: 'application/octet-stream', csv: 'text/csv',
    woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  })[ext] || 'application/octet-stream';
}

function cacheKey(p) {
  const rel = p.replace(/^\.\//, '');
  return new URL(rel.startsWith('assets/') ? rel : 'assets/' + rel, location.href).toString();
}

// ---- 下載單包 → 解壓進 cache ----
async function fetchAndInstallPack(meta, name, onProgress) {
  const url = packUrl(meta, name);
  const c = await activeCache();
  onProgress?.({ status: 'downloading', percent: 0 });
  const resp = await fetch(url, { cache: 'force-cache' });
  if (!resp.ok) throw new Error(`pack ${name}: HTTP ${resp.status}`);
  const buf = await resp.arrayBuffer();
  onProgress?.({ status: 'extracting', percent: 0 });
  const entries = [];
  untarGz(buf, (path, data) => entries.push([path, data]));
  const batch = [];
  for (const [path, data] of entries) {
    const rel = path.replace(/^assets\//, '');
    const body = new Response(data.slice().buffer, {
      headers: { 'Content-Type': guessMime(rel), 'Cache-Control': 'immutable' },
    });
    batch.push(c.put(cacheKey(rel), body));
    if (batch.length >= 64) { await Promise.all(batch); batch.length = 0; }
  }
  await Promise.all(batch);
  onProgress?.({ status: 'done', percent: 100 });
}

// ---- cacheGet：快取 miss → 回傳 null（由呼叫端處理 fallback） ----
async function cacheGet(path) {
  const c = await activeCache();
  if (!c) return null;
  return c.match(cacheKey(path));
}

// ---- ensureAssets：唯一的啟動 gate ----
// neededPacks: ['core'] 或 ['core', 'intro']
// 回傳 { ok, version } 或 { ok:false, version, error }
async function ensureAssets(neededPacks, onProgress) {
  const meta = await fetchRemoteVersion();
  await openCache(meta.version);
  const c = await activeCache();
  const installed = await readMeta(c);

  const toDownload = neededPacks.filter(
    (k) => meta.packages?.[k] && installed[k] !== meta.packages[k].sha256
  );

  if (!toDownload.length) {
    // 所有需要的包都已安裝
    _versionMeta = meta;   // cache reference
    return { ok: true, version: meta.version };
  }

  // 併發下載（同一包不會重複下載）
  const results = await Promise.allSettled(toDownload.map(async (name) => {
    const dedupKey = `${meta.version}:${name}`;
    if (_inflight.has(dedupKey)) return _inflight.get(dedupKey);

    const sendProgress = onProgress
      ? (p) => onProgress({ package: name, ...p })
      : undefined;

    const p = fetchAndInstallPack(meta, name, sendProgress)
      .finally(() => _inflight.delete(dedupKey));
    _inflight.set(dedupKey, p);
    return p;
  }));

  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length) {
    return { ok: false, version: meta.version, error: String(failures[0].reason) };
  }

  // 寫入新的 __meta
  const updated = { ...installed };
  for (const k of toDownload) updated[k] = meta.packages[k].sha256;
  await writeMeta(c, updated);

  // 清理舊版快取
  const names = await caches.keys();
  const activeKey = CACHE_PREFIX + meta.version;
  await Promise.all(
    names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== activeKey)
      .map((n) => caches.delete(n))
  );

  return { ok: true, version: meta.version };
}

// ---- downloadAssets：設定面板的「完整安裝」模式（legacy） ----
async function downloadAllAssets({ version, voice }, onProgress) {
  const meta = version && _versionMeta?.version === version
    ? _versionMeta
    : await fetchRemoteVersion();
  await openCache(meta.version);
  const c = await activeCache();
  const installed = await readMeta(c);

  const wantKr = voice === 'kr';
  const toDownload = Object.keys(meta.packages || {}).filter(
    (k) => installed[k] !== meta.packages[k]?.sha256
      && (!k.startsWith('voice/')
        || (wantKr ? k.startsWith('voice/KR_') : k.startsWith('voice/JP_')))
  );
  if (!toDownload.length) return { ok: true, version: meta.version };

  const results = [];
  for (let i = 0; i < toDownload.length; i++) {
    const name = toDownload[i];
    const sendProgress = onProgress
      ? (p) => onProgress({ package: name, index: i, total: toDownload.length, ...p })
      : undefined;
    try {
      await fetchAndInstallPack(meta, name, sendProgress);
      results.push({ name, ok: true });
    } catch (e) {
      results.push({ name, ok: false, error: e.message });
    }
  }

  // 更新 __meta
  const updated = { ...installed };
  for (const r of results) {
    if (r.ok && meta.packages[r.name]) updated[r.name] = meta.packages[r.name].sha256;
  }
  await writeMeta(c, updated);

  if (results.some((r) => r.ok)) {
    const names = await caches.keys();
    const activeKey = CACHE_PREFIX + meta.version;
    await Promise.all(
      names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== activeKey)
        .map((n) => caches.delete(n))
    );
  }

  return { ok: results.every((r) => r.ok), version: meta.version, results };
}

// ---- window.ba shim ----
const ba = {
  async listLobbies() {
    const hit = await cacheGet('data/lobby_index.json');
    if (hit) { try { return Object.keys(await hit.json()); } catch {} }
    try {
      const r = await fetch('assets/data/lobby_index.json');
      if (r.ok) return Object.keys(await r.json());
    } catch {}
    return [];
  },

  async introMedia() {
    const hasV = await cacheGet('intro/title_h264.mp4');
    const hasA = await cacheGet('intro/pv-a.ogg');
    return { video: hasV ? 'assets/intro/title_h264.mp4' : null, audio: hasA ? 'assets/intro/pv-a.ogg' : null };
  },

  screenshot: async () => null,
  startAnimVideo: async () => false,
  animFrame: () => {},
  finishAnimVideo: async () => null,
  abortAnimVideo: () => {},
  exportBgm: async () => null,
  screenSize: async () => ({ width: window.innerWidth, height: window.innerHeight }),

  _progressHandlers: [],
  onDownloadProgress(cb) {
    this._progressHandlers.push(cb);
  },
  _emitProgress(p) {
    for (const cb of this._progressHandlers) {
      try { cb(p); } catch { /* 呼叫端不必因單一 handler 異常而中斷 */ }
    }
  },

  // ---- 新 API：唯一的啟動 gate ----
  async ensureAssets(neededPacks, onProgress) {
    const combined = onProgress
      ? (p) => onProgress(p)
      : undefined;
    return ensureAssets(neededPacks, combined);
  },

  // ---- legacy：設定面板用（完整安裝） ----
  async checkAssets({ voice } = {}) {
    const meta = await fetchRemoteVersion();
    const c = await caches.open(CACHE_PREFIX + meta.version);
    const installed = await readMeta(c);
    const coreOk = installed['core'] === meta.packages?.['core']?.sha256;
    const wantKr = voice === 'kr';
    const needsDownloadPacks = Object.keys(meta.packages || {}).filter(
      (k) => installed[k] !== meta.packages[k]?.sha256
        && (!k.startsWith('voice/')
          || (wantKr ? k.startsWith('voice/KR_') : k.startsWith('voice/JP_')))
    );
    return {
      localVersion: meta.version,
      hasAssets: !!coreOk,
      remoteVersion: meta.version,
      schema: meta.schema || 1,
      needsDownload: !coreOk || needsDownloadPacks.length > 0,
      needsDownloadPacks,
      packages: meta.packages,
      lobbies: meta.lobbies,
      streaming: true,
      installed,
    };
  },

  async downloadAssets({ version, packages, onlyPacks, voice }, onProgress) {
    const meta = version && _versionMeta?.version === version
      ? _versionMeta : await fetchRemoteVersion();
    const needed = onlyPacks
      ? onlyPacks.filter((k) => meta.packages?.[k])
      : Object.keys(meta.packages || {});
    return downloadAllAssets({ version: meta.version, voice }, onProgress);
  },

  async ensureLobby({ lobby, version, packages, lobbies, voice }) {
    const meta = version && _versionMeta?.version === version
      ? _versionMeta : await fetchRemoteVersion();
    await openCache(meta.version);
    const c = await activeCache();
    const installed = await readMeta(c);

    let packs = [];
    if (lobbies?.[lobby]?.packs) packs = [...lobbies[lobby].packs];
    else {
      const k = 'lobby/' + lobby;
      if (packages?.[k]) packs = [k];
    }
    // 只下玩家選擇的語音語言（jp/kr）的語音包，不下另一種；
    // 非語音包（lobby/spine/scene/bgm/core）全部保留。
    const wantKr = voice === 'kr';
    packs = packs.filter((k) => !k.startsWith('voice/')
      || (wantKr ? k.startsWith('voice/KR_') : k.startsWith('voice/JP_')));
    if (meta.packages?.['core'] && installed['core'] !== meta.packages['core']?.sha256) {
      packs.unshift('core');
    }
    packs = [...new Set(packs)];
    const missing = packs.filter((k) => installed[k] !== meta.packages[k]?.sha256);
    if (!missing.length) return { ok: true, cached: true };

    const results = [];
    for (let i = 0; i < missing.length; i++) {
      const name = missing[i];
      const sendProgress = (p) => this._emitProgress({ package: name, index: i, total: missing.length, ...p });
      try {
        await fetchAndInstallPack(meta, name, sendProgress);
        results.push({ name, ok: true });
      } catch (e) {
        sendProgress({ status: 'error', error: e.message });
        results.push({ name, ok: false, error: e.message });
      }
    }
    const failed = results.filter((r) => !r.ok);
    return failed.length ? { ok: false, results } : { ok: true, results };
  },

  async getStreamingMode() { return true; },
  async setStreamingMode() { return true; },
};

// ---- WEB_MODE activation ----
const WEB_MODE = typeof window !== 'undefined' && !window.ba && !location.protocol.startsWith('file');

if (WEB_MODE) {
  window.ba = ba;
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((e) => {
      console.warn('[ba-web] SW register failed:', e.message);
    });
  }
  console.log('[ba-web] shim active');
}
