const { app, BrowserWindow, ipcMain, dialog, screen, protocol, net } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { pipeline } = require('stream/promises');
const { createGunzip } = require('zlib');
const tar = require('tar');

const DEV_URL = 'http://127.0.0.1:5173';
const isDev = !app.isPackaged;
let win = null;
let vite = null;

function findNode() {
  if (process.env.NODE_BIN) return process.env.NODE_BIN;
  try {
    const { execSync } = require('child_process');
    if (process.platform === 'win32') {
      const p = execSync('where node', { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim().split('\n')[0];
      if (p) return p;
    } else {
      const p = execSync('command -v node').toString().trim();
      if (p) return p;
    }
  } catch {}
  return 'node';
}

function findFfmpeg() {
  // Check for bundled ffmpeg-static first
  try {
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) return ffmpegStatic;
  } catch {}
  // Fallback to system PATH
  return 'ffmpeg';
}

function probeDevUrl(timeout = 1000) {
  return new Promise((resolve) => {
    const http = require('http');
    const req = http.get(DEV_URL, { timeout }, (res) => {
      res.destroy();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function startVite() {
  if (await probeDevUrl()) return;
  vite = spawn(findNode(), [path.join(__dirname, 'node_modules', 'vite', 'bin', 'vite.js')], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let buf = '';
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Vite dev server 啟動逾時')), 20000);
    const onData = (d) => {
      buf += d.toString();
      if (buf.includes('Local:')) {
        clearTimeout(t);
        resolve();
      }
    };
    vite.stdout.on('data', onData);
    vite.stderr.on('data', onData);
    vite.on('exit', () => reject(new Error('Vite dev server 已退出')));
  });
  if (!(await probeDevUrl())) throw new Error('Vite dev server 連線失敗');
}

function getAssetsDir() {
  if (isDev) return path.join(__dirname, 'assets');
  // In packaged app, assets are downloaded to userData (not bundled)
  return path.join(app.getPath('userData'), 'assets');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    backgroundColor: '#12122a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });

  // HASH 可能帶也可能不帶前導 '#'（env 傳值習慣不一），統一剝掉再加。
  const _hash = (process.env.HASH || '').replace(/^#/, '');
  if (isDev) {
    win.loadURL(DEV_URL + (_hash ? '#' + _hash : ''));
  } else {
    // Production: load index.prod.html from project root (Vite-bundled JS in dist/)
    const prodHtml = path.join(__dirname, 'index.prod.html');
    if (fs.existsSync(prodHtml)) {
      win.loadFile(prodHtml, { hash: _hash });
    } else {
      // Fallback: load from dist/
      win.loadFile(path.join(__dirname, 'dist', 'index.html'), { hash: _hash });
    }
  }

  win.webContents.on('console-message', (e, level, message) => {
    console.log('[renderer]', message);
  });
  if (process.env.CAPTURE) {
    const file = process.env.CAPTURE;
    const delay = Number(process.env.CAPTURE_DELAY) || 6000;
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, delay));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(file, img.toPNG());
      console.log('[capture] saved', file);
      app.exit(0);
    });
  }
}

ipcMain.handle('screenshot', async (event, file) => {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(file, img.toPNG());
  return file;
});

ipcMain.handle('lobby-list', async () => {
  const dir = path.join(getAssetsDir(), 'spine');
  return fs.readdirSync(dir).filter((d) => {
    try { return fs.statSync(path.join(dir, d)).isDirectory(); } catch { return false; }
  });
});

// 開場影片：已預先轉碼為 H.264，打包在 assets/intro/ 中。
// dev 模式下若缺少才嘗試從 APK 來源複製 + 轉碼。
const INTRO_VIDEO_SRC = process.env.INTRO_VIDEO_SRC || '';
const INTRO_AUDIO_SRC = process.env.INTRO_AUDIO_SRC || '';

function transcodeH264(src, dst) {
  try {
    const { spawnSync } = require('child_process');
    const ffmpeg = findFfmpeg();
    const r = spawnSync(ffmpeg, ['-y', '-i', src, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', dst], { timeout: 120000 });
    if (r.status === 0 && fs.existsSync(dst)) return true;
    console.error('[intro] 轉碼失敗', r.stderr && r.stderr.toString().slice(0, 500));
    return false;
  } catch (e) {
    console.error('[intro] ffmpeg 執行失敗', e.message);
    return false;
  }
}

ipcMain.handle('intro-media', async () => {
  const dstDir = path.join(getAssetsDir(), 'intro');
  const dstRaw = path.join(dstDir, 'title.mp4');
  const dstH264 = path.join(dstDir, 'title_h264.mp4');
  const dstA = path.join(dstDir, 'pv-a.ogg');
  // In dev mode, try to copy from APK source if available
  if (isDev && !fs.existsSync(dstRaw) && INTRO_VIDEO_SRC && fs.existsSync(INTRO_VIDEO_SRC)) {
    try {
      fs.mkdirSync(dstDir, { recursive: true });
      fs.copyFileSync(INTRO_VIDEO_SRC, dstRaw);
    } catch (e) {
      console.error('[intro] 複製失敗', e.message);
    }
  }
  if (isDev && fs.existsSync(dstRaw) && !fs.existsSync(dstH264)) transcodeH264(dstRaw, dstH264);
  if (isDev && !fs.existsSync(dstA) && INTRO_AUDIO_SRC && fs.existsSync(INTRO_AUDIO_SRC)) {
    try {
      fs.mkdirSync(dstDir, { recursive: true });
      fs.copyFileSync(INTRO_AUDIO_SRC, dstA);
    } catch (e) {
      console.error('[intro] 複製失敗', e.message);
    }
  }
  return {
    video: fs.existsSync(dstH264) ? (isDev ? '/assets/intro/title_h264.mp4' : 'app://assets/intro/title_h264.mp4') : null,
    audio: fs.existsSync(dstA) ? (isDev ? '/assets/intro/pv-a.ogg' : 'app://assets/intro/pv-a.ogg') : null,
  };
});

// 影片匯出：寫入使用者選的路徑（或 EXPORT_DIR 環境變數指定的目錄，供自動化/批次使用）
// 逐幀動畫匯出：renderer 手動推進 spine 逐幀渲染，把 WebP 幀串流進 ffmpeg（stdin），
// 編碼為固定 fps / 精確時長的 MP4 / WebM，完全不依賴即時錄影。
let animProc = null;
let animQueued = Promise.resolve();
let animOutPath = null;
let animAudioTmp = null;

function writeAnim(buf) {
  if (!animProc || !animProc.stdin.writable) return;
  animQueued = animQueued.then(() => new Promise((res, rej) => {
    animProc.stdin.write(buf, (err) => (err ? rej(err) : res()));
  })).catch(() => {});
}

ipcMain.handle('anim-start', async (event, payload) => {
  const { w = 1280, h = 720, fps = 30, duration = 10, ext = 'mp4', defaultName = 'lobby.mp4', audioPcm = null, sampleRate = 44100, channels = 2 } = payload || {};
  try {
    let outPath;
    const autoDir = process.env.EXPORT_DIR;
    if (autoDir) {
      outPath = path.join(autoDir, defaultName);
    } else {
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: '匯出動畫',
        defaultPath: defaultName,
        filters: [
          { name: ext === 'webm' ? 'WebM 影片' : 'MP4 影片', extensions: [ext || 'mp4'] },
          { name: '所有檔案', extensions: ['*'] },
        ],
      });
      if (canceled || !filePath) return { canceled: true };
      outPath = filePath;
    }

    const hasAudio = audioPcm && audioPcm.byteLength > 0;
    let audioTmp = null;
    if (hasAudio) {
      // 音訊（renderer 預混的 s16le PCM）寫成暫存檔再餵 ffmpeg：
      // 直接 pipe 時 s16le demuxer 可能因 read() 邊界不齊（非 4 的倍數）報
      // "Invalid PCM packet" 而中止整個編碼，暫存檔可避免。
      audioTmp = path.join(os.tmpdir(), `ba_anim_${Date.now()}_${Math.random().toString(36).slice(2)}.pcm`);
      fs.writeFileSync(audioTmp, Buffer.from(new Uint8Array(audioPcm)));
    }
    animAudioTmp = audioTmp;
    const vargs = ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', 'pipe:'];
    if (hasAudio) vargs.push('-f', 's16le', '-ar', String(sampleRate), '-ac', String(channels), '-i', audioTmp);
    vargs.push('-map', '0:v');
    if (hasAudio) vargs.push('-map', '1:a');
    if (ext === 'webm') {
      vargs.push('-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '30', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', '160k', '-t', String(duration), outPath);
    } else {
      vargs.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-t', String(duration), '-movflags', '+faststart', outPath);
    }

    animOutPath = outPath;
    animQueued = Promise.resolve();
    console.log('[anim] spawn ffmpeg', vargs.join(' '));
    animProc = spawn(findFfmpeg(), vargs, { stdio: ['pipe', 'ignore', 'pipe'] });
    animProc.stderr.on('data', () => {});
    animProc.on('error', (e) => { console.error('[anim] ffmpeg spawn 失敗', e); });
    animProc.on('exit', (c) => { if (c !== 0 && c !== null) console.error('[anim] ffmpeg exit', c); });
    return { ok: true };
  } catch (e) {
    console.error('[anim] start 失敗', e);
    return { error: e.message };
  }
});

ipcMain.on('anim-frame', (event, buf) => {
  writeAnim(Buffer.from(buf));
});

ipcMain.handle('anim-finish', async () => {
  if (!animProc) return { error: '沒有進行中的動畫匯出' };
  const proc = animProc;
  const tmp = animAudioTmp;
  try { await animQueued; proc.stdin.end(); } catch (e) { proc.stdin.destroy(); }
  const code = await new Promise((res) => proc.on('exit', (c) => res(c)));
  if (proc === animProc) animProc = null;
  if (tmp) { try { fs.unlinkSync(tmp); } catch {} animAudioTmp = null; }
  if (code !== 0) return { error: `ffmpeg 結束碼 ${code}` };
  const p = animOutPath;
  animOutPath = null;
  return { path: p };
});

ipcMain.on('anim-abort', () => {
  if (animProc) { try { animProc.stdin.destroy(); } catch {} try { animProc.kill('SIGKILL'); } catch {} animProc = null; }
  if (animAudioTmp) { try { fs.unlinkSync(animAudioTmp); } catch {} animAudioTmp = null; }
});

ipcMain.handle('bgm-export', async (event, payload) => {
  const { filename, defaultName } = payload || {};
  if (!filename) return { canceled: true };
  const src = path.join(getAssetsDir(), 'bgm', filename);
  if (!fs.existsSync(src)) return { error: 'BGM 檔案不存在' };
  const autoDir = process.env.EXPORT_DIR;
  if (autoDir) {
    const dst = path.join(autoDir, defaultName || filename);
    fs.copyFileSync(src, dst);
    return { path: dst };
  }
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '匯出 BGM',
    defaultPath: defaultName || filename,
    filters: [
      { name: 'OGG 音訊', extensions: ['ogg'] },
      { name: '所有檔案', extensions: ['*'] },
    ],
  });
  if (canceled || !filePath) return { canceled: true };
  fs.copyFileSync(src, filePath);
  return { path: filePath };
});

