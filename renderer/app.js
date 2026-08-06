import { Application, Assets, Texture, Sprite, MeshSimple } from 'pixi.js';
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
const btnSkip = document.getElementById('btnSkip');
const btnLang = document.getElementById('btnLang');
const btnFull = document.getElementById('btnFull');
const btnStudents = document.getElementById('btnStudents');
const sidePanel = document.getElementById('sidePanel');
const sbSearch = document.getElementById('sbSearch');
const sbList = document.getElementById('sbList');
const sbClose = document.getElementById('sbClose');

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

// kivo.wiki 光線修復: 所有角色的 top light slot 改為 Screen 混色
// (對照 kivo 修復版 skel: CH0070_home top_light blendMode = 3)
const isTopLightSlot = (name) => {
  const s = name.replace(/\s+/g, ' ');
  return /^top[\s_]*light/i.test(s)
    || /^fx[\s_]*top[\s_]*light/i.test(s)
    || /^light[\s_]*top[\s_]*(\d|_|$)/i.test(s)
    || s === 'T_Light';
};

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

// In-memory lookup of the AudioBuffer (or fallback to a 'duration' probe) for the
// most recently started voice. The reversed-engineered CoDialog coroutine waits
// `audioClip.length + 0.5` seconds after each line — relying on the spine animation
// duration (as the old code did) was wrong because talk_01_M may end before the
// voice finishes (or vice-versa) when the line is short or has trailing ambience.
const voiceLengthCache = new Map();   // voiceId (lower) -> seconds (Promise)

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

// Probe the ogg for its duration without downloading it twice: fetch as ArrayBuffer,
// decodeAudioData into an AudioBuffer, cache the length.  Falls back to <audio>
// element's .duration if WebAudio is unavailable.
async function probeVoiceLength(name) {
  const lower = name.toLowerCase();
  if (voiceLengthCache.has(lower)) return voiceLengthCache.get(lower);
  const url = `assets/voice/${currentLobbyVoiceFolder}/${lower}.ogg`;
  const p = (async () => {
    try {
      const ctx = ensureAudio();
      if (ctx) {
        const buf = await fetchRetry(url).then((r) => r.arrayBuffer());
        const ab = await ctx.decodeAudioData(buf);
        return ab.duration;
      }
    } catch (e) {
      // fall through
    }
    try {
      const a = new Audio(url);
      await new Promise((res) => {
        if (a.readyState >= 1) return res();
        a.addEventListener('loadedmetadata', res, { once: true });
        a.addEventListener('error', res, { once: true });
      });
      return Number.isFinite(a.duration) ? a.duration : 1.5;
    } catch {
      return 1.5;
    }
  })();
  voiceLengthCache.set(lower, p);
  return p;
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

// ---- eyes follow the pointer ----
// Mechanism (VERIFIED against the skeleton rig + BA2LW MainControl recreation):
//   * Every lobby skeleton rigs the whole face on two master "touch" bones:
//     `Touch_Point` (pat) and `Touch_Eye` (look). Transform constraints bind the
//     eye globes (mix ~0.10-0.15), eyebrows, nose, mouth, halo and hair to
//     `Touch_Eye_Key` (a CHILD of Touch_Eye) — so moving `Touch_Eye` makes the
//     eyes track.
//   * Look_01_M is only a single-keyframe pose on the 4 eye-globe bones
//     (dur 0.00). The game plays it on Track 1 (Loop=1) as the "look mode" clip,
//     but the actual tracking is the per-frame Touch_Eye movement toward the
//     pointer, clamped to a radius and eased with a look speed (BA2LW:
//     lookBone.SetPositionSkeletonSpace(clamp(mouse)) + MoveTowards).
let lookBone = null;
let LOOK_RADIUS_UNITS = 180;  // max Touch_Eye offset from its rest pose (spine units)
let LOOK_SPEED = 6;           // ease rate (1/s)

function setupEyes() {
  lookBone = null;
  if (!spine) return;
  lookBone = spine.skeleton.findBone('Touch_Eye') || spine.skeleton.findBone('Touch_Eye_Key') || null;
  log(lookBone ? `眼睛跟隨: ${lookBone.data.name} 骨骼` : '眼睛跟隨: 無 Touch_Eye 骨骼');
}

// Place `bone` at the given world (skeleton space) position by solving its local
// transform against its parent (bone.x/y are relative to the parent).
function setBoneWorld(bone, wx, wy) {
  const p = bone.parent;
  if (!p) { bone.x = wx; bone.y = wy; return; }
  const l = p.worldToLocal({ x: wx, y: wy });
  bone.x = l.x; bone.y = l.y;
}

let lastEyeFollowT = 0;
function applyEyeFollow(self) {
  const bone = lookBone;
  if (!bone || !self.skeleton) return;
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, Math.max(0, now - (lastEyeFollowT || now)));
  lastEyeFollowT = now;
  if (state.busy === 'look') {
    // 抓眼：Touch_Eye 朝指標移動（clamp 到 LOOK_RADIUS_UNITS 內），constraints 帶動全臉。
    const c = self.worldTransform.applyInverse({ x: mouse.x, y: mouse.y });
    const rest = bone.parent.localToWorld({ x: bone.data.x, y: bone.data.y });
    let dx = c.x - rest.x, dy = c.y - rest.y;
    const d = Math.hypot(dx, dy);
    if (d > LOOK_RADIUS_UNITS) { dx *= LOOK_RADIUS_UNITS / d; dy *= LOOK_RADIUS_UNITS / d; }
    const k = clamp(LOOK_SPEED * dt, 0, 1);
    setBoneWorld(bone,
      bone.worldX + (rest.x + dx - bone.worldX) * k,
      bone.worldY + (rest.y + dy - bone.worldY) * k);
  } else {
    // 其餘情況（idle / talk / pat / 釋放後）緩慢回歸 setup pose，眼睛不再盯指標。
    const k = Math.max(clamp(LOOK_SPEED * dt, 0, 1), 0.06);
    if (Math.abs(bone.x - bone.data.x) < 0.01 && Math.abs(bone.y - bone.data.y) < 0.01) {
      bone.setToSetupPose();
      return;
    }
    bone.x += (bone.data.x - bone.x) * k;
    bone.y += (bone.data.y - bone.y) * k;
  }
}

let currentLobbyVoiceFolder = null;
let voiceCalls = 0;
// Returned by playVoice() so callers (CoDialog-style coroutines) can `await` the
// end-of-line event with the precise `audioClip.length + 0.5` pacing that the
// real client uses.
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
  // Returns a promise that settles when the voice finishes (+0.5s margin for
  // trailing ambience), replicating the CoDialog `WaitForSeconds(length+0.5)`
  // pacing found in the reversed ChatDialog.<CoDialog>d__43.MoveNext.
  const endPromise = new Promise((resolve) => {
    const done = () => { lipActive = false; resolve(); };
    audio.addEventListener('ended', done, { once: true });
    audio.addEventListener('error', done, { once: true });
  }).then(() => new Promise((r) => setTimeout(r, 500)));
  // Save as last seen voice promise so playTalk() can await it for CoDialog pacing.
  lastVoicePromise = endPromise;
  lastVoiceName = voiceId;
  nextVoiceToken();   // bump the token so playTalk() detects a new voice fired
  return endPromise;
}

