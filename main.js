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

  if (isDev) {
    win.loadURL(DEV_URL + (process.env.HASH ? '#' + process.env.HASH : ''));
  } else {
    // Production: load index.prod.html from project root (Vite-bundled JS in dist/)
    const prodHtml = path.join(__dirname, 'index.prod.html');
    if (fs.existsSync(prodHtml)) {
      win.loadFile(prodHtml, { hash: process.env.HASH || '' });
    } else {
      // Fallback: load from dist/
      win.loadFile(path.join(__dirname, 'dist', 'index.html'), { hash: process.env.HASH || '' });
    }
  }

  win.webContents.on('console-message', (e, level, message) => {
    console.log('[renderer]', message);
  });
  if (process.env.CAPTURE) {
    const file = process.env.CAPTURE;
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 6000));
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
const ASSETS_VERSION_URL = 'https://github.com/Augus1217/BA-MemorialLobby-Assets/releases/latest/download/assets_version.json';
const ASSETS_PACKAGES_URL = 'https://github.com/Augus1217/BA-MemorialLobby-Assets/releases/download';

function getAssetsVersionPath() {
  return path.join(getAssetsDir(), '.version');
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

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const doRequest = (u) => {
      const mod = u.startsWith('https') ? https : require('http');
      const req = mod.get(u, { headers: { 'User-Agent': 'BA-MemorialLobby/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return doRequest(res.headers.location);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let downloaded = 0;
        const ws = fs.createWriteStream(dest);
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (onProgress) onProgress(downloaded, total);
        });
        res.pipe(ws);
        ws.on('finish', () => resolve({ size: downloaded }));
        ws.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(300000, () => { req.destroy(); reject(new Error('Download timeout')); });
    };
    doRequest(url);
  });
}

async function extractTarGz(tarPath, destDir) {
  // tar 內容路徑為 "assets/<pkg>/..."（見上游 build_assets.py step_package 的
  // arcname），剝掉兩層後檔案才會直接落在 destDir（= assets/<pkg>）。
  // 先前 strip:1 會解成 assets/<pkg>/<pkg>/... 多套一層。
  await tar.x({ file: tarPath, cwd: destDir, strip: 2 });
}

ipcMain.handle('check-assets', async () => {
  const localVersion = readLocalVersion();
  const assetsDir = getAssetsDir();
  const hasAssets = fs.existsSync(assetsDir) && fs.existsSync(path.join(assetsDir, 'spine'));

  let remoteVersion = null;
  try {
    remoteVersion = await fetchJSON(ASSETS_VERSION_URL);
  } catch (e) {
    console.warn('[assets] 無法取得遠端版本:', e.message);
  }

  return {
    localVersion,
    hasAssets,
    remoteVersion: remoteVersion?.version || null,
    needsDownload: !hasAssets || (remoteVersion && localVersion !== remoteVersion.version),
    packages: remoteVersion?.packages || null,
  };
});

ipcMain.handle('download-assets', async (event, { version, packages }) => {
  const assetsDir = getAssetsDir();
  const tmpDir = path.join(os.tmpdir(), 'ba_download_' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  const pkgNames = Object.keys(packages);
  const results = [];

  for (let i = 0; i < pkgNames.length; i++) {
    const name = pkgNames[i];
    const pkg = packages[name];
    const tarName = `assets-${name}-v${version}.tar.gz`;
    const tarPath = path.join(tmpDir, tarName);
    const pkgDir = path.join(assetsDir, name);

    // Send progress to renderer
    const sendProgress = (p) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('download-progress', {
          package: name,
          index: i,
          total: pkgNames.length,
          ...p,
        });
      }
    };

    try {
      sendProgress({ status: 'downloading', percent: 0 });
      const url = pkg.url || `${ASSETS_PACKAGES_URL}/v${version}/${tarName}`;
      await downloadFile(url, tarPath, (dl, total) => {
        sendProgress({ status: 'downloading', percent: total ? Math.round(dl * 100 / total) : 0, downloaded: dl, bytesTotal: total });
      });

      sendProgress({ status: 'extracting', percent: 0 });
      fs.mkdirSync(pkgDir, { recursive: true });
      await extractTarGz(tarPath, pkgDir);
      sendProgress({ status: 'done', percent: 100 });

      results.push({ name, ok: true });
    } catch (e) {
      console.error(`[assets] ${name} 失敗:`, e.message);
      sendProgress({ status: 'error', error: e.message });
      results.push({ name, ok: false, error: e.message });
    }
  }

  // Write .version file
  try {
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(getAssetsVersionPath(), version);
  } catch {}

  // Cleanup
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

  return results;
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