ipcMain.handle('screen-size', async () => {
  const d = screen.getPrimaryDisplay();
  return { width: d.size.width, height: d.size.height, scaleFactor: d.scaleFactor };
});

// ---------------------------------------------------------------------------
// Asset download system — check + download + extract tar.gz packages
// ---------------------------------------------------------------------------
// 資產分發走 Cloudflare Worker（Assets repo 轉 private 後 Releases 需授權，
// Worker 內嵌 GitHub token 代理；見 ba-assets-worker repo）
const ASSETS_WORKER_BASE = 'https://ba-assets.imlindora.workers.dev';
const ASSETS_VERSION_URL = `${ASSETS_WORKER_BASE}/latest/assets_version.json`;
const ASSETS_PACKAGES_URL = ASSETS_WORKER_BASE;

function getAssetsVersionPath() {
  return path.join(getAssetsDir(), '.version');
}

function getInstalledPath() {
  return path.join(getAssetsDir(), '.installed.json');
}
function readInstalled() {
  try { return JSON.parse(fs.readFileSync(getInstalledPath(), 'utf-8')); }
  catch { return {}; }
}
function writeInstalled(map) {
  fs.mkdirSync(getAssetsDir(), { recursive: true });
  fs.writeFileSync(getInstalledPath(), JSON.stringify(map, null, 2));
}
function getStreamingFlagPath() {
  return path.join(getAssetsDir(), '.streaming');
}
// 串流模式為預設：無旗標檔或 '1' 都視為串流；只有明確的 '0' 才是完整安裝
function isStreamingMode() {
  try { return fs.readFileSync(getStreamingFlagPath(), 'utf-8').trim() !== '0'; }
  catch { return true; }
}
function setStreamingMode(v) {
  fs.mkdirSync(getAssetsDir(), { recursive: true });
  fs.writeFileSync(getStreamingFlagPath(), v ? '1' : '0');
}

