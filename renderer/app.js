import { Application, Assets } from 'pixi.js';
import { Spine } from '@esotericsoftware/spine-pixi-v8';

const app = new Application();
const lobbySelect = document.getElementById('lobbySelect');
const statusEl = document.getElementById('status');
const errEl = document.getElementById('err');
const lipEl = document.getElementById('lip');

function showErr(msg) {
  errEl.style.display = 'block';
  errEl.textContent = String(msg);
  console.error('[renderer]', msg?.stack || msg);
}
function setStatus(s) {
  statusEl.textContent = s;
  console.log('[lobby]', s);
}

async function listLobbies() {
  const resp = await fetch('assets/lobby_index.json');
  const idx = await resp.json();
  return idx;
}

let spine = null;
let currentLobby = null;
let LOBBY_INDEX = {};
let SCHEDULE = null;
let BGM_MAP = {};

// ---- camera (lobby_camera_config.json) ----
const CAMERA = { maxScale: 4, weight: 0.5 };
let cam = { x: 0, y: 0, scale: 1 };
let baseFitScale = 1;
let dragging = false;
let lastPoint = null;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

// Fit the skeleton into the viewport and remember the target framing.
function fitCamera() {
  if (!spine) return;
  spine.scale.set(1);
  spine.x = 0;
  spine.y = 0;
  const b = spine.getBounds();
  if (!b || b.maxX <= b.minX || b.maxY <= b.minY) return;
  const vw = app.renderer.width;
  const vh = app.renderer.height;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  baseFitScale = Math.min(vw / w, vh / h) * 0.85;
  cam.scale = baseFitScale;
  cam.x = vw / 2 - cx * cam.scale;
  cam.y = vh / 2 - cy * cam.scale;
  applyCamera(1);
}

// Ease the spine transform toward the camera target each frame (Weight).
function applyCamera(w) {
  const k = clamp(w, 0, 1);
  spine.scale.set(
    spine.scale.x + (cam.scale - spine.scale.x) * k,
    spine.scale.y + (cam.scale - spine.scale.y) * k,
  );
  spine.x += (cam.x - spine.x) * k;
  spine.y += (cam.y - spine.y) * k;
}

// ---- voice + lip-sync ----
let audioCtx = null;
let lipAnalyser = null;
let lipActive = false;
const lipBuf = new Uint8Array(1024);

function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
    lipAnalyser = audioCtx.createAnalyser();
    lipAnalyser.fftSize = 512;
    lipAnalyser.smoothingTimeConstant = 0.6;
    lipAnalyser.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// Drive the mouth bones from live voice amplitude (on top of the baked _M lip sync).
function setupLipHook(target) {
  const bones = target.state.data.skeletonData.bones;
  const indices = [];
  for (let i = 0; i < bones.length; i++) {
    if (/mouth/i.test(bones[i].name)) indices.push(i);
  }
  target._mouthIndices = indices;
  target.beforeUpdateWorldTransforms = (self) => {
    if (!lipActive || !lipAnalyser || !self._mouthIndices.length) return;
    lipAnalyser.getByteTimeDomainData(lipBuf);
    let sum = 0;
    for (let i = 0; i < lipAnalyser.fftSize; i++) {
      const v = lipBuf[i] - 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / lipAnalyser.fftSize) / 128;
    const boost = 1 + Math.min(1, rms * 6) * 0.35;
    for (const i of self._mouthIndices) self.skeleton.bones[i].scaleY *= boost;
  };
}

function playVoice(voiceId) {
  const name = voiceId.toLowerCase();
  const base = `assets/voice/${currentLobbyVoiceFolder}/${name}.ogg`;
  const audio = new Audio(base);
  const ctx = ensureAudio();
  if (ctx) {
    try {
      const src = ctx.createMediaElementSource(audio);
      src.connect(lipAnalyser);
    } catch (e) {
      console.warn('[lobby] media element source 失敗', e);
    }
  }
  const stopLip = () => {
    lipEl.classList.remove('talking');
    lipActive = false;
  };
  audio.onplay = () => {
    lipEl.classList.add('talking');
    lipActive = true;
  };
  audio.onended = stopLip;
  audio.onerror = stopLip;
  audio.play().catch(() => stopLip());
}

