// ba-web.js — GitHub Pages 版的 window.ba shim
// 以 Cache Storage 取代桌面版的 assets/ 目錄；介面與 preload.js 完全對齊。
// 資產來源：Cloudflare Worker（代理 GitHub Releases，含 CORS 與邊緣快取）。
import { gunzipSync } from 'fflate';

const WORKER_BASE = 'https://ba-assets.imlindora.workers.dev';
const LATEST_VERSION_URL = `${WORKER_BASE}/latest/assets_version.json`;
const CACHE_PREFIX = 'ba-assets-v';
const LS_VERSION = 'ba_web_version';
const LS_INSTALLED = 'ba_web_installed';
const LS_STREAMING = 'ba_streaming';

let _cache = null;
let _versionMeta = null;

function lsGet(k, dflt) {
  try { return localStorage.getItem(k) ?? dflt; } catch { return dflt; }
}
function lsSet(k, v) {
  try { localStorage.setItem(k, v); } catch {}
}
function readInstalled() {
  try { return JSON.parse(lsGet(LS_INSTALLED, '{}')); } catch { return {}; }
}
function writeInstalled(obj) {
  lsSet(LS_INSTALLED, JSON.stringify(obj));
}

async function cache() {
  if (!_cache) {
    const ver = lsGet(LS_VERSION, '0');
    _cache = await caches.open(CACHE_PREFIX + ver);
  }
  return _cache;
}

// 版本切換時開新快取並通知 SW；舊快取延後到新包安裝成功才刪
// （先刪後裝的話，下載中斷 = 使用者資產全毀且無法自癒）。
async function switchVersionCache(ver) {
  _cache = await caches.open(CACHE_PREFIX + ver);
  lsSet(LS_VERSION, ver);
  // 立即通知 SW 指向新快取（原本只在頁面載入 1.5s 後通知一次，
  // 換版後 SW 永遠指向舊快取名）
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'ba-cache', cache: CACHE_PREFIX + ver });
  } catch {}
}

async function fetchRemoteVersion() {
  if (_versionMeta) return _versionMeta;
  // 先問 Worker 最新 tag 有没有 manifest——Worker 只認 /v<tag>/ 路徑，
  // 因此先打 latest release 的 manifest（GitHub 直鏈）取得版本號。
  let meta = null;
  try {
    const r = await fetch(LATEST_VERSION_URL, { cache: 'no-store' });
    if (r.ok) meta = await r.json();
  } catch {}
  if (!meta?.version) throw new Error('assets_version.json unavailable');
  // 改用 Worker 路徑取包（CORS + 快取）
  meta._base = `${WORKER_BASE}/v${meta.version}`;
  _versionMeta = meta;
  return meta;
}

function packUrl(meta, name) {
  return `${meta._base}/assets-${name.replace(/\//g, '_')}-v${meta.version}.tar.gz`;
}

