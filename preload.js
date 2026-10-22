const { contextBridge, ipcRenderer } = require('electron');

// 事件訂閱包裝：同一個 callback 重複訂閱同一 channel 時先移除舊的包裝，
// 避免 HMR／重新初始化把 listener 疊起來（每次事件觸發 N 次）。
// key = callback 物件，value = Map(channel → wrapper)
const _wraps = new Map();

function subscribe(channel, cb, passValue = true) {
  if (typeof cb !== 'function') return;
  let byChannel = _wraps.get(cb);
  if (!byChannel) { byChannel = new Map(); _wraps.set(cb, byChannel); }
  const old = byChannel.get(channel);
  if (old) ipcRenderer.removeListener(channel, old);
  const wrap = (_, v) => { try { cb(passValue ? v : undefined); } catch {} };
  byChannel.set(channel, wrap);
  ipcRenderer.on(channel, wrap);
}

function unsubscribe(channel, cb) {
  const byChannel = _wraps.get(cb);
  const wrap = byChannel && byChannel.get(channel);
  if (!wrap) return;
  ipcRenderer.removeListener(channel, wrap);
  byChannel.delete(channel);
  if (!byChannel.size) _wraps.delete(cb);
}

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
  ffmpegAvailable: () => ipcRenderer.invoke('ffmpeg-available'),
  // Asset download (增量 + 串流)
  checkAssets: (payload) => ipcRenderer.invoke('check-assets', payload),
  downloadAssets: (payload) => ipcRenderer.invoke('download-assets', payload),
  cancelDownload: () => ipcRenderer.invoke('cancel-download-assets'),
  onDownloadProgress: (cb) => subscribe('download-progress', cb),
  offDownloadProgress: (cb) => unsubscribe('download-progress', cb),
  ensureLobby: (payload) => ipcRenderer.invoke('ensure-lobby', payload),
  // 管理空間：檢視已下載資源包與磁碟用量、刪除
  assetsManageList: () => ipcRenderer.invoke('assets-manage-list'),
  assetsManageDelete: (keys) => ipcRenderer.invoke('assets-manage-delete', keys),
  assetsCleanBgm: () => ipcRenderer.invoke('assets-clean-bgm'),
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
  onOpenWallpaperSettings: (cb) => subscribe('open-wallpaper-settings', cb, false),
  offOpenWallpaperSettings: (cb) => unsubscribe('open-wallpaper-settings', cb),
  onWallpaperCursor: (cb) => subscribe('wallpaper-cursor', cb),
  offWallpaperCursor: (cb) => unsubscribe('wallpaper-cursor', cb),
  onWallpaperFps: (cb) => subscribe('wallpaper-fps', cb),
  offWallpaperFps: (cb) => unsubscribe('wallpaper-fps', cb),
  onWallpaperPaused: (cb) => subscribe('wallpaper-pause', cb),
  offWallpaperPaused: (cb) => unsubscribe('wallpaper-pause', cb),
  onWallpaperState: (cb) => subscribe('wallpaper-state', cb),
  offWallpaperState: (cb) => unsubscribe('wallpaper-state', cb),
});