function onAnimationEvent(_entry, ev) {
  // Voice-event format in BA MemorialLobby skeletons — VERIFIED by dumping the
  // SkeletonBinary EventTimelines: the generic marker event is named "Talk"
  // (ev.data.name) while the REAL voice id lives in ev.stringValue, e.g.
  //   EventTimeline frames=2
  //     t=1.333 ev.data.name="Talk"  ev.stringValue="Airi_MemorialLobby_1_1"
  //     t=8.600 ev.data.name="Talk"  ev.stringValue="Airi_MemorialLobby_1_2"
  // (Reading ev.data.name alone made every line fire a bogus playVoice("Talk")
  // against the non-existent talk.ogg, erroring instantly and cutting the whole
  // talk animation short.) lowercase id + voiceFolder -> /assets/voice/<Folder>/<id>.ogg.
  if (!ev || !ev.data) return;
  const voiceId = (ev.stringValue || ev.data.stringValue || ev.data.name || '').trim();
  if (!voiceId) return;
  // VERIFIED: Media stores files by lowercase id (e.g. airi_memoriallobby_1_1.ogg)
  // and missingMedia records that FILENAME. Compare against the lower id, exactly
  // the key playVoice() uses, so the two known-missing files are actually skipped.
  if (voiceSkip.has(voiceId.toLowerCase())) return;
  // The generic "Talk" marker (and any other non-voice id) has no matching .ogg;
  // filter against the character's known voice list so it never fires a bogus
  // playVoice (which errored and cut the whole talk short).
  if (validVoices && !validVoices.has(voiceId.toLowerCase())) return;
  // Some events fire twice in close succession (e.g. from overlapping tracks);
  // dedupe identical voices within 500 ms.
  const now = performance.now();
  if (voiceId === lastVoiceId && now - lastVoiceTime < 500) return;
  lastVoiceId = voiceId;
  lastVoiceTime = now;
  playVoice(voiceId);
}

let lastVoiceId = null;
let lastVoiceTime = 0;
const voiceSkip = new Set();
let validVoices = null;   // 合法語音檔名集合（voice_index.json[characterId]），過濾泛用事件
let VOICE_INDEX = {};     // characterId -> 該角色語音檔名清單

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
// State mirrors the fields at [SpineCharacter+0xb0 / +0xa8 / +0xa0]:
//   blockInteractionOnPlay  ⇔ byte [+0xb0]  – when true, the spine event path
//                                               (OnSpikeEvent -> PlayVoiceEvent) is
//                                               short-circuited and the player must
//                                               finish the current talk animation
//                                               before the next voice line plays.
//   blockList               ⇔ List<object> [+0xc8] – requester instances that are
//                                               currently blocking interactions
//                                               (in-game: dialog boxes add themselves
//                                               via BlockInteraction(dialogBox, true)).
//   talkDelegate / voiceDelegate (we don't bind Spine delegates in JS; the
//   equivalent is just the talk/pat flow below).
const state = {
  busy: null,                 // 'talk' | 'look' | 'pat' | null
  blockInteractionOnPlay: false,  // mirrors SpineCharacter+0xb0
  blockList: [],                   // mirrors SpineCharacter+0xc8 (List<object>)
  autonomy: null,
  timers: [],
  introBlock: false,          // memorial intro timeline (Start_Idle_01) locks input
};

// BlockInteraction-equivalent: any object (e.g. a dialog box) can register itself
// as a blocker; BodyTouch (pat) checks the list before allowing input.  Used here
// to suppress pat while a Talk animation is mid-play.
function blockInteraction(requester, block) {
  const i = state.blockList.indexOf(requester);
  if (block && i < 0) state.blockList.push(requester);
  else if (!block && i >= 0) state.blockList.splice(i, 1);
}
function isInteractionAvailable() {
  return state.blockList.length === 0 && !state.blockInteractionOnPlay;
}

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

function restTracks() {
  if (!spine) return;
  spine.state.setEmptyAnimation(1, 0.45);
  spine.state.setEmptyAnimation(2, 0.45);
}

async function playTalk() {
  if (!spine) return;
  // ---- BlockInteraction constraint from reversed code ----
  // In-game, the dialog system calls BlockInteraction(dialogBox, true) which
  // pushes the blocking requester onto [SpineCharacter+0xc8] (the blockList).
  // While blocked, BodyTouch (pat) is no-op.  And the OnSpikeEvent path checks
  // [SpineCharacter+0xb0] (BlockInteractionOnPlay) to determine whether a new
  // voice line should be allowed while the previous one is still running.
  if (state.blockInteractionOnPlay) { log('Talk: 拒絕 (voice busy)'); return; }
  if (state.busy === 'pat') { log('Talk: 拒絕 (pat)'); return; }

  state.busy = 'talk';
  blockInteraction('talk', true);           // mirrors [this+0xc8].Add(requester)
  state.blockInteractionOnPlay = true;      // mirrors byte [+0xb0] ← from dialog start

  const talks = animNames().filter(n => n.startsWith('Talk_') && n.endsWith('_M'));
  if (!talks.length) { state.busy = null; return; }

  // Prefer Talk animations that have voice events (lobby_voice_schedule.json).
  // In-game the dialog excel (CharacterDialogInfo.AnimationName) hands the
  // exact clip name, but server doesn't expose MemorialLobby dialogs — the
  // closest determinism we can deliver is to filter to clips that actually
  // emit voice events. Falls back to all Talk_N_M if schedule is unavailable.
  const schAnim = SCHEDULE?.lobbies?.[currentLobby]?.animations || {};
  const withVoice = talks.filter(n => (schAnim[n]?.voice || []).length > 0);
  const pool = withVoice.length ? withVoice : talks;
  const m = pick(pool);
  const a = m.replace(/_M$/, '_A');
  spine.state.setAnimation(1, m, false);
  if (animNames().includes(a)) spine.state.setAnimation(2, a, false);
  else spine.state.setEmptyAnimation(2, 0.3);

  // ---- CoDialog-style pacing ----
  // Play the full talk animation and let EVERY voice event along its timeline
  // fire (each playVoice starts its own <audio> and bumps lastVoicePromise).
  // We wait until the animation finishes on track 1, then hold for the trailing
  // margin of the last voice line (`audioClip.length + 0.5`), mirroring the
  // reversed ChatDialog.<CoDialog>d__43.MoveNext pacing.
  const anim = spine.state.data.skeletonData.findAnimation(m);
  const animMs = (anim?.duration ?? 2.0) * 1000;
  const startToken = voiceToken;
  const t0 = performance.now();

  // Poll until the talk animation on track 1 has played through (animationTime
  // reached its end) — this guarantees multi-line talks (e.g. Talk_01_M with
  // events at 1.33s and 8.60s) run to completion instead of cutting after the
  // first line. Bail early if the interaction was superseded.
  let voiceFired = false;
  const deadline = t0 + animMs + 500;
  while (performance.now() < deadline) {
    if (state.busy !== 'talk') return;
    const tr = spine.state.tracks[1];
    const animEnd = tr?.animationEnd || animMs;
    const animDone = tr ? tr.animationTime >= animEnd - 0.05 : true;
    if (animDone) { voiceFired = voiceToken > startToken; break; }
    await new Promise((r) => setTimeout(r, 60));
  }

  // Wait for the most-recently-fired voice to finish. `lastVoicePromise` was
  // reassigned by playVoice() during the run; re-read it here so we await the
  // last line actually played. If nothing fired, wait out the anim remainder.
  if (voiceFired) {
    await lastVoicePromise;
  } else {
    const remain = animMs - (performance.now() - t0);
    if (remain > 0) await new Promise((r) => setTimeout(r, remain + 200));
  }

  if (state.busy !== 'talk') return;

  const done = () => {
    if (state.busy !== 'talk') return;
    restTracks();
    state.busy = null;
    blockInteraction('talk', false);
    state.blockInteractionOnPlay = false;
    scheduleAutonomy();
  };
  done();
}

