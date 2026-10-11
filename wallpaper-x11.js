// wallpaper-x11.js — Linux X11 skipTaskbar 正解（koffi + Xlib）
// 背景：Electron 的 skipTaskbar 在 Linux X11 是 no-op——建構子選項與 win.setSkipTaskbar()
// 實測皆不寫 _NET_WM_STATE（KWin6/XWayland 恆空 → 任務列/dock 照列 worker）；map 前用
// xprop 預寫屬性又會被 Chromium 在 map 時覆寫。EWMH 規定 mapped 視窗的 _NET_WM_STATE
// 變更必須送 Root Window 的 ClientMessage（wmctrl -b add,skip_taskbar 同款手法），
// KWin 收到後更新內部 skipTaskbar → TasksModel/dock 才會排除它。
// koffi 為既有依賴（W4 Windows WorkerW 用），libX11.so.6 在任何能跑本 app 的 Linux 都在。
'use strict';

let _api = null;

function loadX11() {
  if (_api) return _api;
  const koffi = require('koffi');
  const lib = koffi.load('libX11.so.6');
  // koffi 3.x 只吃原型字串（無 abi 前綴；x64 上單一呼叫慣例）
  _api = {
    XOpenDisplay: lib.func('void* XOpenDisplay(string)'),
    XCloseDisplay: lib.func('int XCloseDisplay(void*)'),
    XDefaultRootWindow: lib.func('uint64 XDefaultRootWindow(void*)'),
    XInternAtom: lib.func('uint64 XInternAtom(void*, string, int)'),
    XSendEvent: lib.func('int XSendEvent(void*, uint64, int, int64, void*)'),
    XFlush: lib.func('int XFlush(void*)'),
  };
  return _api;
}

// XEvent 是 96-byte union（x64 LP64）；只會用到 ClientMessage 版面，直接用 Buffer
// 手刻避免 koffi struct 對齊歧異。接收端（WM）只讀 window/message_type/format/data。
//   type=33(ClientMessage) @0 | serial @8 | send_event @16 | display @24（收端忽略，補 0）
//   window @32 | message_type @40 | format=32 @48 | data.l[5] @56
function buildClientMessage(xid, msgType, l0, l1, l2) {
  const ev = Buffer.alloc(96);
  ev.writeUInt32LE(33, 0);                       // ClientMessage
  ev.writeUInt32LE(1, 16);                       // send_event = True
  ev.writeBigUInt64LE(BigInt(xid), 32);          // 目標視窗
  ev.writeBigUInt64LE(BigInt(msgType), 40);      // _NET_WM_STATE
  ev.writeUInt32LE(32, 48);                      // format = 32
  ev.writeBigUInt64LE(BigInt(l0), 56);           // _NET_WM_STATE_ADD / _REMOVE
  ev.writeBigUInt64LE(BigInt(l1), 64);           // atom 1
  ev.writeBigUInt64LE(BigInt(l2), 72);           // atom 2
  return ev;
}

const SUBSTRUCTURE_REDIRECT = 1 << 20;
const SUBSTRUCTURE_NOTIFY = 1 << 19;

/**
 * 對 X11 視窗加/移除 _NET_WM_STATE_SKIP_TASKBAR + SKIP_PAGER（ClientMessage 正道）。
 * @param {number} xid X window id（getNativeWindowHandle() 前 4 bytes）
 * @param {boolean} add true=加入狀態（隱藏於任務列）
 * @returns {boolean} 是否成功送出
 */
function setNetWmStateSkipTaskbar(xid, add = true) {
  if (!process.env.DISPLAY) return false;
  let dpy = null;
  try {
    const api = loadX11();
    dpy = api.XOpenDisplay(null);
    if (!dpy) return false;
    const root = api.XDefaultRootWindow(dpy);
    const NET_WM_STATE = api.XInternAtom(dpy, '_NET_WM_STATE', 0);
    const SKIP_TASKBAR = api.XInternAtom(dpy, '_NET_WM_STATE_SKIP_TASKBAR', 0);
    const SKIP_PAGER = api.XInternAtom(dpy, '_NET_WM_STATE_SKIP_PAGER', 0);
    if (!NET_WM_STATE || !SKIP_TASKBAR) return false;
    const ev = buildClientMessage(
      xid, NET_WM_STATE,
      add ? 1 : 0,            // _NET_WM_STATE_ADD / _NET_WM_STATE_REMOVE
      SKIP_TASKBAR,
      SKIP_PAGER,             // l[2]：第二個 atom；XSendEvent 對 root 不驗 xid，無 BadWindow 風險
    );
    // XSendEvent 對 root 送（SubstructureRedirect 讓 WM 代為處理）；事件內的 xid 若已
    // 銷毀，KWin 查無此窗直接忽略——不會產生 BadWindow，安全。
    api.XSendEvent(dpy, root, 0, SUBSTRUCTURE_REDIRECT | SUBSTRUCTURE_NOTIFY, ev);
    api.XFlush(dpy);
    return true;
  } catch (e) {
    console.error('[wallpaper] x11 skipTaskbar failed:', e.message);
    return false;
  } finally {
    if (dpy) { try { api.XCloseDisplay(dpy); } catch {} }
  }
}

module.exports = { setNetWmStateSkipTaskbar };