function readLocalVersion() {
  try {
    return fs.readFileSync(getAssetsVersionPath(), 'utf-8').trim();
  } catch { return null; }
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'BA-MemorialLobby/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJSON(res.headers.location).then(resolve, reject);
      }
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function downloadFile(url, dest, onProgress, ctl) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn) => (...a) => {
      if (settled) return;
      settled = true;
      if (ctl) ctl.cancel = null;
      fn(...a);
    };
    const ok = finish(resolve), fail = finish(reject);
    const doRequest = (u) => {
      const mod = u.startsWith('https') ? https : require('http');
      const req = mod.get(u, { headers: { 'User-Agent': 'BA-MemorialLobby/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return doRequest(res.headers.location);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return fail(new Error(`HTTP ${res.statusCode} for ${u}`));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let downloaded = 0;
        const ws = fs.createWriteStream(dest);
        if (ctl) {
          ctl.cancel = () => {
            try { req.destroy(); } catch {}
            try { ws.destroy(); } catch {}
            try { res.destroy(); } catch {}
            fail(new Error('cancelled'));
          };
        }
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (onProgress) onProgress(downloaded, total);
        });
        res.on('error', fail);
        res.pipe(ws);
        ws.on('finish', () => ok({ size: downloaded }));
        ws.on('error', fail);
      });
      req.on('error', fail);
      req.setTimeout(300000, () => { req.destroy(); fail(new Error('Download timeout')); });
      if (ctl && !ctl.cancel) {
        ctl.cancel = () => { try { req.destroy(); } catch {} fail(new Error('cancelled')); };
      }
    };
    doRequest(url);
  });
}

