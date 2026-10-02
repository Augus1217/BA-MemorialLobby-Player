// 受控單元測試 runner：載入 vite 服務的 tests/hdr_unit.html，
// 轉發 console、攔 UNIT_SUMMARY、逾時退出。與正式 app 共用 5173（無則自拉、離開時回收）。
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const DEV_URL = 'http://127.0.0.1:5173';
const URL_PATH = '/tests/hdr_unit.html';
const TIMEOUT_MS = 60000;

let vite = null;
let win = null;
let done = false;

function probeDevUrl(timeout = 1000) {
  return new Promise((resolve) => {
    const req = http.get(DEV_URL, { timeout }, (res) => { res.destroy(); resolve(true); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function ensureVite() {
  if (await probeDevUrl()) return;
  vite = spawn('node',
    [path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js')],
    { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('vite 啟動逾時')), 20000);
    const onData = (d) => { if (d.toString().includes('Local:')) { clearTimeout(t); resolve(); } };
    vite.stdout.on('data', onData);
    vite.stderr.on('data', onData);
    vite.on('exit', () => reject(new Error('vite 退出')));
  });
}

function finish(code, why) {
  if (done) return;
  done = true;
  if (why) console.log('[unit] ' + why);
  try { if (vite) vite.kill(); } catch {}
  app.exit(code);
}

app.setPath('userData', '/tmp/bq/ud-unit');
app.whenReady().then(async () => {
  try { await ensureVite(); } catch (e) { return finish(2, 'vite 失敗: ' + e.message); }
  win = new BrowserWindow({
    width: 320, height: 280, show: false,
    webPreferences: { contextIsolation: true, backgroundThrottling: false },
  });
  win.webContents.on('console-message', (_e, _level, message) => {
    console.log('[renderer]', message);
    const dm = message.match(/UNIT T6-DUMP (\S+) data:image\/png;base64,(.+)$/);
    if (dm) {
      try { fs.writeFileSync(`/tmp/bq/unit_${dm[1]}.png`, Buffer.from(dm[2], 'base64')); } catch {}
    }
    if (message.includes('UNIT_SUMMARY')) {
      const m = message.match(/UNIT_SUMMARY (\{.*\})/);
      try {
        const s = JSON.parse(m[1]);
        finish(s.fail === 0 ? 0 : 1, `unit summary: pass=${s.pass} fail=${s.fail} skip=${s.skip}`);
      } catch { finish(1, 'UNIT_SUMMARY 解析失敗'); }
    }
  });
  win.webContents.once('did-fail-load', (_e, code, desc, url) =>
    finish(2, `載入失敗 ${code} ${desc} ${url}`));
  win.loadURL(DEV_URL + URL_PATH);
  setTimeout(() => finish(2, '逾時（60s 未見 UNIT_SUMMARY）'), TIMEOUT_MS);
});
