import { writeFileSync } from 'fs';
const PORT = 9260;
const LOBBY = process.env.CHAT_LOBBY || 'Airi_home';
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
await send('Page.enable');
console.log('connected; reloading to pick up new app.js');
await send('Page.reload', { ignoreCache: true });
await sleep(4000);
for (let i = 0; i < 60; i++) {
  const v = await evalJS('typeof window.ba_debug');
  if (v === 'object') { break; }
  await sleep(1000);
}
console.log('renderer loaded');
console.log('switching to', LOBBY);
await evalJS('document.getElementById("btnStudents").click()');
await sleep(400);
await evalJS(`(() => { const el = [...document.querySelectorAll(".sb-item")].find(b => b.dataset.key === ${JSON.stringify(LOBBY)}); if (el) { el.click(); return true; } return false; })()`);
await sleep(6000);
let voices = [];
for (let i = 0; i < 60; i++) {
  const st = await evalJS('window.ba_debug.state()');
  if (st && st.validVoices && st.validVoices.length) { voices = st.validVoices; break; }
  await sleep(1000);
}
console.log('lobby ready:', LOBBY, 'validVoices:', voices.length);
console.log('subtitleKeys:', await evalJS('window.ba_debug.subtitleKeys()'));
console.log('headPos:', JSON.stringify(await evalJS('window.ba_debug.headPos()')));
console.log('triggering talk…');
await evalJS('window.ba_debug.triggerTalk()');
let shown = false;
for (let i = 0; i < 80; i++) {
  shown = await evalJS('document.getElementById("chatDialog").classList.contains("show")');
  if (shown) break;
  await sleep(100);
}
console.log('bubble shown:', shown);
await sleep(300);
const info = await evalJS(`(() => {
  const d = document.getElementById('chatDialog');
  const t = document.getElementById('chatText');
  const r = d.getBoundingClientRect();
  const cs = getComputedStyle(d);
  const tcs = getComputedStyle(t);
  return {
    show: d.classList.contains('show'),
    rect: { x: r.x, y: r.y, w: r.width, h: r.height },
    text: t.textContent,
    biSource: cs.borderImageSource.slice(0, 80),
    biSlice: cs.borderImageSlice,
    borderTop: cs.borderTopWidth, borderRight: cs.borderRightWidth,
    borderBottom: cs.borderBottomWidth, borderLeft: cs.borderLeftWidth,
    font: tcs.fontSize, color: tcs.color, opacity: cs.opacity,
    transform: cs.transform,
  };
})()`);
console.log('chat:', JSON.stringify(info, null, 2));
const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) {
  const f = `/tmp/opencode/chat_balloon_verify.png`;
  writeFileSync(f, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', f);
}
process.exit(0);
