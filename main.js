const { app, BrowserWindow, ipcMain, dialog, screen, protocol, net } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const { pipeline } = require('stream/promises');
const { createGunzip } = require('zlib');
const tar = require('tar');

const DEV_URL = 'http://127.0.0.1:5173';
const isDev = !app.isPackaged;
const { Menu } = require('electron');
const wallpaper = require('./wallpaper');
const { createTray, refreshTray } = require('./tray');
const { setUiLang } = require('./main-i18n');
let win = null;
let vite = null;
let quitting = false;   // app 退出中——vite watchdog 停手

// app 名稱（dev 模式預設是 "Electron"——全域選單/通知/crash 對話框都會用它）
app.name = 'BA Memorial Lobby';
// ★ app.name 會連動 userData 預設路徑（appData/app.name）——dev 下釘回原目錄，
//   否則 wallpaper.json/installed.json/localStorage 全部「搬家」，設定瞬間歸零。
//   packaged 版本名稱本來就是 productName，路徑不動。
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'ba-memorial-lobby-electron'));
}
// 應用程式選單策略：
// - Win/Linux：整份移除（KDE 全域選單 applet / 視窗內選單列不再顯示 File/Edit/...；
//   F11 全螢幕由 renderer 綁定、F12 devtools 見 createWindow 的 before-input-event）
// - macOS：選單列永遠顯示最前方 app 的選單（桌布 app 也一樣），給最小正規選單＝
//   顯示正確名稱＋Cmd 快捷鍵；packaged 的 CFBundleName 本來就是 productName，
//   dev 下仍顯示 Electron binary 名（無解，打包版不受影響）
if (process.platform === 'darwin') {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { role: 'about' }, { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' },
      { role: 'quit' },
    ] },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]));
} else {
  Menu.setApplicationMenu(null);
}

// Linux Wayland session：Electron 預設仍走 X11(XWayland)，明確 pin 住——
// type:'desktop' 桌布視窗（_NET_WM_WINDOW_TYPE_DESKTOP）只有在 X11 下有正規路線
// （wallpaper-mode 計畫：GNOME Wayland 原生不支援 → XWayland 備援）。
if (process.platform === 'linux' && !process.env.ELECTRON_OZONE_PLATFORM_HINT && !process.env.OZONE_PLATFORM) {
  app.commandLine.appendSwitch('ozone-platform-hint', 'x11');
}

// app:// 資產協定（packaged：頁面 file://、資產 app://）：scheme 必須在 app ready 前
// 註冊為 privileged，renderer 的 fetch() 才認得——否則 Blink 直接回
// "Fetch API cannot load app://...: URL scheme "app" is not supported"（0.5.0 實測）。
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// 單例鎖（wallpaper-mode 計畫）：第二實例把意圖轉交首實例——
// 帶 --wallpaper 的 argv → 首實例啟動桌布；否則聚焦主視窗。
const gotTheLock = app.requestSingleInstanceLock();
function showPlayer() {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return;
  }
  createWindow();
}
// tray「選擇桌布大廳」→ 開播放器並跳到設定桌布分頁（視窗剛建立時掛起，載入完補送）
let pendingOpenWall = false;
function openWallpaperSettings() {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send('open-wallpaper-settings');
  } else {
    pendingOpenWall = true;
    showPlayer();
  }
}
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (argv.includes('--wallpaper')) {
      try { wallpaper.start(); } catch (e) { console.error('[wallpaper] second-instance start failed:', e.message); }
    }
    showPlayer();
  });
}

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

// ffmpeg 可用性（影片匯出前置檢查；結果快取，避免每次匯出都 spawn）
let ffmpegProbe = null;
function ffmpegAvailable() {
  if (ffmpegProbe) return ffmpegProbe;
  try {
    const { spawnSync } = require('child_process');
    const exe = findFfmpeg();
    const r = spawnSync(exe, ['-version'], { timeout: 8000 });
    ffmpegProbe = { ok: r.status === 0, path: exe, error: r.error ? String(r.error.message || r.error) : null };
  } catch (e) {
    ffmpegProbe = { ok: false, path: null, error: e.message };
  }
  return ffmpegProbe;
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
  // vite 輸出轉發（原本吞掉只掃 "Local:"——崩潰訊息永遠看不到）
  const fwd = (d) => {
    for (const line of String(d).split('\n')) if (line.trim()) console.log('[vite]', line.trimEnd());
  };
  vite.stdout.on('data', fwd);
  vite.stderr.on('data', fwd);
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
    vite.on('exit', (code, sig) => {
      clearTimeout(t);
      reject(new Error(`Vite dev server 已退出 (code=${code} signal=${sig})`));
    });
  });
  if (!(await probeDevUrl())) throw new Error('Vite dev server 連線失敗');
  vite.on('exit', (code, sig) => {
    vite = null;
    if (!quitting) console.error(`[vite] dev server 無預警退出 (code=${code} signal=${sig})——watchdog 將重啟`);
  });
}

