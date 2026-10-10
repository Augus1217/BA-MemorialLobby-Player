// wallpaper.js — BA Memorial Lobby 桌布模式主程序模組（ba-wallpaper-mode 計畫 W1/W2）
// 職責：每螢幕 worker 視窗（mac/linux type:'desktop'；win 由 W4 koffi 接 WorkerW）、
//       watchdog（心跳/render-process-gone 自癒）、游標轉發（Linux 無 forward → main 輪詢）、
//       全螢幕暫停（X11 xprop 查 _NET_WM_STATE；Win=W4）、電池降 fps、三平台開機自啟。
// 設定持久化：userData/wallpaper.json；renderer 端只讀 config（wallpaperConfig IPC）。
'use strict';
const { app, BrowserWindow, ipcMain, screen, powerMonitor, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const DEV_URL = 'http://127.0.0.1:5173';
const isDev = !app.isPackaged;
// setIgnoreMouseEvents forward 只有 Win/mac 支援；Linux 靠 main 端游標輪詢補眼球跟隨
const FORWARD_OK = process.platform === 'win32' || process.platform === 'darwin';
// 測試/除錯旋鈕：BA_WALLPAPER_TYPE=normal → 以一般視窗代理桌布（不動真桌面）
const TYPE_OVERRIDE = process.env.BA_WALLPAPER_TYPE || null;
// Windows WorkerW 掛載（koffi）——只在 win32 惰性載入，載入失敗 = 降級成全螢幕窗
let _winMod;
function winMount() {
  if (process.platform !== 'win32') return null;
  if (_winMod !== undefined) return _winMod;
  try { _winMod = require('./wallpaper-win'); }
  catch (e) { console.error('[wallpaper] wallpaper-win load failed:', e.message); _winMod = null; }
  return _winMod;
}

const DEFAULT_CFG = {
  enabled: false,       // 期望狀態：app 啟動時（packaged）自動恢復桌布
  fps: 30,              // 桌布預設 30（計畫裁定；電池再 −15）
  lobby: '',            // 空 = 跟隨播放器記憶（renderer localStorage ba_lastLobby）
  perScreen: {},        // { "1": "LobbyName" } display index → lobby（v1 可手編 json）
  sound: false,         // 桌布 BGM 預設關（常駐桌面不該出聲；設定可開）
  interact: false,      // true = 桌布可點擊（摸頭/說話）；false = 滑鼠穿透
  pauseFullscreen: true,// 偵測到全螢幕前景 → 暫停渲染＋靜音
  pauseBattery: true,   // 電池供電 → fps −15
};

let config = null;
let active = false;
let paused = false;
let lastFsState = false;
let powerBound = false;
const workers = new Map();   // display.id → worker record
const wcIndex = new Map();   // webContents.id → worker record
const stateCbs = [];
let cursorTimer = null, fsTimer = null, watchdogTimer = null, displayDebounce = null, winHealthTimer = null;

// ---------------------------------------------------------------------------
// config 持久化
// ---------------------------------------------------------------------------
function configPath() {
  try { return path.join(app.getPath('userData'), 'wallpaper.json'); }
  catch { return path.join(os.tmpdir(), 'ba-wallpaper.json'); }
}
function loadConfig() {
  if (config) return config;
  try { config = { ...DEFAULT_CFG, ...JSON.parse(fs.readFileSync(configPath(), 'utf-8')) }; }
  catch { config = { ...DEFAULT_CFG }; }
  return config;
}
function saveConfig() {
  try { fs.mkdirSync(path.dirname(configPath()), { recursive: true }); fs.writeFileSync(configPath(), JSON.stringify(config, null, 2)); }
  catch (e) { console.error('[wallpaper] saveConfig failed:', e.message); }
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------
function safeSend(w, ch, v) {
  try { if (w.win && !w.win.isDestroyed()) w.win.webContents.send(ch, v); } catch {}
}
function notify(title, body) {
  console.log('[wallpaper]', title, body || '');
  try { if (Notification.isSupported()) new Notification({ title, body: body || '', silent: true }).show(); }
  catch {}
}
function onState(cb) { stateCbs.push(cb); }
function broadcastState() {
  const s = status();
  for (const cb of stateCbs) { try { cb(s); } catch {} }
  for (const win of BrowserWindow.getAllWindows()) {
    try { win.webContents.send('wallpaper-state', s); } catch {}
  }
}
function prodHtmlPath() {
  const p = path.join(__dirname, 'index.prod.html');
  return fs.existsSync(p) ? p : path.join(__dirname, 'dist', 'index.html');
}

// ---------------------------------------------------------------------------
// worker 視窗
// ---------------------------------------------------------------------------
function createWorker(display, index) {
  const cfg = loadConfig();
  const lobby = (cfg.perScreen && cfg.perScreen[String(index)]) || cfg.lobby || '';
  const hash = `wallpaper=1&autostart=1${lobby ? '&lobby=' + encodeURIComponent(lobby) : ''}`;
  const isWin = process.platform === 'win32';
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    // Windows：W4 用 koffi SetParent 掛 WorkerW，一般 frameless 視窗即可；
    // mac/linux：type:'desktop' 原生桌面層（mac=kCGDesktopWindowLevel-1、linux=_NET_WM_WINDOW_TYPE_DESKTOP）
    type: TYPE_OVERRIDE || (isWin ? 'normal' : 'desktop'),
    frame: false,
    focusable: false,     // 桌布不搶焦點（滑鼠事件仍可收）
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    enableLargerThanScreen: false,
    backgroundColor: '#1f1825',
    show: false,          // renderer 資產就緒（stage=ready）才顯示，免開機閃屏
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      backgroundThrottling: false,  // 桌面層視窗常被視為 occluded，rAF 節流會凍結動畫
    },
  });
  const rec = {
    win, display, index,
    ready: false, lastBeat: 0, created: Date.now(),
    reloads: 0, reloading: false, bootStage: 'new',
  };
  workers.set(display.id, rec);
  wcIndex.set(win.webContents.id, rec);

  win.webContents.on('console-message', (_e, _level, message) => {
    if (isDev) console.log('[wallpaper]', message);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (isMain) console.error('[wallpaper] did-fail-load', code, desc, url);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return;
    console.error('[wallpaper] worker gone:', details.reason, details.exitCode);
    rec.reloads++;
    if (rec.reloads <= 5) setTimeout(() => reloadWorker(rec), 2000);
    else failWorker(rec, `renderer gone (${details.reason})`);
  });
  win.on('closed', () => {
    wcIndex.delete(win.webContents.id);
    if (workers.get(display.id) === rec) workers.delete(display.id);
  });

  win.once('ready-to-show', () => {
    try {
      if (win.isDestroyed()) return;
      applyIgnoreMouse(rec);
      // Windows：掛進 WorkerW（桌面層）；失敗 = 降級為 frameless 全螢幕窗＋通知
      if (process.platform === 'win32') {
        const m = winMount();
        if (m) {
          const r = m.attachWorker(win, display);
          rec.winHost = r.ok ? r.host : null;
          if (!r.ok) notify('BA Memorial Lobby', `桌布掛載失敗：${r.reason}`);
        }
      }
      // 代理測試模式（BA_WALLPAPER_TYPE=normal）即時顯示；真桌布等 stage=ready
      if (TYPE_OVERRIDE) win.show();
    } catch {}
  });

  if (isDev) {
    win.loadURL(DEV_URL + '#' + hash).catch((e) => console.error('[wallpaper] loadURL failed:', e.message));
  } else {
    win.loadFile(prodHtmlPath(), { hash }).catch((e) => console.error('[wallpaper] loadFile failed:', e.message));
  }
  return rec;
}

