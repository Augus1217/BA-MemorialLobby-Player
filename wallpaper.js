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
const { setNetWmStateSkipTaskbar: x11SetSkipTaskbar } = require('./wallpaper-x11');

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
  launchAtLogin: false, // mac：登入啟動時自動進桌布（macOS login item 不帶 args，意圖記在 config）
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
const retiring = new Map();  // display.id → [舊 worker records]（無縫換角：新的 ready 才拆）
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
  // lobby 放 hash 最前（renderer 舊正則 /[?#]lobby=/ 只認 #/? 開頭；放寬見 app.js）
  const hash = `${lobby ? 'lobby=' + encodeURIComponent(lobby) + '&' : ''}wallpaper=1&autostart=1`;
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
    // Linux：focusable:false 會讓 Chromium 建 override-redirect 視窗（KWin 不管理 →
    // Unmanaged 層蓋過面板/所有視窗；實測 KWin 6.6 Wayland）。改 true＋showInactive 不搶焦點。
    focusable: process.platform === 'linux',
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
  // Linux skipTaskbar：Electron 的建構子選項與 win.setSkipTaskbar() 在 X11 都是 no-op
  // （實測 _NET_WM_STATE 恆空 → 任務列/dock 照列 worker）。xid 留在 rec，待視窗
  // mapped（ready 顯示後）用 Xlib ClientMessage 設 _NET_WM_STATE——見 wallpaper-x11.js
  const xid = process.platform === 'linux'
    ? win.getNativeWindowHandle().readUInt32LE(0) : 0;
  const rec = {
    win, display, index, xid,
    ready: false, lastBeat: 0, created: Date.now(),
    reloads: 0, reloading: false, bootStage: 'new',
  };
  workers.set(display.id, rec);
  const wcId = win.webContents.id;   // 建立時抓定：closed 後 win.webContents 會 throw
  wcIndex.set(wcId, rec);

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
    try {
      wcIndex.delete(wcId);
      if (workers.get(display.id) === rec) workers.delete(display.id);
    } catch {}
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
    console.log('[wallpaper] worker hash:', hash);
    win.loadURL(DEV_URL + '#' + hash).catch((e) => console.error('[wallpaper] loadURL failed:', e.message));
  } else {
    win.loadFile(prodHtmlPath(), { hash }).catch((e) => console.error('[wallpaper] loadFile failed:', e.message));
  }
  return rec;
}

function applyIgnoreMouse(rec) {
  const ignore = !loadConfig().interact;
  try { rec.win.setIgnoreMouseEvents(ignore, { forward: ignore && FORWARD_OK }); } catch {}
  // macOS：type:'desktop' 視窗在 Finder 桌面之下，點擊（互動模式的移動也是）會被
  // Finder 桌面視窗攔走——forward:true 只在穿透模式轉送「移動」。互動模式改由
  // 透明點擊代理（正常層，透視下層桌布/圖示）收事件再 sendInputEvent 注入 worker；
  // Windows（WorkerW 子視窗）與 Linux（desktop 層即頂）原生收得到，不需代理。
  if (process.platform === 'darwin') syncClickProxy(rec);
}

// ---- mac 互動模式：透明點擊代理（正常層）→ sendInputEvent 注入 worker ----
const proxies = new Map();   // display.id → { win, wcId, displayId }
const PROXY_PAGE = 'data:text/html;charset=utf-8,' + encodeURIComponent(
  '<!doctype html><meta charset="utf-8">'
  + '<body style="margin:0;background:transparent;user-select:none">'
  + '<script>const S=(t,e)=>window.wpProxy&&wpProxy.event({type:t,x:e.clientX,y:e.clientY,'
  + 'button:e.button==null?0:e.button,clicks:e.detail==null?1:e.detail,'
  + 'dx:e.deltaX==null?0:e.deltaX,dy:e.deltaY==null?0:e.deltaY});'
  + "['mousedown','mouseup','mousemove','contextmenu','wheel'].forEach(t=>"
  + 'addEventListener(t,e=>{e.preventDefault();S(t,e);},{passive:false}));'
  + '<\/script>');