// dev vite watchdog：child 掛掉（或 reuse 的外部 server 消失）且 port 無人服務 → 重新 spawn。
// 限流 60s 內最多 5 次；app 退出中（quitting）不動。5s 輪詢＋vite client 自帶重連輪詢，
// 兩端對上後 renderer 自動恢復（worker 端另有載入重試，見 app.js）。
let viteStarting = false;
const viteRespawns = [];
function startViteWatchdog() {
  setInterval(async () => {
    try {
      if (quitting || !isDev || viteStarting) return;
      if (vite && vite.exitCode === null) return;               // 自己的 child 還活著
      if (await probeDevUrl(800)) return;                       // 還有人在服務（reuse 情境）→ 不動
      const now = Date.now();
      while (viteRespawns.length && now - viteRespawns[0] > 60000) viteRespawns.shift();
      if (viteRespawns.length >= 5) return;
      viteRespawns.push(now);
      viteStarting = true;
      console.warn('[vite] dev server 掛了——watchdog 重啟中…');
      try { await startVite(); console.log('[vite] dev server 已重啟'); }
      catch (e) { console.error('[vite] 重啟失敗:', e.message); }
      finally { viteStarting = false; }
    } catch {}
  }, 5000);
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
  win.webContents.on('did-finish-load', () => {
    if (pendingOpenWall) {
      pendingOpenWall = false;
      setTimeout(() => { try { if (win && !win.isDestroyed()) win.webContents.send('open-wallpaper-settings'); } catch {} }, 800);
    }
  });
  // 應用程式選單已移除（見檔頭）→ F12 補回 devtools 開關
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      try { win.webContents.toggleDevTools(); } catch {}
    }
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
  // 只允許寫進使用者圖片資料夾／暫存資料夾／EXPORT_DIR：這個 IPC 沒有另開
  // 儲存對話框，若照單全收等於讓 renderer 能任意寫檔。
  const name = path.basename(String(file || `screenshot-${Date.now()}.png`));
  const allowed = [process.env.EXPORT_DIR, os.tmpdir(), app.getPath('pictures')].filter(Boolean);
  let out = path.join(app.getPath('pictures'), name);
  if (file) {
    const want = path.resolve(String(file));
    if (allowed.some((d) => pathInside(d, want))) out = want;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.toPNG());
  return out;
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
let animExit = null;
let animSpawnFailed = false;   // spawn 失敗（找不到 ffmpeg）→ 回可翻譯的錯誤碼
let animOutPath = null;
let animAudioTmp = null;

function writeAnim(buf) {
  if (!animProc || !animProc.stdin.writable) return;
  animQueued = animQueued.then(() => new Promise((res, rej) => {
    animProc.stdin.write(buf, (err) => (err ? rej(err) : res()));
  })).catch(() => {});
}

ipcMain.handle('anim-start', async (event, payload) => {
  const { w = 1280, h = 720, fps = 30, duration = 10, ext = 'mp4', defaultName = 'lobby.mp4', audioPcm = null, sampleRate = 44100, channels = 2, labels = {} } = payload || {};
  try {
    let outPath;
    const autoDir = process.env.EXPORT_DIR;
    if (autoDir) {
      // defaultName 來自 renderer：只留檔名，避免 ../../ 逃出 EXPORT_DIR
      outPath = path.join(autoDir, path.basename(String(defaultName || 'lobby.mp4')));
    } else {
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: labels.title || '匯出動畫',
        defaultPath: defaultName,
        filters: [
          { name: labels.videoFilter || (ext === 'webm' ? 'WebM 影片' : 'MP4 影片'), extensions: [ext || 'mp4'] },
          { name: labels.allFiles || '所有檔案', extensions: ['*'] },
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
    animSpawnFailed = false;
    animProc = spawn(findFfmpeg(), vargs, { stdio: ['pipe', 'ignore', 'pipe'] });
    // ffmpeg 提前結束（參數錯、磁碟滿）時，後續 write/end 會 EPIPE；
    // 沒有 listener 會變成 uncaught error 直接把主程序帶走。
    animProc.stdin.on('error', () => {});
    animProc.stderr.on('data', () => {});
    // exit promise 必須在 spawn 當下就掛：等到 anim-finish 才 proc.on('exit')
    // 會錯過已經發生的事件 → 匯出永久卡住不返回。
    animExit = new Promise((res) => {
      animProc.once('exit', (c) => res(c));
      // spawn 失敗（找不到 ffmpeg）不會有 exit 事件，靠 error 收尾避免卡死
      animProc.once('error', () => res(-1));
    });
    animProc.on('error', (e) => { animSpawnFailed = true; console.error('[anim] ffmpeg spawn 失敗', e); });
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
  if (!animProc) return { error: 'no_active_export' };
  const proc = animProc;
  const tmp = animAudioTmp;
  const exitP = animExit || new Promise((res) => proc.once('exit', res));
  try { await animQueued; proc.stdin.end(); } catch { try { proc.stdin.destroy(); } catch {} }
  const code = await exitP;
  if (proc === animProc) { animProc = null; animExit = null; }
  if (tmp) { try { fs.unlinkSync(tmp); } catch {} animAudioTmp = null; }
  // 回可翻譯的錯誤碼（renderer 以 err.ffmpeg_* 呈現）；技術細節留 console
  if (animSpawnFailed) return { error: 'ffmpeg_missing' };
  if (code !== 0) return { error: 'ffmpeg_exit', code };
  const p = animOutPath;
  animOutPath = null;
  return { path: p };
});

ipcMain.on('anim-abort', () => {
  if (animProc) { try { animProc.stdin.destroy(); } catch {} try { animProc.kill('SIGKILL'); } catch {} animProc = null; animExit = null; }
  if (animAudioTmp) { try { fs.unlinkSync(animAudioTmp); } catch {} animAudioTmp = null; }
});

ipcMain.handle('bgm-export', async (event, payload) => {
  const { filename, defaultName, labels = {} } = payload || {};
  if (!filename) return { canceled: true };
  // 只接受純檔名：filename 來自 BGM 對照表，但 renderer 若被注入可送 ../..
  // 讀出 assets 目錄外任意檔案。
  const name = String(filename);
  if (name !== path.basename(name) || name.includes('\0')) return { error: 'bad_name' };
  const bgmDir = path.join(getAssetsDir(), 'bgm');
  const src = path.join(bgmDir, name);
  if (!pathInside(bgmDir, src) || !fs.existsSync(src)) return { error: 'bgm_missing' };
  const outName = path.basename(String(defaultName || name));
  const autoDir = process.env.EXPORT_DIR;
  if (autoDir) {
    const dst = path.join(autoDir, outName);
    fs.mkdirSync(autoDir, { recursive: true });
    fs.copyFileSync(src, dst);
    return { path: dst };
  }
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: labels.title || '匯出 BGM',
    defaultPath: outName,
    filters: [
      { name: labels.audioFilter || 'OGG 音訊', extensions: ['ogg'] },
      { name: labels.allFiles || '所有檔案', extensions: ['*'] },
    ],
  });
  if (canceled || !filePath) return { canceled: true };
  fs.copyFileSync(src, filePath);
  return { path: filePath };
});

// renderer 匯出前先問：找不到 ffmpeg 就不要走完整錄製流程才失敗
ipcMain.handle('ffmpeg-available', async () => ffmpegAvailable());

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
// Worker 端若設了 ACCESS_KEY（可選門檻），客戶端需帶同一個 key。
// 未設定時 worker 不啟用門檻，這裡留空即可（不送 header）。
const ASSET_KEY = process.env.BA_ASSET_KEY || '';
function assetHeaders(extra = {}) {
  const h = { 'User-Agent': 'BA-MemorialLobby/1.0', ...extra };
  if (ASSET_KEY) h['x-ba-key'] = ASSET_KEY;
  return h;
}
// 串流計算檔案 sha256（pack 可能 400MB，不能整檔讀進記憶體）
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const rs = fs.createReadStream(file);
    rs.on('error', reject);
    rs.on('data', (c) => h.update(c));
    rs.on('end', () => resolve(h.digest('hex')));
  });
}
// 下載後驗證 manifest 的 sha256；不符就刪檔，讓上層重試／下次重抓。
// 這是「完整性檢查」唯一真正有效的位置（installed.json 只是記帳）。
async function verifyPackFile(tarPath, pkg, name) {
  const want = pkg?.sha256;
  if (!want) return;
  const got = await sha256File(tarPath);
  if (got !== want) {
    try { fs.rmSync(tarPath, { force: true }); } catch {}
    throw new Error(`${name} sha256 不符（下載 ${got.slice(0, 12)}…，預期 ${want.slice(0, 12)}…）`);
  }
}
// voice-m4a 包住在 companion release（tag=主版號+-m4a；1000 上限分流），其餘走主版
const packTagFor = (name, version) =>
  (typeof name === 'string' && name.startsWith('voice-m4a/')) ? `v${version}-m4a` : `v${version}`;

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
// 資源取得只有一種行為：按需補齊（開機擋 core/intro；大廳隨點隨下）。
// 「完整安裝」不是模式，只是設定頁的一次性動作（把缺包一次補滿）。
// （舊版 .streaming 旗標檔若殘留磁碟，無任何程式讀它，可無視。）

