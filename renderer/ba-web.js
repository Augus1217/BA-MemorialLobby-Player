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
// 下載取消狀態（設定頁暫停鈕用；開機/串流下載不走此旗）
const _dlCtl = { cancelled: false, current: null };

// ---- cache helpers (no localStorage) ----
async function activeCache() {
  return _cache;
}

async function openCache(ver) {
  _cache = await caches.open(CACHE_PREFIX + ver);
  return _cache;
}

// 通知 SW 指向新快取（同時兼容舊版 'ba-cache' 類型）。
// 必須在「安裝完成後」才呼叫：若在下載前就切換，SW 會指到空的快取，
// 安裝窗口期間所有 /assets/ 請求 miss → network → 404（頭貼/BGM 短暫全 404）。
async function notifySwActive(ver) {
  try {
    navigator.serviceWorker?.controller?.postMessage({
      type: 'ba-active-cache',
      cache: CACHE_PREFIX + ver,
    });
  } catch {}
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

// ---- 跨版遷移：新版空快取 → 從最新舊版快取搬 sha 未變的包 ----
// 打包是確定性的（同內容同 sha），沒變的包免重下。只搬有 __files 清單的包
// （太舊的安裝沒有清單，照舊重下；開過一次管理空間即 backfill 全有）。
// 舊快取不刪（SW 可能還指著它；刪除由下載成功路徑的既有清理負責）。
async function migrateFromPreviousCache(meta, newCache, onProgress) {
  const stat = { migrated: 0, files: 0 };
  if (!newCache || !meta?.packages) return stat;
  let names = [];
  try { names = await caches.keys(); } catch { return stat; }
  const key = CACHE_PREFIX + meta.version;
  const olds = names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== key).sort();
  if (!olds.length) return stat;
  let oldCache = null, oldMeta = {};
  try {
    oldCache = await caches.open(olds[olds.length - 1]);
    oldMeta = await readMeta(oldCache);
  } catch { return stat; }
  const oldFiles = oldMeta.__files || {};
  if (!Object.keys(oldFiles).length) return stat;
  const cur = await readMeta(newCache);
  const fileMap = { ...(cur.__files || {}) };
  const jobs = Object.keys(oldFiles).filter((k) =>
    !k.startsWith('__') && meta.packages[k]
    && oldMeta[k] === meta.packages[k].sha256
    && cur[k] !== meta.packages[k].sha256
    && Array.isArray(oldFiles[k]));
  for (let i = 0; i < jobs.length; i++) {
    const name = jobs[i];
    let n = 0;
    for (const rel of oldFiles[name]) {
      try {
        const r = await oldCache.match(cacheKey(rel));
        if (r) { await newCache.put(cacheKey(rel), r); n++; }
      } catch {}
    }
    if (n > 0 || !oldFiles[name].length) {
      cur[name] = meta.packages[name].sha256;
      fileMap[name] = oldFiles[name];
      stat.migrated++;
      stat.files += n;
    }
    try { onProgress?.({ status: 'downloading', package: name, index: i, total: jobs.length, percent: Math.round(((i + 1) / jobs.length) * 100), migrated: true }); } catch {}
    if (stat.migrated % 25 === 0) {
      try { cur.__files = fileMap; await writeMeta(newCache, cur); } catch {}
    }
  }
  try { cur.__files = fileMap; await writeMeta(newCache, cur); } catch {}
  try { onProgress?.({ status: 'done', percent: 100 }); } catch {}
  return stat;
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
async function fetchAndInstallPack(meta, name, onProgress, signal) {
  const url = packUrl(meta, name);
  const c = await activeCache();
  onProgress?.({ status: 'downloading', percent: 0 });
  const resp = await fetch(url, { cache: 'force-cache', ...(signal ? { signal } : {}) });
  if (!resp.ok) throw new Error(`pack ${name}: HTTP ${resp.status}`);
  // 串流讀取回報進度（大包如 400MB 的 assets-player 否則 0% 卡數分鐘）
  const total = Number(resp.headers.get('content-length')) || 0;
  let buf;
  if (resp.body?.getReader) {
    const reader = resp.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total) {
        onProgress?.({ status: 'downloading', percent: Math.min(99, Math.floor((received / total) * 100)) });
      } else {
        onProgress?.({ status: 'downloading', received });
      }
    }
    buf = new Uint8Array(received);
    let off = 0;
    for (const ch of chunks) { buf.set(ch, off); off += ch.length; }
    buf = buf.buffer;
  } else {
    buf = await resp.arrayBuffer();
  }
  onProgress?.({ status: 'extracting', percent: 0 });
  const entries = [];
  untarGz(buf, (path, data) => entries.push([path, data]));
  const batch = [];
  const rels = [];
  for (const [path, data] of entries) {
    const rel = path.replace(/^assets\//, '');
    rels.push(rel);
    const body = new Response(data.slice().buffer, {
      headers: { 'Content-Type': guessMime(rel), 'Cache-Control': 'immutable' },
    });
    batch.push(c.put(cacheKey(rel), body));
    if (batch.length >= 64) { await Promise.all(batch); batch.length = 0; }
  }
  await Promise.all(batch);
  onProgress?.({ status: 'done', percent: 100 });
  // 回傳包內檔案清單：呼叫端併入 __meta.__files，供管理空間按包刪除用
  return rels;
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
  // 跨版：先從舊快取搬 sha 未變的包（免重下），再算還缺什麼
  await migrateFromPreviousCache(meta, c, onProgress);
  const installed = await readMeta(c);

  const toDownload = neededPacks.filter(
    (k) => meta.packages?.[k] && installed[k] !== meta.packages[k].sha256
  );

  if (!toDownload.length) {
    // 所有需要的包都已安裝
    _versionMeta = meta;   // cache reference
    await notifySwActive(meta.version);
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

  // 寫入新的 __meta（併入各包檔案清單，舊包的沿用）
  const updated = { ...installed };
  const fileMap = { ...(installed.__files || {}) };
  results.forEach((r, i) => {
    const k = toDownload[i];
    updated[k] = meta.packages[k].sha256;
    if (r.status === 'fulfilled' && Array.isArray(r.value)) fileMap[k] = r.value;
  });
  updated.__files = fileMap;
  await writeMeta(c, updated);

  // 安裝完成才讓 SW 切換到新快取；下載窗口期間 SW 繼續用舊快取服務，
  // 避免空快取造成的 404 風暴。失敗時不切換（舊快取仍可用）。
  await notifySwActive(meta.version);

  // 清理舊版快取
  const names = await caches.keys();
  const activeKey = CACHE_PREFIX + meta.version;
  await Promise.all(
    names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== activeKey)
      .map((n) => caches.delete(n))
  );

  return { ok: true, version: meta.version };
}