function onAnimationEvent(_entry, ev) {
  let voiceId = null;
  if (ev.data.name.startsWith('Sound/')) voiceId = ev.data.name.slice(6);
  else if (ev.data.name === 'Talk' && ev.stringValue) voiceId = ev.stringValue;
  if (!voiceId) return;
  if (voiceSkip.has(voiceId)) return;
  // Sound/ 與 Talk 事件在同時刻成對出現，避免重複播放
  const now = performance.now();
  if (voiceId === lastVoiceId && now - lastVoiceTime < 500) return;
  lastVoiceId = voiceId;
  lastVoiceTime = now;
  playVoice(voiceId);
  setStatus(`語音: ${voiceId}`);
}

let lastVoiceId = null;
let lastVoiceTime = 0;
const voiceSkip = new Set();

let bgmAudio = null;
let bgmOn = true;

function setBgm(filename) {
  if (bgmAudio) {
    bgmAudio.pause();
    bgmAudio.src = '';
    bgmAudio = null;
  }
  if (!bgmOn || !filename) return;
  const audio = new Audio(`assets/bgm/${filename}`);
  audio.loop = true;
  audio.volume = 0.5;
  audio.play().catch(() => {});
  bgmAudio = audio;
}

function toggleBgm() {
  bgmOn = !bgmOn;
  if (!bgmOn && bgmAudio) {
    bgmAudio.pause();
  } else if (bgmOn) {
    setBgm(BGM_MAP[currentLobby]);
  }
  setStatus(`BGM: ${bgmOn ? '開' : '關'}`);
}

let currentLobbyVoiceFolder = null;

async function loadLobby(name) {
  setStatus(`載入 ${name} ...`);
  if (spine) {
    spine.destroy();
    spine = null;
  }
  const entry = LOBBY_INDEX[name];
  if (!entry) {
    showErr(`索引中無 ${name}`);
    return;
  }
  const asset = (rel) => `assets/spine/${name}/${rel}`;
  try {
    const scale = app.renderer.width / 3000;
    await Assets.load(asset(entry.skel));
    await Assets.load(asset(entry.atlas));
    spine = Spine.from({ skeleton: asset(entry.skel), atlas: asset(entry.atlas) });
    const sch = SCHEDULE?.lobbies?.[name];
    currentLobbyVoiceFolder = sch?.voiceFolder || null;
    voiceSkip.clear();
    for (const m of sch?.missingMedia || []) voiceSkip.add(m);
    spine.state.addListener({ event: onAnimationEvent });
    setupLipHook(spine);
    spine.scale.set(scale);
    spine.x = app.renderer.width / 2;
    spine.y = app.renderer.height * 0.98;
    app.stage.addChild(spine);
    currentLobby = name;
    setBgm(BGM_MAP[name]);
    const anims = spine.state.data.skeletonData.animations.map(a => a.name);
    spine.state.setAnimation(0, 'Idle_01', true);
    requestAnimationFrame(fitCamera);
    setStatus(`${name} 載入完成 (${anims.length} 動畫) — 播放 Idle_01`);
    return anims;
  } catch (e) {
    showErr(`載入 ${name} 失敗:\n${e.message}`);
    setStatus('載入失敗');
  }
}

function playTalk() {
  if (!spine) return;
  const talks = spine.state.data.skeletonData.animations
    .map(a => a.name)
    .filter(n => n.startsWith('Talk_') && n.endsWith('_M'));
  if (!talks.length) { setStatus('無 Talk 動畫'); return; }
  const pick = talks[Math.floor(Math.random() * talks.length)];
  spine.state.setAnimation(1, pick, false);
  spine.state.addAnimation(1, 'Idle_01', true, 0);
  setStatus(`播放 ${pick} (Track 1)`);
}