// Track the last voice end-Promise so playTalk() can use it for CoDialog pacing.
// `voiceToken` is a monotonically increasing counter, bumped every time a new
// voice starts; playTalk() can compare its snapshot to detect that a new voice
// has fired (and await the corresponding `lastVoicePromise`).
let lastVoicePromise = Promise.resolve();
let lastVoiceName = null;
let voiceToken = 0;
function nextVoiceToken() { return ++voiceToken; }

// Look (抓眼) — a hold interaction, VERIFIED:
//   * BA2LW recreation (Look.cs) uses IPointerDownHandler/IPointerUpHandler, so
//     Look = press-and-hold, not a tap.
//   * SpineClip assets (SpineLobbies/*_home/*.json) show Look_01_M Loop=1 (loop
//     while held) and LookEnd_01_M/LookEnd_01_A Loop=0 (release). Look_01_M is a
//     single-keyframe pose on the eye-globe bones (dur 0.00) — it flags "look
//     mode"; the actual eye tracking is the per-frame Touch_Eye bone movement
//     that applyEyeFollow() performs (see setupEyes), which the face transform
//     constraints relay to the eyes.
// On release the LookEnd plays and Touch_Eye eases back to its setup pose.
// BodyTouchCB carries no screen coordinate, so Pat-vs-Look is routed here by the
// head region test (Touch_Eye/Touch_Point anchor).
function startLook() {
  if (!spine) return;
  if (state.introBlock) return;                 // intro timeline locks input
  if (state.blockInteractionOnPlay) { log('Look: 拒絕 (voice busy)'); return; }
  if (state.busy === 'pat') { log('Look: 拒絕 (pat)'); return; }
  if (state.busy === 'look') return;
  if (!has('Look_01_M')) return;

  clearTimers();                       // interrupt an ongoing talk
  state.busy = 'look';
  blockInteraction('look', true);      // mirrors [this+0xc8].Add(requester)
  state.blockInteractionOnPlay = true; // mirrors byte [+0xb0]

  spine.state.setAnimation(1, 'Look_01_M', true);
  if (has('Look_01_A')) spine.state.setAnimation(2, 'Look_01_A', true);
  log('抓眼 (hold)');
}

function endLook() {
  if (!spine || state.busy !== 'look') return;
  state.busy = null;
  blockInteraction('look', false);
  state.blockInteractionOnPlay = false;
  spine.state.setAnimation(1, 'LookEnd_01_M', false);
  if (has('LookEnd_01_A')) spine.state.setAnimation(2, 'LookEnd_01_A', false);
  after(500, () => {
    if (state.busy || patting) return;
    restTracks();
    scheduleAutonomy();
  });
  log('抓眼結束');
}

function startPat() {
  if (!spine || patting) return;
  if (state.introBlock) return;                 // intro timeline locks input
  if (state.busy === 'talk' && !isInteractionAvailable()) return; // blocked by dialog
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
    if (!spine || state.busy || state.introBlock) { scheduleAutonomy(); return; }
    if (Math.random() < 0.5 && hasAny('Talk_')) playTalk();
    else scheduleAutonomy();
  }, rand(7000, 15000));
}

// ---- idle clip switching (reversed PortraitSpineCharacter.set_ClipToPlayOnIdle) ----
// The in-game UILobbyContainer.Init loads [x21+0x24] (isMemorial) and then sets
// either "01" (default portrait idle) or "S2_01" (memorial lobby timeline intro).
// We load this from the lobby_index metadata entry and switch the idle clip name.
//
// Idle chain: Start_Idle_01 once → Idle_01 (or S2_01) loop on track 0.
// The reversed RefreshClipToPlayOnIdle looks up the animation in the dictionary
// [this+0x58] for the given clip name, then plays it via the standard flow.
let idleClip = null;   // effective idle loop name

function loadIdleClip(entry) {
  const isMemorial = !!(entry?.isMemorial);
  idleClip = isMemorial ? 'S2_01' : 'Idle_01';
  if (isMemorial && !has(idleClip)) idleClip = 'Idle_01'; // fallback
}

function playStart() {
  if (!spine) return;
  const introName = 'Start_Idle_01';
  const hasStart = has(introName);
  if (!idleClip) idleClip = has('S2_01') ? 'S2_01' : 'Idle_01';
  if (hasStart) {
    // Memorial intro timeline (PlayableDirector) occupies the screen and locks
    // interaction until it finishes (matching UILobby memory lobby flow). Track 0
    // completion of the intro clears the lock (see onTrackComplete).
    state.introBlock = true;
    spine.state.setAnimation(0, introName, false);
    spine.state.addAnimation(0, idleClip, true, 0);
  } else {
    spine.state.setAnimation(0, idleClip, true);
  }
}

// ---- MemoryLobbySkip (reversed UILobbySpineController.MemoryLobbySkip) ----
// The in-game logic sets `PlayableDirector.set_time = duration` followed by
// `SpineBase.SkipToIdleImmediately()`.  On the Electron side, this translates
// to immediately cutting from the Idle_01 intro animation (Start_Idle_01) to
// the final Idle_01 looping track.
function memoryLobbySkip() {
  if (!spine) return;
  state.introBlock = false;
  spine.state.setAnimation(0, idleClip || 'Idle_01', true);
  log('skip to idle');
}

