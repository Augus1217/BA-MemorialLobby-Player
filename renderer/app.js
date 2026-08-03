import { Application, Assets } from 'pixi.js';
import { Spine } from '@esotericsoftware/spine-pixi-v8';

window.addEventListener('error', (e) => console.error('[renderer][uncaught]', e.message, e.filename, e.lineno));
window.addEventListener('unhandledrejection', (e) => console.error('[renderer][unhandled]', e.reason));

const app = new Application();

// ---- minimal HUD refs ----
const hud = document.getElementById('hud');
const charNameEl = document.getElementById('charName');
const subNameEl = document.getElementById('subName');
const loadingEl = document.getElementById('loading');
const loadingText = document.getElementById('loadingText');
const errEl = document.getElementById('err');
const fadeEl = document.getElementById('fade');
const btnPrev = document.getElementById('btnPrev');
const btnNext = document.getElementById('btnNext');
const btnBgm = document.getElementById('btnBgm');

function showErr(msg) {
  errEl.style.display = 'block';
  errEl.textContent = String(msg);
  console.error('[renderer]', msg?.stack || msg);
}
const log = (s) => console.log('[lobby]', s);

// ---- state ----
let spine = null;          // character skeleton
let scene = null;          // room overlay skeleton (when available)
let currentLobby = null;
let LOBBY_INDEX = {};
let SCHEDULE = null;
let BGM_MAP = {};
let ORDER = [];

// ---- camera (lobby_camera_config.json) ----
const CAMERA = { maxScale: 4, weight: 0.5 };
let cam = { x: 0, y: 0, scale: 1 };
let charScale = 1;
let sceneScale = 1;
let sceneBiasY = 0;
let fitted = false;
let cameraTargetY = 0;     // 相機線骨架（Camera_Pos/Root/All_Layer）的 setup-pose 世界 Y
let downTime = 0;
let downPos = null;
let longPressTimer = null;
let patting = false;
let userActiveAt = 0;

// ---- eyes follow cursor (drives the same bones Look_01_M animates) ----
let mouse = { x: -9999, y: -9999, active: false };
let eyeBones = null;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Compute per-layer base fit.
// The in-game camera centres on a marker bone (Camera_Pos / Camera_Root,
// or All_Layer for e.g. CH0070). We scale the character with kivo's "fill"
// rule (view width / 3000 against the standard 3000-unit skeleton) and place
// the camera line at the vertical centre of the view, which puts the
// character's chest/face mid-screen with the ground near the bottom edge.
function boneWorldY(bone) {
  let y = 0;
  for (let b = bone; b; b = b.parent) y += b.data.y;
  return y;
}
function fitScene() {
  const vw = app.renderer.width, vh = app.renderer.height;

  if (scene) {
    const b = scene.getBounds();
    if (b && b.maxX > b.minX) {
      sceneScale = Math.max(vw / (b.maxX - b.minX), vh / (b.maxY - b.minY));
    }
  } else {
    sceneScale = 1;
  }

  if (spine) {
    const camPos =
      spine.skeleton.findBone('Camera_Pos') ||
      spine.skeleton.findBone('Camera_Root') ||
      spine.skeleton.findBone('All_Layer');
    cameraTargetY = camPos ? boneWorldY(camPos) : 962;   // 962 = 遊戲標準相機線
    charScale = vw / 3000;                                // kivo fill 統一縮放
    sceneBiasY = cameraTargetY * charScale;               // 相機線置於畫面垂直中央
  }

  cam.scale = 1;   // 無使用者縮放（zoom/scroll/pinch 已移除）
  cam.x = 0;
  cam.y = 0;
  fitted = true;
  applyCamera(1);
}