// ---- downloadAssets：設定面板的「完整安裝」模式（legacy，現無調用者保留） ----
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

  _dlCtl.cancelled = false;
  const results = [];
  const fileMap = { ...(installed.__files || {}) };
  for (let i = 0; i < toDownload.length; i++) {
    const name = toDownload[i];
    if (_dlCtl.cancelled) break;
    const sendProgress = (p) => {
      const full = { package: name, index: i, total: toDownload.length, ...p };
      try { onProgress?.(full); } catch {}
      try { ba._emitProgress(full); } catch {}
    };
    _dlCtl.current = new AbortController();
    try {
      fileMap[name] = await fetchAndInstallPack(meta, name, sendProgress, _dlCtl.current.signal);
      results.push({ name, ok: true });
    } catch (e) {
      if (_dlCtl.cancelled) break;   // 暫停：不記錯誤，直接收尾
      results.push({ name, ok: false, error: e.message });
    } finally {
      _dlCtl.current = null;
    }
  }

  // 更新 __meta
  const updated = { ...installed };
  for (const r of results) {
    if (r.ok && meta.packages[r.name]) updated[r.name] = meta.packages[r.name].sha256;
  }
  updated.__files = fileMap;
  await writeMeta(c, updated);

  if (results.some((r) => r.ok)) {
    await notifySwActive(meta.version);
    const names = await caches.keys();
    const activeKey = CACHE_PREFIX + meta.version;
    await Promise.all(
      names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== activeKey)
        .map((n) => caches.delete(n))
    );
  }

  return { ok: results.every((r) => r.ok) && !_dlCtl.cancelled, cancelled: _dlCtl.cancelled, version: meta.version, results };
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
  offDownloadProgress(cb) {
    const i = this._progressHandlers.indexOf(cb);
    if (i >= 0) this._progressHandlers.splice(i, 1);
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
    await migrateFromPreviousCache(meta, c);
    const installed = await readMeta(c);
    const coreOk = installed['core'] === meta.packages?.['core']?.sha256;
    const wantKr = voice === 'kr';
    let needsDownloadPacks = Object.keys(meta.packages || {}).filter(
      (k) => installed[k] !== meta.packages[k]?.sha256
        && (!k.startsWith('voice/')
          || (wantKr ? k.startsWith('voice/KR_') : k.startsWith('voice/JP_')))
    );
    // 串流模式：初始只需 core/intro（與 Electron 版一致；之前 web 版回全部，
    // 開始下載會把串流用戶的全包也抓下來）。
    let streaming = true;
    try { streaming = localStorage.getItem('ba_streaming') !== '0'; } catch {}
    if (streaming) {
      const coreNeeds = needsDownloadPacks.filter((k) => k === 'core' || k === 'intro');
      if (coreNeeds.length === 0 && coreOk) needsDownloadPacks = [];
      else needsDownloadPacks = coreNeeds;
    }
    return {
      localVersion: meta.version,
      hasAssets: !!coreOk,
      remoteVersion: meta.version,
      schema: meta.schema || 1,
      needsDownload: !coreOk || needsDownloadPacks.length > 0,
      needsDownloadPacks,
      packages: meta.packages,
      lobbies: meta.lobbies,
      streaming,
      installed,
    };
  },

  async downloadAssets({ version, packages, onlyPacks, voice }, onProgress) {
    const meta = version && _versionMeta?.version === version
      ? _versionMeta : await fetchRemoteVersion();
    // 尊重呼叫端指定的包集合（過去直接忽略，開始下載永遠抓全部）。
    const wanted = onlyPacks?.filter((k) => meta.packages?.[k])
      ?? (packages ? Object.keys(packages).filter((k) => meta.packages?.[k]) : null)
      ?? Object.keys(meta.packages || {});
    const sendProgress = (p) => {
      try { onProgress?.(p); } catch {}
      ba._emitProgress(p);
    };
    // 下載 missing 的指定包（其餘邏輯同 downloadAllAssets 的收尾）
    const c = await activeCache();
    await migrateFromPreviousCache(meta, c);
    const installed = await readMeta(c);
    const wantKr = voice === 'kr';
    const toDownload = wanted.filter(
      (k) => installed[k] !== meta.packages[k]?.sha256
        && (!k.startsWith('voice/')
          || (wantKr ? k.startsWith('voice/KR_') : k.startsWith('voice/JP_')))
    );
    if (!toDownload.length) return { ok: true, version: meta.version };
    _dlCtl.cancelled = false;
    const results = [];
    const fileMap = { ...(installed.__files || {}) };
    for (let i = 0; i < toDownload.length; i++) {
      const name = toDownload[i];
      if (_dlCtl.cancelled) break;
      try {
        _dlCtl.current = new AbortController();
        fileMap[name] = await fetchAndInstallPack(meta, name,
          (p) => sendProgress({ package: name, index: i, total: toDownload.length, ...p }),
          _dlCtl.current.signal);
        results.push({ name, ok: true });
      } catch (e) {
        if (_dlCtl.cancelled) break;   // 暫停：不記錯誤，直接收尾
        results.push({ name, ok: false, error: e.message });
      } finally {
        _dlCtl.current = null;
      }
    }
    const updated = { ...installed };
    for (const r of results) {
      if (r.ok && meta.packages[r.name]) updated[r.name] = meta.packages[r.name].sha256;
    }
    updated.__files = fileMap;
    await writeMeta(c, updated);
    if (results.some((r) => r.ok)) {
      await notifySwActive(meta.version);
      const names = await caches.keys();
      const activeKey = CACHE_PREFIX + meta.version;
      await Promise.all(
        names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== activeKey)
          .map((n) => caches.delete(n))
      );
    }
    return { ok: results.every((r) => r.ok) && !_dlCtl.cancelled, cancelled: _dlCtl.cancelled, version: meta.version, results };
  },

  async ensureLobby({ lobby, version, packages, lobbies, voice }) {
    const meta = version && _versionMeta?.version === version
      ? _versionMeta : await fetchRemoteVersion();
    await openCache(meta.version);
    const c = await activeCache();
    await migrateFromPreviousCache(meta, c);
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
    const fileMap = { ...(installed.__files || {}) };
    for (let i = 0; i < missing.length; i++) {
      const name = missing[i];
      const sendProgress = (p) => this._emitProgress({ package: name, index: i, total: missing.length, ...p });
      try {
        fileMap[name] = await fetchAndInstallPack(meta, name, sendProgress);
        results.push({ name, ok: true });
      } catch (e) {
        sendProgress({ status: 'error', error: e.message });
        results.push({ name, ok: false, error: e.message });
      }
    }
    // 大廳包也要記入 meta（過去沒寫：每次進大廳都重下）
    const updated = { ...installed };
    for (const r of results) {
      if (r.ok && meta.packages?.[r.name]) updated[r.name] = meta.packages[r.name].sha256;
    }
    updated.__files = fileMap;
    await writeMeta(c, updated);
    const failed = results.filter((r) => !r.ok);
    if (!failed.length) await notifySwActive(meta.version);
    return failed.length ? { ok: false, results } : { ok: true, results };
  },

  // ---- 下載模式（web 真實實作；過去是永遠回 true 的 stub，設定頁切換看似沒反應）----
  // streaming=true：只保 core/intro，大廳隨點隨下；false＝完整安裝。
  async getStreamingMode() {
    try { return localStorage.getItem('ba_streaming') !== '0'; }
    catch { return true; }
  },
  async setStreamingMode(v) {
    const streaming = !!v;
    try { localStorage.setItem('ba_streaming', streaming ? '1' : '0'); } catch {}
    return streaming;
  },
  // ---- 瀏覽器儲存鎖定＋配額（完整安裝前調用）----
  // Cache Storage 與 IDB/OPFS 同一配額池、可被清除；persist 要到就不清。
  async ensurePersistent() {
    try {
      if (navigator.storage?.persist) return await navigator.storage.persist();
    } catch {}
    return false;
  },
  async quotaInfo() {
    try {
      if (navigator.storage?.estimate) {
        const { usage = 0, quota = 0 } = await navigator.storage.estimate();
        return { usage, quota };
      }
    } catch {}
    return { usage: 0, quota: 0 };
  },
  // ---- 取消設定頁下載（暫停鈕用；進行中的包 abort，包之間檢查旗標）
  cancelDownload() {
    _dlCtl.cancelled = true;
    try { _dlCtl.current?.abort(); } catch {}
    return true;
  },
  // ---- 管理空間（web）：已裝包＋manifest 標稱大小；core 不可刪；
  // 無檔案清單的舊包（此功能上線前裝的）按確定性包結構 backfill：
  // lobby/X＝spine/X/＋scene/X/＋映射表那首bgm，voice/F＝voice/F/，
  // core/intro/assets-player＝各自固定目錄。共用檔靠 refcount 保護。
  async assetsManageList({ bgmByLobby } = {}) {
    let meta = null;
    try { meta = _versionMeta?.version ? _versionMeta : await fetchRemoteVersion(); }
    catch { meta = _versionMeta || null; }
    const c = await activeCache();
    let installed = {};
    try { installed = await readMeta(c); } catch {}
    const pkgs = meta?.packages || {};
    let files = installed.__files || {};
    const packKeys = Object.keys(installed).filter((k) => !k.startsWith('__') && pkgs[k]);
    const unmapped = packKeys.filter((k) => k !== 'core' && !files[k]);
    if (c && unmapped.length) {
      try {
        const keyReqs = await c.keys();
        const rels = [];
        for (const r of keyReqs) {
          try {
            const u = new URL(r.url, location.href);
            const p = u.pathname.replace(/^\//, '');
            if (p.startsWith('assets/')) rels.push(p.slice(7));
          } catch {}
        }
        const inCache = new Set(rels);
        const PLAYER_DIRS = ['bgm/', 'students/', 'loading/', 'ui/', 'fonts/', 'clickfx/'];
        const rebuilt = {};
        for (const k of unmapped) {
          let list = null;
          if (k === 'intro') {
            list = rels.filter((r) => r.startsWith('intro/'));
          } else if (k === 'assets-player') {
            list = rels.filter((r) => PLAYER_DIRS.some((d) => r.startsWith(d)));
          } else if (k.startsWith('lobby/')) {
            const dir = k.slice(6);
            list = rels.filter((r) => r.startsWith('spine/' + dir + '/') || r.startsWith('scene/' + dir + '/'));
            const bgm = bgmByLobby?.[dir];
            if (bgm && inCache.has('bgm/' + bgm)) list = [...list, 'bgm/' + bgm];
          } else if (k.startsWith('voice/')) {
            list = rels.filter((r) => r.startsWith(k + '/'));
          }
          if (list) rebuilt[k] = list;
        }
        if (Object.keys(rebuilt).length) {
          files = { ...files, ...rebuilt };
          installed.__files = files;
          await writeMeta(c, installed);
        }
      } catch {}
    }
    const packs = packKeys.sort().map((k) => ({
      key: k,
      kind: k === 'core' ? 'core' : k === 'intro' ? 'intro' : k.split('/')[0],
      name: k.includes('/') ? k.split('/')[1] : k,
      size: pkgs[k]?.size || 0,
      files: (files[k] || []).length,
      deletable: k !== 'core' && !!files[k],
      present: true,
    }));
    // 無主檔：快取裡有、但沒有任何已裝包認領（舊版殘留等）
    let orphans = 0;
    try {
      const claimed = new Set();
      for (const [p, rels] of Object.entries(files)) {
        if (p.startsWith('__') || !(p in installed)) continue;
        for (const r of rels || []) claimed.add(r);
      }
      const keyReqs = await c.keys();
      for (const r of keyReqs) {
        try {
          const u = new URL(r.url, location.href);
          const p = u.pathname.replace(/^\//, '');
          if (p.startsWith('assets/') && !claimed.has(p.slice(7))) orphans++;
        } catch {}
      }
    } catch {}
    return {
      version: meta?.version || '?',
      packs,
      totalSize: packs.reduce((a, p) => a + p.size, 0),
      orphans,
      streaming: await this.getStreamingMode(),
    };
  },
  // ---- 按包刪除：只刪無其他已裝包共用的檔案（共用如 bgm 保留）
  async assetsManageDelete(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    const c = await activeCache();
    const meta = await readMeta(c);
    const files = meta.__files || {};
    const removed = [], errors = [];
    for (const key of list) {
      if (key === 'core') { errors.push({ key, error: 'core 不可刪除' }); continue; }
      if (!(key in meta) && !files[key]) { errors.push({ key, error: '未知的資源包' }); continue; }
      const staying = new Set();
      for (const [p, rels] of Object.entries(files)) {
        if (p === key || list.includes(p) || !(p in meta)) continue;
        for (const r of rels || []) staying.add(r);
      }
      for (const r of files[key] || []) {
        if (staying.has(r)) continue;
        try { await c.delete(cacheKey(r)); } catch {}
      }
      delete meta[key];
      delete files[key];
      removed.push(key);
    }
    await writeMeta(c, meta);
    return { removed, errors };
  },
  // ---- 完整性：有清單的包逐檔確認在快取內，缺檔回 {key: 缺數} ----
  async verifyPacks() {
    const c = await activeCache();
    if (!c) return {};
    const meta = await readMeta(c);
    const files = meta.__files || {};
    const broken = {};
    for (const [key, rels] of Object.entries(files)) {
      if (key.startsWith('__') || !(key in meta) || !Array.isArray(rels)) continue;
      let missing = 0;
      for (let i = 0; i < rels.length; i += 64) {
        const checks = await Promise.all(
          rels.slice(i, i + 64).map((r) => c.match(cacheKey(r)).catch(() => null)));
        for (const hit of checks) if (!hit) missing++;
      }
      if (missing) broken[key] = missing;
    }
    return broken;
  },
  // ---- 修復：去掉缺檔包的 sha（保留清單），下次下載自動補回 ----
  async repairPacks(keys) {
    const c = await activeCache();
    if (!c) return { removed: [] };
    const meta = await readMeta(c);
    const list = Array.isArray(keys) ? keys : [keys];
    const removed = [];
    for (const key of list) {
      if (key === 'core' || !(key in meta)) continue;
      delete meta[key];
      removed.push(key);
    }
    await writeMeta(c, meta);
    return { removed };
  },
  // ---- 清除無主檔 ----
  async cleanOrphans() {
    const c = await activeCache();
    if (!c) return { removed: 0 };
    const meta = await readMeta(c);
    const files = meta.__files || {};
    const claimed = new Set();
    for (const [p, rels] of Object.entries(files)) {
      if (p.startsWith('__') || !(p in meta)) continue;
      for (const r of rels || []) claimed.add(r);
    }
    let removed = 0;
    try {
      for (const r of await c.keys()) {
        try {
          const u = new URL(r.url, location.href);
          const p = u.pathname.replace(/^\//, '');
          if (p.startsWith('assets/') && !claimed.has(p.slice(7))) {
            if (await c.delete(r)) removed++;
          }
        } catch {}
      }
    } catch {}
    return { removed };
  },
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
