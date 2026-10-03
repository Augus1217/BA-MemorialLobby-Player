// 互動探針 runner：載入指定 lobby（PROBE=1&probeInteract=1），收集 [interact-probe]
// JSON 行存 /tmp/bq/interact_<lobby>.json，見 done 或逾時退出。
// 用法：electron tests/interact_main.js（env：LOBBY=Hanako_home）
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const DEV_URL = 'http://127.0.0.1:5173';
const LOBBY = process.env.LOBBY || 'Hanako_home';
const PROBE_MODE = process.env.PROBE_MODE || 'interact';   // interact | beam
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS) || (PROBE_MODE === 'beam' ? 300000 : 90000);
let vite = null, win = null, done = false;
const lines = [];

const outFile = () => PROBE_MODE === 'beam' ? `/tmp/bq/beam_${LOBBY}.json` : `/tmp/bq/interact_${LOBBY}.json`;

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
  if (why) console.log('[interact-runner] ' + why);
  try { fs.writeFileSync(outFile(), lines.join('\n') + '\n'); } catch {}
  try { if (vite) vite.kill(); } catch {}
  app.exit(code);
}
app.setPath('userData', `/tmp/bq/ud-interact-${LOBBY}`);
app.whenReady().then(async () => {
  try { await ensureVite(); } catch (e) { return finish(2, 'vite 失敗: ' + e.message); }
  win = new BrowserWindow({ width: Number(process.env.WIDTH) || 1600, height: Number(process.env.HEIGHT) || 900, show: true, webPreferences: { contextIsolation: true, backgroundThrottling: false } });
  win.webContents.on('console-message', (_e, _l, message) => {
    if (process.env.DEBUG_CONSOLE) console.log('[console] ' + message.slice(0, 220));
    if (message.includes('[interact-probe]')) {
      const m = message.match(/\[interact-probe\] (\{.*\})$/);
      if (m) {
        lines.push(m[1]); console.log('[probe-line] ' + m[1].slice(0, 160));
        if (m[1].includes('"done"')) finish(0, 'probe done');
        // beam 探針的存證幀：姿勢已凍結（autoUpdate=false），capturePage 非同步仍安全
        if (PROBE_MODE === 'beam' && m[1].includes('"capture"')) {
          try {
            const rec = JSON.parse(m[1]);
            win.webContents.capturePage().then((img) => {
              fs.writeFileSync(`/tmp/bq/beam_${rec.file || 'frame'}.png`, img.toPNG());
              console.log('[probe-capture] saved beam_' + (rec.file || 'frame') + '.png');
            }).catch((e) => console.log('[probe-capture] fail: ' + e.message));
          } catch {}
        }
      }
    } else if (/must be a child|uncaught|TypeError/.test(message)) {
      console.log('[probe-error] ' + message.slice(0, 200));
    }
  });
  const probeParam = PROBE_MODE === 'beam' ? 'probeBeam=1' : 'probeInteract=1';
  const extra = process.env.EXTRA || '';
  win.loadURL(`${DEV_URL}/#lobby=${LOBBY}&autostart=1&vignette=0&PROBE=1&${probeParam}${extra}`);
  setTimeout(() => finish(lines.length ? 0 : 2, '逾時（已收集 ' + lines.length + ' 行）'), TIMEOUT_MS);
});
