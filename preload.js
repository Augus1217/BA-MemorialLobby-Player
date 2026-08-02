const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ba', {
  listLobbies: () => ipcRenderer.invoke('lobby-list'),
  screenshot: (file) => ipcRenderer.invoke('screenshot', file),
});
