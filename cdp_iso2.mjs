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
  if (r.result?.data) { writeFileSync(`/tmp/opencode/d9_${name}.png`, Buffer.from(r.result.data, 'base64')); console.log('saved', name); }
}
// hide ALL except top_light via skipRender (pose preserved)
await evalJS(`(() => {
  const sp = window.ba_debug.spine;
  const sk = sp.skeleton;
  for (const slot of sk.slots) {
    if (slot.data.name === 'top_light') continue;
    const at = slot.getAttachment();
    if (!at || !sp.attachmentCacheData[slot.data.index]) continue;
    const cd = sp.attachmentCacheData[slot.data.index][at.name];
    if (cd) cd.skipRender = true;
  }
  const s = sk.findSlot('top_light');
  const at = s.getAttachment();
  const cd = sp.attachmentCacheData[s.data.index][at.name];
  cd.skipRender = false;
  sp.spineAttachmentsDirty = true;
  return true;
})()`);
await sleep(400);
async function blendShot(name, m) {
  await evalJS(`window.ba_debug.setSlotBlend('top_light', ${m}); window.ba_debug.dbgForceDirty(); true`);
  await sleep(400);
  await shot(name);
}
await blendShot('iso2_add', 1);
await blendShot('iso2_screen', 3);
await blendShot('iso2_normal', 0);
await blendShot('iso2_nolight', 1);
await evalJS(`(() => {
  const sp = window.ba_debug.spine;
  const s = sp.skeleton.findSlot('top_light');
  const at = s.getAttachment();
  const cd = sp.attachmentCacheData[s.data.index][at.name];
  cd.skipRender = true;
  sp.spineAttachmentsDirty = true;
  return true;
})()`);
await sleep(400);
await shot('iso2_nolight');
process.exit(0);
