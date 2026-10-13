// wallpaper.js mac 互動模式的透明點擊代理用 preload：
// 代理頁面把 DOM 輸入事件送回主進程，主進程以 sendInputEvent 注入 worker renderer。
// （mac type:'desktop' 視窗在 Finder 桌面之下，點擊/移動會被 Finder 桌面視窗攔走，
//   只有穿透模式的 forward:true 轉得送「移動」——互動模式必須靠這層代理。）
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('wpProxy', {
  event: (p) => ipcRenderer.send('wallpaper-proxy-event', p),
});