function applyCamera(w) {
  const k = clamp(w, 0, 1);
  const vw = app.renderer.width, vh = app.renderer.height;

  if (scene) {
    scene.scale.set(
      scene.scale.x + (sceneScale * cam.scale - scene.scale.x) * k,
      scene.scale.y + (sceneScale * cam.scale - scene.scale.y) * k,
    );
    scene.x += (vw / 2 - cam.x - scene.x) * k;
    scene.y += (vh * 0.5 + sceneBiasY - cam.y - scene.y) * k;
  }
  if (spine) {
    const targetS = charScale * cam.scale;
    spine.scale.set(
      spine.scale.x + (targetS - spine.scale.x) * k,
      spine.scale.y + (targetS - spine.scale.y) * k,
    );
    spine.x += (vw / 2 - cam.x - spine.x) * k;
    spine.y += (vh * 0.5 + sceneBiasY - cam.y - spine.y) * k;
  }
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

// Drive the mouth bones from live voice amplitude (on top of the baked _M lip sync),
// and the eye bones from the cursor (eyes follow cursor).
function setupLipHook(target) {
  const bones = target.state.data.skeletonData.bones;
  const indices = [];
  for (let i = 0; i < bones.length; i++) {
    if (/mouth/i.test(bones[i].name)) indices.push(i);
  }
  target._mouthIndices = indices;
  target.beforeUpdateWorldTransforms = (self) => {
    if (lipActive && lipAnalyser && self._mouthIndices.length) {
      lipAnalyser.getByteTimeDomainData(lipBuf);
      let sum = 0;
      for (let i = 0; i < lipAnalyser.fftSize; i++) {
        const v = lipBuf[i] - 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / lipAnalyser.fftSize) / 128;
      const boost = 1 + Math.min(1, rms * 6) * 0.35;
      for (const i of self._mouthIndices) self.skeleton.bones[i].scaleY *= boost;
    }
    applyEyeFollow(self);
  };
}

// ---- eyes follow cursor ----
// Basis: 264/279 lobbies ship Look_01_M / Look_01, a single-pose animation that
// translates the eye bones by their "looking" offsets. We drive those same bones
// every frame toward the cursor, clamped to each lobby's own pose offsets.
function setupEyes() {
  eyeBones = null;
  if (!spine) return;
  const name = has('Look_01_M') ? 'Look_01_M' : has('Look_01') ? 'Look_01' : null;
  if (!name) return;
  const look = spine.state.data.skeletonData.findAnimation(name);
  const list = [];
  for (const tl of look.timelines) {
    if (tl.boneIndex === undefined || tl.constructor.name !== 'TranslateTimeline') continue;
    const f = tl.frames;
    const n = f.length;
    list.push({ index: tl.boneIndex, ox: f[n - 3 + 1], oy: f[n - 3 + 2], x: 0, y: 0 });
  }
  if (list.length) {
    eyeBones = list;
    log(`眼睛跟隨: ${list.length} 骨骼 (${name}) — ${list.map(b=>b.index).join(',')}`);
  }
}

function applyEyeFollow(self) {
  if (!eyeBones || !self.skeleton) return;
  // 說話/摸頭時由 _M 動畫控制表情，眼睛跟隨暫停（緩慢歸零，不覆寫動畫）
  if (state.busy) {
    for (const b of eyeBones) { b.x *= 0.9; b.y *= 0.9; }
    return;
  }
  const bones = self.skeleton.bones;
  const sx = (mouse.x - self.x) / self.scale.x;
  const sy = (mouse.y - self.y) / self.scale.y;
  for (const b of eyeBones) {
    const bone = bones[b.index];
    if (!bone || !bone.getWorldX) continue;
    const ex = bone.getWorldX(), ey = bone.getWorldY();
    const dx = sx - ex, dy = sy - ey;
    const dist = Math.hypot(dx, dy);
    let tx = 0, ty = 0;
    if (mouse.active && dist > 14) {
      const p = bone.parent;
      if (!p) continue;
      const R = 150;
      const ldx = dx * p.a + dy * p.b;
      const ldy = dx * p.c + dy * p.d;
      tx = b.ox * clamp(ldx / R, -1, 1);
      ty = b.oy * clamp(ldy / R, -1, 1);
    }
    b.x += (tx - b.x) * 0.16;
    b.y += (ty - b.y) * 0.16;
    bone.x = b.x;
    bone.y = b.y;
  }
}

let currentLobbyVoiceFolder = null;
let voiceCalls = 0;

function playVoice(voiceId) {
  voiceCalls++;
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
  const stopLip = () => { lipActive = false; };
  audio.onplay = () => { lipActive = true; };
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
}

let lastVoiceId = null;
let lastVoiceTime = 0;
const voiceSkip = new Set();

// ---- BGM ----
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
  audio.volume = 0.42;
  audio.play().catch(() => {});
  bgmAudio = audio;
}

function toggleBgm() {
  bgmOn = !bgmOn;
  btnBgm.classList.toggle('off', !bgmOn);
  if (!bgmOn && bgmAudio) {
    bgmAudio.pause();
  } else if (bgmOn) {
    setBgm(BGM_MAP[currentLobby]);
  }
  log(`BGM: ${bgmOn ? '開' : '關'}`);
}

// ---- behavior (mimics the in-game spine playback model) ----
//   Track 0: Start_Idle_01 (once) -> Idle_01 (loop)
//   Track 1: reactive _M (talk/look/pat, lip + mouth)
//   Track 2: reactive _A (secondary, synced with _M)
const state = {
  busy: null,        // 'talk' | 'pat' | null
  autonomy: null,    // scheduled timeout
  timers: [],
};

function animNames() {
  return spine.state.data.skeletonData.animations.map(a => a.name);
}
function has(name) { return spine && animNames().includes(name); }
function hasAny(prefix) { return animNames().some(n => n.startsWith(prefix)); }