function applyIgnoreMouse(rec) {
  const ignore = !loadConfig().interact;
  try { rec.win.setIgnoreMouseEvents(ignore, { forward: ignore && FORWARD_OK }); } catch {}
}

function createWorkers() {
  const displays = screen.getAllDisplays();
  displays.forEach((d, i) => createWorker(d, i));
}
function destroyWorkers() {
  for (const w of [...workers.values()]) {
    // Windows：先從 WorkerW 卸下再銷毀（SetParent(NULL)）
    if (process.platform === 'win32') { try { winMount()?.detachWorker(w.win); } catch {} }
    try { w.win.destroy(); } catch {}
  }
  workers.clear();
  wcIndex.clear();
}
function restartWorkers() {
  if (!active) return;
  destroyWorkers();
  createWorkers();
}

// ---------------------------------------------------------------------------
// watchdog：心跳（renderer 每 2s）＋ boot 逾時＋崩潰自癒
// ---------------------------------------------------------------------------
function watchdogTick() {
  if (!active) return;
  const now = Date.now();
  for (const w of [...workers.values()]) {
    if (!w.win || w.win.isDestroyed()) continue;
    if (w.reloading) continue;
    if (!w.ready) {
      // boot 長（首訪串流下載 lobby pack 可達分鐘級）→ 10 分鐘才判死，只重試一次
      if (now - w.created > 10 * 60000 && w.reloads < 1) reloadWorker(w);
      else if (now - w.created > 20 * 60000) failWorker(w, 'boot timeout');
      continue;
    }
    if (w.lastBeat && now - w.lastBeat > 20000) {
      w.reloads++;
      if (w.reloads <= 3) reloadWorker(w);
      else failWorker(w, 'heartbeat lost');
    }
  }
}
function reloadWorker(w) {
  w.reloading = true;
  w.ready = false;
  w.lastBeat = 0;
  w.bootStage = 'reload';
  try { w.win.webContents.reload(); } catch {}
  // 心跳恢復時清除 reloading（見 heartbeat handler）；逾時保險
  setTimeout(() => { w.reloading = false; }, 30000);
}
function failWorker(w, why) {
  console.error('[wallpaper] worker failed:', why, `(display ${w.index})`);
  try { w.win.destroy(); } catch {}
  workers.delete(w.display.id);
  wcIndex.delete(w.win.webContents.id);
  if (workers.size === 0 && active) {
    active = false;
    stopPollers();
    notify('BA Memorial Lobby', '桌布已停止（worker 無法啟動）');
    broadcastState();
  } else {
    notify('BA Memorial Lobby', `螢幕 ${w.index + 1} 的桌布已停止：${why}`);
  }
}