// ---- debug surface for the reversed state ----
// `ba_debug.state` is a frozen-ish snapshot that other tools (or the devtools
// console) can use to inspect the BlockInteraction / Talk / Voice state machine.
// Mirrors the SpineCharacter+0xb0 / +0xc8 / busy fields, useful when tweaking.
window.ba_debug = {
  state: () => ({
    busy: state.busy,
    blockInteractionOnPlay: state.blockInteractionOnPlay,
    blockList: [...state.blockList],
    introBlock: state.introBlock,
    pendingVoiceName: lastVoiceName,
    idleClip,
    validVoices: validVoices ? [...validVoices].sort().slice(0, 8) : null,
  }),
  triggerTalk: () => playTalk(),
  triggerLook: (on) => on ? startLook() : endLook(),
  triggerPat: (on) => on ? startPat() : endPat(),
  skipMemoryLobby: () => memoryLobbySkip(),
  headPos: () => {
    const b = headBone();
    if (!spine || !b) return null;
    const g = spine.toGlobal({ x: b.worldX, y: b.worldY });
    return { x: g.x, y: g.y, scale: spine.scale.x, radius: HEAD_PAT_RADIUS * spine.scale.x };
  },
  look: {
    radius: () => LOOK_RADIUS_UNITS,
    speed: () => LOOK_SPEED,
    setRadius: (v) => { LOOK_RADIUS_UNITS = v; },
    setSpeed: (v) => { LOOK_SPEED = v; },
  },
  boneWorld: (name) => {
    if (!spine) return null;
    const b = spine.skeleton.findBone(name);
    return b ? { x: b.worldX, y: b.worldY } : null;
  },
  spineSlot: (name) => {
    if (!spine) return null;
    const slot = spine.skeleton.findSlot(name);
    if (!slot) return null;
    return {
      blendMode: slot.data.blendMode,
      bone: slot.bone ? slot.bone.data.name : null,
      attachment: slot.getAttachment() ? slot.getAttachment().name : null,
      color: slot.color ? { r: slot.color.r, g: slot.color.g, b: slot.color.b, a: slot.color.a } : null,
    };
  },
  dbgTopLight: () => {
    if (!spine) return null;
    return spine.skeleton.slots
      .filter(s => isTopLightSlot(s.data.name))
      .map(s => `${s.data.name}=${s.data.blendMode}`);
  },
  setTimeScale: (v) => { if (spine) spine.state.timeScale = v; },
  setSlotBlend: (name, m) => { const s = spine?.skeleton?.findSlot(name); if (s) s.data.blendMode = m; },
  dbgRenderer: () => ({ type: app.renderer.type, w: app.canvas.width, h: app.canvas.height, spineVisible: spine ? spine.visible : null }),
  setSpineVisible: (v) => { if (spine) spine.visible = v; },
  dbgTexPixels: () => {
    if (!spine) return 'no-spine';
    const slot = spine.skeleton.findSlot('top_light');
    const at = slot && slot.getAttachment();
    const res = at && at.region && at.region.texture && at.region.texture.source ? at.region.texture.source.resource : null;
    if (!res) return 'no-resource';
    const c = document.createElement('canvas');
    const N = 8;
    c.width = N; c.height = N;
    const ctx = c.getContext('2d');
    ctx.drawImage(res, 0, 0, N, N);
    const d = ctx.getImageData(0, 0, N, N).data;
    const out = [];
    for (let y = 0; y < N; y++) { const row = []; for (let x = 0; x < N; x++) { const i = (y * N + x) * 4; row.push(`${d[i]},${d[i + 1]},${d[i + 2]},${d[i + 3]}`); } out.push(row.join(' ')); }
    return { resType: res.constructor.name, grid: out };
  },
  dbgClearMeshes: () => {
    try {
      for (const k of ['__dbgMesh', '__dbgWhiteMesh', '__dbgLightQuad', '__dbgSpr']) {
        if (window[k]) { app.stage.removeChild(window[k]); window[k] = null; }
      }
      return 'cleared';
    } catch (e) { return 'EXC: ' + String(e); }
  },
  dbgTestRegion: () => {
    try {
      const slot = spine.skeleton.findSlot('top_light');
      const at = slot && slot.getAttachment();
      const cd = spine.attachmentCacheData[slot.data.index][at.name];
      if (!window.__dbgRegQuad) {
        const m = new MeshSimple({
          texture: cd.texture,
          vertices: new Float32Array([-200, -200, 200, -200, 200, 200, -200, 200]),
          uvs: new Float32Array([0.002, 0.002, 0.994, 0.002, 0.994, 0.739, 0.002, 0.739]),
          indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
        });
        window.__dbgRegQuad = m;
        app.stage.addChild(m);
      }
      const m = window.__dbgRegQuad;
      m.scale.set(1, 1);
      m.position.set(app.renderer.width / 2, app.renderer.height / 2);
      return 'region quad added';
    } catch (e) { return 'EXC: ' + String(e); }
  },
  dbgShowMeshTint: (hex) => {
    try {
      const slot = spine.skeleton.findSlot('top_light');
      const at = slot && slot.getAttachment();
      const cd = spine.attachmentCacheData[slot.data.index][at.name];
      if (!window.__dbgMesh2) {
        const m = new MeshSimple({
          texture: cd.texture,
          vertices: cd.vertices,
          uvs: cd.uvs,
          indices: new Uint16Array(cd.indices),
        });
        window.__dbgMesh2 = m;
        app.stage.addChild(m);
      }
      const m = window.__dbgMesh2;
      m.texture = cd.texture;
      m.vertices = cd.vertices;
      m.tint = hex || 0xffffff;
      m.alpha = 1;
      m.blendMode = 'normal';
      m.scale.set(spine.scale.x, spine.scale.y);
      m.position.set(spine.x, spine.y);
      return 'tint mesh added: ' + (hex || 'white');
    } catch (e) { return 'EXC: ' + String(e); }
  },
  dbgShowMeshUVs: (mode) => {
    try {
      const slot = spine.skeleton.findSlot('top_light');
      const at = slot && slot.getAttachment();
      const cd = spine.attachmentCacheData[slot.data.index][at.name];
      if (!window.__dbgMesh3) {
        const m = new MeshSimple({
          texture: cd.texture,
          vertices: cd.vertices,
          uvs: cd.uvs,
          indices: new Uint16Array(cd.indices),
        });
        window.__dbgMesh3 = m;
        app.stage.addChild(m);
      }
      const m = window.__dbgMesh3;
      m.texture = cd.texture;
      m.vertices = cd.vertices;
      const n = cd.vertices.length / 2;
      let uvs;
      if (mode === 'zero') uvs = new Float32Array(n * 2);
      else if (mode === 'region') {
        uvs = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) { uvs[i * 2] = 0.25 + 0.5 * (i % 2); uvs[i * 2 + 1] = 0.15 + 0.3 * ((i >> 1) % 2); }
      } else uvs = cd.uvs;
      m.geometry.getBuffer('aUv').data = uvs;
      m.geometry.getBuffer('aUv').update();
      m.tint = 0xffffff;
      m.scale.set(spine.scale.x, spine.scale.y);
      m.position.set(spine.x, spine.y);
      return { mode, n, texSrc: cd.texture.source?.resource?.url || cd.texture.source?.resource?.constructor?.name };
    } catch (e) { return 'EXC: ' + String(e); }
  },
  dbgShowMeshAlpha: (alpha, blend) => {
    try {
      const slot = spine.skeleton.findSlot('top_light');
      const at = slot && slot.getAttachment();
      const cd = spine.attachmentCacheData[slot.data.index][at.name];
      if (!window.__dbgMeshA) {
        const m = new MeshSimple({
          texture: cd.texture,
          vertices: cd.vertices,
          uvs: cd.uvs,
          indices: new Uint16Array(cd.indices),
        });
        window.__dbgMeshA = m;
        app.stage.addChild(m);
      }
      const m = window.__dbgMeshA;
      m.texture = cd.texture;
      m.vertices = cd.vertices;
      m.alpha = alpha;
      m.blendMode = blend || 'normal';
      m.scale.set(spine.scale.x, spine.scale.y);
      m.position.set(spine.x, spine.y);
      return 'mesh alpha=' + alpha + ' blend=' + (blend || 'normal');
    } catch (e) { return 'EXC: ' + String(e); }
  },
  dbgDrawOrder: () => {
    try {
      const do_ = spine.skeleton.drawOrder;
      const idx = do_.findIndex(s => s.data.name === 'top_light');
      return { total: do_.length, lightIdx: idx, around: do_.slice(Math.max(0, idx - 3), idx + 4).map(s => s.data.name) };
    } catch (e) { return 'EXC: ' + String(e); }
  },
  dbgLightLive: () => {
    try {
      const slot = spine.skeleton.findSlot('top_light');
      const at = slot && slot.getAttachment();
      const cd = at && spine.attachmentCacheData[slot.data.index] ? spine.attachmentCacheData[slot.data.index][at.name] : null;
      const skColor = spine.skeleton.color;
      const slColor = slot ? slot.color : null;
      const atColor = at ? at.color : null;
      return {
        hasCd: !!cd,
        skipRender: cd ? cd.skipRender : null,
        clipped: cd ? cd.clipped : null,
        darkTint: cd ? cd.darkTint : null,
        darkColor: cd && cd.darkColor ? { r: cd.darkColor.r, g: cd.darkColor.g, b: cd.darkColor.b, a: cd.darkColor.a } : null,
        verts: cd ? cd.vertices.length : null,
        vertsVals: cd ? [...cd.vertices].slice(0, 8).map(x => +x.toFixed(0)) : null,
        uvs: cd ? [...cd.uvs].slice(0, 8).map(x => +x.toFixed(3)) : null,
        idx: cd ? cd.indices.length : null,
        tex: cd ? { w: cd.texture.width, h: cd.texture.height, src: cd.texture.source?.resource?.constructor?.name, uid: cd.texture.uid } : null,
        skA: skColor.a, slotA: slColor ? slColor.a : null, attA: atColor ? atColor.a : null,
        alpha: skColor.a * (slColor ? slColor.a : 0) * (atColor ? atColor.a : 0),
        spineAlpha: spine.alpha, groupAlpha: spine.groupAlpha,
      };
    } catch (e) { return 'EXC: ' + String(e); }
  },
  dbgBatchState: () => {
    try {
      const pipe = app.renderer.renderPipes.spine;
      if (!pipe || !pipe.gpuSpineData) return 'no-spine-pipe';
      const gpu = pipe.gpuSpineData[spine.uid];
      if (!gpu) return 'no-gpu-data';
      const slot = spine.skeleton.findSlot('top_light');
      const at = slot && slot.getAttachment();
      const cd = spine.attachmentCacheData[slot.data.index][at.name];
      const b = gpu.slotBatches[cd.id];
      const slotNames = Object.keys(gpu.slotBatches);
      return {
        batchCount: slotNames.length,
        lightBatchable: b ? {
          batcherName: b.batcherName,
          texture: b.texture ? b.texture.uid : null,
          indexSize: b.indexSize, attributeSize: b.attributeSize,
          blendMode: b.blendMode,
          positions0: b.positions ? [...b.positions].slice(0, 4).map(x => +x.toFixed(0)) : null,
          uvs0: b.uvs ? [...b.uvs].slice(0, 4).map(x => +x.toFixed(3)) : null,
        } : null,
        hasDirty: spine.spineAttachmentsDirty,
        hasTexDirty: spine.spineTexturesDirty,
      };
    } catch (e) { return 'EXC: ' + String(e); }
  },
  dbgForceDirty: () => {
    try {
      spine.spineAttachmentsDirty = true;
      spine.spineTexturesDirty = true;
      return 'forced dirty';
    } catch (e) { return 'EXC: ' + String(e); }
  },
  dbgTraceBatches: (on) => {
    try {
      const pipe = app.renderer.renderPipes.batch;
      const adaptor = pipe._adaptor;
      if (!window.__trOrigExecute && on) {
        window.__trOrigExecute = adaptor.execute.bind(adaptor);
        window.__trBatches = [];
        adaptor.execute = (batchPipe, batch) => {
          if (window.__trBatches.length < 4000) {
            window.__trBatches.push({
              blend: batch.blendMode,
              size: batch.size,
              tex: batch.textures && batch.textures.count,
              texUid: batch.textures && batch.textures.textures ? batch.textures.textures[0]?.uid : null,
            });
          }
          return window.__trOrigExecute(batchPipe, batch);
        };
        return 'tracing on';
      }
      if (!on && window.__trOrigExecute) {
        adaptor.execute = window.__trOrigExecute;
        window.__trOrigExecute = null;
        return 'tracing off, collected=' + (window.__trBatches ? window.__trBatches.length : 0);
      }
      return 'already ' + (on ? 'on' : 'off');
    } catch (e) { return 'EXC: ' + String(e); }
  },
  dbgTransform: () => {
    try {
      const gt = spine.groupTransform;
      const pipe = app.renderer.renderPipes.spine;
      const gpu = pipe.gpuSpineData[spine.uid];
      const slot = spine.skeleton.findSlot('top_light');
      const at = slot.getAttachment();
      const cd = spine.attachmentCacheData[slot.data.index][at.name];
      const b = gpu.slotBatches[cd.id];
      return {
        spineScale: [spine.scale.x, spine.scale.y],
        spinePos: [spine.x, spine.y],
        groupTransform: { a: gt.a, b: gt.b, c: gt.c, d: gt.d, tx: gt.tx, ty: gt.ty },
        batchableTransform: b.transform === gt ? 'same-object' : 'different',
        batchTransform: b.transform ? { a: b.transform.a, b: b.transform.b, c: b.transform.c, d: b.transform.d, tx: b.transform.tx, ty: b.transform.ty } : null,
      };
    } catch (e) { return 'EXC: ' + String(e); }
  },
  dbgSwapLightTex: () => {
    try {
      const pipe = app.renderer.renderPipes.spine;
      const gpu = pipe.gpuSpineData[spine.uid];
      const slot = spine.skeleton.findSlot('top_light');
      const at = slot.getAttachment();
      const cd = spine.attachmentCacheData[slot.data.index][at.name];
      const b = gpu.slotBatches[cd.id];
      const other = Object.values(gpu.slotBatches).find(x => x.texture && x.texture !== b.texture && x.texture.width === 2048);
      if (!other) return 'no-other-texture';
      b.texture = other.texture;
      cd.texture = other.texture;
      spine.spineAttachmentsDirty = true;
      spine.spineTexturesDirty = true;
      return { swappedTo: { w: other.texture.width, h: other.texture.height, uid: other.texture.uid } };
    } catch (e) { return 'EXC: ' + String(e); }
  },
  dbgScreenSprite: (mode) => {
    try {
      if (!window.__dbgSpr2) {
        const s = new Sprite(Texture.WHITE);
        s.width = 300;
        s.height = 300;
        s.tint = 0xff0000;
        s.position.set(200, 600);
        window.__dbgSpr2 = s;
        app.stage.addChild(s);
      }
      window.__dbgSpr2.blendMode = mode || 'screen';
      return 'sprite blend=' + (mode || 'screen');
    } catch (e) { return 'EXC: ' + String(e); }
  },
  dbgTexAlphaMode: () => {
    try {
      const slot = spine.skeleton.findSlot('top_light');
      const at = slot.getAttachment();
      const cd = spine.attachmentCacheData[slot.data.index][at.name];
      const out = { light: { uid: cd.texture.uid, alphaMode: cd.texture.alphaMode, srcAlphaMode: cd.texture.source.alphaMode } };
      const pipe = app.renderer.renderPipes.spine;
      const gpu = pipe.gpuSpineData[spine.uid];
      const others = Object.values(gpu.slotBatches).map(b => ({ uid: b.texture?.uid, alphaMode: b.texture?.alphaMode, srcAlphaMode: b.texture?.source?.alphaMode, w: b.texture?.width }));
      const unique = {};
      for (const o of others) { const k = o.uid + '|' + o.srcAlphaMode + '|' + o.w; unique[k] = o; }
      out.all = Object.values(unique).slice(0, 20);
      return out;
    } catch (e) { return 'EXC: ' + String(e); }
  },
  dbgShowTex: () => {
    if (!spine) return 'no-spine';
    const slot = spine.skeleton.findSlot('top_light');
    const at = slot && slot.getAttachment();
    const tex = at && at.region ? at.region.texture : null;
    const cacheTex = spine.attachmentCacheData[slot?.data?.index]?.[at?.name]?.texture;
    const pixiTex = cacheTex instanceof Texture ? cacheTex : (tex && tex.texture instanceof Texture ? tex.texture : null);
    const info = {
      regionTexCtor: tex && tex.constructor ? tex.constructor.name : null,
      regionTexW: tex ? tex.width : null,
      cacheTexCtor: cacheTex && cacheTex.constructor ? cacheTex.constructor.name : null,
      cacheTexW: cacheTex ? cacheTex.width : null,
      cacheTexH: cacheTex ? cacheTex.height : null,
      pixiTex: pixiTex ? { w: pixiTex.width, h: pixiTex.height, src: pixiTex.source ? pixiTex.source.constructor.name : null } : null,
    };
    if (!pixiTex) { info.msg = 'no pixi texture'; return info; }
    try {
      if (!window.__dbgSprite) {
        const s = new Sprite(Texture.EMPTY);
        s.anchor.set(0.5);
        window.__dbgSprite = s;
        app.stage.addChild(s);
      }
      window.__dbgSprite.texture = pixiTex;
      window.__dbgSprite.width = app.renderer.width * 0.8;
      window.__dbgSprite.height = app.renderer.height * 0.8;
      window.__dbgSprite.position.set(app.renderer.width / 2, app.renderer.height / 2);
    } catch (e) { info.drawErr = String(e); }
    return info;
  },
  dbgLight: async () => {
    if (!spine) return 'no-spine';
    const slot = spine.skeleton.findSlot('top_light');
    if (!slot) return 'no-slot';
    const at = slot.getAttachment();
    const r = at && at.region ? { name: at.region.name, w: at.region.width, h: at.region.height } : null;
    let cache = [];
    try { cache = [...Assets.cache.keys()].slice(0, 60); } catch (e) { cache = ['err:' + e.message]; }
    const texOf = (nm) => {
      const s = spine.skeleton.findSlot(nm);
      const a = s && s.getAttachment();
      const t = a && a.region ? a.region.texture : null;
      if (!t) return 'no-tex';
      return {
        name: a.region.name, w: t.width, h: t.height,
        res: t.source && t.source.resource ? t.source.resource.constructor.name : null,
        isEmpty: t === Texture.EMPTY,
      };
    };
    const bodies = [];
    for (const nm of ['body_01', 'body_02', 'hair_01', 'Face', 'L_Arm_01', 'R_eye_01']) {
      const s = spine.skeleton.findSlot(nm);
      if (s) bodies.push([nm, texOf(nm)]);
    }
    return {
      attachType: at && at.constructor ? at.constructor.name : null,
      region: r,
      uvLen: at.uvs ? at.uvs.length : null,
      uvs: at.uvs ? [...at.uvs].map(x => +x.toFixed(3)) : null,
      regionUVs: at.regionUVs ? [...at.regionUVs].map(x => +x.toFixed(3)) : null,
      worldVerticesLength: at.worldVerticesLength,
      bodies,
      cache,
    };
  },
  dbgShowMesh: () => {
    if (!spine) return 'no-spine';
    const slot = spine.skeleton.findSlot('top_light');
    const at = slot && slot.getAttachment();
    const cd = at && spine.attachmentCacheData[slot.data.index] ? spine.attachmentCacheData[slot.data.index][at.name] : null;
    if (!cd) return 'no-cache';
    try {
      if (!window.__dbgMesh) {
        const m = new MeshSimple({
          texture: cd.texture,
          vertices: cd.vertices,
          uvs: cd.uvs,
          indices: new Uint16Array(cd.indices),
        });
        window.__dbgMesh = m;
        app.stage.addChild(m);
      }
      const m = window.__dbgMesh;
      m.texture = cd.texture;
      m.vertices = cd.vertices;
      m.scale.set(spine.scale.x, spine.scale.y);
      m.position.set(spine.x, spine.y);
      return { verts: cd.vertices.length, vertsVals: [...cd.vertices].map(x => +x.toFixed(1)), uvs: cd.uvs.length, idx: cd.indices.length, texW: cd.texture.width };
    } catch (e) { return 'EXC: ' + String(e); }
  },
  dbgShowMeshWhite: () => {
    try {
      const slot = spine.skeleton.findSlot('top_light');
      const at = slot && slot.getAttachment();
      const cd = spine.attachmentCacheData[slot.data.index][at.name];
      if (!window.__dbgMeshW) {
        const m = new MeshSimple({
          texture: Texture.WHITE,
          vertices: cd.vertices,
          uvs: cd.uvs,
          indices: new Uint16Array(cd.indices),
        });
        window.__dbgMeshW = m;
        app.stage.addChild(m);
      }
      const m = window.__dbgMeshW;
      m.texture = Texture.WHITE;
      m.vertices = cd.vertices;
      m.tint = 0x00ff00;
      m.scale.set(spine.scale.x, spine.scale.y);
      m.position.set(spine.x, spine.y);
      return 'white mesh added';
    } catch (e) { return 'EXC: ' + String(e); }
  },
  dbgTestLight: () => {
    try {
      const slot = spine.skeleton.findSlot('top_light');
      const at = slot && slot.getAttachment();
      const cd = spine.attachmentCacheData[slot.data.index][at.name];
      if (!window.__dbgLightQuad) {
        const m = new MeshSimple({
          texture: cd.texture,
          vertices: new Float32Array([-150, -150, 150, -150, 150, 150, -150, 150]),
          uvs: new Float32Array([0.25, 0.15, 0.75, 0.15, 0.75, 0.45, 0.25, 0.45]),
          indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
        });
        window.__dbgLightQuad = m;
        app.stage.addChild(m);
      }
      const m = window.__dbgLightQuad;
      m.scale.set(1, 1);
      m.position.set(app.renderer.width / 2, app.renderer.height / 2);
      return 'light quad added at center';
    } catch (e) { return 'EXC: ' + String(e); }
  },
  dbgTestQuad: () => {
    try {
      if (!window.__dbgQuad) {
        const m = new MeshSimple({
          texture: Texture.WHITE,
          vertices: new Float32Array([0, 0, 400, 0, 400, 400, 0, 400]),
          uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
          indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
        });
        window.__dbgQuad = m;
        app.stage.addChild(m);
      }
      window.__dbgQuad.tint = 0xff0000;
      window.__dbgQuad.position.set(100, 100);
      window.__dbgQuad.scale.set(1, 1);
      return 'quad added';
    } catch (e) { return 'EXC: ' + String(e); }
  },
  dbgLightBounds: () => {
    if (!spine) return 'no-spine';
    const slot = spine.skeleton.findSlot('top_light');
    if (!slot) return 'no-slot';
    const at = slot.getAttachment();
    if (!at || !at.vertices || !at.triangles) return { msg: 'no-mesh', v: at && at.vertices ? at.vertices.length : null, t: at && at.triangles ? at.triangles.length : null };
    const world = new Float32Array(at.worldVerticesLength);
    if (at.computeWorldVertices) at.computeWorldVertices(slot, 0, at.worldVerticesLength, world, 0, 2);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < world.length; i += 2) { minX = Math.min(minX, world[i]); minY = Math.min(minY, world[i + 1]); maxX = Math.max(maxX, world[i]); maxY = Math.max(maxY, world[i + 1]); }
    const g0 = spine.toGlobal({ x: minX, y: minY });
    const g1 = spine.toGlobal({ x: maxX, y: maxY });
    return {
      world: [minX.toFixed(1), minY.toFixed(1), maxX.toFixed(1), maxY.toFixed(1)],
      screen: [g0.x.toFixed(1), g0.y.toFixed(1), g1.x.toFixed(1), g1.y.toFixed(1)],
      vw: app.renderer.width, vh: app.renderer.height,
      spineX: spine.x.toFixed(1), spineY: spine.y.toFixed(1), spineScale: spine.scale.x.toFixed(4),
      verts: at.vertices.length, tris: at.triangles.length,
    };
  },
  layout: () => ({
    vw: app.renderer.width,
    vh: app.renderer.height,
    charScale,
    sceneScale,
    spineScale: spine ? +spine.scale.x.toFixed(4) : null,
    cameraTargetY,
  }),
};

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