async function extractTarGz(tarPath, destDir) {
  // v1 舊包：arcname "assets/<pkg>/..."，曾用 strip:2 到 assets/<pkg>
  // v2 增量包：同樣 "assets/..."，統一 strip:1 到 assets/ 根目錄即正確
  // 為相容兩者：嘗試 strip:1 到 assets 根；若 destDir 是子目錄則退回 strip:2
  try {
    await tar.x({ file: tarPath, cwd: destDir, strip: 2 });
  } catch {
    await tar.x({ file: tarPath, cwd: getAssetsDir(), strip: 1 });
  }
}
async function extractTarGzToAssets(tarPath) {
  await tar.x({ file: tarPath, cwd: getAssetsDir(), strip: 1 });
}

ipcMain.handle('check-assets', async (event, { voice } = {}) => {
  const localVersion = readLocalVersion();
  const installed = readInstalled();
  const assetsDir = getAssetsDir();
  const streaming = isStreamingMode();
  const hasAssets = fs.existsSync(assetsDir) && fs.existsSync(path.join(assetsDir, 'spine'));

  let remoteVersion = null;
  try {
    remoteVersion = await fetchJSON(ASSETS_VERSION_URL);
  } catch (e) {
    console.warn('[assets] 無法取得遠端版本:', e.message);
  }

  // 計算需要下載的包（schema 2 增量；schema 1 回退為整版）
  // dev 模式（直接跑 repo）：assets/ 已在本地，installed.json 只是下載器記帳，
  // 不該讓它反過來把整個 assets 判成未安裝。此時僅提示有新版本、不強制下載。
  let needsDownloadPacks = [];
  const devAssets = isDev && hasAssets;
  if (remoteVersion?.packages) {
    if (devAssets) {
      needsDownloadPacks = [];
    } else if (remoteVersion.schema === 2) {
      for (const [k, v] of Object.entries(remoteVersion.packages)) {
        if (installed[k] !== v.sha256) needsDownloadPacks.push(k);
      }
      // 串流模式：初始只需 core
      if (streaming) {
        const coreNeeds = needsDownloadPacks.filter(k => k === 'core' || k === 'intro');
        // 若 core 已齊，即使其他 lobby 缺也不阻擋進入
        if (coreNeeds.length === 0 && hasAssets) needsDownloadPacks = [];
        else needsDownloadPacks = coreNeeds;
      }
    } else {
      if (!hasAssets || (remoteVersion && localVersion !== remoteVersion.version)) {
        needsDownloadPacks = Object.keys(remoteVersion.packages);
        // 只下玩家選擇的語音語言（jp/kr）的語音包，不下另一種
        const wantKr = voice === 'kr';
        needsDownloadPacks = needsDownloadPacks.filter(k => !k.startsWith('voice/')
          || (wantKr ? k.startsWith('voice/KR_') : k.startsWith('voice/JP_')));
      }
    }
  }

  return {
    localVersion,
    hasAssets,
    remoteVersion: remoteVersion?.version || null,
    schema: remoteVersion?.schema || 1,
    // dev 模式本地資源已齊，永不阻擋進入
    needsDownload: devAssets ? false : (needsDownloadPacks.length > 0 || !hasAssets),
    needsDownloadPacks: devAssets ? [] : needsDownloadPacks,
    packages: remoteVersion?.packages || null,
    lobbies: remoteVersion?.lobbies || null,
    streaming,
    installed,
  };
});

