const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ba', {
  listLobbies: () => ipcRenderer.invoke('lobby-list'),
  screenshot: (file) => ipcRenderer.invoke('screenshot', file),
  startAnimVideo: (payload) => ipcRenderer.invoke('anim-start', payload),
  animFrame: (buf) => ipcRenderer.send('anim-frame', buf),
  finishAnimVideo: () => ipcRenderer.invoke('anim-finish'),
  abortAnimVideo: () => ipcRenderer.send('anim-abort'),
  exportBgm: (payload) => ipcRenderer.invoke('bgm-export', payload),
  screenSize: () => ipcRenderer.invoke('screen-size'),
});