function syncClickProxy(rec) {
  const want = loadConfig().interact;
  const existing = proxies.get(rec.display.id);
  if (want && !existing) {
    const proxy = new BrowserWindow({
      x: rec.display.bounds.x, y: rec.display.bounds.y,
      width: rec.display.bounds.width, height: rec.display.bounds.height,
      frame: false, transparent: true, hasShadow: false,
      backgroundColor: '#00000000',
      focusable: false,           // 不搶焦點；mac 上非 key 視窗仍收滑鼠事件
      show: false,
      skipTaskbar: true, resizable: false, movable: false, minimizable: false,
      maximizable: false, fullscreenable: false, enableLargerThanScreen: false,
      webPreferences: {
        preload: path.join(__dirname, 'wallpaper-proxy-preload.js'),
        contextIsolation: true, backgroundThrottling: false,
      },
    });
    const wcId = proxy.webContents.id;
    proxies.set(rec.display.id, { win: proxy, wcId, displayId: rec.display.id });
    proxy.on('closed', () => {
      const cur = proxies.get(rec.display.id);
      if (cur && cur.wcId === wcId) proxies.delete(rec.display.id);
    });
    // ready 才顯示，免透明窗閃黑；showInactive 不搶 app 焦點
    proxy.once('ready-to-show', () => { try { proxy.showInactive(); } catch {} });
    // worker 是 canJoinAllSpaces——代理也跨 Space，互動模式才不會切 Space 就失效
    try { proxy.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
    // 壓到 Finder 桌面之上、一般視窗之下（floating(3)−503 ≈ level −500）：
    // 點空白桌面才輪得到代理（Finder 桌面在更低的 desktop 層收不到），
    // 點其他 app 視窗（level 0）照常命中原視窗、照常聚焦——不搶點擊
    try { proxy.setAlwaysOnTop(true, 'floating', -503); } catch {}
    proxy.loadURL(PROXY_PAGE).catch((e) => console.error('[wallpaper] proxy loadURL:', e.message));
    console.log('[wallpaper] click proxy on (display', rec.index + ')');
  } else if (!want && existing) {
    destroyProxy(rec.display.id);
  }
}
function destroyProxy(displayId) {
  const p = proxies.get(displayId);
  if (!p) return;
  proxies.delete(displayId);
  try { if (!p.win.isDestroyed()) p.win.destroy(); } catch {}
}
function destroyAllProxies() {
  for (const id of [...proxies.keys()]) destroyProxy(id);
}

// 代理頁事件 → 該螢幕現役 worker（換角後 proxy 存活，動態解析目標）
ipcMain.on('wallpaper-proxy-event', (e, p) => {
  let entry = null;
  for (const v of proxies.values()) { if (v.wcId === e.sender.id) { entry = v; break; } }
  if (!entry) return;
  const rec = workers.get(entry.displayId);
  if (!rec || !rec.win || rec.win.isDestroyed()) return;
  const type = { mousedown: 'mouseDown', mouseup: 'mouseUp', mousemove: 'mouseMove',
                 wheel: 'mouseWheel', contextmenu: 'mouseDown' }[p && p.type];
  if (!type) return;
  const ev = { type, x: p.x, y: p.y };
  if (type === 'mouseDown' || type === 'mouseUp') {
    ev.button = p.button === 2 ? 'right' : p.button === 1 ? 'middle' : 'left';
    ev.clickCount = p.clicks || 1;
  } else if (type === 'mouseWheel') {
    ev.deltaX = p.dx; ev.deltaY = p.dy;
  }
  try { rec.win.webContents.sendInputEvent(ev); } catch {}
});

function createWorkers() {
  const displays = screen.getAllDisplays();
  displays.forEach((d, i) => createWorker(d, i));
}
function destroyWorkers() {
  const all = [...workers.values(), ...[...retiring.values()].flat()];
  for (const w of all) {
    // Windows：先從 WorkerW 卸下再銷毀（SetParent(NULL)）
    if (process.platform === 'win32' && w.win && !w.win.isDestroyed()) {
      try { winMount()?.detachWorker(w.win); } catch {}
    }
    try { if (w.win && !w.win.isDestroyed()) w.win.destroy(); } catch {}
  }
  workers.clear();
  wcIndex.clear();
  retiring.clear();
  if (process.platform === 'darwin') destroyAllProxies();   // mac 互動模式點擊代理
}

// 無縫換角：為每個現役 worker 先建新 worker（隱藏），ready 顯示後才拆舊的——
// 桌面不會出現「桌布消失幾秒」的空窗；新 worker 起不來 → failWorker 回退保留舊的。
function swapWorkers() {
  for (const [did, rec] of [...workers.entries()]) {
    rec.retired = true;
    if (!retiring.has(did)) retiring.set(did, []);
    retiring.get(did).push(rec);
    workers.delete(did);
    wcIndex.delete(rec.win.webContents.id);   // 舊的不再接心跳/stage
    createWorker(rec.display, rec.index);
  }
}
// 新 worker 就位 → 拆掉同一顯示器的所有 retiring 舊 worker
function retireFor(displayId) {
  const list = retiring.get(displayId);
  if (!list) return;
  retiring.delete(displayId);
  for (const r of list) {
    if (process.platform === 'win32' && r.win && !r.win.isDestroyed()) {
      try { winMount()?.detachWorker(r.win); } catch {}
    }
    try { if (r.win && !r.win.isDestroyed()) r.win.destroy(); } catch {}
  }
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
  const wcId = w.win && !w.win.isDestroyed() ? (() => { try { return w.win.webContents.id; } catch { return null; } })() : null;
  try { w.win.destroy(); } catch {}
  workers.delete(w.display.id);
  if (wcId !== null) wcIndex.delete(wcId);
  if (workers.size === 0 && active) {
    // 換角失敗 → 回退：把 retiring 的舊 worker 重新扶正（桌布不中斷）
    for (const [did, list] of [...retiring.entries()]) {
      const keep = list.find((r) => r.win && !r.win.isDestroyed());
      if (keep) {
        retiring.set(did, list.filter((r) => r !== keep));
        keep.retired = false;
        workers.set(did, keep);
        wcIndex.set(keep.win.webContents.id, keep);
        notify('BA Memorial Lobby', `桌布更新失敗，保留原桌布（${why}）`);
        broadcastState();
        return;
      }
    }
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
  if (process.platform === 'win32') {
    try { return app.getLoginItemSettings({ args: ['--wallpaper'] }).openAtLogin; } catch { return false; }
  }
  if (process.platform === 'darwin') {
    // macOS login item（LSSharedFileList）不帶 args——用 args 過濾查詢永遠 miss，
    // checkbox 會立刻彈回（實測 VM）。dev（npx electron）無法註冊自己 → 以 config
    // 意圖為準；packaged 以 login item 實際狀態 ∧ config 意圖為準。
    if (isDev) { try { return !!loadConfig().launchAtLogin; } catch { return false; } }
    try {
      return !!app.getLoginItemSettings().openAtLogin && !!loadConfig().launchAtLogin;
    } catch { return false; }
  }
  try { return fs.existsSync(autostartFile()); } catch { return false; }
}
function setAutostart(on) {
  if (process.platform === 'win32') {
    try {
      app.setLoginItemSettings({ openAtLogin: !!on, openAsHidden: true, args: ['--wallpaper'] });
    } catch (e) { console.error('[wallpaper] setLoginItemSettings failed:', e.message); }
    return getAutostart();
  }
  if (process.platform === 'darwin') {
    // args 在 macOS 存不進 login item；「進桌布」意圖改記 config.launchAtLogin，
    // 啟動時由 maybeLoginAutostart() 判定。dev 不註冊 login item（會把裸
    // Electron.app 加進登入項），只記 config。
    try { if (!isDev) app.setLoginItemSettings({ openAtLogin: !!on, openAsHidden: true }); }
    catch (e) { console.error('[wallpaper] setLoginItemSettings failed:', e.message); }
    try { const cfg = loadConfig(); cfg.launchAtLogin = !!on; saveConfig(); } catch {}
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
  // macOS：桌布運行中整個 app 轉 accessory（Dock 不顯示圖示、選單列不顯示名稱）
  // ＝真·隱形引擎；檢視器仍可從系統列（tray）開啟。stop 時還原。
  if (process.platform === 'darwin' && app.dock) { try { app.dock.hide(); } catch {} }
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
  if (process.platform === 'darwin' && app.dock) { try { app.dock.show(); } catch {} }
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
  // lobby/sound 變更 → 無縫換角（新 worker ready 顯示後才拆舊的；renderer 於載入時讀 config）
  if (active && (prev.lobby !== cfg.lobby
    || JSON.stringify(prev.perScreen) !== JSON.stringify(cfg.perScreen)
    || prev.sound !== cfg.sound)) {
    swapWorkers();
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
    try { if (!w.win.isVisible() && !TYPE_OVERRIDE) w.win.showInactive(); } catch {}
    // Linux：mapped 後才能送 _NET_WM_STATE ClientMessage（unmapped 時 WM 查無此窗）。
    // 立即送一次＋1.2s 補一次，蓋掉 KWin manage 競態；操作冪等。
    if (process.platform === 'linux' && w.xid) {
      x11SetSkipTaskbar(w.xid, true);
      setTimeout(() => {
        try { if (!w.win.isDestroyed()) x11SetSkipTaskbar(w.xid, true); } catch {}
      }, 1200);
    }
    retireFor(w.display.id);   // 無縫換角：新的就位才拆舊的
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

// mac 登入啟動：login item 無法帶 args → 以 wasOpenedAtLogin + config 意圖判定
function maybeLoginAutostart() {
  if (process.platform !== 'darwin') return false;
  try {
    if (!app.getLoginItemSettings().wasOpenedAtLogin) return false;
    if (!loadConfig().launchAtLogin) return false;
    if (active) return true;
    start();
    return true;
  } catch { return false; }
}

module.exports = {
  start, stop, status, setConfig, restoreIfEnabled, isActive,
  setAutostart, getAutostart, shutdown, onState, maybeLoginAutostart,
};
