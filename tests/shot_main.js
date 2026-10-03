// 粒子層驗證 runner：載入 lobby、等粒子累積、capturePage 存 /tmp/bq/particles_<lobby>.png。
// 用法：LOBBY=Hanako_home WAIT_S=12 electron tests/shot_main.js
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const DEV_URL = 'http://127.0.0.1:5173';
const LOBBY = process.env.LOBBY || 'Hanako_home';
const WAIT_S = Number(process.env.WAIT_S) || 12;
const WIDTH = Number(process.env.WIDTH) || 1600;
const HEIGHT = Number(process.env.HEIGHT) || 900;
let vite = null, win = null, done = false;

function probeDevUrl(timeout = 1000) {
  return new Promise((resolve) => {
    const req = http.get(DEV_URL, { timeout }, (res) => { res.destroy(); resolve(true); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
async function ensureVite() {
  if (await probeDevUrl()) return;
  vite = spawn('node', [path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js')],
    { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('vite 逾時')), 20000);
    const onData = (d) => { if (d.toString().includes('Local:')) { clearTimeout(t); resolve(); } };
    vite.stdout.on('data', onData); vite.stderr.on('data', onData);
    vite.on('exit', () => reject(new Error('vite 退出')));
  });
}
function finish(code, why) {
  if (done) return; done = true;
  if (why) console.log('[shot-runner] ' + why);
  try { if (vite) vite.kill(); } catch {}
  app.exit(code);
}
app.setPath('userData', `/tmp/bq/ud-shot-${LOBBY}`);
app.whenReady().then(async () => {
  try { await ensureVite(); } catch (e) { return finish(2, 'vite 失敗: ' + e.message); }
  win = new BrowserWindow({ width: WIDTH, height: HEIGHT, show: true, webPreferences: { contextIsolation: true, backgroundThrottling: false } });
  win.webContents.on('console-message', (_e, _l, message) => {
    if (process.env.DEBUG_CONSOLE) console.log('[console] ' + message.slice(0, 220));
    else if (message.includes('[particles]') || message.includes('[layout]')) console.log('[console] ' + message.slice(0, 200));
  });
  win.loadURL(`${DEV_URL}/#lobby=${LOBBY}&autostart=1&vignette=0`);
  setTimeout(async () => {
    try {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(`/tmp/bq/particles_${LOBBY}.png`, img.toPNG());
      console.log('[shot-runner] saved /tmp/bq/particles_' + LOBBY + '.png');
      finish(0);
    } catch (e) { finish(2, 'capture 失敗: ' + e.message); }
  }, WAIT_S * 1000);
  setTimeout(() => finish(lines0(), '逾時'), Math.max(60000, (WAIT_S + 30) * 1000));
  function lines0() { return 2; }
});