ipcMain.handle('get-streaming-mode', async () => isStreamingMode());
ipcMain.handle('set-streaming-mode', async (event, v) => {
  setStreamingMode(!!v);
  return isStreamingMode();
});

// 設定頁暫停鈕用（download-assets 迴圈內檢查；進行中的包經 ctl abort）
const dlCancel = { cancelled: false, cancel: null };
ipcMain.handle('cancel-download-assets', async () => {
  dlCancel.cancelled = true;
  try { dlCancel.cancel?.(); } catch {}
  return true;
});

ipcMain.handle('download-assets', async (event, { version, packages, onlyPacks, voice }) => {
  const assetsDir = getAssetsDir();
  const installed = readInstalled();
  const remotePackages = packages || {};
  // 設定頁暫停鈕用：包之間檢查旗標，進行中的包經 ctl abort
  dlCancel.cancelled = false;
  dlCancel.cancel = null;
  // 僅下載需要的包（增量）：sha 不同的才下；若呼叫端指定 onlyPacks 則限於該清單
  let pkgNames;
  if (onlyPacks && Array.isArray(onlyPacks)) {
    pkgNames = onlyPacks.filter(k => remotePackages[k] && installed[k] !== remotePackages[k].sha256);
    if (pkgNames.length === 0) pkgNames = onlyPacks.filter(k => remotePackages[k]); // 串流：即使 sha 相同但本地檔案遺失也補下
  } else {
    pkgNames = Object.keys(remotePackages).filter(k => installed[k] !== remotePackages[k].sha256);
    // 舊版 schema 1 無 per-pack sha 回退為全量
    if (pkgNames.length === 0 && !Object.keys(installed).length) pkgNames = Object.keys(remotePackages);
  }
  // 只下玩家選擇的語音語言（jp/kr）的語音包，不下另一種
  const wantKr = voice === 'kr';
  pkgNames = pkgNames.filter(k => !k.startsWith('voice/')
    || (wantKr ? k.startsWith('voice/KR_') : k.startsWith('voice/JP_')));
  if (pkgNames.length === 0) {
    try { fs.writeFileSync(getAssetsVersionPath(), version); } catch {}
    return [];
  }
  const tmpDir = path.join(os.tmpdir(), 'ba_download_' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });
  const results = [];
  for (let i = 0; i < pkgNames.length; i++) {
    const name = pkgNames[i];
    if (dlCancel.cancelled) { results.push({ name, ok: false, error: 'cancelled' }); break; }
    const pkg = remotePackages[name];
    if (!pkg) { results.push({ name, ok: false, error: 'not in remote' }); continue; }
    const tarName = `assets-${name.replace(/\//g, '_')}-v${version}.tar.gz`;
    const tarPath = path.join(tmpDir, tarName);
    const sendProgress = (p) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('download-progress', { package: name, index: i, total: pkgNames.length, ...p });
      }
    };
    try {
      sendProgress({ status: 'downloading', percent: 0 });
      const url = `${ASSETS_PACKAGES_URL}/v${version}/${tarName}` || pkg.url;
      await downloadFile(url, tarPath, (dl, total) => {
        sendProgress({ status: 'downloading', percent: total ? Math.round(dl * 100 / total) : 0, downloaded: dl, bytesTotal: total });
      }, dlCancel);
      sendProgress({ status: 'extracting', percent: 0 });
      // v2：arcname "assets/..." strip:1 到 assets/ 根；兼容舊包
      try { await extractTarGzToAssets(tarPath); }
      catch { await extractTarGz(tarPath, path.join(assetsDir, name.split('/')[0])); }
      installed[name] = pkg.sha256;
      writeInstalled(installed);
      sendProgress({ status: 'done', percent: 100 });
      results.push({ name, ok: true });
    } catch (e) {
      if (dlCancel.cancelled) { results.push({ name, ok: false, error: 'cancelled' }); break; }
      console.error(`[assets] ${name} 失敗:`, e.message);
      sendProgress({ status: 'error', error: e.message });
      results.push({ name, ok: false, error: e.message });
    }
  }
  // 僅在「至少一包成功」時寫入 .version；全失敗（如 release 資產缺包 404）
  // 不覆寫版本號，讓下次啟動仍判定 needsDownload 重試。
  if (results.some(r => r.ok)) {
    try { fs.mkdirSync(assetsDir, { recursive: true }); fs.writeFileSync(getAssetsVersionPath(), version); } catch {}
  }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  return results;
});