// ---------------------------------------------------------------------------
// 暫停策略：全螢幕前景偵測（linux=X11 xprop；win=W4；mac=v1 不做）
// ---------------------------------------------------------------------------
function fsCheck() {
  if (!active) return;
  if (!loadConfig().pauseFullscreen) {
    if (lastFsState) { lastFsState = false; setPaused(false); }
    return;
  }
  if (process.platform === 'linux') fsCheckLinux();
  else if (process.platform === 'win32') fsCheckWin(); // W4: koffi SHQueryUserNotificationState 2s 輪詢
}
function fsCheckLinux() {
  if (!process.env.DISPLAY) return;
  execFile('xprop', ['-root', '_NET_ACTIVE_WINDOW'], (err, out) => {
    if (err) return;
    const m = /window id # (0x[0-9a-f]+)/i.exec(String(out));
    if (!m) return;
    execFile('xprop', ['-id', m[1], '_NET_WM_STATE'], (err2, out2) => {
      if (err2) return;
      const fs = String(out2).includes('_NET_WM_STATE_FULLSCREEN');
      if (fs !== lastFsState) { lastFsState = fs; setPaused(fs); }
    });
  });
}
function fsCheckWin() {
  // W4：SHQueryUserNotificationState（全螢幕 app/D3D 獨占/簡報模式/鎖屏 → 暫停）
  const m = winMount();
  if (!m) return;
  const fs = !!m.isFullscreenFront();
  if (fs !== lastFsState) { lastFsState = fs; setPaused(fs); }
}
function setPaused(p) {
  p = !!p;
  if (p === paused) return;
  paused = p;
  console.log('[wallpaper] paused =', p);
  for (const w of [...workers.values()]) safeSend(w, 'wallpaper-pause', p);
}

// 電池：on-battery → fps −15（下限 10）
function applyBattery() {
  const cfg = loadConfig();
  const eff = (cfg.pauseBattery && powerMonitor.isOnBatteryPower)
    ? Math.max(10, cfg.fps - 15)
    : cfg.fps;
  for (const w of [...workers.values()]) safeSend(w, 'wallpaper-fps', eff);
}

// ---------------------------------------------------------------------------
// 游標轉發（Linux/無 forward 平台）：main 輪詢 getCursorScreenPoint → worker 本地座標
// ---------------------------------------------------------------------------
function sendCursor() {
  if (!active || FORWARD_OK || loadConfig().interact) return; // 可點擊模式 → DOM 原生事件
  let pt;
  try { pt = screen.getCursorScreenPoint(); } catch { return; }
  for (const w of [...workers.values()]) {
    if (!w.win || w.win.isDestroyed()) continue;
    const b = w.display.bounds;
    if (pt.x < b.x || pt.y < b.y || pt.x >= b.x + b.width || pt.y >= b.y + b.height) continue;
    safeSend(w, 'wallpaper-cursor', { x: Math.round(pt.x - b.x), y: Math.round(pt.y - b.y) });
  }
}

