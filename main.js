const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DEV_URL = 'http://127.0.0.1:5173';
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

function probeDevUrl(timeout = 1000) {
  return new Promise((resolve) => {
    const http = require('http');
    const req = http.get(DEV_URL, { timeout }, (res) => {
      res.destroy();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function startVite() {
  if (await probeDevUrl()) return;
  vite = spawn(findNode(), [path.join(__dirname, 'node_modules', 'vite', 'bin', 'vite.js')], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let buf = '';
  await new Promise((resolve, reject) => {
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
    vite.on('exit', () => reject(new Error('Vite dev server 已退出')));
  });
  if (!(await probeDevUrl())) throw new Error('Vite dev server 連線失敗');
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

// 影片匯出：寫入使用者選的路徑（或 EXPORT_DIR 環境變數指定的目錄，供自動化/批次使用）
// 逐幀動畫匯出：renderer 手動推進 spine 逐幀渲染，把 WebP 幀串流進 ffmpeg（stdin），
// 編碼為固定 fps / 精確時長的 MP4 / WebM，完全不依賴即時錄影。
let animProc = null;
let animQueued = Promise.resolve();
let animOutPath = null;
let animAudioTmp = null;

function writeAnim(buf) {
  if (!animProc || !animProc.stdin.writable) return;
  animQueued = animQueued.then(() => new Promise((res, rej) => {
    animProc.stdin.write(buf, (err) => (err ? rej(err) : res()));
  })).catch(() => {});
}

ipcMain.handle('anim-start', async (event, payload) => {
  const { w = 1280, h = 720, fps = 30, duration = 10, ext = 'mp4', defaultName = 'lobby.mp4', audioPcm = null, sampleRate = 44100, channels = 2 } = payload || {};
  try {
    let outPath;
    const autoDir = process.env.EXPORT_DIR;
    if (autoDir) {
      outPath = path.join(autoDir, defaultName);
    } else {
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: '匯出動畫',
        defaultPath: defaultName,
        filters: [
          { name: ext === 'webm' ? 'WebM 影片' : 'MP4 影片', extensions: [ext || 'mp4'] },
          { name: '所有檔案', extensions: ['*'] },
        ],
      });
      if (canceled || !filePath) return { canceled: true };
      outPath = filePath;
    }

    const hasAudio = audioPcm && audioPcm.byteLength > 0;
    let audioTmp = null;
    if (hasAudio) {
      // 音訊（renderer 預混的 s16le PCM）寫成暫存檔再餵 ffmpeg：
      // 直接 pipe 時 s16le demuxer 可能因 read() 邊界不齊（非 4 的倍數）報
      // "Invalid PCM packet" 而中止整個編碼，暫存檔可避免。
      audioTmp = path.join(os.tmpdir(), `ba_anim_${Date.now()}_${Math.random().toString(36).slice(2)}.pcm`);
      fs.writeFileSync(audioTmp, Buffer.from(new Uint8Array(audioPcm)));
    }
    animAudioTmp = audioTmp;
    const vargs = ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', 'pipe:'];
    if (hasAudio) vargs.push('-f', 's16le', '-ar', String(sampleRate), '-ac', String(channels), '-i', audioTmp);
    vargs.push('-map', '0:v');
    if (hasAudio) vargs.push('-map', '1:a');
    if (ext === 'webm') {
      vargs.push('-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '30', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', '160k', '-t', String(duration), outPath);
    } else {
      vargs.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-t', String(duration), '-movflags', '+faststart', outPath);
    }

    animOutPath = outPath;
    animQueued = Promise.resolve();
    console.log('[anim] spawn ffmpeg', vargs.join(' '));
    animProc = spawn('ffmpeg', vargs, { stdio: ['pipe', 'ignore', 'pipe'] });
    animProc.stderr.on('data', () => {});
    animProc.on('error', (e) => { console.error('[anim] ffmpeg spawn 失敗', e); });
    animProc.on('exit', (c) => { if (c !== 0 && c !== null) console.error('[anim] ffmpeg exit', c); });
    return { ok: true };
  } catch (e) {
    console.error('[anim] start 失敗', e);
    return { error: e.message };
  }
});

ipcMain.on('anim-frame', (event, buf) => {
  writeAnim(Buffer.from(buf));
});

ipcMain.handle('anim-finish', async () => {
  if (!animProc) return { error: '沒有進行中的動畫匯出' };
  const proc = animProc;
  const tmp = animAudioTmp;
  try { await animQueued; proc.stdin.end(); } catch (e) { proc.stdin.destroy(); }
  const code = await new Promise((res) => proc.on('exit', (c) => res(c)));
  if (proc === animProc) animProc = null;
  if (tmp) { try { fs.unlinkSync(tmp); } catch {} animAudioTmp = null; }
  if (code !== 0) return { error: `ffmpeg 結束碼 ${code}` };
  const p = animOutPath;
  animOutPath = null;
  return { path: p };
});

ipcMain.on('anim-abort', () => {
  if (animProc) { try { animProc.stdin.destroy(); } catch {} try { animProc.kill('SIGKILL'); } catch {} animProc = null; }
  if (animAudioTmp) { try { fs.unlinkSync(animAudioTmp); } catch {} animAudioTmp = null; }
});

ipcMain.handle('bgm-export', async (event, payload) => {
  const { filename, defaultName } = payload || {};
  if (!filename) return { canceled: true };
  const src = path.join(__dirname, 'assets', 'bgm', filename);
  if (!fs.existsSync(src)) return { error: 'BGM 檔案不存在' };
  const autoDir = process.env.EXPORT_DIR;
  if (autoDir) {
    const dst = path.join(autoDir, defaultName || filename);
    fs.copyFileSync(src, dst);
    return { path: dst };
  }
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '匯出 BGM',
    defaultPath: defaultName || filename,
    filters: [
      { name: 'OGG 音訊', extensions: ['ogg'] },
      { name: '所有檔案', extensions: ['*'] },
    ],
  });
  if (canceled || !filePath) return { canceled: true };
  fs.copyFileSync(src, filePath);
  return { path: filePath };
});

ipcMain.handle('screen-size', async () => {
  const d = screen.getPrimaryDisplay();
  return { width: d.size.width, height: d.size.height, scaleFactor: d.scaleFactor };
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