// 串流模式：確保某個 lobby 的資源已就緒（core + 該 lobby 需要的包）
ipcMain.handle('ensure-lobby', async (event, { lobby, version, packages, lobbies, voice }) => {
  const assetsDir = getAssetsDir();
  const installed = readInstalled();
  // lobby 需要哪些包（由 assets_version.json 的 lobbies 表提供）
  let packs = [];
  if (lobbies?.[lobby]?.packs) packs = [...lobbies[lobby].packs];
  else {
    // 回退：至少確保 lobby 本身
    const k = 'lobby/' + lobby;
    if (packages?.[k]) packs = [k];
  }
  // 只下玩家選擇的語音語言（jp/kr）的語音包，不下另一種；
  // 非語音包（lobby/spine/scene/bgm/core）全部保留。
  const wantKr = voice === 'kr';
  packs = packs.filter((k) => !k.startsWith('voice/')
    || (wantKr ? k.startsWith('voice/KR_') : k.startsWith('voice/JP_')));
  // core 必須先有
  if (packages?.['core'] && installed['core'] !== packages['core'].sha256) packs.unshift('core');
  packs = [...new Set(packs)];
  const missing = packs.filter(k => installed[k] !== packages[k]?.sha256);
  // 額外檢查：即使 sha 相同但目錄其實不存在也視為缺失
  const actuallyMissing = missing.length ? missing : packs.filter(k => {
    const p = packages[k];
    if (!p) return false;
    // 檢查代表性路徑是否存在
    if (k.startsWith('lobby/')) return !fs.existsSync(path.join(assetsDir, 'spine', k.split('/')[1]));
    if (k.startsWith('voice/')) return !fs.existsSync(path.join(assetsDir, 'voice', k.split('/')[1]));
    return false;
  });
  if (actuallyMissing.length === 0) return { ok: true, cached: true };
  // 下載指定 packs
  const tmpDir = path.join(os.tmpdir(), 'ba_download_' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });
  const results = [];
  for (let i = 0; i < actuallyMissing.length; i++) {
    const name = actuallyMissing[i];
    const pkg = packages[name];
    const tarName = `assets-${name.replace(/\//g, '_')}-v${version}.tar.gz`;
    const tarPath = path.join(tmpDir, tarName);
    const sendProgress = (p) => {
      if (win && !win.isDestroyed()) win.webContents.send('download-progress', { package: name, index: i, total: actuallyMissing.length, ...p });
    };
    try {
      sendProgress({ status: 'downloading', percent: 0 });
      const url = `${ASSETS_PACKAGES_URL}/v${version}/${tarName}` || pkg.url;
      await downloadFile(url, tarPath, (dl, total) => {
        sendProgress({ status: 'downloading', percent: total ? Math.round(dl * 100 / total) : 0, downloaded: dl, bytesTotal: total });
      });
      sendProgress({ status: 'extracting', percent: 0 });
      await extractTarGzToAssets(tarPath);
      installed[name] = pkg.sha256;
      writeInstalled(installed);
      sendProgress({ status: 'done', percent: 100 });
      results.push({ name, ok: true });
    } catch (e) {
      console.error(`[assets] ${name} 串流失敗:`, e.message);
      sendProgress({ status: 'error', error: e.message });
      results.push({ name, ok: false, error: e.message });
    }
  }
  // 同 download-assets：全失敗時不寫 .version，保留 needsDownload 狀態供重試。
  if (results.some(r => r.ok)) {
    try { fs.writeFileSync(getAssetsVersionPath(), version); } catch {}
  }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  const failed = results.filter(r => !r.ok);
  return failed.length ? { ok: false, results } : { ok: true, results };
});