function startPollers() {
  stopPollers();
  cursorTimer = setInterval(sendCursor, 80);
  watchdogTimer = setInterval(watchdogTick, 5000);
  fsTimer = setInterval(fsCheck, 2000);
  // Windows：WorkerW 被系統回收/explorer 重啟 → 5s 健康巡檢重掛
  if (process.platform === 'win32') {
    winHealthTimer = setInterval(winHealthTick, 5000);
  }
  if (!powerBound) {
    powerBound = true;
    powerMonitor.on('on-battery', applyBattery);
    powerMonitor.on('on-ac', applyBattery);
  }
  applyBattery();
}
function winHealthTick() {
  if (!active) return;
  const m = winMount();
  if (!m) return;
  for (const w of [...workers.values()]) {
    if (!w.win || w.win.isDestroyed()) continue;
    try {
      if (m.healthCheck(w.win, w.display) === 'degraded') {
        w.winHost = null;
      }
    } catch {}
  }
}
function stopPollers() {
  if (cursorTimer) { clearInterval(cursorTimer); cursorTimer = null; }
  if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
  if (fsTimer) { clearInterval(fsTimer); fsTimer = null; }
  if (winHealthTimer) { clearInterval(winHealthTimer); winHealthTimer = null; }
}

// 多螢幕變動 → 重建（debounce）
function onDisplayChanged() {
  clearTimeout(displayDebounce);
  displayDebounce = setTimeout(() => { if (active) restartWorkers(); }, 1500);
}
function bindScreenEvents() {
  screen.on('display-added', onDisplayChanged);
  screen.on('display-removed', onDisplayChanged);
  screen.on('display-metrics-changed', onDisplayChanged);
}
function unbindScreenEvents() {
  try {
    screen.removeListener('display-added', onDisplayChanged);
    screen.removeListener('display-removed', onDisplayChanged);
    screen.removeListener('display-metrics-changed', onDisplayChanged);
  } catch {}
}

