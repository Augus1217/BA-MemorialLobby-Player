const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const DEV_URL = 'http://localhost:5173';
let win = null;
let vite = null;

function findNode() {
  if (process.env.NODE_BIN) return process.env.NODE_BIN;
  try {
    const { execSync } = require('child_process');
    const p = execSync('command -v node').toString().trim();
    if (p) return p;
  } catch {}
  return 'node';
}

function startVite() {
  vite = spawn(findNode(), [path.join(__dirname, 'node_modules', 'vite', 'bin', 'vite.js')], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let buf = '';
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Vite dev server 啟動逾時')), 20000);
    const onData = (d) => {
      buf += d.toString();
      if (buf.includes('Local:')) {
        clearTimeout(t);
        resolve();
      }
    };
    vite.stdout.on('data', onData);
    vite.stderr.on('data', onData);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    backgroundColor: '#12122a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  win.loadURL(DEV_URL + (process.env.HASH ? '#' + process.env.HASH : ''));
  win.webContents.on('console-message', (e, level, message) => {
    console.log('[renderer]', message);
  });
  if (process.env.CAPTURE) {
    const file = process.env.CAPTURE;
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 6000));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(file, img.toPNG());
      console.log('[capture] saved', file);
      app.exit(0);
    });
  }
}

ipcMain.handle('screenshot', async (event, file) => {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(file, img.toPNG());
  return file;
});

ipcMain.handle('lobby-list', async () => {
  const dir = path.join(__dirname, 'assets', 'spine');
  return fs.readdirSync(dir).filter((d) => {
    try { return fs.statSync(path.join(dir, d)).isDirectory(); } catch { return false; }
  });
});

app.whenReady().then(async () => {
  try {
    await startVite();
  } catch (e) {
    console.error('無法啟動 Vite dev server:', e.message);
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (vite) vite.kill();
  if (process.platform !== 'darwin') app.quit();
});