// ---- student display names (students_data.csv, keyed by file_id) ----
const LANG_MODES = [
  ['tw', '繁', 'name_tw'],
  ['jp', '日', 'name_jp'],
  ['cn', '簡', 'name_cn'],
  ['en', 'EN', 'name_en'],
];
let STUDENTS = null;
let langMode = null;
try { langMode = localStorage.getItem('ba_lang') || 'tw'; } catch { langMode = 'tw'; }

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function loadStudents() {
  try {
    const r = await fetchRetry('assets/data/students_data.csv');
    const rows = parseCSV(await r.text());
    if (!rows.length) return;
    const header = rows[0].map(h => h.trim());
    const map = {};
    for (let i = 1; i < rows.length; i++) {
      const rec = {};
      for (let j = 0; j < header.length; j++) rec[header[j]] = (rows[i][j] ?? '').trim();
      const key = (rec.file_id || '').toLowerCase();
      if (key && !map[key]) map[key] = rec;
    }
    STUDENTS = map;
  } catch (e) {
    console.warn('[lobby] 學生名單載入失敗', e);
  }
}

function studentForLobby(lobbyKey) {
  if (!STUDENTS) return null;
  const cands = [lobbyKey.toLowerCase()];
  let b = lobbyKey.toLowerCase();
  let prev;
  while (b !== prev) {
    prev = b;
    for (const suf of ['_home_gl', '_home', '_gl', '_teen', '_multi']) {
      if (b.endsWith(suf)) { b = b.slice(0, -suf.length); break; }
    }
    if (b.length > 5 && b.startsWith('lobby')) b = b.slice(5);
  }
  cands.push(b);
  const s = b.replace(/[0-9]+$/, '');
  if (s !== b && s) cands.push(s);
  for (const c of cands) {
    if (STUDENTS[c]) return STUDENTS[c];
  }
  return null;
}