document.getElementById('playStart').onclick = () => {
  if (!spine) return;
  spine.state.setAnimation(0, 'Start_Idle_01', false);
  spine.state.addAnimation(0, 'Idle_01', true, 0);
  setStatus('播放 Start_Idle_01 → Idle_01');
};
document.getElementById('playIdle').onclick = () => {
  if (!spine) return;
  spine.state.setAnimation(0, 'Idle_01', true);
  setStatus('播放 Idle_01 (Track 0, 循環)');
};
document.getElementById('playTalk').onclick = playTalk;
document.getElementById('playPat').onclick = () => {
  if (!spine) return;
  spine.state.setAnimation(2, 'Pat_01_A', true);
  setStatus('播放 Pat_01_A (Track 2, 循環)');
};
document.getElementById('toggleBgm').onclick = toggleBgm;

lobbySelect.onchange = () => loadLobby(lobbySelect.value);

async function fetchRetry(url, retries = 4) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return r;
    } catch (e) {
      if (i >= retries - 1) throw e;
    }
    await new Promise((res) => setTimeout(res, 300 * (i + 1)));
  }
}

async function init() {
  await app.init({ resizeTo: window, antialias: true, backgroundColor: 0x12122a });
  const canvas = app.canvas;
  document.getElementById('app').appendChild(canvas);

  // camera config
  try {
    const cr = await fetchRetry('assets/data/lobby_camera_config.json');
    const c = await cr.json();
    if (typeof c.MaxScale === 'number') CAMERA.maxScale = c.MaxScale;
    if (typeof c.Weight === 'number') CAMERA.weight = c.Weight;
  } catch (e) {
    console.warn('[lobby] 鏡頭設定載入失敗，使用預設', e);
  }

  const idx = await listLobbies();
  LOBBY_INDEX = idx;
  try {
    const sr = await fetchRetry('assets/data/lobby_voice_schedule.json');
    SCHEDULE = await sr.json();
  } catch (e) {
    console.warn('[lobby] 語音排程載入失敗，語音將無法播放', e);
  }
  try {
    const br = await fetchRetry('assets/data/lobby_bgm_mapping.csv');
    const txt = await br.text();
    for (const line of txt.trim().split('\n').slice(1)) {
      const cols = line.split(',');
      if (cols.length < 5) continue;
      BGM_MAP[cols[1].trim() + '_home'] = cols[4].trim();
    }
  } catch (e) {
    console.warn('[lobby] BGM 對照載入失敗', e);
  }

  // camera smoothing loop
  app.ticker.add(() => {
    if (spine) applyCamera(CAMERA.weight);
  });

  // wheel zoom (toward cursor), clamped to CAMERA.maxScale
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!spine) return;
    const factor = Math.exp(-e.deltaY * 0.0015);
    cam.scale = clamp(cam.scale * factor, baseFitScale * 0.3, baseFitScale * CAMERA.maxScale);
    const sx = (e.clientX - spine.x) / spine.scale.x;
    const sy = (e.clientY - spine.y) / spine.scale.y;
    cam.x = e.clientX - sx * cam.scale;
    cam.y = e.clientY - sy * cam.scale;
  }, { passive: false });

  // drag to pan
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastPoint = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    cam.x += e.clientX - lastPoint.x;
    cam.y += e.clientY - lastPoint.y;
    lastPoint = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('pointerup', () => { dragging = false; });
  window.addEventListener('pointercancel', () => { dragging = false; });

  const names = Object.keys(idx);
  for (const name of names) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    lobbySelect.appendChild(opt);
  }
  setStatus(`已列舉 ${names.length} 個大廳`);
  if (names.length) await loadLobby(names[0]);
  else showErr('assets/lobby_index.json 為空');
}

init().catch(showErr);