// ---------------------------------------------------------------------------
// Asset space management — per-pack disk usage + user-driven deletion
// ---------------------------------------------------------------------------
function dirStats(dir) {
  let size = 0, files = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); }
    catch { continue; }
    for (const ent of entries) {
      const p = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else {
        try {
          size += fs.statSync(p).size;
          files++;
        } catch {}
      }
    }
  }
  return { size, files };
}

// installed.json 的 pack key → 磁碟路徑清單（與 build_assets.py 打包規則一一對應）
function packPaths(key) {
  const assetsDir = getAssetsDir();
  if (key === 'core') return ['data', 'students', 'ui', 'loading', 'fonts'].map(s => path.join(assetsDir, s));
  if (key === 'intro') return [path.join(assetsDir, 'intro')];
  if (key.startsWith('lobby/')) {
    const nm = key.slice('lobby/'.length);
    return [path.join(assetsDir, 'spine', nm), path.join(assetsDir, 'scene', nm)];
  }
  if (key.startsWith('voice/')) return [path.join(assetsDir, 'voice', key.slice('voice/'.length))];
  return [];
}

ipcMain.handle('assets-manage-list', async () => {
  const installed = readInstalled();
  const localVersion = readLocalVersion();
  const packs = [];
  for (const key of Object.keys(installed).sort()) {
    const paths = packPaths(key);
    // lobby 包跨 spine/ 兩處 + 可能共用 bgm；大小統計全部存在的路徑
    const stats = paths.reduce((acc, p) => {
      if (!fs.existsSync(p)) return acc;
      const s = dirStats(p);
      acc.size += s.size; acc.files += s.files;
      return acc;
    }, { size: 0, files: 0 });
    packs.push({
      key,
      kind: key === 'core' ? 'core' : key === 'intro' ? 'intro' : key.split('/')[0],
      name: key.includes('/') ? key.split('/')[1] : key,
      size: stats.size,
      files: stats.files,
      deletable: key !== 'core',   // core 是必載基礎，不可刪
      present: paths.some(p => fs.existsSync(p)),
    });
  }
  const total = packs.reduce((a, p) => a + p.size, 0);
  return { version: localVersion, packs, totalSize: total, orphans: 0, streaming: isStreamingMode() };
});