function langField(mode) {
  return (LANG_MODES.find(l => l[0] === mode) || LANG_MODES[0])[2];
}
function langLabel(mode) {
  return (LANG_MODES.find(l => l[0] === mode) || LANG_MODES[0])[1];
}

function renderStudentName(lobbyKey) {
  const rec = studentForLobby(lobbyKey);
  const label = rec ? rec[langField(langMode)] : null;
  charNameEl.textContent = label || prettyName(lobbyKey);
  btnLang.textContent = langLabel(langMode);
  btnLang.title = `名稱語言 (${LANG_MODES.map(l => l[1]).join('/')})`;
}

// ---- collapsible student sidebar ----
const SIDEBAR_FIELDS = ['full_name', 'name', 'skin_name', 'spine_remark', 'name_cn', 'name_jp', 'name_tw', 'name_en', 'name_kr'];

function studentDisplay(rec) {
  if (!rec) return null;
  return rec[langField(langMode)] || rec.name_tw || rec.name_en || rec.name_jp || rec.full_name || rec.name || null;
}

function buildSidebarGroups() {
  const groups = new Map();
  for (const key of ORDER) {
    const rec = studentForLobby(key);
    const display = studentDisplay(rec) || prettyName(key);
    if (!groups.has(display)) groups.set(display, { display, rec, children: [] });
    groups.get(display).children.push({ key, variant: prettyName(key) });
  }
  return [...groups.values()].sort((a, b) => a.display.localeCompare(b.display, 'zh-Hant'));
}

