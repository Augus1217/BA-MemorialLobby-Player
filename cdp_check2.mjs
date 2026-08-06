import { spawn, execSync } from 'child_process';
import { writeFileSync } from 'fs';
const PORT = 9257;
const APP = '/home/augus/BA_MemorialLobbyElectron';
try { execSync(`pkill -f "remote-debugging-port=${PORT}"`); } catch {}
try { execSync('pkill -f "electron ."'); } catch {}
await new Promise(r => setTimeout(r, 800));
const child = spawn('node_modules/.bin/electron', ['.', '--no-sandbox', `--remote-debugging-port=${PORT}`], { cwd: APP, stdio: ['ignore', 'inherit', 'inherit'] });
async function getTarget() {
  for (let i = 0; i < 90; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes('5173'));
      if (page) return page;
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('target not found');
}
const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
function send(method, params = {}) {
  return new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
async function evalJS(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
  return r.result?.result?.value;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
await send('Runtime.enable');
let ok = false;
for (let i = 0; i < 90; i++) {
  const v = await evalJS('typeof window.ba_debug');
  if (v === 'object') { ok = true; break; }
  await sleep(1000);
}
console.log('loaded:', ok);
await evalJS('document.getElementById("btnStudents").click()');
await sleep(500);
await evalJS('(() => { const el = [...document.querySelectorAll(".sb-item")].find(b => b.dataset.key === "CH0070_home"); el.click(); return true; })()');
await sleep(6000);
await evalJS('window.ba_debug.setTimeScale(0)');
await sleep(500);
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (r.result?.data) { writeFileSync(`/tmp/opencode/d2_${name}.png`, Buffer.from(r.result.data, 'base64')); console.log('saved', name); }
}
await shot('on');
// alpha 0 -> skipRender -> rebuild
await evalJS('window.spine.skeleton.findSlot("top_light").color.a = 0');
await evalJS('window.ba_debug.dbgForceDirty()');
await sleep(800);
await shot('off_alpha0');
console.log('live off:', JSON.stringify(await evalJS('window.ba_debug.dbgLightLive()')));
// restore alpha
await evalJS('window.spine.skeleton.findSlot("top_light").color.a = 0.4627451002597809');
await evalJS('window.ba_debug.dbgForceDirty()');
await sleep(800);
await shot('on_restored');
child.kill();
process.exit(0);
