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
const btnExport = document.getElementById('btnExport');
const exportPanel = document.getElementById('exportPanel');
const expChar = document.getElementById('expChar');
const expStart = document.getElementById('expStart');
const expCancel = document.getElementById('expCancel');
const expAudio = document.getElementById('expAudio');
const expAudioRow = document.getElementById('expAudioRow');
const expModeLabel = document.getElementById('expModeLabel');
const recBadge = document.getElementById('recBadge');
const recTime = document.getElementById('recTime');
const recDur = document.getElementById('recDur');
const recStop = document.getElementById('recStop');
const toastEl = document.getElementById('toast');
const chatDialog = document.getElementById('chatDialog');
const chatBubble = document.getElementById('chatBubble');
const chatName = document.getElementById('chatName');
const chatText = document.getElementById('chatText');
// Screen point the balloon is placed from for the CURRENT dialog. Round-3:
// the balloon lives in the lobby container's NGUI space, NOT on the head bone.
// Game data (LobbyCH*.prefab, all 262 prefabs extracted from the uilobbyelement
// bundles): the ChatDialog root sits at the container origin and its Talk child
// (Sprite pivot bottom-left) has a per-lobby offset; the SkeletonAnimation child
// is ALWAYS at (0, -962) scale 100, so the container origin sits 962 UI units
// ABOVE the spine root on screen. assets/data/lobby_chat_anchors.json holds the
// per-lobby combined NGUI offset (tx, ty) = chatDialog.pos + talk.pos, and
//   balloonBtmLeft = (spine root global) + (tx, -962, +ty) * bs   (y-up → up)
//                  = (spine.x + tx·bs, spine.y - (962+ty)·bs)
// with the box growing up/right from its bottom-left (sprite pivot bottom-left)
// and the tail hanging on the LEFT edge. No head alignment; the container is
// fixed, so capture the spine root once per dialog. Cleared on hide.
let chatAnchor = null;
let CHAT_ANCHORS = {};   // app lobby key -> { tx, ty, skY, skScale } from lobby_chat_anchors.json

let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
}

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
  return /top[\s_]*light/i.test(s)
    || /^light[\s_]*top[\s_]*(\d|_|$)/i.test(s)
    || /^T_light$/i.test(s);
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
// 逐字稿查詢（lobby_subtitle.json：voiceId -> { jp, tw, en } 或字串）。
// GL dump 未含 memorial lobby 逐字稿，此檔現為空，放入資料即可自動顯示。
let SUBTITLES = null;
// DialogType per voice (assets/data/lobby_dialog_types.json, from the GL
// CharacterDialogExcel table): "Talk" (Lobby_balloon) / "Think" (Lobby_balloon2)
// / "UITalk" (Common_Balloon_Type2). Missing voice -> "Talk" (newest JP-only
// lobbies are not in the GL table yet).
let DIALOG_TYPES = null;
async function loadSubtitles() {
  try {
    SUBTITLES = await fetchRetry('assets/data/lobby_subtitle.json').then(r => r.json());
  } catch (e) {
    SUBTITLES = {};
  }
  try {
    DIALOG_TYPES = await fetchRetry('assets/data/lobby_dialog_types.json').then(r => r.json());
  } catch (e) {
    DIALOG_TYPES = {};
  }
}
function dialogTypeFor(voiceId) {
  if (!DIALOG_TYPES) return 'Talk';
  return DIALOG_TYPES[voiceId] ?? DIALOG_TYPES[voiceId.toLowerCase()] ?? 'Talk';
}
function subtitlePick(voiceId) {
  if (!SUBTITLES) return null;
  const hit = SUBTITLES[voiceId] ?? SUBTITLES[voiceId.toLowerCase()];
  if (hit == null) return null;
  if (typeof hit === 'string') return { text: hit, lang: null };
  for (const k of ['tw', 'ja', 'jp', 'en', 'zh']) {
    if (hit[k]) return { text: hit[k], lang: k };
  }
  return null;
}
function subtitleFor(voiceId) {
  const r = subtitlePick(voiceId);
  return r ? r.text : null;
}
// Language the balloon text was picked from (drives the game's font swap:
// tw/zh -> Noto Sans TC, ja/jp -> M PLUS 1p, en -> Noto Sans).
function subtitleLang(voiceId) {
  const r = subtitlePick(voiceId);
  return r ? r.lang : null;
}
function showChat(name, text) {
  chatName.textContent = name || '';
  chatText.textContent = text || '';
  if (!chatDialog.classList.contains('show')) {
    // First show of this dialog: capture the spine ROOT (the lobby container
    // origin in the app's model) as the anchor so the box stays put for the
    // whole talk; later lines only re-fit the text. The container never moves.
    if (spine) {
      const g = spine.toGlobal({ x: 0, y: 0 });
      chatAnchor = { x: g.x, y: g.y };
    }
  }
  chatDialog.classList.add('show');
  positionChat();
}
function hideChat() {
  chatAnchor = null;
  chatDialog.classList.remove('show');
}