function groupMatches(g, q) {
  if (!q) return true;
  if (g.display.toLowerCase().includes(q)) return true;
  if (g.rec && SIDEBAR_FIELDS.some(f => g.rec[f] && g.rec[f].toLowerCase().includes(q))) return true;
  return g.children.some(c => c.key.toLowerCase().includes(q));
}

function renderSidebar() {
  const q = sbSearch.value.trim().toLowerCase();
  sbList.innerHTML = '';
  let shown = 0;
  for (const g of buildSidebarGroups()) {
    if (!groupMatches(g, q)) continue;
    const nameMatch = !q || g.display.toLowerCase().includes(q)
      || (g.rec && SIDEBAR_FIELDS.some(f => g.rec[f] && g.rec[f].toLowerCase().includes(q)));
    const kids = nameMatch
      ? g.children
      : g.children.filter(c => c.key.toLowerCase().includes(q));
    if (!kids.length) continue;
    shown += kids.length;
    const head = document.createElement('div');
    head.className = 'sb-group-head';
    head.textContent = g.display;
    const cnt = document.createElement('span');
    cnt.className = 'cnt';
    cnt.textContent = String(kids.length);
    head.appendChild(cnt);
    sbList.appendChild(head);
    for (const c of kids) {
      const b = document.createElement('button');
      b.className = 'sb-item';
      b.dataset.key = c.key;
      b.textContent = c.variant;
      if (c.key === currentLobby) b.classList.add('cur');
      sbList.appendChild(b);
    }
  }
  if (!shown) {
    const e = document.createElement('div');
    e.className = 'sb-empty';
    e.textContent = '沒有符合的學生';
    sbList.appendChild(e);
  }
}

function toggleSidebar(force) {
  const open = force === undefined ? !sidePanel.classList.contains('open') : force;
  sidePanel.classList.toggle('open', open);
  btnStudents.textContent = open ? '✕' : '☰';
  if (open) renderSidebar();
}