function after(ms, fn) {
  const id = setTimeout(fn, ms);
  state.timers.push(id);
  return id;
}
function clearTimers() {
  for (const id of state.timers) clearTimeout(id);
  state.timers = [];
  clearTimeout(state.autonomy);
}

function playStart() {
  if (!spine) return;
  spine.state.setAnimation(0, 'Start_Idle_01', false);
  spine.state.addAnimation(0, 'Idle_01', true, 0);
}

function restTracks() {
  if (!spine) return;
  spine.state.setEmptyAnimation(1, 0.45);
  spine.state.setEmptyAnimation(2, 0.45);
}

function playTalk() {
  if (!spine || state.busy === 'pat') return;
  state.busy = 'talk';
  const talks = animNames().filter(n => n.startsWith('Talk_') && n.endsWith('_M'));
  if (!talks.length) { state.busy = null; return; }
  const m = pick(talks);
  const a = m.replace(/_M$/, '_A');
  spine.state.setAnimation(1, m, false);
  if (animNames().includes(a)) spine.state.setAnimation(2, a, false);
  else spine.state.setEmptyAnimation(2, 0.3);
  after(spine.state.data.skeletonData.findAnimation(m).duration * 1000 + 600, () => {
    if (state.busy !== 'talk') return;
    restTracks();
    state.busy = null;
    scheduleAutonomy();
  });
  log(`互動: ${m}`);
}

function startPat() {
  if (!spine || patting) return;
  patting = true;
  if (!has('Pat_01_M')) { patting = false; return; }
  clearTimers();              // interrupt an ongoing talk / look
  state.busy = 'pat';
  spine.state.setAnimation(1, 'Pat_01_M', true);
  if (has('Pat_01_A')) spine.state.setAnimation(2, 'Pat_01_A', true);
  log('摸頭');
}

function endPat() {
  if (!spine || !patting) return;
  patting = false;
  if (state.busy !== 'pat') return;
  state.busy = null;
  spine.state.setAnimation(1, 'PatEnd_01_M', false);
  if (has('PatEnd_01_A')) spine.state.setAnimation(2, 'PatEnd_01_A', false);
  after(1200, () => {
    if (state.busy || patting) return;
    restTracks();
    scheduleAutonomy();
  });
  log('摸頭結束');
}

function scheduleAutonomy() {
  clearTimeout(state.autonomy);
  state.autonomy = setTimeout(() => {
    if (!spine || state.busy) { scheduleAutonomy(); return; }
    if (Math.random() < 0.5 && hasAny('Talk_')) playTalk();
    else scheduleAutonomy();
  }, rand(7000, 15000));
}

// ---- asset loading ----
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