// 管理空間：完整性（代表路徑存在性）＋修復（去 sha，缺席計數）
function packPrimaryPath(key) {
  const assetsDir = getAssetsDir();
  if (key === 'core') return path.join(assetsDir, 'data');
  if (key === 'intro') return path.join(assetsDir, 'intro');
  if (key === 'assets-player') return path.join(assetsDir, 'bgm');
  if (key.startsWith('lobby/')) return path.join(assetsDir, 'spine', key.slice('lobby/'.length));
  if (key.startsWith('voice/')) return path.join(assetsDir, 'voice', key.slice('voice/'.length));
  return null;
}

ipcMain.handle('assets-verify', async () => {
  const installed = readInstalled();
  const broken = {};
  for (const key of Object.keys(installed)) {
    if (key === 'core') continue;
    const p = packPrimaryPath(key);
    if (p && !fs.existsSync(p)) broken[key] = 1;
  }
  return broken;
});

ipcMain.handle('assets-repair', async (event, keys) => {
  const list = Array.isArray(keys) ? keys : [keys];
  const installed = readInstalled();
  const removed = [];
  for (const key of list) {
    if (key === 'core' || !(key in installed)) continue;
    delete installed[key];
    removed.push(key);
  }
  writeInstalled(installed);
  return { removed };
});

ipcMain.handle('assets-clean-orphans', async () => ({ removed: 0 }));

ipcMain.handle('assets-manage-delete', async (event, keys) => {
  const list = Array.isArray(keys) ? keys : [keys];
  const installed = readInstalled();
  const removed = [], errors = [];
  for (const key of list) {
    if (key === 'core') { errors.push({ key, error: 'core 不可刪除' }); continue; }
    // 安全檢查：只允許刪除已知 pack 對應的目錄，防止任意路徑注入
    const paths = packPaths(key);
    if (!paths.length || !installed[key]) { errors.push({ key, error: '未知的資源包' }); continue; }
    try {
      for (const p of paths) {
        // 必須位於 assetsDir 之下才可刪
        if (!p.startsWith(getAssetsDir())) continue;
        fs.rmSync(p, { recursive: true, force: true });
      }
      delete installed[key];
      removed.push(key);
    } catch (e) {
      errors.push({ key, error: e.message });
    }
  }
  writeInstalled(installed);
  return { removed, errors };
});

app.whenReady().then(async () => {
  // Register app:// protocol for serving assets in production
  if (!isDev) {
    protocol.handle('app', (request) => {
      const url = new URL(request.url);
      const filePath = path.join(getAssetsDir(), decodeURIComponent(url.pathname));
      return net.fetch('file://' + filePath);
    });
  }

  if (isDev) {
    try {
      await startVite();
    } catch (e) {
      console.error('無法啟動 Vite dev server:', e.message);
    }
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (vite) vite.kill();
  if (process.platform !== 'darwin') app.quit();
});
