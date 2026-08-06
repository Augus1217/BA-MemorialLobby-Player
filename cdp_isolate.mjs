import { writeFileSync } from 'fs';
const PORT = 9260;
async function getTarget() {
  for (let i = 0; i < 60; i++) {
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
await evalJS('window.ba_debug.dbgClearMeshes()');
await evalJS('document.getElementById("btnStudents").click()');
await sleep(500);
await evalJS('(() => { const el = [...document.querySelectorAll(".sb-item")].find(b => b.dataset.key === "CH0070_home"); el.click(); return true; })()');
await sleep(6000);
await evalJS('window.ba_debug.setTimeScale(0)');
await sleep(400);
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (r.result?.data) { writeFileSync(`/tmp/opencode/d6_${name}.png`, Buffer.from(r.result.data, 'base64')); console.log('saved', name); }
}
// hide ALL slots except top_light
await evalJS(`(() => {
  const sk = window.ba_debug.spine.skeleton;
  const keep = new Set(['top_light']);
  for (const s of sk.slots) {
    if (!keep.has(s.data.name) && s.getAttachment() && s.getAttachment().name) s.setAttachment(null);
  }
  window.ba_debug.dbgForceDirty();
  return true;
})()`);
await sleep(600);
console.log('drawOrder light:', await evalJS('window.ba_debug.dbgDrawOrder()'));
await shot('isol_add');
await evalJS('window.ba_debug.setSlotBlend("top_light", 3); window.ba_debug.dbgForceDirty(); true');
await sleep(500);
await shot('isol_screen');
await evalJS('window.ba_debug.setSlotBlend("top_light", 0); window.ba_debug.dbgForceDirty(); true');
await sleep(500);
await shot('isol_normal');
process.exit(0);
