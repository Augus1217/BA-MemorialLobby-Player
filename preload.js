const { contextBridge, ipcRenderer } = require('electron');

// download-progress handler 精確刪除用（app 會在單次下載結束後反註冊）
const _progWraps = new Map();

contextBridge.exposeInMainWorld('ba', {
  __electron: true,
  listLobbies: () => ipcRenderer.invoke('lobby-list'),
  introMedia: () => ipcRenderer.invoke('intro-media'),
  screenshot: (file) => ipcRenderer.invoke('screenshot', file),
  startAnimVideo: (payload) => ipcRenderer.invoke('anim-start', payload),
  animFrame: (buf) => ipcRenderer.send('anim-frame', buf),
  finishAnimVideo: () => ipcRenderer.invoke('anim-finish'),
  abortAnimVideo: () => ipcRenderer.send('anim-abort'),
  exportBgm: (payload) => ipcRenderer.invoke('bgm-export', payload),
  screenSize: () => ipcRenderer.invoke('screen-size'),
  // Asset download (增量 + 串流)
  checkAssets: (payload) => ipcRenderer.invoke('check-assets', payload),
  downloadAssets: (payload) => ipcRenderer.invoke('download-assets', payload),
  cancelDownload: () => ipcRenderer.invoke('cancel-download-assets'),
  onDownloadProgress: (cb) => {
    const w = (_, data) => { try { cb(data); } catch {} };
    _progWraps.set(cb, w);
    ipcRenderer.on('download-progress', w);
  },
  offDownloadProgress: (cb) => {
    const w = _progWraps.get(cb);
    if (w) { ipcRenderer.removeListener('download-progress', w); _progWraps.delete(cb); }
  },
  ensureLobby: (payload) => ipcRenderer.invoke('ensure-lobby', payload),
  // 管理空間：檢視已下載資源包與磁碟用量、刪除
  assetsManageList: () => ipcRenderer.invoke('assets-manage-list'),
  assetsManageDelete: (keys) => ipcRenderer.invoke('assets-manage-delete', keys),
  verifyPacks: () => ipcRenderer.invoke('assets-verify'),
  repairPacks: (keys) => ipcRenderer.invoke('assets-repair', keys),
  cleanOrphans: () => ipcRenderer.invoke('assets-clean-orphans'),
  // ---- 桌布模式（wallpaper.js：worker 心跳/設定；manager 設定分頁控制）----
  wallpaperConfig: () => ipcRenderer.invoke('wallpaper-config'),
  wallpaperStatus: () => ipcRenderer.invoke('wallpaper-status'),
  wallpaperSetConfig: (patch) => ipcRenderer.invoke('wallpaper-set-config', patch),
  wallpaperStart: () => ipcRenderer.invoke('wallpaper-start'),
  wallpaperStop: () => ipcRenderer.invoke('wallpaper-stop'),
  wallpaperGetAutostart: () => ipcRenderer.invoke('wallpaper-get-autostart'),
  wallpaperSetAutostart: (on) => ipcRenderer.invoke('wallpaper-set-autostart', !!on),
  wallpaperBeat: () => ipcRenderer.send('wallpaper-heartbeat'),
  wallpaperStage: (s) => ipcRenderer.send('wallpaper-stage', String(s || '')),
  onWallpaperCursor: (cb) => ipcRenderer.on('wallpaper-cursor', (_, p) => { try { cb(p); } catch {} }),
  onWallpaperFps: (cb) => ipcRenderer.on('wallpaper-fps', (_, v) => { try { cb(v); } catch {} }),
  onWallpaperPaused: (cb) => ipcRenderer.on('wallpaper-pause', (_, v) => { try { cb(v); } catch {} }),
  onWallpaperState: (cb) => ipcRenderer.on('wallpaper-state', (_, v) => { try { cb(v); } catch {} }),
});
