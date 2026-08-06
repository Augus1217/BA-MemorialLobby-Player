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
  if (r.result?.data) { writeFileSync(`/tmp/opencode/d8_${name}.png`, Buffer.from(r.result.data, 'base64')); console.log('saved', name); }
}
async function setSkip(v) {
  await evalJS(`(() => {
    const sp = window.ba_debug.spine;
    const slot = sp.skeleton.findSlot('top_light');
    const at = slot.getAttachment();
    const cd = sp.attachmentCacheData[slot.data.index][at.name];
    cd.skipRender = ${v};
    sp.spineAttachmentsDirty = true;
    return true;
  })()`);
}
async function setBlend(m) {
  await evalJS(`window.ba_debug.setSlotBlend('top_light', ${m}); window.ba_debug.dbgForceDirty(); true`);
}
// 1. spine additive
await setSkip(false); await setBlend(1); await sleep(400); await shot('spine_add');
// 2. spine screen
await setSkip(false); await setBlend(3); await sleep(400); await shot('spine_screen');
// 3. spine normal
await setSkip(false); await setBlend(0); await sleep(400); await shot('spine_normal');
// 4. true no-light (skip)
await setSkip(true); await sleep(400); await shot('spine_nolight');
// 5. manual MeshSimple screen (light hidden)
await evalJS(`window.ba_debug.dbgShowMeshAlpha(0.4627451002597809, 'screen')`); await sleep(400); await shot('manual_screen');
// 6. manual MeshSimple add
await evalJS('window.ba_debug.dbgClearMeshes()');
await evalJS(`window.ba_debug.dbgShowMeshAlpha(0.4627451002597809, 'add')`); await sleep(400); await shot('manual_add');
// 7. manual MeshSimple normal
await evalJS('window.ba_debug.dbgClearMeshes()');
await evalJS(`window.ba_debug.dbgShowMeshAlpha(0.4627451002597809, 'normal')`); await sleep(400); await shot('manual_normal');
process.exit(0);