function readLocalVersion() {
  try {
    return fs.readFileSync(getAssetsVersionPath(), 'utf-8').trim();
  } catch { return null; }
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: assetHeaders() }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchJSON(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        // 403（ACCESS_KEY 未帶）／5xx 若直接 JSON.parse 會變成誤導的 parse error
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
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

// 版本/manifest 抓取重試：啟動路徑對瞬斷要有韌性（Fastly 抖動常見）
async function fetchJSONRetry(url, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fetchJSON(url); }
    catch (e) { lastErr = e; if (i < attempts - 1) await new Promise(r => setTimeout(r, 600 * 2 ** i)); }
  }
  throw lastErr;
}

// 下載單檔（韌性版）：
//  - Range 續傳：dest.part 存在則帶 Range 接著抓（206 續寫、200 重來、416 棄 part）；
//    成功才 rename 成 dest，中斷/取消都保留 .part 供下次（含下次啟動）續傳
//  - 自動重試：網路類失敗指數退避（最多 DL_RETRY_MAX 次）；4xx（除 429/416）不重試
//  - 吞吐 watchdog：完全無進度 DL_STALL_MS → 砍線重試；「慢而活」不再砍線
//    （只有低到 DL_SLOW_BPS 且持續兩個窗口才視為掉速換線），並且會用
//    onProgress 回報慢速旗標讓 UI 顯示提示——使用者可能只有 2G/熱點速度，
//    砍掉重試只會讓進度倒退（每輪都要重新暖線）。
const DL_RETRY_MAX = 5;
const DL_STALL_MS = 25000;      // 完全無位元組才判死（慢網的 TCP 停滯容忍久一點）
const DL_SLOW_SPAN_MS = 60000;  // 速度採樣窗（拉長，避免短暫壅塞誤判）
const DL_SLOW_BPS = 4 * 1024;   // 均速低於 4KB/s 持續兩個窗口 → 才換線重試
const DL_SLOW_HINT_BPS = 150 * 1024;  // 低於此值 → UI 顯示「網路較慢」提示（不砍線）
function downloadFile(url, dest, onProgress, ctl) {
  return new Promise((resolve, reject) => {
    let settled = false, cancelled = false, attempt = 0, active = null, retryScheduled = false;
    const finish = (fn) => (...a) => {
      if (settled) return;
      settled = true;
      if (ctl) ctl.cancel = null;
      fn(...a);
    };
    const ok = finish(resolve), fail = finish(reject);
    const partPath = dest + '.part';
    const backoff = (n) => Math.min(15000, 800 * 2 ** (n - 1));

    const retryableFail = (err, retriable) => {
      if (cancelled) return fail(new Error('cancelled'));
      if (!retriable || attempt >= DL_RETRY_MAX) return fail(err);
      if (retryScheduled) return;
      retryScheduled = true;
      setTimeout(() => {
        retryScheduled = false;
        if (!settled && !cancelled) tryOnce();
      }, backoff(attempt));
    };

    const tryOnce = () => {
      attempt++;
      let startOffset = 0;
      try { startOffset = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0; } catch {}
      const headers = assetHeaders();
      if (startOffset > 0) headers.Range = `bytes=${startOffset}-`;
      let ws = null, watchdog = null;
      let received = 0;                 // 本次連線接收量
      let lastCur = startOffset, lastCurT = Date.now();
      let winT = Date.now(), winB = startOffset;

      const clearWatch = () => { if (watchdog) { clearInterval(watchdog); watchdog = null; } };
      const abort = (err, retriable) => {
        clearWatch();
        try { if (ws) ws.destroy(); } catch {}
        try { if (active) active.destroy(); } catch {}
        retryableFail(err, retriable);
      };

      const doRequest = (u) => {
        const mod = u.startsWith('https') ? https : require('http');
        const req = mod.get(u, { headers }, (r2) => {
          if (r2.statusCode >= 300 && r2.statusCode < 400 && r2.headers.location) {
            r2.resume();
            return doRequest(r2.headers.location);
          }
          if (r2.statusCode === 416 && startOffset > 0) {
            // .part 已達全長（上次中斷在收尾）→ 棄 part 從頭抓
            try { fs.rmSync(partPath, { force: true }); } catch {}
            delete headers.Range;
            startOffset = 0;
            r2.resume();
            return doRequest(u);
          }
          const resumeOK = startOffset > 0 && r2.statusCode === 206;
          if (!resumeOK && r2.statusCode !== 200) {
            r2.resume();
            return abort(new Error(`HTTP ${r2.statusCode} for ${u}`),
              r2.statusCode >= 500 || r2.statusCode === 429);
          }
          if (startOffset > 0 && r2.statusCode === 200) startOffset = 0; // 不支援續傳 → 重來
          let total = startOffset + parseInt(r2.headers['content-length'] || '0', 10);
          const cr = /\/(\d+)$/.exec(r2.headers['content-range'] || '');
          if (cr) total = parseInt(cr[1], 10);

          ws = fs.createWriteStream(partPath, { flags: resumeOK ? 'a' : 'w' });
          lastCur = startOffset; lastCurT = Date.now();
          winT = Date.now(); winB = startOffset;
          if (onProgress) onProgress(startOffset, total);
          r2.on('data', (chunk) => {
            received += chunk.length;
            if (onProgress) onProgress(startOffset + received, total);
          });
          r2.on('error', (e) => abort(e, true));
          r2.pipe(ws);
          ws.on('finish', () => {
            clearWatch();
            try { fs.renameSync(partPath, dest); } catch (e) { return fail(e); }
            if (onProgress && total) onProgress(total, total);
            ok({ size: total });
          });
          ws.on('error', (e) => abort(e, true));

          let slowWindows = 0;
          watchdog = setInterval(() => {
            const cur = startOffset + received;
            const now = Date.now();
            if (cur !== lastCur) { lastCur = cur; lastCurT = now; }
            else if (now - lastCurT > DL_STALL_MS) return abort(new Error(`stall ${DL_STALL_MS / 1000}s`), true);
            if (now - winT >= DL_SLOW_SPAN_MS) {
              const bps = (cur - winB) / ((now - winT) / 1000);
              // UI 提示（不砍線）：讓慢網使用者知道有在動、只是慢
              try { onProgress && onProgress(cur, total, { bps, slow: bps < DL_SLOW_HINT_BPS }); } catch {}
              if (bps < DL_SLOW_BPS) {
                slowWindows++;
                // 連續兩個窗口都低於 4KB/s → 視為掉速，換一條線續傳（.part 不丟）
                if (slowWindows >= 2) return abort(new Error(`slow ${Math.round(bps / 1024)}KB/s`), true);
              } else {
                slowWindows = 0;
              }
              winT = now; winB = cur;
            }
          }, 1000);
        });
        active = req;
        req.on('error', (e) => { if (!cancelled) abort(e, true); });
        // socket 層後備：完全靜默也會觸發
        req.setTimeout(DL_STALL_MS + 5000, () => abort(new Error('socket idle'), true));
      };
      doRequest(url);
    };

    if (ctl) {
      ctl.cancel = () => {
        cancelled = true;
        try { if (active) active.destroy(); } catch {}
        if (!settled) fail(new Error('cancelled'));
      };
    }
    tryOnce();
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

ipcMain.handle('check-assets', async (event, { voice, audioFmt } = {}) => {
  const localVersion = readLocalVersion();
  const installed = readInstalled();
  const assetsDir = getAssetsDir();
  const hasAssets = fs.existsSync(assetsDir) && fs.existsSync(path.join(assetsDir, 'spine'));

  let remoteVersion = null;
  try {
    remoteVersion = await fetchJSONRetry(ASSETS_VERSION_URL);
  } catch (e) {
    console.warn('[assets] 無法取得遠端版本:', e.message);
  }
  // companion manifest（voice-m4a 分流 release，tag=主版號+-m4a；
// GitHub 單 release 硬上限 1000 assets 故分流）。404/失敗容忍→退回純 ogg
  //（audioPackFor 只在 manifest 有對端時才改取 m4a；下次啟動重試）。
  if (remoteVersion?.version) {
    try {
      const m4aMeta = await fetchJSONRetry(
        `${ASSETS_WORKER_BASE}/v${remoteVersion.version}-m4a/assets_version_m4a.json`);
      if (m4aMeta?.packages) {
        remoteVersion.packages = { ...remoteVersion.packages, ...m4aMeta.packages };
      }
    } catch (e) {
      console.warn('[assets] companion manifest 不可用，m4a 包暫時缺席:', e.message);
    }
  }

  // 計算需要下載的包：sha 比對（schema 無關；舊版 schema-1 整版回退已刪除，
  // 逐包 sha 在 schema 2 下恒成立）。dev 模式（直接跑 repo）：assets/ 已在本地，
  // installed.json 只是下載器記帳，不該讓它反過來把整個 assets 判成未安裝。
  // 此時僅提示有新版本、不強制下載。
  // needsDownloadPacks = 全部缺包（設定頁「預先下載全部」用）；
  // bootPacks = 其中擋開機的 core/intro（開機只等它）。
  let needsDownloadPacks = [];
  let bootPacks = [];
  const devAssets = isDev && hasAssets;
  if (remoteVersion?.packages && !devAssets) {
    const allMissing = Object.keys(remoteVersion.packages)
      .filter(k => installed[k] !== remoteVersion.packages[k].sha256);
    needsDownloadPacks = selectPacks(allMissing,
      { voice, audioFmt, packages: remoteVersion.packages });
    // 開機只擋 core/meta；intro 改背景補齊（app.js ensureReady 對應），
    // 慢網進場少等 5.5MB
    bootPacks = needsDownloadPacks.filter(k => k === 'core' || k === 'meta');
  }

  return {
    localVersion,
    hasAssets,
    remoteVersion: remoteVersion?.version || null,
    schema: remoteVersion?.schema || 1,
    // dev 模式本地資源已齊，永不阻擋進入
    needsDownload: devAssets ? false : (needsDownloadPacks.length > 0 || !hasAssets),
    needsDownloadPacks: devAssets ? [] : needsDownloadPacks,
    bootPacks: devAssets ? [] : bootPacks,
    needsBootDownload: devAssets ? false : (bootPacks.length > 0 || !hasAssets),
    packages: remoteVersion?.packages || null,
    lobbies: remoteVersion?.lobbies || null,
    installed,
  };
});

// 設定頁暫停鈕用（download-assets 迴圈內檢查；進行中的包經 ctl abort）
const dlCancel = { cancelled: false, cancel: null };
ipcMain.handle('cancel-download-assets', async () => {
  dlCancel.cancelled = true;
  try { dlCancel.cancel?.(); } catch {}
  return true;
});

// IPC 契約斷言：呼叫端欄位缺失直接 fail-loud（別等到下載 404／靜默 no-op
// 才發現傳錯；invoke 端會收到 reject）。
function assertIpc(cond, what) {
  if (!cond) throw new Error(`bad IPC payload: ${what}`);
}

// 下載管線序列化＋同 key 去重：桌布模式下主視窗和 worker 視窗是兩個 renderer，
// 開機同時 checkAssets → download-assets，兩邊併發寫同一個 .dl/<tar>.part——
// 先完成者 rename 成功、後者 rename ENOENT（0.5.0 桌面模式實測 meta/core 全炸）。
// 同 key 直接共用同一個 promise（另一個視窗等同一份結果）；不同 key 排隊，
// 避免 .dl 目錄清理 / 續傳檔互踩。
let dlTail = Promise.resolve();
const dlInflight = new Map();
function serializeDownload(key, fn) {
  if (dlInflight.has(key)) return dlInflight.get(key);
  const run = dlTail.then(fn, fn);
  dlTail = run.then(() => {}, () => {});
  const p = run.finally(() => dlInflight.delete(key));
  dlInflight.set(key, p);
  return p;
}

ipcMain.handle('download-assets', async (event, opts) => {
  const { version, packages, onlyPacks, voice, audioFmt, requireMissing } = opts || {};
  assertIpc(typeof version === 'string' && version && packages && typeof packages === 'object',
    'download-assets needs {version, packages}');
  const key = ['dl', version, voice || '', audioFmt || '', requireMissing ? 'req' : 'any',
    onlyPacks ? [...onlyPacks].sort().join(',') : '*'].join('|');
  return serializeDownload(key, () => runDownloadAssets(opts));
});

async function runDownloadAssets({ version, packages, onlyPacks, voice, audioFmt, requireMissing }) {
  const assetsDir = getAssetsDir();
  const installed = readInstalled();
  const remotePackages = packages || {};
  // 設定頁暫停鈕用：包之間檢查旗標，進行中的包經 ctl abort
  dlCancel.cancelled = false;
  dlCancel.cancel = null;
  // 僅下載需要的包（增量）：sha 不同的才下；若呼叫端指定 onlyPacks 則限於該清單
  let pkgNames;
  if (onlyPacks && Array.isArray(onlyPacks)) {
    const mapped = selectPacks(onlyPacks, { voice, audioFmt, packages: remotePackages });
    pkgNames = mapped.filter(k => installed[k] !== remotePackages[k].sha256);
    // 串流：即使 sha 相同但本地檔案遺失也補下。requireMissing=true 時嚴格照 sha
    // （供「intro 背景補齊」用——否則每次啟動都會重抓一遍）
    if (pkgNames.length === 0 && !requireMissing) pkgNames = mapped;
  } else {
    pkgNames = selectPacks(
      Object.keys(remotePackages).filter(k => installed[k] !== remotePackages[k].sha256),
      { voice, audioFmt, packages: remotePackages });
  }
  if (pkgNames.length === 0) {
    try { fs.writeFileSync(getAssetsVersionPath(), version); } catch {}
    return [];
  }
  // .part 續傳檔需跨啟動存活 → 放 assets 目錄下固定位置（舊的 os.tmpdir 隨機
  // 目錄在 handler 結束時整個刪除，續傳無從接起）
  const tmpDir = path.join(assetsDir, '.dl');
  fs.mkdirSync(tmpDir, { recursive: true });
  // 清掉舊版本的殘留 part（同版本不同流程並行時名稱不同，不會互刪）
  try {
    const curSuffix = `-v${version}.tar.gz.part`;
    for (const f of fs.readdirSync(tmpDir)) {
      if (!f.endsWith('.part') || f.endsWith(curSuffix)) continue;
      fs.rmSync(path.join(tmpDir, f), { force: true });
    }
  } catch {}
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
      const url = `${ASSETS_PACKAGES_URL}/${packTagFor(name, version)}/${tarName}`;
      await downloadFile(url, tarPath, (dl, total, extra) => {
        // extra: { bps, slow }（watchdog 每分鐘回報一次；慢網提示用）
        sendProgress({ status: 'downloading', percent: total ? Math.round(dl * 100 / total) : 0, downloaded: dl, bytesTotal: total, ...(extra || {}) });
      }, dlCancel);
      await verifyPackFile(tarPath, pkg, name);
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
  // 還有 .part（未完成的下載）就留著目錄供下次續傳；清空了才整個移除
  try {
    const leftover = fs.existsSync(tmpDir) && fs.readdirSync(tmpDir).some(f => f.endsWith('.part'));
    if (!leftover) fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
  return results;
}

// 按需補齊：確保某個 lobby 的資源已就緒（core + 該 lobby 需要的包）
ipcMain.handle('ensure-lobby', async (event, opts) => {
  const { lobby, packages, version, voice, audioFmt } = opts || {};
  assertIpc(typeof lobby === 'string' && lobby && packages && typeof packages === 'object',
    'ensure-lobby needs {lobby, packages}');
  const key = ['el', lobby, version || '', voice || '', audioFmt || ''].join('|');
  return serializeDownload(key, () => runEnsureLobby(opts));
});

async function runEnsureLobby({ lobby, version, packages, lobbies, voice, audioFmt }) {
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
  // 該 lobby 需要的包：語言＋格式一次選定（selectPacks），非語音包全留。
  packs = selectPacks(packs, { voice, audioFmt, packages });
  // core 必須先有
  if (packages?.['core'] && installed['core'] !== packages['core'].sha256) packs.unshift('core');
  const missing = packs.filter(k => installed[k] !== packages[k]?.sha256);
  // 額外檢查：即使 sha 相同但實體檔案被刪也要補。以前只認 lobby/voice 代表路徑，
  // core/meta/intro 被刪掉永遠不會重抓（sha 沒變 → 永遠 cached）。
  const actuallyMissing = missing.length ? missing
    : packs.filter(k => packages[k] && !packLooksPresent(k));
  if (actuallyMissing.length === 0) return { ok: true, cached: true };
  // 下載指定 packs
  // .part 續傳檔需跨啟動存活 → 放 assets 目錄下固定位置（舊的 os.tmpdir 隨機
  // 目錄在 handler 結束時整個刪除，續傳無從接起）
  const tmpDir = path.join(assetsDir, '.dl');
  fs.mkdirSync(tmpDir, { recursive: true });
  // 清掉舊版本的殘留 part（同版本不同流程並行時名稱不同，不會互刪）
  try {
    const curSuffix = `-v${version}.tar.gz.part`;
    for (const f of fs.readdirSync(tmpDir)) {
      if (!f.endsWith('.part') || f.endsWith(curSuffix)) continue;
      fs.rmSync(path.join(tmpDir, f), { force: true });
    }
  } catch {}
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
      const url = `${ASSETS_PACKAGES_URL}/${packTagFor(name, version)}/${tarName}`;
      await downloadFile(url, tarPath, (dl, total, extra) => {
        sendProgress({ status: 'downloading', percent: total ? Math.round(dl * 100 / total) : 0, downloaded: dl, bytesTotal: total, ...(extra || {}) });
      });
      await verifyPackFile(tarPath, pkg, name);
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
  // 還有 .part（未完成的下載）就留著目錄供下次續傳；清空了才整個移除
  try {
    const leftover = fs.existsSync(tmpDir) && fs.readdirSync(tmpDir).some(f => f.endsWith('.part'));
    if (!leftover) fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
  const failed = results.filter(r => !r.ok);
  return failed.length ? { ok: false, results } : { ok: true, results };
}

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
  if (key === 'core') return ['students', 'ui', 'loading', 'fonts', 'voice_title'].map(s => path.join(assetsDir, s));
  if (key === 'meta') return [path.join(assetsDir, 'data')];
  if (key === 'intro') return [path.join(assetsDir, 'intro')];
  if (key === 'assets-player') {
    // 與 build_assets.py 的 assets-player 清單一致；刪除時會被 core 的共用宣告擋下
    return ['bgm', 'students', 'loading', 'ui', 'fonts', 'clickfx'].map(s => path.join(assetsDir, s));
  }
  if (key.startsWith('lobby/')) {
    const nm = key.slice('lobby/'.length);
    return [
      path.join(assetsDir, 'spine', nm),
      path.join(assetsDir, 'scene', nm),
      path.join(assetsDir, 'particles', nm),
    ];
  }
  if (key.startsWith('voice/')) return [path.join(assetsDir, 'voice', key.slice('voice/'.length))];
  if (key.startsWith('voice-m4a/')) return [path.join(assetsDir, 'voice', key.slice('voice-m4a/'.length))];
  return [];
}

// 這個 pack 的關鍵路徑是否還在（sha 沒變但檔案被手動刪掉時用來觸發重抓）。
// lobby 包不檢查 scene/particles：這兩者本來就只存在於部分大廳。
function packLooksPresent(key) {
  const assetsDir = getAssetsDir();
  const exists = (rel) => fs.existsSync(path.join(assetsDir, rel));
  if (key === 'core') return ['students', 'ui', 'loading', 'fonts'].every(exists);
  if (key === 'meta') return exists(path.join('data', 'lobby_index.json'));
  if (key === 'intro') return exists('intro');
  if (key === 'assets-player') return exists('bgm');
  if (key.startsWith('lobby/')) return exists(path.join('spine', key.slice('lobby/'.length)));
  if (key.startsWith('voice/')) return exists(path.join('voice', key.slice('voice/'.length)));
  if (key.startsWith('voice-m4a/')) return exists(path.join('voice', key.slice('voice-m4a/'.length)));
  return true;
}

// 音訊格式分包：voice/<F>（ogg）與 voice-m4a/<F>（m4a）同目錄成對。
// 瀏覽器按能力只取其一；m4a 端須在 manifest 存在才切換（過渡期舊包自動退回 ogg）。
function audioPackFor(key, fmt, packages) {
  if (fmt !== 'm4a' || typeof key !== 'string' || !key.startsWith('voice/')) return key;
  const alt = 'voice-m4a/' + key.slice('voice/'.length);
  if (packages && packages[alt]) return alt;
  return key;
}
// 語音語言過濾（jp/kr）同時認 voice/ 與 voice-m4a/ 前綴
function voiceLangKeep(key, wantKr) {
  const f = key.startsWith('voice-m4a/') ? key.slice('voice-m4a/'.length)
    : key.startsWith('voice/') ? key.slice('voice/'.length) : null;
  if (f === null) return true;
  return wantKr ? f.startsWith('KR_') : f.startsWith('JP_');
}
// 唯一選包入口：語言＋格式過濾（ogg key 有 m4a 對端即改取 m4a），去重保序，
// 只留 manifest 有的 key。check/download/ensure 三處共用。
// 注意：本檔案是 CJS 且正式版不帶 renderer/ 源碼，故此三函數是
// renderer/asset-core.js 的逐字鏡像；scripts/check_asset_core_parity.py
// 會在 CI 比對，改一邊必須改另一邊。
function selectPacks(names, { voice, audioFmt, packages }) {
  const wantKr = voice === 'kr';
  const fmt = audioFmt === 'm4a' ? 'm4a' : 'ogg';
  const pkgs = packages || {};
  const out = [];
  for (const k of names || []) {
    if (!voiceLangKeep(k, wantKr)) continue;
    const m = audioPackFor(k, fmt, pkgs);
    if (pkgs[m] && !out.includes(m)) out.push(m);
  }
  return out;
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
  // 孤兒計數：設定頁 >0 才顯示「清除」列（先前固定 0 → 按鈕永遠看不到，
  // 但清理功能其實可以做）。
  let orphans = 0;
  try { orphans = orphanDirs(installed).length; } catch {}
  return { version: localVersion, packs, totalSize: total, orphans };
});

// 路徑必須真的位於 base 之下（防 ../ 逃逸；同時擋掉 base 前綴相近的假路徑）
function pathInside(base, p) {
  const b = path.resolve(base);
  const q = path.resolve(p);
  return q === b || q.startsWith(b + path.sep);
}

// 每個磁碟路徑被哪些「已安裝」pack 宣告 → 刪除時用來保護共用目錄。
// assets-player 與 core 都含 students/ui/loading/fonts，沒有這層保護時
// 刪掉 assets-player 會把 core 的 UI 一起砍掉，畫面直接壞掉。
function packClaims(installed) {
  const map = new Map();
  for (const key of Object.keys(installed)) {
    for (const p of packPaths(key)) {
      const q = path.resolve(p);
      if (!map.has(q)) map.set(q, new Set());
      map.get(q).add(key);
    }
  }
  return map;
}

ipcMain.handle('assets-verify', async () => {
  const installed = readInstalled();
  const broken = {};
  // 逐包檢查關鍵路徑（含 core/meta/intro——以前跳過，刪掉也偵測不到）
  for (const key of Object.keys(installed)) {
    if (!packLooksPresent(key)) broken[key] = 1;
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

// 孤兒目錄＝spine/scene/particles/voice 底下沒有任何已安裝 pack 宣告的目錄。
// 必須有真正的安裝狀態（installed.core）才算，否則 dev 模式或半殘狀態下
// assets/ 可能有手動放入的檔案，會被誤認孤兒。
function orphanDirs(installed) {
  if (!Object.prototype.hasOwnProperty.call(installed, 'core')) return [];
  const assetsDir = getAssetsDir();
  const claimed = new Set(packClaims(installed).keys());
  const out = [];
  for (const group of ['spine', 'scene', 'particles', 'voice']) {
    const dir = path.join(assetsDir, group);
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name.startsWith('_') || ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      if (!claimed.has(path.resolve(full))) out.push(full);
    }
  }
  return out;
}

ipcMain.handle('assets-clean-orphans', async () => {
  const installed = readInstalled();
  if (!Object.prototype.hasOwnProperty.call(installed, 'core')) {
    return { removed: 0, skipped: 'not_installed' };
  }
  const removed = [];
  for (const full of orphanDirs(installed)) {
    try {
      fs.rmSync(full, { recursive: true, force: true });
      removed.push(path.relative(getAssetsDir(), full));
    } catch (e) {
      console.warn('[assets] 孤兒清理失敗:', full, e.message);
    }
  }
  return { removed: removed.length, paths: removed };
});

ipcMain.handle('assets-manage-delete', async (event, keys) => {
  const list = Array.isArray(keys) ? keys : [keys];
  const installed = readInstalled();
  const claims = packClaims(installed);
  const removed = [], errors = [];
  for (const key of list) {
    if (key === 'core') { errors.push({ key, error: 'protect_core' }); continue; }
    // 安全檢查：只允許刪除已知 pack 對應的目錄，防止任意路徑注入
    const paths = packPaths(key);
    if (!paths.length || !Object.prototype.hasOwnProperty.call(installed, key)) {
      errors.push({ key, error: 'unknown_pack' }); continue;
    }
    try {
      for (const p of paths) {
        // 必須位於 assetsDir 之下才可刪
        if (!pathInside(getAssetsDir(), p)) continue;
        // 其他已安裝 pack 也宣告這個路徑 → 共用，保留
        const owners = [...(claims.get(path.resolve(p)) || [])]
          .filter(o => o !== key && Object.prototype.hasOwnProperty.call(installed, o));
        if (owners.length) continue;
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
  if (!gotTheLock) return;
  // Register app:// protocol for serving assets in production
  if (!isDev) {
    protocol.handle('app', async (request) => {
      // 頁面是 file://（origin "null"），fetch() 屬跨來源 → 回應需帶 CORS 標頭
      const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      };
      const notFound = (rel) => new Response(`app:// not found: ${rel}`, {
        status: 404, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' },
      });
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      const url = new URL(request.url);
      // app://assets/X → '/X'（'assets' 是 host）。decodeURIComponent 會拋在
      // 非法 % 序列，且解碼後的 ../ 必須再擋一次，否則可讀出 assets 目錄外檔案。
      let rel;
      try { rel = decodeURIComponent(url.pathname); }
      catch { return notFound(url.pathname); }
      if (rel.includes('\0')) return notFound(rel);
      const resolveIn = (base) => {
        const b = path.resolve(base);
        const p = path.resolve(path.join(b, rel));
        return (p === b || p.startsWith(b + path.sep)) ? p : null;
      };
      // ①userData/assets（執行期 Worker 下載的遊戲資產）優先
      const userP = resolveIn(getAssetsDir());
      // ②退回安裝內建（package.json files 打包的啟動資源：loading/ui/clickfx/bgm）
      //   ——pack 尚未下載完或離線時，開場畫面與原版 ClickFX 貼圖也要能用
      const bundledP = resolveIn(path.join(__dirname, 'assets'));
      const isFile = (p) => p && fs.existsSync(p) && fs.statSync(p).isFile();
      const target = isFile(userP) ? userP : (isFile(bundledP) ? bundledP : null);
      if (!target) return notFound(rel);
      try {
        const resp = await net.fetch(pathToFileURL(target).href);
        const headers = new Headers(resp.headers);
        for (const [k, v] of Object.entries(cors)) headers.set(k, v);
        return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
      } catch {
        return notFound(rel);
      }
    });
  }

  if (isDev) {
    try {
      await startVite();
    } catch (e) {
      console.error('無法啟動 Vite dev server:', e.message);
    }
    startViteWatchdog();   // dev server 死掉自動重啟（見 startViteWatchdog）
  }
  createWindow();
  try { createTray({ showPlayer, onOpenWallpaperSettings: openWallpaperSettings }); } catch (e) { console.error('[tray] init failed:', e.message); }
  // renderer 選的 UI 語言（localStorage，主程序讀不到）→ 系統匣/桌面通知用；
  // OS 語言常與 app 語言不同（ja/ko 使用者以前只見英文、zh-CN 見繁中）。
  ipcMain.handle('set-ui-lang', (event, tag) => {
    const lang = setUiLang(tag);
    try { refreshTray({ showPlayer, onOpenWallpaperSettings: openWallpaperSettings }); } catch {}
    return lang;
  });
  // 桌布只在明確要求時啟動：--wallpaper CLI（登入自啟的 .desktop 會帶）或
  // BA_WALLPAPER=1。一般啟動不再自動恢復上次的桌布設定——使用者沒按就別蓋桌面。
  const wantWallpaper = process.argv.includes('--wallpaper') || process.env.BA_WALLPAPER === '1';
  try {
    if (wantWallpaper) wallpaper.start();
    // mac 登入啟動：login item 帶不了 args（LSSharedFileList）→ 以
    // wasOpenedAtLogin + config.launchAtLogin 判定是否直接進桌布
    if (process.platform === 'darwin') {
      try { wallpaper.maybeLoginAutostart(); } catch {}
    }
  } catch (e) { console.error('[wallpaper] start failed:', e.message); }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => {
  // 桌布運行中時 worker 視窗還在，本事件不會觸發；真正全部關閉＝桌布已停 → 照舊退出
  if (wallpaper.isActive()) return;
  if (vite) vite.kill();
  if (process.platform !== 'darwin') app.quit();
});