// ---------------------------------------------------------------------------
// 開機自啟（桌布）：win/mac=setLoginItemSettings；linux=XDG autostart .desktop
// ---------------------------------------------------------------------------
function autostartFile() {
  return path.join(os.homedir(), '.config', 'autostart', 'ba-memorial-lobby-wallpaper.desktop');
}
function getAutostart() {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    try { return app.getLoginItemSettings({ args: ['--wallpaper'] }).openAtLogin; } catch { return false; }
  }
  try { return fs.existsSync(autostartFile()); } catch { return false; }
}
function setAutostart(on) {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    try {
      app.setLoginItemSettings({ openAtLogin: !!on, openAsHidden: true, args: ['--wallpaper'] });
    } catch (e) { console.error('[wallpaper] setLoginItemSettings failed:', e.message); }
    return getAutostart();
  }
  const file = autostartFile();
  if (!on) { try { fs.unlinkSync(file); } catch {} return false; }
  // AppImage → env.APPIMAGE；packaged（deb/rpm）→ execPath；dev → electron binary + app 目錄
  const exe = process.env.APPIMAGE || (app.isPackaged ? process.execPath : null);
  const execLine = exe
    ? `"${exe}" --wallpaper`
    : `"${process.execPath}" "${app.getAppPath()}" --wallpaper`;
  const iconCandidates = [path.join(__dirname, 'favicon.ico'), path.join(__dirname, 'build', 'icon.png')];
  const icon = iconCandidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
  const lines = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=BA Memorial Lobby Wallpaper',
    `Exec=${execLine}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
  ];
  if (icon) lines.push(`Icon=${icon}`);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, lines.join('\n') + '\n');
  } catch (e) { console.error('[wallpaper] autostart write failed:', e.message); return false; }
  return true;
}

// ---------------------------------------------------------------------------
// 對外 API
// ---------------------------------------------------------------------------
function start() {
  loadConfig();
  if (active) { config.enabled = true; saveConfig(); return status(); }
  config.enabled = true;
  saveConfig();
  active = true;
  lastFsState = false;
  createWorkers();
  bindScreenEvents();
  startPollers();
  console.log('[wallpaper] started,', workers.size, 'worker(s)');
  broadcastState();
  return status();
}
function stop() {
  loadConfig();
  config.enabled = false;
  saveConfig();
  destroyWorkers();
  unbindScreenEvents();
  stopPollers();
  paused = false;
  lastFsState = false;
  active = false;
  console.log('[wallpaper] stopped');
  broadcastState();
  return status();
}
function restoreIfEnabled() {
  loadConfig();
  if (config.enabled && !active) return start();
  return status();
}
function isActive() { return active; }
function status() {
  const cfg = loadConfig();
  let displays = [];
  try {
    displays = screen.getAllDisplays().map((d, i) => ({ index: i, id: d.id, bounds: d.bounds, label: d.label || '' }));
  } catch {}
  return {
    active,
    paused,
    config: { ...cfg, perScreen: { ...(cfg.perScreen || {}) } },
    autostart: getAutostart(),
    displays,
    capabilities: {
      desktopType: process.platform !== 'win32',
      workerW: process.platform === 'win32',
      workerWMounted: process.platform === 'win32' ? !!winMount() : null,
      cursorForward: FORWARD_OK,
      cursorPoll: true,
      // linux 需 DISPLAY（X11/XWayland）才有全螢幕偵測；Wayland 原生無解（計畫標註）
      fullscreenPause: process.platform === 'linux' ? !!process.env.DISPLAY : process.platform === 'win32',
      x11Available: process.platform === 'linux' ? !!process.env.DISPLAY : true,
      batteryFps: true,
    },
    workers: [...workers.values()].map((w) => ({
      displayIndex: w.index, ready: w.ready, stage: w.bootStage, reloads: w.reloads,
      winHost: process.platform === 'win32' ? !!w.winHost : undefined,
    })),
  };
}
function setConfig(patch) {
  const cfg = loadConfig();
  const prev = { ...cfg };
  const p = patch || {};
  for (const k of Object.keys(DEFAULT_CFG)) {
    if (k in p) cfg[k] = p[k];
  }
  saveConfig();
  // 即時套用
  if (prev.interact !== cfg.interact) {
    for (const w of [...workers.values()]) applyIgnoreMouse(w);
  }
  if (prev.fps !== cfg.fps || prev.pauseBattery !== cfg.pauseBattery) applyBattery();
  if (!prev.pauseFullscreen && cfg.pauseFullscreen === false) { /* noop */ }
  if (prev.pauseFullscreen !== cfg.pauseFullscreen && !cfg.pauseFullscreen) { lastFsState = false; setPaused(false); }
  // lobby/sound 變更 → 重建 worker（renderer 於載入時讀 config）
  if (active && (prev.lobby !== cfg.lobby
    || JSON.stringify(prev.perScreen) !== JSON.stringify(cfg.perScreen)
    || prev.sound !== cfg.sound)) {
    restartWorkers();
  }
  if ('enabled' in p && p.enabled && !active) start();
  if ('enabled' in p && !p.enabled && active) stop();
  broadcastState();
  return status();
}
// tray「離開」：收掉 workers 但不動 enabled（下次啟動依設定恢復）
function shutdown() {
  destroyWorkers();
  unbindScreenEvents();
  stopPollers();
  active = false;
}

// ---------------------------------------------------------------------------
// IPC（manager 設定分頁＋worker 心跳）
// ---------------------------------------------------------------------------
ipcMain.handle('wallpaper-config', () => ({ ...loadConfig() }));
ipcMain.handle('wallpaper-status', () => status());
ipcMain.handle('wallpaper-start', () => start());
ipcMain.handle('wallpaper-stop', () => stop());
ipcMain.handle('wallpaper-set-config', (_e, patch) => setConfig(patch));
ipcMain.handle('wallpaper-get-autostart', () => getAutostart());
ipcMain.handle('wallpaper-set-autostart', (_e, on) => setAutostart(!!on));
ipcMain.on('wallpaper-heartbeat', (e) => {
  const w = wcIndex.get(e.sender.id);
  if (w) { w.lastBeat = Date.now(); w.reloading = false; }
});
ipcMain.on('wallpaper-stage', (e, stage) => {
  const w = wcIndex.get(e.sender.id);
  if (!w) return;
  w.bootStage = String(stage || '');
  if (stage === 'ready') {
    w.ready = true;
    w.reloading = false;
    w.lastBeat = Date.now();
    try { if (!w.win.isVisible() && !TYPE_OVERRIDE) w.win.show(); } catch {}
    console.log(`[wallpaper] worker ${w.index} ready`);
    // 驗收旋鈕：CAPTURE_WORKER=<file> 在就緒後截第一個 worker（自動化測試用）
    if (process.env.CAPTURE_WORKER) {
      const file = process.env.CAPTURE_WORKER;
      const delay = Number(process.env.CAPTURE_DELAY) || 4000;
      setTimeout(async () => {
        try {
          const img = await w.win.webContents.capturePage();
          fs.writeFileSync(file, img.toPNG());
          console.log('[wallpaper] capture saved', file);
        } catch (err) { console.error('[wallpaper] capture failed:', err.message); }
        finally { app.exit(0); }
      }, delay);
    }
  }
});

module.exports = {
  start, stop, status, setConfig, restoreIfEnabled, isActive,
  setAutostart, getAutostart, shutdown, onState,
};
