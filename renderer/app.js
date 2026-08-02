import { Application, Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { Spine } from '@esotericsoftware/spine-pixi-v8';

window.addEventListener('error', (e) => console.error('[renderer][uncaught]', e.message, e.filename, e.lineno));
window.addEventListener('unhandledrejection', (e) => console.error('[renderer][unhandled]', e.reason));

const app = new Application();

// ---- minimal HUD refs ----
const hud = document.getElementById('hud');
const charNameEl = document.getElementById('charName');
const subNameEl = document.getElementById('subName');
const hintEl = document.getElementById('hint');
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
let particles = null;
let currentLobby = null;
let LOBBY_INDEX = {};
let SCHEDULE = null;
let BGM_MAP = {};
let ORDER = [];

// ---- camera (lobby_camera_config.json) ----
const CAMERA = { maxScale: 4, weight: 0.5 };
let cam = { x: 0, y: 0, scale: 1 };
let baseFitScale = 1;      // reference fit for zoom clamps
let charFillScale = 1;     // character fills the playback area
let sceneFitScale = 1;
let sceneBiasY = 0;
let fitted = false;
let pinch = null;
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

// Compute per-layer base fit (composition = scene behind, character in front).
function fitScene() {
  const vw = app.renderer.width, vh = app.renderer.height;
  // scene (room) fills the viewport
  if (scene) {
    const b = scene.getBounds();
    if (b && b.maxX > b.minX) {
      sceneFitScale = Math.max(vw / (b.maxX - b.minX), vh / (b.maxY - b.minY));
    }
  } else {
    sceneFitScale = 1;
  }
  // character fills the playback area (anchored feet at 88% height, face keeps a top margin)
  if (spine) {
    const b = spine.getBounds();
    if (b && b.maxX > b.minX) {
      const w = b.maxX - b.minX, h = b.maxY - b.minY;
      charFillScale = Math.max(vw / w, (vh * 0.84) / h);
    }
  }
  baseFitScale = charFillScale || sceneFitScale || 1;
  cam.scale = baseFitScale;
  cam.x = 0;
  cam.y = 0;
  fitted = true;
  applyCamera(1);
}

const P_BG = 0.72;   // background parallax (moves slower than character)

function applyCamera(w) {
  const k = clamp(w, 0, 1);
  const vw = app.renderer.width, vh = app.renderer.height;
  const idle = idleDrift();

  if (scene) {
    scene.scale.set(
      scene.scale.x + (sceneFitScale * cam.scale * P_BG - scene.scale.x) * k,
      scene.scale.y + (sceneFitScale * cam.scale * P_BG - scene.scale.y) * k,
    );
    scene.x += (vw / 2 - cam.x * P_BG + idle.x * P_BG - scene.x) * k;
    scene.y += (vh / 2 + sceneBiasY - cam.y * P_BG + idle.y * P_BG - scene.y) * k;
  }
  if (spine) {
    const targetS = charFillScale * cam.scale;
    spine.scale.set(
      spine.scale.x + (targetS - spine.scale.x) * k,
      spine.scale.y + (targetS - spine.scale.y) * k,
    );
    spine.x += (vw / 2 - cam.x + idle.x - spine.x) * k;
    spine.y += (vh * 0.88 - cam.y + idle.y - spine.y) * k;
  }
}

// subtle living drift when the user is idle
let idleT = 0;
function idleDrift() {
  const slow = 0.6;
  return {
    x: Math.sin(idleT * slow * 0.5) * 16,
    y: Math.cos(idleT * slow * 0.31) * 10,
  };
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

// ---- ambient layer (glow + shadow behind the character, dust motes in front) ----
function buildGlow() {
  const layer = new Container();
  const g = document.createElement('canvas');
  g.width = g.height = 256;
  const ctx = g.getContext('2d');
  const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,.34)');
  grad.addColorStop(0.5, 'rgba(190,205,255,.10)');
  grad.addColorStop(1, 'rgba(190,205,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const glow = new Sprite(Texture.from(g));
  glow.anchor.set(0.5);
  glow.blendMode = 'add';
  glow.alpha = 0.55;
  layer.addChild(glow);

  const sh = document.createElement('canvas');
  sh.width = sh.height = 128;
  const sctx = sh.getContext('2d');
  const sg = sctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  sg.addColorStop(0, 'rgba(0,0,0,.55)');
  sg.addColorStop(1, 'rgba(0,0,0,0)');
  sctx.fillStyle = sg;
  sctx.fillRect(0, 0, 128, 128);
  const shadow = new Sprite(Texture.from(sh));
  shadow.anchor.set(0.5);
  shadow.alpha = 0.55;
  layer.addChild(shadow);
  return { layer, glow, shadow };
}

function buildMotes() {
  const layer = new Container();
  const motes = [];
  const n = 28;
  for (let i = 0; i < n; i++) {
    const dot = new Graphics();
    const r = rand(0.6, 1.9);
    dot.circle(0, 0, r).fill({ color: 0xfff3d6, alpha: 1 });
    dot.alpha = rand(0.10, 0.36);
    layer.addChild(dot);
    motes.push({
      dot,
      x: Math.random() * 1200,
      y: Math.random() * 900,
      vy: rand(6, 22),
      amp: rand(6, 28),
      phase: Math.random() * Math.PI * 2,
      sp: rand(0.2, 0.6),
      tw: rand(0.6, 2.2),
    });
  }
  return { layer, motes };
}

function updateAmbient(t) {
  if (!particles) return;
  const { glow, shadow } = particles.glow;
  const { motes } = particles.motes;
  const vw = app.renderer.width, vh = app.renderer.height;
  glow.x = vw / 2 - cam.x;
  glow.y = vh * 0.58 - cam.y;
  glow.scale.set(charFillScale * cam.scale * 0.9);
  shadow.x = vw / 2 - cam.x;
  shadow.y = vh * 0.88 - cam.y;
  shadow.scale.set(charFillScale * cam.scale * 0.5, charFillScale * cam.scale * 0.14);
  for (const m of motes) {
    m.y -= m.vy * 0.016;
    m.x += Math.sin(t * 0.001 * m.sp + m.phase) * m.amp * 0.016;
    m.dot.alpha = 0.10 + 0.26 * (0.5 + 0.5 * Math.sin(t * 0.001 * m.tw + m.phase));
    if (m.y < -10) { m.y = vh + 10; m.x = Math.random() * vw; }
    m.dot.x = m.x;
    m.dot.y = m.y;
  }
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
  if (particles) {
    particles.glow.layer.destroy({ children: true });
    particles.motes.layer.destroy({ children: true });
    particles = null;
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
  // layering: scene(0) -> glow(1) -> spine(2) -> motes(3)
  const glow = buildGlow();
  app.stage.addChild(glow.layer);
  app.stage.setChildIndex(spine, app.stage.children.indexOf(glow.layer));
  const motes = buildMotes();
  app.stage.addChild(motes.layer);
  particles = { glow, motes };
  fitted = false;
  // frame on the Idle pose (mesh geometry only exists after a render), then play the intro
  spine.state.setAnimation(0, 'Idle_01', true);
  let frames = 0;
  const waitFit = () => {
    if (++frames < 3) requestAnimationFrame(waitFit);
    else {
      fitScene();
      playStart();
      log(`[layout] ${name}: scene=${!!scene} charFit=${charFillScale.toFixed(3)} sceneFit=${sceneFitScale.toFixed(3)} camScale=${cam.scale.toFixed(3)}`);
    }
  };
  requestAnimationFrame(waitFit);
  setBgm(BGM_MAP[name]);
  charNameEl.textContent = prettyName(name);
  subNameEl.textContent = 'MEMORIAL LOBBY';
  scheduleAutonomy();
  loadingEl.classList.remove('show');
  setTimeout(() => hintEl.classList.add('hide'), 6000);
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

// ---- input (no drag pan — the camera is fixed; only pat / tap / zoom) ----
function onPointerDown(e) {
  ensureAudio();
  userActiveAt = performance.now();
  if (bgmOn && !bgmAudio) setBgm(BGM_MAP[currentLobby]);
  if (e.pointerType === 'touch') e.preventDefault();
  if (pinch === null && e.isPrimary) {
    downTime = performance.now();
    downPos = { x: e.clientX, y: e.clientY };
    longPressTimer = setTimeout(() => {
      if (state.busy !== 'pat' && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) < 10) {
        startPat();
      }
    }, 420);
  }
  if (!pinch) pinch = { p: [] };
  pinch.p.push({ id: e.pointerId, x: e.clientX, y: e.clientY });
}

function onPointerMove(e) {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  mouse.active = true;
  if (longPressTimer && downPos && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 7) {
    clearTimeout(longPressTimer);
  }
  const p = pinch?.p.find(p => p.id === e.pointerId);
  if (p) { p.x = e.clientX; p.y = e.clientY; }
  if (pinch && pinch.p.length === 2) {
    const [a, b] = pinch.p;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (pinch.d0) {
      const f = d / pinch.d0;
      cam.scale = clamp(pinch.s0 * f, baseFitScale * 0.3, baseFitScale * CAMERA.maxScale);
    } else {
      pinch.d0 = d;
      pinch.s0 = cam.scale;
    }
  }
  hud.classList.toggle('idle', performance.now() - userActiveAt > 2600);
}

function onPointerUp(e) {
  clearTimeout(longPressTimer);
  const p = pinch?.p.find(p => p.id === e.pointerId);
  if (p) pinch.p = pinch.p.filter(x => x.id !== e.pointerId);
  if (pinch && pinch.p.length === 0) pinch = null;
  if (downPos && state.busy !== 'pat') {
    const dt = performance.now() - downTime;
    const d = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    if (dt < 340 && d < 10) playTalk();
  }
  if (patting) endPat();
  downPos = null;
  downTime = 0;
  pinch = null;
}

function onWheel(e) {
  e.preventDefault();
  if (!spine) return;
  const factor = Math.exp(-e.deltaY * 0.0015);
  cam.scale = clamp(cam.scale * factor, baseFitScale * 0.3, baseFitScale * CAMERA.maxScale);
  // zoom toward cursor: keep world point under cursor stationary
  const wx = ((e.clientX - spine.x) / spine.scale.x) * cam.scale;
  const wy = ((e.clientY - spine.y) / spine.scale.y) * cam.scale;
  cam.x = e.clientX - wx - (vw() / 2);
  cam.y = e.clientY - wy - (vh() * 0.88);
}

const vw = () => app.renderer.width;
const vh = () => app.renderer.height;

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

  // camera smoothing + ambient loop
  // camera smoothing + ambient loop
  app.ticker.add(() => {
    idleT = performance.now() / 1000;
    if (spine && fitted) applyCamera(CAMERA.weight);
    updateAmbient(performance.now());
  });
  // input
  canvas.addEventListener('wheel', onWheel, { passive: false });
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