// ---- mini tar parser（ustar；包內 arcname 為 assets/...，strip:1 對齊桌面版）----
function untarGz(buf, onEntry) {
  const files = gunzipSync(new Uint8Array(buf));
  let off = 0;
  while (off + 512 <= files.length) {
    const header = files.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break; // 兩個全零 block 結尾
    let name = '';
    for (const b of header.subarray(0, 100)) { if (!b) break; name += String.fromCharCode(b); }
    // ustar prefix 欄位（345..500）
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

// 下載單一包並展開進 Cache Storage；回傳是否成功
async function fetchAndInstallPack(meta, name, onProgress) {
  const url = packUrl(meta, name);
  const c = await cache();
  onProgress?.({ status: 'downloading', percent: 0 });
  const resp = await fetch(url, { cache: 'force-cache' });
  if (!resp.ok) throw new Error(`pack ${name}: HTTP ${resp.status}`);
  const buf = await resp.arrayBuffer();
  onProgress?.({ status: 'extracting', percent: 0 });
  const entries = [];
  untarGz(buf, (path, data) => entries.push([path, data]));
  // strip "assets/" 前綴 → key 成 "./xxx" 相對路徑（與 assetUrl('./...') 對齊）
  const batch = [];
  for (const [path, data] of entries) {
    const rel = path.replace(/^assets\//, '');
    const body = new Response(data.slice().buffer, {
      headers: { 'Content-Type': guessMime(rel), 'Cache-Control': 'immutable' },
    });
    const key = cacheKey(rel);
    batch.push(c.put(key, body));
    if (batch.length >= 64) { await Promise.all(batch); batch.length = 0; }
  }
  await Promise.all(batch);
  const installed = readInstalled();
  installed[name] = meta.packages?.[name]?.sha256 || 'local';
  writeInstalled(installed);
  onProgress?.({ status: 'done', percent: 100 });
}

export function guessMime(p) {
  const ext = p.split('.').pop().toLowerCase();
  return ({
    mp4: 'video/mp4', webm: 'video/webm', ogg: 'audio/ogg', m4a: 'audio/mp4',
    png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', json: 'application/json',
    js: 'application/javascript', css: 'text/css', svg: 'image/svg+xml',
    atlas: 'text/plain', skel: 'application/octet-stream', csv: 'text/csv',
    woff2: 'font/woff2', ttf: 'font/ttf',
  })[ext] || 'application/octet-stream';
}

// app.js 傳 'assets/xxx'（無 ./）；快取 key 統一為絕對 URL
export function cacheKey(p) {
  const rel = p.replace(/^\.\//, '');
  return new URL(rel.startsWith('assets/') ? rel : 'assets/' + rel, location.href).toString();
}

async function cacheGet(p) {
  const c = await cache();
  return c.match(cacheKey(p));
}

// ---- window.ba shim ----
const ba = {
  async listLobbies() {
    // 核心包內的 lobby_index.json（core 安裝後在快取；否則 fallback 到站上核心檔）
    const hit = await cacheGet('data/lobby_index.json');
    if (hit) {
      const idx = await hit.json();
      return Object.keys(idx);
    }
    const r = await fetch('./data/lobby_index.json');
    if (r.ok) return Object.keys(await r.json());
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

  onDownloadProgress(cb) {
    const h = (e) => cb(e.detail);
    window.addEventListener('ba-download-progress', h);
  },

  async checkAssets() {
    let remote = null;
    try { remote = await fetchRemoteVersion(); } catch {}
    const installed = readInstalled();
    const localVersion = lsGet(LS_VERSION, null);
    const streaming = lsGet(LS_STREAMING, '1') === '1';
    // sha 一致之外，還要驗證快取裡真的有哨兵檔——版本切換中斷會留下
    // 「sha 已記但快取空/損毀」的狀態，不驗證的話永遠不會自癒。
    let coreOk = !!(remote?.packages && installed['core'] === remote.packages['core']?.sha256);
    if (coreOk) {
      try {
        coreOk = !!(await cacheGet('data/lobby_index.json'));
      } catch { coreOk = false; }
      if (!coreOk) {
        // 快取損毀：清除安裝記錄，強制重裝
        delete installed['core'];
        delete installed['intro'];
        writeInstalled(installed);
      }
    }

    let needsDownloadPacks = [];
    if (remote?.packages) {
      for (const [k, v] of Object.entries(remote.packages)) {
        if (installed[k] !== v.sha256) needsDownloadPacks.push(k);
      }
      if (streaming) {
        const coreNeeds = needsDownloadPacks.filter((k) => k === 'core' || k === 'intro');
        needsDownloadPacks = coreNeeds.length ? coreNeeds : (coreOk ? [] : ['core']);
      }
    }

    return {
      localVersion,
      hasAssets: coreOk,
      remoteVersion: remote?.version || null,
      schema: remote?.schema || 1,
      needsDownload: !coreOk || (needsDownloadPacks.length > 0),
      needsDownloadPacks,
      packages: remote?.packages || null,
      lobbies: remote?.lobbies || null,
      streaming,
      installed,
    };
  },

  async downloadAssets({ version, packages, onlyPacks } = {}) {
    const meta = version && _versionMeta?.version === version ? _versionMeta : await fetchRemoteVersion();
    const installed = readInstalled();
    let names;
    if (onlyPacks?.length) {
      names = onlyPacks.filter((k) => meta.packages[k] && installed[k] !== meta.packages[k].sha256);
      if (!names.length) names = onlyPacks.filter((k) => meta.packages[k]);
    } else {
      names = Object.keys(meta.packages).filter((k) => installed[k] !== meta.packages[k].sha256);
      if (!names.length && !Object.keys(installed).length) names = Object.keys(meta.packages);
    }
    if (!names.length) {
      if (!lsGet(LS_VERSION, null)) await switchVersionCache(meta.version);
      return [];
    }
    await switchVersionCache(meta.version);
    const results = [];
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const sendProgress = (p) => window.dispatchEvent(new CustomEvent('ba-download-progress', { detail: { package: name, index: i, total: names.length, ...p } }));
      try {
        await fetchAndInstallPack(meta, name, sendProgress);
        results.push({ name, ok: true });
      } catch (e) {
        sendProgress({ status: 'error', error: e.message });
        results.push({ name, ok: false, error: e.message });
      }
    }
    if (results.some((r) => r.ok)) {
      lsSet(LS_VERSION, meta.version);
      // 新包安裝成功 → 通知 SW 指向新快取，並清掉其他舊快取（釋放空間）
      try {
        navigator.serviceWorker?.controller?.postMessage({ type: 'ba-cache', cache: CACHE_PREFIX + meta.version });
      } catch {}
      try {
        const names = await caches.keys();
        await Promise.all(names
          .filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_PREFIX + meta.version)
          .map((n) => caches.delete(n)));
      } catch {}
    }
    return results;
  },

  async getStreamingMode() { return lsGet(LS_STREAMING, '1') === '1'; },
  async setStreamingMode(v) { lsSet(LS_STREAMING, v ? '1' : '0'); return !!v; },

  async ensureLobby({ lobby, version, packages, lobbies }) {
    const meta = version && _versionMeta?.version === version ? _versionMeta : await fetchRemoteVersion();
    const installed = readInstalled();
    let packs = [];
    if (lobbies?.[lobby]?.packs) packs = [...lobbies[lobby].packs];
    else {
      const k = 'lobby/' + lobby;
      if (packages?.[k]) packs = [k];
    }
    if (meta.packages?.['core'] && installed['core'] !== meta.packages['core'].sha256) packs.unshift('core');
    packs = [...new Set(packs)];
    const missing = packs.filter((k) => installed[k] !== meta.packages[k]?.sha256);
    if (!missing.length) return { ok: true, cached: true };
    const results = [];
    for (let i = 0; i < missing.length; i++) {
      const name = missing[i];
      const sendProgress = (p) => window.dispatchEvent(new CustomEvent('ba-download-progress', { detail: { package: name, index: i, total: missing.length, ...p } }));
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
};

// Electron（preload 已注入 window.ba 或 file: 協議）下整個 shim 不生效
const WEB_MODE = typeof window !== 'undefined' && !window.ba && !location.protocol.startsWith('file');

if (WEB_MODE) {
  window.ba = ba;
  // Service Worker：攔截 assets/ fetch → Cache Storage
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((e) => {
      console.warn('[ba-web] SW register failed (fallback to direct fetch):', e.message);
    });
    navigator.serviceWorker.addEventListener('message', () => {});
  }
  // 通知 SW 目前的快取名（換版時）
  const _swCacheNotify = () => {
    navigator.serviceWorker.controller?.postMessage({ type: 'ba-cache', cache: CACHE_PREFIX + lsGet(LS_VERSION, '0') });
  };
  setTimeout(_swCacheNotify, 1500);
  console.log('[ba-web] shim active');
}