function prettyName(name) {
  return name.replace(/_home$/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

async function loadScene(entry) {
  if (scene) { scene.destroy(); scene = null; }
  const s = entry?.scene;
  if (!s) return;
  try {
    await Assets.load(`assets/scene/${currentLobby}/${s.skel}`);
    await Assets.load(`assets/scene/${currentLobby}/${s.atlas}`);
    scene = Spine.from({ skeleton: `assets/scene/${currentLobby}/${s.skel}`, atlas: `assets/scene/${currentLobby}/${s.atlas}` });
    app.stage.addChildAt(scene, 0);
    const anims = scene.state.data.skeletonData.animations;
    scene.state.setAnimation(0, anims[0].name, true);
    log(`場景: ${currentLobby} (${anims[0].name})`);
  } catch (e) {
    console.warn('[lobby] 場景載入失敗，略過', e);
    if (scene) { scene.destroy(); scene = null; }
  }
}

async function loadLobby(name) {
  if (spine) {
    spine.state.clearListeners?.();
    spine.destroy();
    spine = null;
  }
  clearTimers();
  state.busy = null;
  patting = false;

  const entry = LOBBY_INDEX[name];
  if (!entry) { showErr(`索引中無 ${name}`); return; }
  loadingEl.classList.add('show');
  loadingText.textContent = `載入 ${prettyName(name)}`;
  try {
    const charAssets = entry.skel && entry.atlas
      ? [`assets/spine/${name}/${entry.skel}`, `assets/spine/${name}/${entry.atlas}`]
      : [];
    await Promise.all(charAssets.map(a => Assets.load(a)));
    spine = Spine.from({ skeleton: charAssets[0], atlas: charAssets[1] });
    const sch = SCHEDULE?.lobbies?.[name];
    currentLobbyVoiceFolder = sch?.voiceFolder || null;
    voiceSkip.clear();
    for (const m of sch?.missingMedia || []) voiceSkip.add(m);
    spine.state.addListener({ event: onAnimationEvent, complete: onTrackComplete });
    spine.state.data.defaultMix = 0.25;
    setupLipHook(spine);
    setupEyes();
    app.stage.addChild(spine);
    currentLobby = name;
  } catch (e) {
    showErr(`載入 ${name} 失敗:\n${e.message}`);
    loadingEl.classList.remove('show');
    return;
  }

  await loadScene(entry);
  app.stage.setChildIndex(spine, Math.max(0, app.stage.children.length - 2));
  fitted = false;
  // frame on the Idle pose (mesh geometry only exists after a render), then play the intro
  spine.state.setAnimation(0, 'Idle_01', true);
  let frames = 0;
  const waitFit = () => {
    if (++frames < 3) requestAnimationFrame(waitFit);
    else {
      fitScene();
      playStart();
      log(`[layout] ${name}: scene=${!!scene} charScale=${charScale.toFixed(3)} cameraTargetY=${cameraTargetY.toFixed(0)}`);
    }
  };
  requestAnimationFrame(waitFit);
  setBgm(BGM_MAP[name]);
  charNameEl.textContent = prettyName(name);
  subNameEl.textContent = 'MEMORIAL LOBBY';
  scheduleAutonomy();
  loadingEl.classList.remove('show');
  fadeOut();
  log(`${name} 載入完成 — ${prettyName(name)}`);
}

let fadeTimer = null;
function fadeIn() {
  fadeEl.classList.add('on');
  return new Promise((res) => {
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(res, 720);
  });
}
function fadeOut() {
  fadeEl.classList.remove('on');
}

function switchLobby(dir) {
  if (!ORDER.length || loadingEl.classList.contains('show')) return;
  const i = ORDER.indexOf(currentLobby);
  const next = ORDER[(i + dir + ORDER.length) % ORDER.length];
  if (next === currentLobby) return;
  fadeIn().then(() => loadLobby(next));
}

// spine track completion -> return reactive tracks to rest
function onTrackComplete(entry) {
  if (entry.trackIndex === 1 && !state.busy) {
    if (state.busy === 'talk') return; // handled by timer
    restTracks();
  }
}

// ---- input (only pat / tap — no drag, zoom, pan) ----
function onPointerDown(e) {
  ensureAudio();
  userActiveAt = performance.now();
  if (bgmOn && !bgmAudio) setBgm(BGM_MAP[currentLobby]);
  if (e.pointerType === 'touch') e.preventDefault();
  downTime = performance.now();
  downPos = { x: e.clientX, y: e.clientY };
  longPressTimer = setTimeout(() => {
    if (state.busy !== 'pat' && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) < 10) {
      startPat();
    }
  }, 420);
}

function onPointerMove(e) {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  mouse.active = true;
  if (longPressTimer && downPos && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 7) {
    clearTimeout(longPressTimer);
  }
  hud.classList.toggle('idle', performance.now() - userActiveAt > 2600);
}

function onPointerUp(e) {
  clearTimeout(longPressTimer);
  if (downPos && state.busy !== 'pat') {
    const dt = performance.now() - downTime;
    const d = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    if (dt < 340 && d < 10) playTalk();
  }
  if (patting) endPat();
  downPos = null;
  downTime = 0;
}

// ---- init ----
async function init() {
  await app.init({ resizeTo: window, antialias: true, backgroundColor: 0x05060d, autoDensity: true });
  const canvas = app.canvas;
  document.getElementById('app').appendChild(canvas);

  try {
    const cr = await fetchRetry('assets/data/lobby_camera_config.json');
    const c = await cr.json();
    if (typeof c.MaxScale === 'number') CAMERA.maxScale = c.MaxScale;
    if (typeof c.Weight === 'number') CAMERA.weight = c.Weight;
  } catch (e) {
    console.warn('[lobby] 鏡頭設定載入失敗，使用預設', e);
  }

  const idx = await fetchRetry('assets/lobby_index.json').then(r => r.json());
  LOBBY_INDEX = idx;
  ORDER = Object.keys(idx);
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

  // camera smoothing
  app.ticker.add(() => {
    if (spine && fitted) applyCamera(CAMERA.weight);
  });
  // input
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  document.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
    hud.classList.toggle('idle', performance.now() - userActiveAt > 2600);
    userActiveAt = performance.now();
  });
  document.addEventListener('mouseleave', () => { mouse.active = false; });
  window.addEventListener('blur', () => { mouse.active = false; });
  btnPrev.addEventListener('click', () => switchLobby(-1));
  btnNext.addEventListener('click', () => switchLobby(1));
  btnBgm.addEventListener('click', toggleBgm);

  if (ORDER.length) {
    const m = location.hash.match(/^#lobby=([^&]+)/);
    const first = m && LOBBY_INDEX[m[1]] ? m[1] : ORDER[0];
    await loadLobby(first);
  } else {
    showErr('assets/lobby_index.json 為空');
  }
}

init().catch(showErr);
