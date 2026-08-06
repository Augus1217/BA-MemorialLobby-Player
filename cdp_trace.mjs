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
await evalJS('document.getElementById("btnStudents").click()');
await sleep(500);
await evalJS('(() => { const el = [...document.querySelectorAll(".sb-item")].find(b => b.dataset.key === "CH0070_home"); el.click(); return true; })()');
await sleep(6000);
await evalJS('window.ba_debug.setTimeScale(0)');
await sleep(400);

async function traceFor(name, setupFn) {
  await evalJS('window.ba_debug.dbgClearMeshes()');
  await evalJS(`window.__trBatches = []`);
  await evalJS('window.ba_debug.dbgTraceBatches(true)');
  await evalJS(setupFn);
  await sleep(600);
  await evalJS('window.ba_debug.dbgTraceBatches(false)');
  const batches = await evalJS('window.__trBatches');
  const counts = {};
  for (const b of batches) {
    const k = `${b.blend}|${b.texUid}`;
    counts[k] = (counts[k] || 0) + 1;
  }
  console.log(`\n=== ${name} (${batches.length} draw calls) ===`);
  console.log('blend|texUid -> count:', JSON.stringify(counts));
  const screenish = batches.filter(b => b.blend.includes('screen'));
  console.log('screen batches:', JSON.stringify(screenish.slice(0, 20)));
  const last5 = batches.slice(-8).map(b => `${b.blend}:${b.size}`);
  console.log('last draws:', last5.join(', '));
}

// baseline (additive)
await traceFor('BASELINE add', 'true');

// switch top_light to screen
await traceFor('TOP_LIGHT SCREEN', `window.ba_debug.setSlotBlend("top_light", 3); window.ba_debug.dbgForceDirty(); true`);

// switch top_light to normal
await traceFor('TOP_LIGHT NORMAL', `window.ba_debug.setSlotBlend("top_light", 0); window.ba_debug.dbgForceDirty(); true`);

// switch top_light back to add
await traceFor('TOP_LIGHT ADD', `window.ba_debug.setSlotBlend("top_light", 1); window.ba_debug.dbgForceDirty(); true`);

process.exit(0);
