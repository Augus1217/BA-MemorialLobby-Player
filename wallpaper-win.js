// wallpaper-win.js — Windows 桌面層掛載（ba-wallpaper-mode 計畫 W4）
// koffi FFI（main process，免編 native module）：Progman→0x052C→找含 SHELLDLL_DefView
// 的 WorkerW 的 sibling→SetParent。已知坑（計畫清單）：
//   - Win11 24H2/26xxx WorkerW 結構變動 → 找不到目標就降級（保持 frameless 全螢幕窗）＋通知
//   - WorkerW 被系統回收/explorer 重啟 → 5s 輪詢：父親不對/目標死亡 → 重新掛載
//   - 「顯示桌面」→ IsIconic → SW_SHOWNOACTIVATE 還原
//   - DPI：Electron bounds 是 DIP；SetWindowPos 用實體像素（×scaleFactor）
// 僅在 process.platform === 'win32' 時由 wallpaper.js 惰性 require；本檔不得在載入時炸。
'use strict';

let koffi = null;
let user32 = null;
let shell32 = null;
let fns = null;
let loadErr = null;

// ---- 惰性載入 koffi＋宣告（win32 才會走）----
function ensure() {
  if (fns) return fns;
  if (loadErr) return null;
  try {
    koffi = require('koffi');
    user32 = koffi.load('user32.dll');
    shell32 = koffi.load('shell32.dll');
    // Windows 的 C long = 32-bit → RECT 用 int32（koffi 無 'long32'；koffi 3 驗證）
    const RECT = koffi.struct('BA_RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
    const WNDENUMPROC = koffi.proto('BA_WNDENUMPROC', 'bool', ['intptr', 'intptr']);
    // koffi 3.x 語法（linux 上以 libX11/libc/qsort 實證的方言）：
    //   func(name, retType, [args])；callback 參數記 'Proto*'；register 要 koffi.pointer(proto)
    fns = {
      WNDENUMPROC,   // koffi.register(cb, koffi.pointer(WNDENUMPROC)) 需要（原實作漏存 → Windows 上必炸）
      FindWindowW: user32.func('FindWindowW', 'intptr', ['str16', 'str16']),
      FindWindowExW: user32.func('FindWindowExW', 'intptr', ['intptr', 'intptr', 'str16', 'str16']),
      EnumWindows: user32.func('EnumWindows', 'bool', ['BA_WNDENUMPROC*', 'intptr']),
      SendMessageTimeoutW: user32.func('SendMessageTimeoutW', 'intptr',
        ['intptr', 'uint32', 'uintptr', 'intptr', 'uint32', 'uint32', koffi.out(koffi.pointer('uintptr'))]),
      SetParent: user32.func('SetParent', 'intptr', ['intptr', 'intptr']),
      GetParent: user32.func('GetParent', 'intptr', ['intptr']),
      SetWindowPos: user32.func('SetWindowPos', 'bool',
        ['intptr', 'intptr', 'int32', 'int32', 'int32', 'int32', 'uint32']),
      GetWindowRect: user32.func('GetWindowRect', 'bool', ['intptr', koffi.out(koffi.pointer(RECT))]),
      IsWindow: user32.func('IsWindow', 'bool', ['intptr']),
      IsIconic: user32.func('IsIconic', 'bool', ['intptr']),
      ShowWindow: user32.func('ShowWindow', 'bool', ['intptr', 'int32']),
      GetWindowLongPtrW: user32.func('GetWindowLongPtrW', 'intptr', ['intptr', 'int32']),
      SetWindowLongPtrW: user32.func('SetWindowLongPtrW', 'intptr', ['intptr', 'int32', 'intptr']),
      SHQueryUserNotificationState: shell32.func('SHQueryUserNotificationState', 'int32',
        [koffi.out(koffi.pointer('int32'))]),
    };
    return fns;
  } catch (e) {
    loadErr = e;
    console.error('[wallpaper-win] koffi load failed:', e.message);
    return null;
  }
}

const GWL_STYLE = -16;
const WS_CHILD = 0x40000000;
const WS_VISIBLE = 0x10000000;
const WS_POPUP = 0x80000000; // unsigned 域；運算用 >>>0
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SMTO_NORMAL = 0x0002;
const SW_SHOWNOACTIVATE = 4;
// SHQueryUserNotificationState：全螢幕前景/鎖屏 → 暫停桌布
// 1=BUSY(全螢幕 app) 2=NOT_PRESENT(鎖屏/關屏) 3=D3D 獨占 4=簡報模式 7=全螢幕 UWP
const QUNS_PAUSE = new Set([1, 2, 3, 4, 7]);

function hwndOf(win) {
  try {
    const buf = win.getNativeWindowHandle();
    if (!buf || buf.length < 8) return null;
    return buf.readBigUInt64LE(0);
  } catch { return null; }
}

// 找掛載目標：送 0x052C 後，含 SHELLDLL_DefView 的視窗（WorkerW）的下一個 WorkerW sibling
function findWallpaperHost() {
  const f = fns;
  const progman = Number(f.FindWindowW('Progman', null));
  if (!progman) return { ok: false, reason: 'no Progman' };
  const resultPtr = [0];
  f.SendMessageTimeoutW(progman, 0x052C, 0, 0, SMTO_NORMAL, 1000, resultPtr);
  let host = null;
  const cb = (top, _lparam) => {
    const defview = Number(f.FindWindowExW(top, null, 'SHELLDLL_DefView', null));
    if (defview) {
      const sibling = Number(f.FindWindowExW(null, top, 'WorkerW', null));
      if (sibling) host = sibling;
    }
    return true; // 繼續列舉
  };
  const proc = koffi.register(cb, koffi.pointer(fns.WNDENUMPROC));
  try { f.EnumWindows(proc, 0); } finally { koffi.unregister(proc); }
  if (!host) return { ok: false, reason: 'no WorkerW host (Win11 24H2 structure change?)' };
  return { ok: true, host, progman };
}

// 視窗樣式 → WS_CHILD|WS_VISIBLE（Electron frameless 預設 WS_POPUP 族）
function toChildStyle(hwnd) {
  const f = fns;
  const style = Number(f.GetWindowLongPtrW(hwnd, GWL_STYLE));
  const childStyle = ((style & ~(WS_POPUP >>> 0)) | WS_CHILD | WS_VISIBLE) >>> 0;
  f.SetWindowLongPtrW(hwnd, GWL_STYLE, childStyle | 0); // intptr 帶號；0x40000000 內安全
}

// 掛載：回傳 { ok, host } 或 { ok:false, reason }
function attachWorker(win, display) {
  if (!ensure()) return { ok: false, reason: 'koffi unavailable' };
  const f = fns;
  const hwndBig = hwndOf(win);
  if (!hwndBig) return { ok: false, reason: 'no HWND' };
  const hwnd = Number(hwndBig);
  const found = findWallpaperHost();
  if (!found.ok) return found;
  try {
    toChildStyle(hwnd);
    const box = [null];
    f.GetWindowRect(found.host, box);
    const hostLeft = box[0] ? box[0].left : 0;
    const hostTop = box[0] ? box[0].top : 0;
    // 實體像素：display.bounds 是 DIP
    const scale = display.scaleFactor || 1;
    const px = Math.round((display.bounds.x - hostLeft) * scale);
    const py = Math.round((display.bounds.y - hostTop) * scale);
    const pw = Math.round(display.bounds.width * scale);
    const ph = Math.round(display.bounds.height * scale);
    f.SetParent(hwnd, found.host);
    f.SetWindowPos(hwnd, null, px, py, pw, ph, SWP_NOZORDER | SWP_NOACTIVATE);
    console.log(`[wallpaper-win] attached to WorkerW ${found.host} (display ${display.bounds.x},${display.bounds.y} ${display.bounds.width}x${display.bounds.height} @${scale}x)`);
    return { ok: true, host: found.host };
  } catch (e) {
    console.error('[wallpaper-win] attach failed:', e.message);
    return { ok: false, reason: e.message };
  }
}

// 卸載：SetParent(NULL) 還原成 top-level（銷毀前的禮貌動作）
function detachWorker(win) {
  if (!ensure()) return;
  const hwndBig = hwndOf(win);
  if (!hwndBig) return;
  try { fns.SetParent(Number(hwndBig), null); } catch {}
}

// 健康檢查（5s 輪詢用）：被最小化 → 還原；父親失效/被拔 → 重新掛載
// 回傳：'ok' | 'remount' | 'degraded'
function healthCheck(win, display) {
  if (!ensure()) return 'degraded';
  const f = fns;
  const hwndBig = hwndOf(win);
  if (!hwndBig) return 'degraded';
  const hwnd = Number(hwndBig);
  if (Number(f.IsIconic(hwnd))) {
    f.ShowWindow(hwnd, SW_SHOWNOACTIVATE);
  }
  const parent = Number(f.GetParent(hwnd));
  if (parent && Number(f.IsWindow(parent))) return 'ok';
  const found = findWallpaperHost();
  if (!found.ok) return 'degraded';
  try {
    toChildStyle(hwnd);
    const box = [null];
    f.GetWindowRect(found.host, box);
    const scale = display.scaleFactor || 1;
    const px = Math.round((display.bounds.x - (box[0] ? box[0].left : 0)) * scale);
    const py = Math.round((display.bounds.y - (box[0] ? box[0].top : 0)) * scale);
    f.SetParent(hwnd, found.host);
    f.SetWindowPos(hwnd, null, px, py,
      Math.round(display.bounds.width * scale), Math.round(display.bounds.height * scale),
      SWP_NOZORDER | SWP_NOACTIVATE);
    console.log('[wallpaper-win] remounted (host lost or changed)');
    return 'remount';
  } catch (e) {
    console.error('[wallpaper-win] remount failed:', e.message);
    return 'degraded';
  }
}

// 全螢幕前景偵測（SHQueryUserNotificationState 2s 輪詢，wallpaper.js fsCheck 呼叫）
function isFullscreenFront() {
  if (!ensure()) return false;
  try {
    const state = [5];
    fns.SHQueryUserNotificationState(state);
    return QUNS_PAUSE.has(Number(state[0]));
  } catch { return false; }
}

module.exports = { attachWorker, detachWorker, healthCheck, isFullscreenFront, available: () => !!ensure() };