function selectLobby(key) {
  if (key === currentLobby) { toggleSidebar(false); return; }
  toggleSidebar(false);
  fadeIn().then(() => loadLobby(key));
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
  state.introBlock = false;
  patting = false;
  headAnchorBone = null;

  const entry = LOBBY_INDEX[name];
  if (!entry) { showErr(`索引中無 ${name}`); return; }
  loadIdleClip(entry);
  loadingEl.classList.add('show');
  loadingText.textContent = `載入 ${prettyName(name)}`;
  try {
    const charAssets = entry.skel && entry.atlas
      ? [`assets/spine/${name}/${entry.skel}`, `assets/spine/${name}/${entry.atlas}`]
      : [];
    await Promise.all(charAssets.map(a => Assets.load(a)));
    spine = Spine.from({ skeleton: charAssets[0], atlas: charAssets[1] });
    for (const slot of spine.skeleton.slots) {
      if (isTopLightSlot(slot.data.name)) slot.data.blendMode = 3;
    }
    const sch = SCHEDULE?.lobbies?.[name];
    currentLobbyVoiceFolder = sch?.voiceFolder || null;
    voiceSkip.clear();
    for (const m of sch?.missingMedia || []) voiceSkip.add(m);
    validVoices = new Set((VOICE_INDEX[sch?.characterId] || []).map(f => f.toLowerCase().replace(/\.ogg$/, '')));
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
  renderStudentName(name);
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
  // Intro (Start_Idle_01) finished on track 0 -> release the interaction lock so
  // the player can tap/pat; track 0 now loops the idle clip.
  if (entry.trackIndex === 0 && state.introBlock) state.introBlock = false;
  if (entry.trackIndex === 1 && !state.busy) {
    if (state.busy === 'talk') return; // handled by timer
    restTracks();
  }
}

// Head anchor for the Pat-vs-Look hold region test. Every lobby skeleton ships a
// Touch_Point / Touch_Eye bone pair under head_Rot (Airi: Touch_Point≈(582,66),
// Touch_Eye≈(493,82) in the 3000-unit skeleton) — the very bones the Pat_01_M /
// Look_01_M animations key, so they mark the head region.
let headAnchorBone = null;
const HEAD_PAT_RADIUS = 130;   // spine units around the head anchor

function headBone() {
  if (headAnchorBone) return headAnchorBone;
  if (!spine) return null;
  headAnchorBone =
    spine.skeleton.findBone('Touch_Eye') ||
    spine.skeleton.findBone('Touch_Point') ||
    spine.skeleton.findBone('head') ||
    null;
  return headAnchorBone;
}
function isHeadRegion(sx, sy) {
  const b = headBone();
  if (!b) return false;   // no anchor → whole body is Look (no Pat region)
  const g = spine.toGlobal({ x: b.worldX, y: b.worldY });
  const r = HEAD_PAT_RADIUS * spine.scale.x;
  return Math.hypot(sx - g.x, sy - g.y) <= r;
}

// ---- input: tap → Talk, press-and-hold / press-and-drag → Look, on head → Pat ----
// VERIFIED interaction model (JP community wiki wikiru + GameWith + NoxPlayer):
//   * tap               → Talk (one-shot _M + _A + voice)
//   * hold head region  → Pat (撫でる, eyes close — Pat_01_M Loop=1 → PatEnd_01_M)
//   * hold / drag body  → Look (目で追う — Look_01_M Loop=1 → LookEnd_01_M, eyes
//                         follow the pointer). Confirmed by the Touch_Point /
//                         Touch_Eye anchor bones the Pat/Look animations key.
// No drag / zoom / pan.
function onPointerDown(e) {
  ensureAudio();
  userActiveAt = performance.now();
  if (bgmOn && !bgmAudio) setBgm(BGM_MAP[currentLobby]);
  if (e.pointerType === 'touch') e.preventDefault();
  downTime = performance.now();
  downPos = { x: e.clientX, y: e.clientY };
  longPressTimer = setTimeout(() => {
    if (downPos && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) < 10) {
      // Hold gesture: on the head region → Pat, anywhere else → Look.
      if (isHeadRegion(e.clientX, e.clientY)) startPat();
      else startLook();
    }
  }, 420);
}

function onPointerMove(e) {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  mouse.active = true;
  // Press-and-drag gesture — matches the real game: "頭以外の場所をタップしたまま
  // 指を移動させると目で追ってくれます". Moving while pressed starts Pat on the
  // head (撫でる) or Look anywhere else; a stationary long-press still falls back to
  // the 420 ms hold timer in onPointerDown.
  if (longPressTimer && downPos && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 7) {
    clearTimeout(longPressTimer);
    if (state.busy === null) {
      if (isHeadRegion(downPos.x, downPos.y)) startPat();
      else startLook();
    }
  }
  hud.classList.toggle('idle', performance.now() - userActiveAt > 2600);
}

function onPointerUp(e) {
  clearTimeout(longPressTimer);
  if (downPos) {
    const dt = performance.now() - downTime;
    const d = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    // Quick tap (short, still) → Talk (one-shot _M + _A + voice). A tap while
    // a hold is active is ignored — the hold branches below handle the release.
    if (dt < 340 && d < 10 && !state.introBlock && state.busy !== 'look' && state.busy !== 'pat') {
      playTalk();
    }
  }
  if (state.busy === 'look') endLook();
  else if (patting) endPat();
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
    VOICE_INDEX = await fetchRetry('assets/data/voice_index.json').then(r => r.json());
  } catch (e) {
    console.warn('[lobby] 語音索引載入失敗', e);
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
  await loadStudents();

  // camera smoothing
  app.ticker.add(() => {
    if (spine && fitted) applyCamera(CAMERA.weight);
  });
  // Re-fit on window resize (resizeTo resizes the canvas, but charScale/sceneScale
  // are only recomputed in fitScene — re-run it so the layout doesn't go stale
  // until the next character switch).
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (spine && fitted) fitScene(); }, 80);
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
  btnSkip.addEventListener('click', memoryLobbySkip);
  btnLang.addEventListener('click', () => {
    const i = LANG_MODES.findIndex(l => l[0] === langMode);
    langMode = LANG_MODES[(i + 1) % LANG_MODES.length][0];
    try { localStorage.setItem('ba_lang', langMode); } catch {}
    if (currentLobby) renderStudentName(currentLobby);
    if (sidePanel.classList.contains('open')) renderSidebar();
    log(`名稱語言: ${langLabel(langMode)}`);
  });

  btnStudents.addEventListener('click', () => toggleSidebar());
  sbClose.addEventListener('click', () => toggleSidebar(false));
  sbSearch.addEventListener('input', () => renderSidebar());
  sbList.addEventListener('click', (e) => {
    const item = e.target.closest('.sb-item');
    if (item) selectLobby(item.dataset.key);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidePanel.classList.contains('open')) toggleSidebar(false);
  });
  // fullscreen toggle (button + F11 / F)
  const updateFullBtn = () => {
    const on = !!document.fullscreenElement;
    btnFull.textContent = on ? '⤡' : '⤢';
    btnFull.title = on ? '結束全螢幕' : '全螢幕';
    btnFull.classList.toggle('off', false);
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      document.documentElement.requestFullscreen?.();
    }
  };
  btnFull.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    updateFullBtn();
    if (spine && fitted) fitScene();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F11' || e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      toggleFullscreen();
    }
  });
  updateFullBtn();

  if (ORDER.length) {
    const m = location.hash.match(/^#lobby=([^&]+)/);
    const first = m && LOBBY_INDEX[m[1]] ? m[1] : ORDER[0];
    await loadLobby(first);
  } else {
    showErr('assets/lobby_index.json 為空');
  }
}

init().catch(showErr);