// The balloon auto-sizes to its text (label + NGUI anchor padding L79 R59 T45
// B44); the 9-slice borders stay at their native sprite size (L80 R50 T84 B60
// × bs) and only the middle stretches, exactly like an NGUI sliced sprite, with
// the tail jutting out of the sprite's LEFT edge (apex ≈ x7/136, centre ≈ y62/146).
// Each lobby carries its own sprite flip (see positionChat: H moves the tail to
// the right edge, V mirrors it vertically), mirroring the LobbyCH*.prefab mFlip.
// Round-3 position: the box is placed by its bottom-left corner at the Talk
// origin — the lobby container origin (skUp UI units above the spine root per
// SkeletonAnimation localPosition (0,-962), constant across all prefabs) plus
// the per-lobby combined NGUI offset (tx, ty) = ChatDialog.pos + Talk.pos from
// assets/data/lobby_chat_anchors.json (extracted from the LobbyCH*.prefab
// bundles; e.g. CH0239 = (-208,+429), Airi = (-19,+306)). bs here is the NGUI
// canvas scale (vw/3840), the SAME scale the balloon is rendered at, so size
// and position use one consistent unit.
function positionChat() {
  if (!chatDialog.classList.contains('show')) return;
  const bs = window.innerWidth / 3840;   // NGUI canvas scale (balloon)
  chatDialog.style.bottom = 'auto';
  chatDialog.style.transform = 'none';
  const bw = chatDialog.offsetWidth, bh = chatDialog.offsetHeight;
  const ax = chatAnchor ? chatAnchor.x : (spine ? spine.x : window.innerWidth / 2);
  const ay = chatAnchor ? chatAnchor.y : (spine ? spine.y : window.innerHeight);
  const a = CHAT_ANCHORS[currentLobby] || { tx: 0, ty: 0, skY: -962 };
  // Think (OS) bubble sits at a DIFFERENT position from Talk in the prefab
  // (extracted per-lobby as thinkOffsetX/Y in lobby_chat_anchors.json).
  let tx = a.tx, ty = a.ty;
  if (chatDialog.dataset.dtype === 'Think') {
    tx += (a.thinkOffsetX || 0);
    ty += (a.thinkOffsetY || 0);
  }
  // Per-lobby NGUI UISprite mFlip (0=none,1=H,2=V,3=both, from LobbyCH*.prefab).
  // The balloon sprite's tail hangs on the LEFT edge, so H mirrors it to point
  // right and V mirrors it vertically. chatText is a sibling above the bubble,
  // so it is NOT flipped; only the 9-slice border + tail are.
  const flip = a.flip || 0;
  const tfx = (flip & 1) ? 'scaleX(-1)' : '';
  const tfy = (flip & 2) ? 'scaleY(-1)' : '';
  chatBubble.style.transform = tfx + (tfx && tfy ? ' ' : '') + tfy || 'none';
  const skUp = -a.skY;
  let x = ax + tx * bs;
  // Flipped lobbies (mFlip bit0 = H) mirror the whole box about the spine root:
  // the tail (now on the right edge) must face the character, so the balloon
  // sits on the OPPOSITE side at the same tail-to-root distance the prefab
  // authored. Verified vs game data: 76/98 mFlip=1 lobbies have tx>0, which
  // unmirrored would leave the right-pointing tail facing AWAY from the head.
  if (flip & 1) x = ax - tx * bs - bw;
  let y = ay - (skUp + ty) * bs - bh;
  const maxX = window.innerWidth - bw - 6;
  const maxY = window.innerHeight - bh - 6;
  if (x < 6) x = 6;
  if (x > maxX) x = maxX;
  if (y < 6) y = 6;
  if (y > maxY) y = maxY;
  chatDialog.style.left = x + 'px';
  chatDialog.style.top = y + 'px';
}
function speakerName() {
  const rec = studentForLobby(currentLobby);
  return (rec && rec[langField(langMode)]) || (rec && (rec.name_tw || rec.name_en || rec.name_jp)) || prettyName(currentLobby);
}

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
  // Resolves on ended/error/play-rejection so playTalk() can never hang waiting
  // on a voice that neither ends nor errors (e.g. autoplay-blocked audio).
  let resolveEnd;
  const endPromise = new Promise((r) => { resolveEnd = r; })
    .then(() => new Promise((r) => setTimeout(r, 500)));
  const done = () => {
    stopLip();
    if (!dialogActive) {
      // CoDialog pacing: a standalone line (intro greeting) holds the balloon
      // for `audioClip.length + 0.5` then closes it — never instantly.
      endPromise.then(() => hideChat());
    }
    resolveEnd();
  };
  audio.onplay = () => {
    lipActive = true;
    const text = subtitleFor(voiceId);
    if (!text) {
      // No subtitle for this voice: skip the balloon instead of showing an
      // empty bubble. Mid-dialog this keeps the previous line's balloon up
      // (it closes with the dialog); standalone lines just show nothing.
      return;
    }
    chatDialog.dataset.lang = subtitleLang(voiceId) || '';
    // Balloon style follows the line's DialogType (Think = OS bubble
    // Lobby_balloon2, Talk = Lobby_balloon; UITalk would use Common_Balloon_Type2).
    chatDialog.dataset.dtype = dialogTypeFor(voiceId);
    showChat(speakerName(), text);
  };
  audio.onended = done;
  audio.onerror = done;
  audio.play().catch(done);
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
// CoDialog balloon lifecycle: the box is ONE persistent element for the whole
// talk (text switches in place per line) and only closes after the LAST line's
// `audioClip.length + 0.5` hold — never at each voice's end. Non-dialog lines
// (e.g. the Start_Idle_01 greeting) still close on their own.
let dialogActive = false;   // true while a playTalk() dialog is running
let dialogSession = 0;      // guards the balloon watcher against stale closes
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
  const session = ++dialogSession;          // this talk's balloon session
  dialogActive = true;

  try {
    const talks = animNames().filter(n => n.startsWith('Talk_') && n.endsWith('_M'));
    if (!talks.length) return;

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

    // ---- Balloon lifecycle (reversed ChatDialog.<CoDialog>d__43.MoveNext) ----
    // The balloon is ONE persistent element for the whole talk: each recorded
    // Talk voice event (lobby_voice_schedule.json) switches the text in place,
    // each line is held `audioClip.length + 0.5`, and the balloon closes (with
    // the CSS .4s fade) after the LAST line's hold — NOT at every voice's end
    // (that flickered the box between lines and cut it off early), and NOT at
    // the full animation length (Talk_04_M runs 40s with its last line at 32.9s).
    const anim = spine.state.data.skeletonData.findAnimation(m);
    const animMs = (anim?.duration ?? 2.0) * 1000;
    const startToken = voiceToken;
    const t0 = performance.now();

    const lines = schAnim[m]?.voice || [];
    const lastLine = lines.length ? lines[lines.length - 1] : null;
    if (lastLine) {
      // Watch the last line's voice event fire, then hold `length + 0.5` and
      // close the balloon — independently of the animation still running on
      // track 1 (busy stays held until the clip finishes, below).
      (async () => {
        const deadline = t0 + animMs + 1000;
        let fired = false;
        // Phase 1 — wait until the last line's voice event fires, or the
        // animation passes the line's recorded time (events dispatch on the
        // next rAF, so `t` can cross the event time a frame early).
        while (performance.now() < deadline) {
          if (session !== dialogSession) return;
          const tr = spine.state.tracks[1];
          const animEnd = tr?.animationEnd || animMs;
          const t = tr ? tr.animationTime : animEnd;
          if (lastVoiceName === lastLine.name) { fired = true; break; }
          if (t >= lastLine.t - 0.05 || t >= animEnd - 0.05) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        // Phase 2 — grace for the async event→playVoice dispatch before giving
        // up (a missingMedia/skipped last line has no audio; close shortly after
        // its recorded time instead of leaving the balloon up till anim end).
        for (let i = 0; i < 20 && !fired; i++) {
          if (session !== dialogSession) return;
          if (lastVoiceName === lastLine.name) { fired = true; break; }
          await new Promise((r) => setTimeout(r, 50));
        }
        if (session !== dialogSession) return;
        if (fired) {
          await lastVoicePromise;             // last line audio + 0.5
          if (session !== dialogSession) return;
        }
        dialogActive = false;
        hideChat();                           // .4s CSS fade, not instant
      })();
    }

    // Poll until the talk animation on track 1 has played through (animationTime
    // reached its end). This keeps `busy` / blockInteractionOnPlay held (mirroring
    // byte [+0xb0]) so a new line can't start until the current talk clip finishes,
    // even though the balloon already closed after the last line's +0.5 hold.
    // Guarantees multi-line talks (e.g. Talk_01_M: events at 1.33s and 8.60s) run
    // to completion instead of cutting after the first line. Bail early if the
    // interaction was superseded.
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
    restTracks();
  } finally {
    // Always close the balloon and release the talk's blocking state — a lobby
    // switch or pat that superseded this talk must never leave the box stuck
    // open or blockInteractionOnPlay stuck (or every later talk would be refused,
    // "Talk: 拒絕 (voice busy)").
    if (session === dialogSession) {
      dialogActive = false;
      hideChat();
    }
    blockInteraction('talk', false);
    state.blockInteractionOnPlay = false;
    if (state.busy === 'talk') {
      state.busy = null;
      scheduleAutonomy();
    }
  }
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
    if (!spine || state.busy || state.introBlock || exporting) { scheduleAutonomy(); return; }
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
  subtitleProbe: (v) => subtitleFor(v),
  subtitleKeys: () => (SUBTITLES ? Object.keys(SUBTITLES).length : -1),
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
  boneGlobal: (name) => {
    if (!spine) return null;
    const b = spine.skeleton.findBone(name);
    if (!b) return null;
    const g = spine.toGlobal({ x: b.worldX, y: b.worldY });
    return { x: g.x, y: g.y };
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
  extractProbe: async () => {
    try {
      const w = app.renderer.width, h = app.renderer.height;
      app.render();
      const gl = app.canvas.getContext('webgl2') || app.canvas.getContext('webgl');
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { ok: true, w, h, hasExtract: !!app.renderer.extract, bytes: px.length, avg: Math.round(px.reduce((s, v, i) => (i % 4 === 0 ? s + v : s), 0) / (w * h)) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
  dbgLobby: () => currentLobby,
  selectLobby: (key) => selectLobby(key),
  showProbe: (text) => showChat('TEST', text),
  dbgSpineTree: () => {
    const walk = (o, d, lim) => {
      if (!o || d > lim) return [];
      const p = [];
      if (o.texture !== undefined && o.texture !== null) p.push('tex');
      if (o.skeleton) p.push('skeleton');
      if (o.mesh) p.push('mesh');
      const out = [{ d, c: o.constructor?.name || '?', p: p.join(','), nc: o.children?.length }];
      if (o.children) for (const c of o.children.slice(0, 4)) out.push(...walk(c, d + 1, lim));
      return out;
    };
    const a = spine ? walk(spine, 0, 5) : [];
    const s = scene ? walk(scene, 0, 5) : [];
    return { spine: a, scene: s };
  },
  dbgMem: () => {
    let textures = 0;
    let spineKeys = [];
    try {
      for (const k of Assets.cache.keys()) {
        const v = Assets.cache.get(k);
        if (v && v.baseTexture) { textures++; spineKeys.push(k); }
      }
    } catch { /* not exposed */ }
    const live = [];
    for (const o of [spine, scene]) if (o) for (const t of collectTextures(o)) live.push(t);
    return { textures, spineKeys, liveTextures: live.length };
  },
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
  dbgExport: () => ({ exporting, recorder: recorder ? recorder.state : null, chunks: recChunks.length }),
  anim: {
    start: () => startAnimExport(),
    stop: () => stopAnimExport(true),
    active: () => animActive,
    dbg: () => ({ animActive, animAbort, exporting, tickerStarted: app.ticker.started, autoUpdate: spine ? spine.autoUpdate : null }),
  },
  exp: {
    start: () => startExport(),
    stop: () => stopExport(),
    lobby: () => currentLobby,
    duration: () => recordingDuration,
  },
};

// ---- 影片匯出 ----
// 用 canvas.captureStream() + MediaRecorder 錄製 pixi canvas（DOM 覆蓋層不會入鏡），
// 語音與 BGM 透過 WebAudio MediaStreamDestination 混合成單一音軌。
let exporting = false;
let recorder = null;
let recChunks = [];
let recTimer = null;
let recStopTimer = null;
let recElapsedStart = 0;
let recAudioOffs = [];     // 錄製結束時要斷開的 WebAudio 節點
let recRestore = null;     // renderer 原狀態（resize 復原用）
let recExt = 'mp4';
let recSizeStr = '';
let exportMode = 'anim';   // 'anim' | 'rec'
let animActive = false;
let animAbort = false;
let animPrevAutoUpdate = true;
let animPixels = null;        // 重複使用的 readPixels 緩衝
let animScratchCanvas = null; // 重複使用的幀編碼 canvas

const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

function fmtClock(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function segVal(id) {
  const on = document.querySelector(`#${id} .on`);
  if (!on) return null;
  if (on.dataset.v !== undefined) return on.dataset.v;
  if (on.dataset.w !== undefined) return on.dataset.w;
  return on.dataset.fmt;
}

function pickMime(fmt) {
  if (fmt === 'mp4' && MediaRecorder.isTypeSupported('video/mp4')) return { mime: 'video/mp4', ext: 'mp4' };
  const cands = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const mime = cands.find((m) => MediaRecorder.isTypeSupported(m)) || '';
  return { mime, ext: 'webm' };
}

function openExportPanel() {
  if (!spine) { showToast('尚未載入角色'); return; }
  expChar.textContent = prettyName(currentLobby);
  exportPanel.classList.add('open');
}
function closeExportPanel() { exportPanel.classList.remove('open'); }

function showRecBadge() {
  recBadge.classList.add('show');
  recDur.textContent = fmtClock(recordingDuration);
}
function hideRecBadge() { recBadge.classList.remove('show'); }

let recordingDuration = 10;
function updateRecBadge() {
  recTime.textContent = fmtClock((performance.now() - recElapsedStart) / 1000);
}

function tryCreateRecorder(stream, opts) {
  try { return new MediaRecorder(stream, opts); } catch (e) {
    console.warn('[export] MediaRecorder 建立失敗', e);
    return null;
  }
}

async function startExport() {
  if (!spine || exporting) return;
  const duration = Math.max(1, +segVal('expDur') || 10);
  const w = +segVal('expRes') || 0;          // 0 = 目前視窗
  const fps = Math.min(60, Math.max(10, +segVal('expFps') || 30));
  const fmt = segVal('expFmt') || 'mp4';
  const withAudio = expAudio.checked;
  recordingDuration = duration;

  let { mime, ext } = pickMime(fmt);
  recExt = ext;
  recSizeStr = `${app.renderer.width}x${app.renderer.height}`;

  exporting = true;
  document.body.classList.add('recording');
  memoryLobbySkip();          // 強制回到 Idle 循環，匯出內容穩定
  clearTimers();
  scheduleAutonomy();         // 匯出期間只會重排、不隨機說話

  recRestore = { resizeTo: app.renderer.resizeTo, w: app.renderer.width, h: app.renderer.height };

  // 自訂解析度（16:9）：暫時停用 resizeTo、resize renderer、canvas CSS 填滿視窗
  if (w > 0) {
    const h = Math.round((w * 9) / 16);
    try {
      app.renderer.resizeTo = null;
      app.renderer.resize(w, h);
      app.canvas.style.width = '100%';
      app.canvas.style.height = '100%';
      await nextFrame();
      fitScene();
      recSizeStr = `${app.renderer.width}x${app.renderer.height}`;
    } catch (e) {
      console.warn('[export] resize 失敗，改用視窗解析度', e);
      restoreRendererState();
    }
  }

  // 音訊圖（語音走 lipAnalyser，BGM 用 captureStream 餵進 WebAudio 混音）
  let audioTrack = null;
  recAudioOffs = [];
  try {
    const ctx = ensureAudio();
    const dest = ctx.createMediaStreamDestination();
    if (withAudio) {
      if (lipAnalyser) { lipAnalyser.connect(dest); recAudioOffs.push(() => lipAnalyser.disconnect(dest)); }
      if (bgmOn && bgmAudio) {
        const bs = ctx.createMediaStreamSource(bgmAudio.captureStream());
        bs.connect(dest);
        recAudioOffs.push(() => bs.disconnect());
      }
    }
    audioTrack = dest.stream.getAudioTracks()[0];
  } catch (e) {
    console.warn('[export] 音訊圖建立失敗，改為無音軌', e);
  }

  const vstream = app.canvas.captureStream(fps);
  const tracks = [vstream.getVideoTracks()[0]];
  if (withAudio && audioTrack) tracks.push(audioTrack);
  const combined = new MediaStream(tracks);

  recChunks = [];
  recorder = tryCreateRecorder(combined, {
    mimeType: mime,
    videoBitsPerSecond: 12_000_000,
    audioBitsPerSecond: 160_000,
  });
  if (!recorder) {
    // MP4 開錄失敗（編碼器不可用）→ 退回 WebM
    if (fmt === 'mp4' && MediaRecorder.isTypeSupported('video/webm')) {
      const fb = pickMime('webm');
      mime = fb.mime; ext = fb.ext; recExt = fb.ext;
      recorder = tryCreateRecorder(combined, { mimeType: mime, videoBitsPerSecond: 12_000_000, audioBitsPerSecond: 160_000 });
    }
  }
  if (!recorder) {
    exporting = false;
    document.body.classList.remove('recording');
    restoreRendererState();
    hideRecBadge();
    showErr('此系統不支援 MediaRecorder，無法匯出');
    return;
  }

  recorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
  recorder.onerror = (e) => {
    console.error('[export] recorder error', e.error || e);
    stopExport();
  };
  try { recorder.start(300); } catch (e) {
    console.error('[export] recorder.start 失敗', e);
    exporting = false;
    document.body.classList.remove('recording');
    restoreRendererState();
    hideRecBadge();
    showErr(`錄製啟動失敗: ${e.message}`);
    return;
  }

  showRecBadge();
  recElapsedStart = performance.now();
  recTimer = setInterval(updateRecBadge, 250);
  recStopTimer = setTimeout(() => stopExport(), duration * 1000);
  log(`匯出開始: ${duration}s ${recordingSizeName()} ${fps}fps ${ext} audio=${withAudio}`);
}

function recordingSizeName() {
  return recSizeStr || `${app.renderer.width}x${app.renderer.height}`;
}

async function restoreRendererState() {
  if (!recRestore) return;
  try {
    app.renderer.resizeTo = recRestore.resizeTo;
    app.renderer.resize(recRestore.w, recRestore.h);
    app.canvas.style.width = '';
    app.canvas.style.height = '';
    await nextFrame();
    fitScene();
  } catch (e) {
    console.warn('[export] 復原 renderer 失敗', e);
  }
  recRestore = null;
}

async function stopExport() {
  if (!exporting) return;
  exporting = false;
  clearTimeout(recStopTimer);
  clearInterval(recTimer);
  hideRecBadge();

  const isRec = recorder && recorder.state !== 'inactive';
  let blob = null;
  if (isRec) {
    blob = await new Promise((res) => {
      recorder.onstop = () => res(new Blob(recChunks, { type: recorder.mimeType }));
      try { recorder.stop(); } catch (e) { res(null); }
    });
    try { for (const t of recorder.stream?.getTracks() || []) t.stop(); } catch { /* ignore */ }
  }
  for (const off of recAudioOffs) { try { off(); } catch { /* ignore */ } }
  recAudioOffs = [];
  recorder = null;
  recChunks = [];

  document.body.classList.remove('recording');
  await restoreRendererState();
  scheduleAutonomy();

  if (blob && blob.size > 0) {
    const fileBase = currentLobby || 'lobby';
    const defaultName = `${fileBase}_${recordingDuration}s_${recordingSizeName()}.${recExt}`;
    try {
      const res = await window.ba.saveVideo({ data: await blob.arrayBuffer(), defaultName, ext: recExt });
      if (res?.canceled) log('匯出已取消');
      else if (res?.path) { log(`匯出完成: ${res.path}`); showToast('影片已儲存'); }
      else log('匯出無結果');
    } catch (e) {
      showErr(`儲存失敗: ${e.message}`);
    }
  } else {
    showErr('錄製失敗（無資料）');
  }
}

// ---- 逐幀動畫匯出 ----
// 不依賴即時錄影：暫停 app.ticker 與 spine 的 autoUpdate，每幀以固定 dt=1/fps
// 手動推進動畫並 renderer.extract 讀出畫面，把 WebP 幀串流進 main 的 ffmpeg 編碼，
// 產出精確 fps / 精確時長的 MP4 / WebM。
async function startAnimExport() {
  if (!spine || animActive || exporting) return;
  const duration = Math.max(1, +segVal('expDur') || 10);
  const w = +segVal('expRes') || 0;
  const fps = Math.min(60, Math.max(10, +segVal('expFps') || 30));
  const fmt = segVal('expFmt') || 'mp4';
  const withAudio = expAudio.checked;
  recordingDuration = duration;

  exporting = true;
  animActive = true;
  animAbort = false;

  memoryLobbySkip();          // 固定 Idle 循環
  clearTimers();
  scheduleAutonomy();         // 匯出期間不隨機說話

  recRestore = { resizeTo: app.renderer.resizeTo, w: app.renderer.width, h: app.renderer.height };
  if (w > 0) {
    const h = Math.round((w * 9) / 16);
    try {
      app.renderer.resizeTo = null;
      app.renderer.resize(w, h);
      await nextFrame();
      fitScene();
    } catch (e) {
      console.warn('[anim] resize 失敗，改用視窗解析度', e);
      await restoreRendererState();
    }
  }
  recSizeStr = `${app.renderer.width}x${app.renderer.height}`;

  const total = Math.max(1, Math.round(duration * fps));
  const dt = 1 / fps;

  const ext = fmt === 'mp4' ? 'mp4' : 'webm';
  const sess = await window.ba.startAnimVideo({
    w: app.renderer.width,
    h: app.renderer.height,
    fps,
    duration,
    ext,
    defaultName: `${currentLobby}_idle_${duration}s_${recSizeStr}.${ext}`,
    audioFile: withAudio && bgmOn ? (BGM_MAP[currentLobby] || null) : null,
  });
  if (!sess || sess.canceled) { await cleanupAnimExport(); return; }
  if (sess.error) { await cleanupAnimExport(); showErr(`匯出啟動失敗: ${sess.error}`); return; }

  app.ticker.stop();
  animPrevAutoUpdate = spine.autoUpdate;
  spine.autoUpdate = false;
  spine.state.timeScale = 1;

  showRecBadge();
  recDur.textContent = fmtClock(duration);
  log(`動畫匯出開始: ${duration}s ${recSizeStr} ${fps}fps ${ext} frames=${total}`);

  const vw = app.renderer.width, vh = app.renderer.height;
  const need = vw * vh * 4;
  if (!animPixels || animPixels.length !== need) animPixels = new Uint8Array(need);
  if (!animScratchCanvas) animScratchCanvas = document.createElement('canvas');
  const scratch = animScratchCanvas;
  if (scratch.width !== vw || scratch.height !== vh) { scratch.width = vw; scratch.height = vh; }
  const c2 = scratch.getContext('2d');

  for (let i = 0; i < total; i++) {
    if (animAbort) break;
    spine.update(dt);
    try {
      app.render();
      const gl = app.canvas.getContext('webgl2') || app.canvas.getContext('webgl');
      gl.readPixels(0, 0, vw, vh, gl.RGBA, gl.UNSIGNED_BYTE, animPixels);
      const img = new ImageData(new Uint8ClampedArray(animPixels.buffer, 0, need), vw, vh);
      c2.setTransform(1, 0, 0, 1, 0, 0);
      c2.translate(0, vh);
      c2.scale(1, -1);
      c2.putImageData(img, 0, 0);
      c2.setTransform(1, 0, 0, 1, 0, 0);
      const blob = await new Promise((r) => scratch.toBlob(r, 'image/webp', 90));
      if (blob && blob.size) window.ba.animFrame(await blob.arrayBuffer());
    } catch (e) {
      console.error('[anim] 幀處理失敗', e);
      animAbort = true;
    }
    recTime.textContent = fmtClock((i + 1) / fps);
    recDur.textContent = `${i + 1}/${total}`;
    if (i % 15 === 0) await nextFrame();
  }

  let res = null;
  if (animAbort) { window.ba.abortAnimVideo(); }
  else {
    try { res = await window.ba.finishAnimVideo(); } catch (e) { res = { error: e.message }; }
  }

  await cleanupAnimExport();
  if (res?.path) { log(`動畫匯出完成: ${res.path}`); showToast('動畫已儲存'); }
  else if (animAbort) log('動畫匯出已取消');
  else showErr(`動畫匯出失敗: ${res?.error || '未知錯誤'}`);
}

function stopAnimExport(abort = false) {
  animAbort = true;
  if (abort) log('動畫匯出取消中…');
}

async function cleanupAnimExport() {
  animActive = false;
  exporting = false;
  hideRecBadge();
  try { app.ticker.start(); } catch {}
  if (spine) spine.autoUpdate = animPrevAutoUpdate;
  await restoreRendererState();
  scheduleAutonomy();
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
  if (exporting) return;
  if (key === currentLobby) { toggleSidebar(false); return; }
  toggleSidebar(false);
  fadeIn().then(() => loadLobby(key));
}

async function loadScene(entry) {
  let oldSceneTextures = new Set();
  if (scene) {
    oldSceneTextures = collectTextures(scene);
    scene.destroy();
    scene = null;
  }
  destroyTextures(oldSceneTextures);
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
    if (scene) { destroyTextures(collectTextures(scene)); scene.destroy(); scene = null; }
  }
}

// 收集顯示物件樹上的 texture（含 children / spine attachmentCacheData）
function collectTextures(obj) {
  const set = new Set();
  const stack = [obj];
  while (stack.length) {
    const c = stack.pop();
    if (!c) continue;
    if (c.texture && !c.texture.destroyed) set.add(c.texture);
    if (c.attachmentCacheData) {
      for (const row of c.attachmentCacheData) {
        if (!row) continue;
        for (const cd of Object.values(row)) {
          if (cd && cd.texture && !cd.texture.destroyed) set.add(cd.texture);
        }
      }
    }
    if (c.children) for (const ch of c.children) stack.push(ch);
  }
  return set;
}
// 銷毀舊 spine/scene 的 texture，釋放 GPU 記憶體
function destroyTextures(set) {
  for (const t of set) {
    try { if (!t.destroyed) t.destroy(true); } catch { /* ignore */ }
  }
}

// 切換 lobby 時卸載上一隻的 assets（含 scene），避免 texture 記憶體無限累積
function unloadLobbyAssets(lobbyName) {
  if (!lobbyName) return;
  const entry = LOBBY_INDEX[lobbyName];
  if (!entry || typeof entry !== 'object') return;
  const urls = [];
  const push = (rel, base) => { if (rel) urls.push(base + rel.replace(/^\.\//, '')); };
  const charBase = `assets/spine/${lobbyName}/`;
  push(entry.skel, charBase);
  push(entry.atlas, charBase);
  for (const p of entry.png || []) push(p, charBase);
  if (entry.scene) {
    const sceneBase = `assets/scene/${lobbyName}/`;
    push(entry.scene.skel, sceneBase);
    push(entry.scene.atlas, sceneBase);
    for (const p of entry.scene.png || []) push(p, sceneBase);
  }
  for (const u of urls) { try { Assets.unload(u); } catch {} }
}

async function loadLobby(name) {
  if (exporting) return;
  const oldLobby = currentLobby;
  let oldTextures = new Set();
  if (spine) {
    oldTextures = collectTextures(spine);
    spine.state.clearListeners?.();
    spine.destroy();
    spine = null;
  }
  unloadLobbyAssets(oldLobby);
  destroyTextures(oldTextures);
  clearTimers();
  state.busy = null;
  state.blockInteractionOnPlay = false;
  state.blockList = [];
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
  if (exporting || !ORDER.length || loadingEl.classList.contains('show')) return;
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
  if (exporting) return;
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
    CHAT_ANCHORS = await fetchRetry('assets/data/lobby_chat_anchors.json').then(r => r.json());
  } catch (e) {
    console.warn('[lobby] 對話錨點資料載入失敗，使用預設位置', e);
  }
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
  await loadSubtitles();
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
    resizeTimer = setTimeout(() => { if (spine && fitted) fitScene(); positionChat(); }, 80);
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

  // ---- video export UI ----
  btnExport.addEventListener('click', openExportPanel);
  expCancel.addEventListener('click', closeExportPanel);
  expStart.addEventListener('click', () => { closeExportPanel(); if (exportMode === 'anim') startAnimExport(); else startExport(); });
  recStop.addEventListener('click', () => { if (animActive) stopAnimExport(true); else stopExport(); });
  for (const id of ['expMode', 'expDur', 'expRes', 'expFps', 'expFmt']) {
    const box = document.getElementById(id);
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      for (const sib of box.children) sib.classList.remove('on');
      b.classList.add('on');
    });
  }
  const modeLabel = () => {
    const m = segVal('expMode') || 'anim';
    exportMode = m === 'rec' ? 'rec' : 'anim';
    const isAnim = exportMode === 'anim';
    expModeLabel.textContent = isAnim ? '逐幀編碼：固定 fps，不依賴即時錄影' : '畫面錄製：即時進行，含語音';
    expAudioRow.style.display = isAnim ? 'none' : '';
  };
  document.getElementById('expMode').addEventListener('click', () => { setTimeout(modeLabel, 0); });
  modeLabel();
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && exportPanel.classList.contains('open')) closeExportPanel();
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
