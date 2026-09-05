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
  getStreamingMode: () => ipcRenderer.invoke('get-streaming-mode'),
  setStreamingMode: (v) => ipcRenderer.invoke('set-streaming-mode', v),
  ensureLobby: (payload) => ipcRenderer.invoke('ensure-lobby', payload),
  // 管理空間：檢視已下載資源包與磁碟用量、刪除
  assetsManageList: () => ipcRenderer.invoke('assets-manage-list'),
  assetsManageDelete: (keys) => ipcRenderer.invoke('assets-manage-delete', keys),
});
