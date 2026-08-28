import { Application, Assets, Texture, Sprite, MeshSimple, BlurFilter, Cache } from 'pixi.js';
import { Spine, ScaleTimeline } from '@esotericsoftware/spine-pixi-v8';
import { Vector2 } from '@esotericsoftware/spine-core';
import { i as initClickFx } from '../assets/clickfx/clickFx.js';

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
const whiteFlashEl = document.getElementById('whiteflash');
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
const btnSettings = document.getElementById('btnSettings');
const exportPanel = document.getElementById('exportPanel');
const expChar = document.getElementById('expChar');
const expStart = document.getElementById('expStart');
const expCancel = document.getElementById('expCancel');
const expBgm = document.getElementById('expBgm');
const expVoice = document.getElementById('expVoice');
const expDialog = document.getElementById('expDialog');
const expDialogCk = document.getElementById('expDialogCk');
const expTalkRow = document.getElementById('expTalkRow');
const expTalkSel = document.getElementById('expTalkSel');
const expCustomRow = document.getElementById('expCustomRow');
const expCustomW = document.getElementById('expCustomW');
const expCustomH = document.getElementById('expCustomH');
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

// ---- i18n (UI language, bound to the btnLang name-language cycle) ----
// Dictionary: assets/data/ui_i18n.json — flat "key": text per UI lang
// (zh-TW / zh-CN / ja / en / ko). The chosen mode also drives student-name
// fields (LANG_MODES below), so one button switches both. zh-TW is the source
// of truth; t() falls back to it and finally to the raw key.
const I18N_UI = {
  tw: 'zh-TW', jp: 'ja', cn: 'zh-CN', en: 'en', kr: 'ko',
};
const I18N_TAG_FALLBACK = 'zh-TW';
let i18nDict = null;       // loaded dict (all langs)
let uiLang = null;         // active LANG_MODES key ('tw'|'jp'|'cn'|'en'|'kr')

function i18nTag(mode) {
  return I18N_UI[mode] || I18N_TAG_FALLBACK;
}

function langParamToMode(v) {
  if (!v) return null;
  let mode = Object.keys(I18N_UI).find(k => k === v);
  if (!mode) mode = Object.keys(I18N_UI).find(k => I18N_UI[k].toLowerCase() === v.toLowerCase());
  return mode || null;
}

function fromUrlLang() {
  const m = location.hash.match(/[?#&]lang=([\w-]+)/) || location.search.match(/[?&]lang=([\w-]+)/);
  return m ? langParamToMode(m[1]) : null;
}

function detectUiLang() {
  // Priority: explicit ?lang= URL param (deep links/automation) -> saved
  // choice -> navigator.language -> en.
  const fromUrl = fromUrlLang();
  if (fromUrl) return fromUrl;
  try {
    const saved = localStorage.getItem('ba_lang');
    if (saved && I18N_UI[saved]) return saved;
  } catch {}
  const n = String(navigator.language || 'en').toLowerCase();
  if (n.startsWith('zh')) return /hans|cn|sg|my/.test(n) ? 'cn' : 'tw';
  if (n.startsWith('ja')) return 'jp';
  if (n.startsWith('ko')) return 'kr';
  return 'en';
}

async function loadI18n() {
  uiLang = detectUiLang();
  // Keep the name-language mode in sync so character names follow the UI
  // language on first load / explicit override; btnLang re-syncs afterwards.
  try {
    if (fromUrlLang() || !localStorage.getItem('ba_lang')) {
      localStorage.setItem('ba_lang', uiLang);
      langMode = uiLang;
    }
  } catch {}
  try {
    i18nDict = await fetchRetry('assets/data/ui_i18n.json').then(r => r.json());
  } catch (e) {
    console.warn('[lobby] ui_i18n 載入失敗，UI 文字退回原始碼字串', e);
    i18nDict = null;
  }
}

function t(key, params) {
  let s = i18nDict?.[i18nTag(uiLang)]?.[key]
    ?? i18nDict?.[I18N_TAG_FALLBACK]?.[key]
    ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

// Walk static DOM: data-i18n -> textContent, data-i18n-title -> title,
// data-i18n-ph -> placeholder.
function applyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
}

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
   let bg = null;             // lobby background skeleton (Akari_bg / Yuzu_bg)
   let sceneIndependent = false;   // scene 骨架 ≠ 角色骨架（獨立背景，需另行定位）
  let sceneBoundsMaxY = 0;   // scene 內容的世界座標最大 Y（供底部對齊）
  let sceneBoundsCenterY = 0; // scene 內容的世界座標中心 Y（供置中對齊）
   let bgCenterX = 0, bgCenterY = 0;   // bg 內容的世界座標中心
   let sceneCenterX = 0, sceneCenterY = 0; // scene 內容的世界座標中心
  let sceneStabTimer = null; // (unused)
 let currentLobby = null;
 let LOBBY_INDEX = {};
 // 由 Unity dump 抽出的每 lobby Transform（scripts/extract_lobby_transforms.py）：
 // bg.mode "char"=與本體同變換（如 CH0060BG_home），"fill"=獨立座標系（如 Akari/Yuzu_BG）
 let LOBBY_TRANSFORMS = null;
 let SCHEDULE = null;
 let BGM_MAP = {};
 let ORDER = [];
 let STUDENT_ICONS = {};

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
let sceneXTarget = 0;        // 場景內容水平置中目標（stabilize 依動畫表演空間校正）
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
// 以骨架 region/mesh 附著物（attachment）的世界頂點量測實際繪製範圍，
// 排除 setup bounds 中未繪製的空白區域，避免 fit 基準偏移。
// （不依賴 extract.canvas，其座標基準會受 scale/position 影響而失真）
function contentWorldBounds(obj) {
  try {
    const sk = obj.skeleton;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const errs = [];
    for (const slot of sk.slots) {
      const att = slot.getAttachment();
      if (!att) continue;
      if (typeof att.computeWorldVertices !== 'function') { errs.push(`no fns: ${slot.data.name}`); continue; }
      try {
        const len = (att.worldVerticesLength || 8);
        const arr = new Float32Array(Math.max(len, 8));
        if (att.type === 2) att.computeWorldVertices(slot, 0, len, arr, 0, 2);   // mesh
        else att.computeWorldVertices(slot, arr, 0, 2);                          // region 等
        for (let i = 0; i < len; i += 2) {
          const x = arr[i], y = arr[i + 1];
          if (!isFinite(x) || !isFinite(y)) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      } catch (e) { errs.push(`${slot.data.name}: ${e.message}`); }
    }
    if (!isFinite(minX) || maxX <= minX) return { err: errs.slice(0, 4).join(' | ') || 'no content' };
    return { minX, minY, maxX, maxY, errs: errs.slice(0, 2) };
  } catch { return null; }
}

function fitScene() {
  const vw = app.renderer.width, vh = app.renderer.height;

  const fitObj = bg || scene;
  let ox = 0, oy = 0, ow = 0, oh = 0;
  if (fitObj) {
    if (bg) {
      // 背景以實際渲染內容為準（貼圖內容 ≠ setup bounds，後者含大量空白）
      try {
        const cb = contentWorldBounds(bg);
        if (cb && cb.maxX > cb.minX && cb.maxY > cb.minY) {
          ox = cb.minX; oy = cb.minY; ow = cb.maxX - cb.minX; oh = cb.maxY - cb.minY;
        }
      } catch {}
    }
    if (!(ow > 0 && oh > 0)) {
      const off = new Vector2(), size = new Vector2();
      try { fitObj.skeleton.getBounds(off, size); } catch { /* fall through to getBounds */ }
      if (size.x > 0 && size.y > 0) {
        ox = off.x; oy = off.y; ow = size.x; oh = size.y;
      } else {
        const b = fitObj.getBounds();
        if (b && b.maxX > b.minX) { ox = b.minX; oy = b.minY; ow = b.maxX - b.minX; oh = b.maxY - b.minY; }
      }
    }
  }
  if (ow > 0 && oh > 0) {
    sceneScale = Math.max(vw / ow, vh / oh);
    sceneBoundsMaxY = oy + oh;
    sceneBoundsCenterY = oy + oh / 2;
    sceneXTarget = vw / 2 - (ox + ow / 2) * sceneScale;
  } else {
    sceneScale = 1;
    sceneXTarget = vw / 2;
  }
  if (bg) {
    const off = new Vector2(), size = new Vector2();
    try { bg.skeleton.getBounds(off, size); } catch {}
    if (size.x > 0 && size.y > 0) { bgCenterX = off.x + size.x / 2; bgCenterY = off.y + size.y / 2; }
  }
  if (scene) {
    const off = new Vector2(), size = new Vector2();
    try { scene.skeleton.getBounds(off, size); } catch {}
    if (size.x > 0 && size.y > 0) { sceneCenterX = off.x + size.x / 2; sceneCenterY = off.y + size.y / 2; }
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

  if (bg || scene) {
    const setTransform = (obj, tx, ty, sc) => {
      const target = (sc !== undefined ? sc : sceneScale) * cam.scale;
      obj.scale.set(
        obj.scale.x + (target - obj.scale.x) * k,
        obj.scale.y + (target - obj.scale.y) * k,
      );
      obj.x += (tx - cam.x - obj.x) * k;
      obj.y += (ty - cam.y - obj.y) * k;
    };
    if (sceneIndependent) {
      // 三獨立物件（Akari）：由 BA 資料堆的 GameObject Transform 還原——
      //   - Akari_home 與 Akari_Scene 的 localPosition(0,-962)/localScale(100) 與父節點完全相同，
      //     故 scene（壽司特寫）在 BA 中與本體共用「完全相同」的變換（同座標系、前景繪製），
      //     沿用本體同一變換（spine.x, spine.y）。
      //   - Akari_BG 的 localPosition(0,0,0) 是 GameObject 軸心；BA 中可視底圖以該軸心為中心繪製、
      //     填滿視窗（lobby root 位於視窗中心）。本專案匯出的骨架原點並非底圖中心（量得偏移約
      //     (748,-196)），故以「內容中心對齊視窗中心」還原 BA 的填滿效果，三者統一以 charScale 繪製。
      const cs = charScale * cam.scale;
      if (bg) {
        // 背景一律沿用人物同一變換（spine.x, spine.y, charScale）。實證：
        // kivo 合併骨架（Yuzu_home_Combined）中 90 個 bg 骨骼的世界座標與我們的
        // 分離 yuzu_bg 完全相同（誤差 <0.001）——合併是「恆等變換」，bg 骨架座標
        // == 人物骨架座標系；CH0060BG_home 的 GameObject 變換亦與本體相同
        // （lobby_transforms.json mode "char"）。底圖大於視窗屬正常（視窗是背景
        // 的檢視區）；舊的「內容置中/cover 縮放」會把底圖縮小下移，正是黑帶來源。
        setTransform(bg, spine.x, spine.y, cs);
      }
      if (scene) setTransform(scene, spine.x, spine.y, cs);
    } else {
      const s = sceneScale * cam.scale;
      if (bg) {
        // 背景填滿視窗：內容中心對齊視窗中心
        setTransform(bg, sceneXTarget, vh * 0.5 - bgCenterY * s);
      }
      if (scene) {
        if (bg) {
          // 前景場景與背景同世界座標系：相對背景中心偏移
          setTransform(scene, sceneXTarget + (sceneCenterX - bgCenterX) * s, vh * 0.5 + (sceneBoundsCenterY - bgCenterY) * s);
        } else {
          // 獨立場景（背景骨架 ≠ 角色骨架）：內容中心對齊視窗中心，避免被推到視窗外；
          // 同骨架場景（場景即角色，如 Fuuka/Momoi/Wakamo）沿用「相機線」定位。
          const sceneYTarget = sceneIndependent
            ? vh * 0.5 - sceneBoundsCenterY * s
            : vh * 0.5 + sceneBiasY;
          setTransform(scene, sceneXTarget, sceneYTarget);
        }
      }
    }
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
  const cacheKey = (voiceLang === 'kr' ? 'kr:' : '') + lower;
  if (voiceLengthCache.has(cacheKey)) return voiceLengthCache.get(cacheKey);
  const url = voiceUrl(currentLobbyVoiceFolder, lower);
  const p = (async () => {
    try {
      const ctx = ensureAudio();
      if (ctx) {
        const buf = await fetchRetry(url).then((r) => r.arrayBuffer());
        const ab = await ctx.decodeAudioData(buf);
        return ab.duration;
      }
    } catch (e) {
      // KR 缺檔 → 退回 JP 檔的長度（JP 一定存在；保持 CoDialog 節奏正確）
      if (voiceLang === 'kr') {
        try {
          const jpUrl = `assets/voice/${currentLobbyVoiceFolder}/${lower}.ogg`;
          const buf = await fetchRetry(jpUrl).then((r) => r.arrayBuffer());
          const ab = await ensureAudio().decodeAudioData(buf);
          return ab.duration;
        } catch {}
      }
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
  voiceLengthCache.set(cacheKey, p);
  return p;
}

// Drive the mouth bones from live voice amplitude (on top of the baked _M lip sync),
// and the eye bones from the cursor (eyes follow cursor).
//
// Many characters have a CHAINED mouth rig (e.g. Midori: Mouth -> Mouth2 -> ...
// -> Mouth7 -> F_Mouth_11 — 7 levels deep). Applying `scaleY *= boost` to every
// bone in such a chain compounds through the parenting (child inherits an already
// boosted scaleY, then multiplies again), exponentially inflating the mouth.
// To stay within the baked _M animation shape only the ROOT bone of each mouth
// sub-tree (the one with no mouth-named ancestor) gets the boost; all descendants
// inherit the boost naturally via the parent's world transform.
//
// Second hazard: for rigs whose root mouth bone has NO ScaleTimeline in any
// animation (e.g. CH0288 — only the child mouth_XXXX bones are animated), the
// baked animation never resets the root bone's scaleY between frames. A plain
// `scaleY *= boost` then accumulates (1.35^60 ≈ 66M after 1s of loud audio),
// blowing the mouth up. For such bones we must REBASE from the setup value each
// frame (`setupY * boost`) instead of compounding. Whether a bone is safe to
// compound is judged dynamically against the CURRENTLY PLAYING tracks (the Idle
// loop on track 0 + the Talk/Look/Pat clip on track 1), because coverage varies
// per animation (some Talk clips scale the root bone, others don't).
function setupLipHook(target) {
  const skeletonData = target.state.data.skeletonData;
  const bones = skeletonData.bones;
  const mouthRe = /mouth/i;
  const indices = [];
  // Per-animation set of bone indices that have a ScaleTimeline, so the
  // per-frame check is a cheap lookup instead of re-scanning timelines.
  const animScale = new Map();  // Animation -> Set<boneIndex>
  for (const anim of skeletonData.animations) {
    const set = new Set();
    for (const tl of anim.timelines) {
      if (tl instanceof ScaleTimeline) set.add(tl.boneIndex);
    }
    if (set.size) animScale.set(anim, set);
  }
  for (let i = 0; i < bones.length; i++) {
    if (!mouthRe.test(bones[i].name)) continue;
    // Walk up ancestors; if any is also a "mouth" bone, this is a child — skip it.
    let ancestor = bones[i].parent;
    let isRoot = true;
    while (ancestor) {
      if (mouthRe.test(ancestor.name)) { isRoot = false; break; }
      ancestor = ancestor.parent;
    }
    if (isRoot) indices.push(i);
  }
  target._mouthIndices = indices;
  target._mouthAnimScale = animScale;
  target.beforeUpdateWorldTransforms = (self) => {
    // Bones whose scaleY the animation state rewrites this frame (all tracks,
    // including the mixing-out clip). These are reset before we multiply, so
    // compounding is safe; the rest must be rebased every frame.
    const resetSet = new Set();
    const tracks = self.state.tracks;
    for (let t = 0; t < tracks.length; t++) {
      let e = tracks[t];
      while (e) {
        const set = e.animation && self._mouthAnimScale.get(e.animation);
        if (set) for (const i of set) resetSet.add(i);
        e = e.mixingFrom;
      }
    }
    if (lipActive && lipAnalyser && self._mouthIndices.length) {
      lipAnalyser.getByteTimeDomainData(lipBuf);
      let sum = 0;
      for (let i = 0; i < lipAnalyser.fftSize; i++) {
        const v = lipBuf[i] - 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / lipAnalyser.fftSize) / 128;
      const boost = 1 + Math.min(1, rms * 6) * 0.35;
      for (const i of self._mouthIndices) {
        const b = self.skeleton.bones[i];
        if (resetSet.has(i)) b.scaleY *= boost;         // animation resets it every frame
        else b.scaleY = b.data.scaleY * boost;          // never touched by animation — rebase
      }
    } else {
      // No voice: bones that the animation does NOT rewrite must return to their
      // setup scaleY or they'd stay frozen at the last boosted value.
      for (const i of self._mouthIndices) {
        if (resetSet.has(i)) continue;
        const b = self.skeleton.bones[i];
        if (b.scaleY !== b.data.scaleY) b.scaleY = b.data.scaleY;
      }
    }
    applyEyeFollow(self);
    if (pinchActive && interactionMode === 'pinch') updatePinch();
    if (handFollowActive && interactionMode === 'handfollow') updateHandFollow();
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

// ---- advanced interactions: Pinch (拖曳捏頰) / Touch (戳) / HandFollow (手部跟隨) ----
// VERIFIED straight from the game skeletons (all 277 lobbies scanned):
// only 10 newer lobbies carry non-standard gesture animations, each with a
// distinct clip set & trigger (see assets/data scan notes):
//   Pinch_01_M / Pinch_02_M + PinchEnd_01_M   -> drag-stretch on the face
//   Touch_01_M / Touch_02_M + TouchEnd_01_M   -> tap / poke on the face
//   HandFollow_01_M / _02_M + HandFollowEnd   -> drag anywhere, hand follows cursor
// Detection is per-lobby and driven by the loaded skeleton's animation names
// (no external config file to keep in sync). These special gestures take priority
// over the base 摸頭 (Pat) on the face region for the characters that own them.
let interactionMode = null;    // 'pinch' | 'touch' | 'handfollow' | null
let pinchActive = false;       // pinch drag in progress
let pinchDeep = false;         // voice/animation switched to the deeper Pinch_02
let handFollowBone = null;     // skeleton position bone driven toward the cursor
let handFollowActive = false;

// Available memorial-lobby voices for the current lobby (media ids, lowercase).
function reactionVoices() {
  if (!validVoices) return [];
  return [...validVoices].filter(v => /memoriallobby/i.test(v));
}
function playReactionVoice() {
  const pool = reactionVoices();
  if (!pool.length) return;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  playVoice(pick);
}

function setupInteraction() {
  interactionMode = null;
  pinchActive = false;
  pinchDeep = false;
  handFollowBone = null;
  handFollowActive = false;
  if (!spine) return;
  // mode priority: pinch > touch > handfollow (mirrors each lobby's primary gesture)
  if (has('Pinch_01_M') || has('Pinch_01') || hasAny('Pinch_')) interactionMode = 'pinch';
  else if (has('Touch_01_M') || hasAny('Touch_')) interactionMode = 'touch';
  else if (has('HandFollow_01_M') || hasAny('HandFollow_')) interactionMode = 'handfollow';
  if (interactionMode) {
    // pick a hand/arm position bone for the HandFollow cursor-tracking (in order
    // of preference; the game keys these `*_hand_Pos*` / `*_LowArm_Pos` bones).
    const pref = ['R_hand_Pos', 'L_hand_Pos2', 'R_LowArm_Pos', 'L_LowArm_Pos',
      'R_lowerarm_rot', 'R_hand_rot', 'L_hand_rot', 'R_UpperArm_Pos', 'L_UpperArm_Pos'];
    for (const name of pref) {
      const b = spine.skeleton.findBone(name);
      if (b) { handFollowBone = b; break; }
    }
  }
  if (interactionMode) log(`進階互動: ${interactionMode}${handFollowBone ? ` (hand=${handFollowBone.data.name})` : ''}`);
  else log('進階互動: 無 (標準 Pat/Look/Talk)');
}

// ---- Pinch (拖曳捏頰) ----
// Face drag: the stretched pose loops while dragging; the farther the pointer
// from the face anchor, the deeper the stretch (Pinch_01 -> Pinch_02). Releasing
// plays PinchEnd + a reaction voice line.
function startPinch() {
  if (!spine || pinchActive) return;
  if (state.introBlock) return;
  if (state.busy === 'talk' && !isInteractionAvailable()) return;
  if (!has('Pinch_01_M') && !has('Pinch_01')) return;
  clearTimers();
  pinchActive = true;
  pinchDeep = false;
  state.busy = 'pinch';
  blockInteraction('pinch', true);
  spine.state.setAnimation(1, has('Pinch_01_M') ? 'Pinch_01_M' : 'Pinch_01', true);
  if (has('Pinch_01_A')) spine.state.setAnimation(2, 'Pinch_01_A', true);
  log('捏頰 (拖曳)');
}

function updatePinch() {
  if (!spine || !pinchActive) return;
  // deepen to Pinch_02 when the pointer is dragged well off the face anchor.
  const deep = has('Pinch_02_M') || has('Pinch_02');
  if (deep && !pinchDeep) {
    const b = headBone();
    if (b) {
      const g = spine.toGlobal({ x: b.worldX, y: b.worldY });
      if (Math.hypot(mouse.x - g.x, mouse.y - g.y) > HEAD_PAT_RADIUS * spine.scale.x * 1.5) {
        pinchDeep = true;
        spine.state.setAnimation(1, has('Pinch_02_M') ? 'Pinch_02_M' : 'Pinch_02', true);
        if (has('Pinch_02_A')) spine.state.setAnimation(2, 'Pinch_02_A', true);
        playReactionVoice();
        log('捏頰 → 更深');
      }
    }
  }
  // subtle face pull toward the finger for the drag feel (Touch_Point bone)
  const b = headBone();
  if (b) {
    const rest = b.parent.localToWorld({ x: b.data.x, y: b.data.y });
    const c = spine.worldTransform.applyInverse({ x: mouse.x, y: mouse.y });
    let dx = c.x - rest.x, dy = c.y - rest.y;
    const d = Math.hypot(dx, dy);
    const max = HEAD_PAT_RADIUS;
    if (d > max) { dx *= max / d; dy *= max / d; }
    const k = 0.25;
    setBoneWorld(b, b.worldX + (rest.x + dx - b.worldX) * k, b.worldY + (rest.y + dy - b.worldY) * k);
  }
}

function endPinch() {
  if (!spine || !pinchActive) return;
  pinchActive = false;
  state.busy = null;
  blockInteraction('pinch', false);
  if (has('PinchEnd_01_M')) spine.state.setAnimation(1, 'PinchEnd_01_M', false);
  if (has('PinchEnd_01_A')) spine.state.setAnimation(2, 'PinchEnd_01_A', false);
  playReactionVoice();
  after(1200, () => { if (state.busy) return; restTracks(); scheduleAutonomy(); });
  log('捏頰結束');
}

// ---- Touch (戳) ----
// Face tap / press: a quick poke (Touch_02, the 0.33 s jolt) on a short tap,
// or the longer Touch_01 on a press; repeated pokes chain. Releasing plays the
// TouchEnd + a reaction line.
function startTouch() {
  if (!spine) return;
  if (state.introBlock) return;
  if (state.busy === 'talk' && !isInteractionAvailable()) return;
  if (!has('Touch_01_M') && !has('Touch_02_M')) return;
  clearTimers();
  state.busy = 'touch';
  blockInteraction('touch', true);
  const now = performance.now();
  const quick = (now - (touchLastAt || 0)) < 900;   // rapid poke → jolt variant
  touchLastAt = now;
  let clip = has('Touch_01_M') ? 'Touch_01_M' : null;
  if (has('Touch_02_M') && quick) clip = 'Touch_02_M';
  if (clip) spine.state.setAnimation(1, clip, false);
  playReactionVoice();
  after(700, () => endTouch());
  log(quick ? '戳 (poke)' : '觸摸');
}
let touchLastAt = 0;

function endTouch() {
  if (!spine || state.busy !== 'touch') return;
  state.busy = null;
  blockInteraction('touch', false);
  if (has('TouchEnd_01_M')) spine.state.setAnimation(1, 'TouchEnd_01_M', false);
  after(1200, () => { if (state.busy) return; restTracks(); scheduleAutonomy(); });
  log('觸摸結束');
}

// ---- HandFollow (手部跟隨) ----
// Drag anywhere: the character's hand tracks the cursor via a position/IK bone
// (like the eye follow), HandFollow_01 loops while moving and HandFollow_02 pulses
// on drag. Release plays HandFollowEnd + a reaction line.
function startHandFollow() {
  if (!spine || handFollowActive) return;
  if (state.introBlock) return;
  if (state.busy === 'talk' && !isInteractionAvailable()) return;
  if (!has('HandFollow_01_M')) return;
  clearTimers();
  handFollowActive = true;
  state.busy = 'handfollow';
  blockInteraction('handfollow', true);
  spine.state.setAnimation(1, 'HandFollow_01_M', true);
  if (has('HandFollow_01_A')) spine.state.setAnimation(2, 'HandFollow_01_A', true);
  playReactionVoice();
  log('手部跟隨');
}

function updateHandFollow() {
  if (!spine || !handFollowActive || !handFollowBone) return;
  // drive the hand position bone toward the cursor (eased), inside its rig.
  const rest = handFollowBone.parent.localToWorld({ x: handFollowBone.data.x, y: handFollowBone.data.y });
  const c = spine.worldTransform.applyInverse({ x: mouse.x, y: mouse.y });
  let dx = c.x - rest.x, dy = c.y - rest.y;
  const d = Math.hypot(dx, dy);
  const max = 220;
  if (d > max) { dx *= max / d; dy *= max / d; }
  const k = 0.35;
  setBoneWorld(handFollowBone,
    handFollowBone.worldX + (rest.x + dx - handFollowBone.worldX) * k,
    handFollowBone.worldY + (rest.y + dy - handFollowBone.worldY) * k);
  // pulse HandFollow_02 once-swap while the pointer moves quickly, then restore
  // the HandFollow_01 loop once the 0.2 s pulse on track 1 completes (otherwise
  // the arm would drop to the idle pose mid-drag).
  const now = performance.now();
  if (has('HandFollow_02_M') && !state.blockInteractionOnPlay) {
    if (updateHandFollow._lx === undefined) updateHandFollow._lx = mouse.x;
    const moving = Math.abs(mouse.x - updateHandFollow._lx) > 4;
    if (moving && now - (updateHandFollow._last || 0) > 600) {
      updateHandFollow._last = now;
      spine.state.setAnimation(1, 'HandFollow_02_M', false);
    } else if (!spine.state.getCurrent(1)) {
      spine.state.setAnimation(1, 'HandFollow_01_M', true);
    }
    updateHandFollow._lx = mouse.x;
  }
}

function endHandFollow() {
  if (!spine || !handFollowActive) return;
  handFollowActive = false;
  state.busy = null;
  blockInteraction('handfollow', false);
  if (has('HandFollowEnd_01_M')) spine.state.setAnimation(1, 'HandFollowEnd_01_M', false);
  if (has('HandFollowEnd_01_A')) spine.state.setAnimation(2, 'HandFollowEnd_01_A', false);
  playReactionVoice();
  after(1400, () => { if (state.busy) return; restTracks(); scheduleAutonomy(); });
  log('手部跟隨結束');
}

// ---- input routing for the special gestures ----
// Dispatched directly inside the pointer handlers (see onPointerDown / Move / Up):
//   pinch / touch consume the face region (replacing Pat), handfollow owns the
//   drag anywhere (replacing Look). Detection is driven by setupInteraction().

let currentLobbyVoiceFolder = null;
// 語音語言：jp（預設）/ kr。KR 資料夾 = voice/KR_<Folder 去 JP_>；缺檔 fallback JP。
let voiceLang = (() => {
  try { return localStorage.getItem('ba_voiceLang') === 'kr' ? 'kr' : 'jp'; }
  catch { return 'jp'; }
})();
function voiceUrl(folder, name) {
  const f = (voiceLang === 'kr') ? folder.replace(/^JP_/, 'KR_') : folder;
  return assetUrl(`assets/voice/${f}/${name}.ogg`);
}
let voiceCalls = 0;
// 逐字稿查詢（lobby_subtitle.json：voiceId -> { jp, tw, en } 或字串）。
// GL dump 未含 memorial lobby 逐字稿，此檔現為空，放入資料即可自動顯示。
let SUBTITLES = null;
// lobby_timelines.json：BA PlayableDirector 的 spine 播放軌道（每 lobby 多段開場排程）
let TIMELINES = null;
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
  const id = voiceId.toLowerCase();
  // 先命中者若是「空殼」（dict 內 jp/tw/en/kr 全空字串，fuse 管線對未匹配
  // 事件的佔位條目，v2026.0827.1 起混入 2,527 筆）視同 miss，繼續往下找
  // lowercase/退化匹配——否則骨架事件字串（MixedCase）會被空殼擋掉，氣泡全滅。
  const useful = (x) => x != null && (typeof x === 'string' ? !!x : Object.values(x).some(Boolean));
  let hit = [SUBTITLES[voiceId], SUBTITLES[id]].find(useful);
  // 表格條數與音檔拆句不同步（如 Shiroko：表格 G1..G4 各1條，音檔 _1.._4 單檔；
  // 但同角色另一皮膚 DevName 撞名時，規則稿可能只剩 _G_I 形式）——
  // 單 index 語音退化匹配「同群組第一條」的翻譯。
  if (hit == null) {
    const m = id.match(/^(.+_memoriallobby_\d+)$/);
    if (m) hit = SUBTITLES[m[1] + '_1'];
  }
  if (!useful(hit)) return null;
  if (typeof hit === 'string') return { text: hit, lang: null };
  // 字幕語言跟隨介面語言（langMode：tw/jp/cn/en/kr）；無該語言時 fallback：
  // cn→tw、kr→jp，再退到任一可用語言。
  const pref = [];
  if (langMode) pref.push(langMode);
  if (langMode === 'cn') pref.push('tw');
  if (langMode === 'kr') pref.push('jp');
  pref.push('jp', 'tw', 'en');
  for (const k of pref) {
    if (hit[k]) return { text: hit[k], lang: k === 'cn' ? 'tw' : k };
  }
  for (const k of ['jp', 'tw', 'en', 'kr']) {
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
// 目前角色的邏輯 ID（如 "Airi"），來自 lobby_voice_schedule.json。
function speakerCharacterId() {
  return SCHEDULE?.lobbies?.[currentLobby]?.characterId || null;
}

// Returned by playVoice() so callers (CoDialog-style coroutines) can `await` the
// end-of-line event with the precise `audioClip.length + 0.5` pacing that the
// real client uses.
function playVoice(voiceId) {
  voiceCalls++;
  const name = voiceId.toLowerCase();
  const jpBase = `assets/voice/${currentLobbyVoiceFolder}/${name}.ogg`;
  const base = voiceUrl(currentLobbyVoiceFolder, name);
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
    // 字幕：lobby_subtitle.json（whisper 驗證逐句稿 + GL 多語）。
    // 查無條目＝SFX（如 airi_memoriallobby_0 舔冰淇淋音效，設計上就沒有台詞）
    // → 直接跳過氣泡。絕不可 fallback 到隨機台詞池（會冒出不相干的日文）。
    const text = subtitleFor(voiceId);
    const lang = subtitleLang(voiceId);
    if (!text) return;
    chatDialog.dataset.lang = lang || '';
    // Balloon style follows the line's DialogType (Think = OS bubble
    // Lobby_balloon2, Talk = Lobby_balloon; UITalk would use Common_Balloon_Type2).
    chatDialog.dataset.dtype = dialogTypeFor(voiceId);
    showChat(speakerName(), text);
  };
  audio.onended = done;
  audio.onerror = () => {
    // KR 模式缺檔 → 靜默退回 JP 語音（換 src 重播一次）
    if (voiceLang === 'kr' && !audio.dataset.jpFallback) {
      audio.dataset.jpFallback = '1';
      audio.src = jpBase;
      audio.play().catch(done);
      return;
    }
    done();
  };
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
  if (animActive) return;   // 逐幀匯出自行驅動語音/嘴型/對話框（非即時，時間軸驅動）
  if (!ev || !ev.data) return;
  let voiceId = (ev.stringValue || ev.data.stringValue || ev.data.name || '').trim();
  if (!voiceId) return;
  // Strip path-like prefixes some JP skeletons use (e.g. "Sound/CH0344_…", "sound/…", "Talk/…").
  voiceId = voiceId.replace(/^[A-Za-z]+\//, '');
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

let bgmFilename = null;   // 目前 lobby 的 BGM 檔名（串流下載完成後重試用）
function setBgm(filename) {
  bgmFilename = filename || null;
  if (bgmAudio) {
    bgmAudio.pause();
    bgmAudio.src = '';
    bgmAudio = null;
  }
  // 標題 BGM 接手時停掉 intro PV 音軌，避免兩首同時響
  if (_introAudio) { _introAudio.pause(); _introAudio = null; }
  if (!bgmOn || !filename) return;
  const audio = new Audio(assetUrl(`assets/bgm/${filename}`));
  audio.loop = true;
  audio.volume = 0.42;
  // 串流模式首次進大廳：pack 下載中 SW cache 尚無此檔 → network 404。
  // 標記失敗，等 ensureLobbyAssets 完成後由 retryBgm() 再播一次。
  audio.addEventListener('error', () => {
    if (bgmAudio === audio) bgmAudio = null;
    console.warn(`[bgm] ${filename} 無法載入（串流包未含或尚在下載）`);
  }, { once: true });
  audio.play().catch(() => {});
  bgmAudio = audio;
}
// BGM 檔案隨 lobby pack 下載；串流首入時可能晚於 setBgm() 就緒 → 補播一次
function retryBgmIfSilent() {
  if (!bgmOn && !bgmAudio) return;
  if (bgmAudio && !bgmAudio.paused && bgmAudio.readyState > 2) return;   // 正常播放中
  const file = bgmFilename || (currentLobby && bgmForLobby(currentLobby));
  if (file && bgmOn) setBgm(file);
}

function toggleBgm() {
  bgmOn = !bgmOn;
  btnBgm.classList.toggle('off', !bgmOn);
  if (!bgmOn && bgmAudio) {
    bgmAudio.pause();
  } else if (bgmOn) {
    setBgm(bgmForLobby(currentLobby));
  }
  log(`BGM: ${bgmOn ? '開' : '關'}`);
}

// BGM 對照以角色核心名建檔（如 Airi_home），但 currentLobby 可能是資源複製版
// （Airi0_home）。用 lobbyGroupInfo 的核心名 + 大小寫不敏感去比對。
function bgmForLobby(name) {
  if (!name || !BGM_MAP) return null;
  if (BGM_MAP[name]) return BGM_MAP[name];
  const core = lobbyGroupInfo(name).core;
  if (!core) return null;
  const want = core + '_home';
  const hit = Object.keys(BGM_MAP).find(k => k.toLowerCase() === want.toLowerCase() || k.toLowerCase() === core);
  return hit ? BGM_MAP[hit] : null;
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
// Pick the looping idle animation from the actual skeleton. Some lobbies name
// it Idle_01 / S2_01, others (e.g. Fuuka: "bub") use an unrelated name — never
// assume the name exists (a missing clip would throw in setAnimation). Placeholder
// zero-length clips like "Dummy" fire `complete` every frame, which would clear
// the intro lock instantly, so they are never used as the idle loop.
function resolveIdleClip() {
  if (!spine) return 'Idle_01';
  const names = animNames();
  for (const n of ['S2_01', 'Idle_01']) if (names.includes(n)) return n;
  const byPattern = names.find(n => /^idle/i.test(n) || /^s\d/i.test(n));
  if (byPattern) return byPattern;
  const usable = names.filter(n => !/^(start|talk|look|pat|dummy|smok)/i.test(n));
  if (usable.length) return usable[0];
  const start = names.find(n => /^start/i.test(n));
  return start || names[0] || 'Idle_01';
}
// Start_Idle intro clip resolver. Almost every lobby names it "Start_Idle_01",
// but some skeletons ship a lowercase variant (e.g. 武裝星野 CH0258_home:
// "Start_idle_01") — resolve case-insensitively instead of hardcoding.
function resolveStartClip() {
  if (!spine) return null;
  const names = animNames();
  return names.find(n => /^start_idle/i.test(n)) || names.find(n => /^start/i.test(n)) || null;
}

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
  state.autonomy = null;
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

// ---- memorial intro white flash (rebuilt 1:1 from the game Timeline) ----
// Per-character curves are extracted from every spinelobbies bundle's
// `<char>_Timeline` -> "Animation Track (1)" infinite clip `Recorded` and shipped
// as `assets/data/flash_curves.json`. Each lobby drives its own exposure /
// white-sprite / depth-of-field curves; the template below (Airi) is only a
// fallback when the data file fails to load. The white screen is driven by:
//   * Volume.weight -> ColorAdjustments postExposure 5.5  (PPPV_Lobby_Airi_C)
//   * SpriteRenderer.m_Color.a -> 4x4 pure-white sprite  (FX_White_01_F_01)
//   * Volume.weight -> DepthOfField gaussian blur         (PPPV_Lobby_Airi_D)
// Unity stores the streamed curve as cubic coefficients applied from each key
// to the next: v = d + dx*(c + dx*(b + dx*a)), dx = t - key.t.
const FALLBACK_FLASH_KEYS = {
  // ColorAdjustments exposure volume weight
  exposure: [
    { t: 0, a: 9.9432, b: -7.1023, c: 0, d: 1 },            // 1 -> 0.5 @0.4s
    { t: 0.4, a: 1.0602, b: -0.4638, c: -0.9091, d: 0.5 },  // 0.5 -> 0 @1.1s
    { t: 1.1, a: 0, b: 0, c: 0, d: 0 },
    { t: 15.4, a: -53.9997, b: 26.9999, c: 0, d: 0 },       // 0 -> 1 @15.733s
    { t: 15.7333333, a: 0, b: 0, c: 0, d: 1 },
    { t: 15.9, a: 29.618, b: -16.1727, c: 0, d: 1 },        // 1 -> 0.3 @16.233s
    { t: 16.2333333, a: -0.2152, b: 0.8403, c: -0.9091, d: 0.3 },
    { t: 17, a: 0, b: 0, c: 0, d: 0 },
  ],
  // white sprite alpha (opening overlay only)
  sprite: [
    { t: 0, a: 843.7498, b: -168.75, c: 0, d: 1 },          // 1 -> 0 @0.133s
    { t: 0.1333333, a: 0, b: 0, c: 0, d: 0 },
  ],
  // DepthOfField volume weight (subtle focus-snap on the flashes)
  dof: [
    { t: 0, a: 0.432, b: -1.08, c: 0, d: 1 },               // 1 -> 0 @1.667s
    { t: 1.6666667, a: 0, b: 0, c: 0, d: 0 },
    { t: 15.8666667, a: -54002.4727, b: 2700.0825, c: 0, d: 0 }, // 0 -> 1 @15.9s
    { t: 15.9, a: 7.8729, b: -7.4792, c: 0, d: 1 },
    { t: 16.5333333, a: 0, b: 0, c: 0, d: 0 },
  ],
};

// Evaluate a Unity streamed cubic at time t (seconds). Holds the last value.
function cubicAt(keys, t) {
  if (!keys || !keys.length) return 0;
  if (t <= keys[0].t) return keys[0].d;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i], n = keys[i + 1];
    if (t <= n.t) {
      const dx = t - k.t;
      return k.d + dx * (k.c + dx * (k.b + dx * k.a));
    }
  }
  return keys[keys.length - 1].d;
}

// Per-character flash table (loaded from assets/data/flash_curves.json).
let FLASH_TABLE = null;
function normalizeFlashKeys(list) {
  if (!list) return undefined;
  return list.map(k => ({ t: k[0], a: k[1], b: k[2], c: k[3], d: k[4] }));
}
function normalizeFlashTable(raw) {
  const out = {};
  for (const [name, entry] of Object.entries(raw || {})) {
    const e = {};
    for (const n of ['exposure', 'sprite', 'dof']) e[n] = normalizeFlashKeys(entry[n]);
    if (entry.body_start != null) e.bodyStart = entry.body_start;
    if (e.exposure || e.sprite || e.dof || e.bodyStart) out[name.toLowerCase()] = e;
  }
  return out;
}
// Curves for the current lobby. null when the intro has no flash (the table is
// authoritative — a few non-standard lobbies are intentionally excluded rather
// than force-fitting the shared template); FALLBACK only if the file never loaded.
function flashCurves() {
  const t = FLASH_TABLE;
  if (t && currentLobby) return t[currentLobby.toLowerCase()] || null;
  return t === null ? FALLBACK_FLASH_KEYS : null;
}

// Net screen whiteness (0..1): the exposure volume and the white sprite both
// white-out the frame, so take their max (Unity post-process + sprite overlay).
function whiteFlashAlpha(t) {
  if (t < 0) return 0;
  const c = flashCurves();
  if (!c) return 0;
  return clamp(Math.max(cubicAt(c.sprite, t), cubicAt(c.exposure, t)), 0, 1);
}

// Current intro timeline time, or -1 when the memorial intro is not playing
// (idle loop / after skip / interactions) — the flash only exists in the intro.
// The flash window is the PlayableDirector timeline, which is often LONGER than
// the skeleton's Start_Idle_01 clip (Fuuka/Momoi: ~2s spine intro but flashes up
// to 6-9s). So drive the flash from a pure virtual clock armed at intro start and
// advanced by real/frame time — NEVER from spine trackTime (which loops / fades /
// switches clips and is not the game's timeline clock).
let introVirtual = false;    // virtual intro clock armed
let introVirtualTime = 0;
let introWindowEnd = 0;      // flash window length for the current lobby (0 = no flash)
let introClockStart = -1;    // performance.now() when armed (live wall-clock source)
function introFlashWindow() {
  const c = flashCurves();
  if (!c) return 0;
  let mx = 0;
  for (const k of ['exposure', 'sprite', 'dof']) {
    const arr = c[k];
    if (Array.isArray(arr)) for (const key of arr) {
      if (!key) continue;
      const t = Array.isArray(key) ? key[0] : key.t;
      if (t > mx) mx = t;
    }
  }
  return mx;
}
function startIntroClock() {
  introWindowEnd = introFlashWindow();
  introVirtual = introWindowEnd > 0;
  introVirtualTime = 0;
  introClockStart = performance.now();
}
// Timeline body-spine start time for the current lobby (0 = the timeline starts
// the body at t=0). Extracted from each spinelobbies bundle's `<char>_Timeline`
// "Spine Animation State Track (1)" first clip start: Akari_home starts its body
// at 3.0s (the Akari_Scene spine + opening flash run 0->5s first), so its intro
// clip plays 3.0 -> 13.3333s and the Idle hand-off lands at 13.3333s.
function introBodyStart() {
  const t = FLASH_TABLE;
  if (t && currentLobby) {
    const e = t[currentLobby.toLowerCase()];
    if (e && e.bodyStart) return e.bodyStart;
  }
  return 0;
}
// Export (animActive) drives the clock by frame time via advanceIntroClock(dt);
// live view drives it by wall-clock time — independent of the app ticker, so a
// render hiccup can never freeze the flash.
function advanceIntroClock(dt) {
  if (introVirtual && dt > 0) introVirtualTime += dt;
}

function introFlashTime() {
  if (!introWindowEnd) return -1;
  if (!animActive && introVirtual && introClockStart >= 0) introVirtualTime = (performance.now() - introClockStart) / 1000;
  return introVirtualTime < introWindowEnd ? introVirtualTime : -1;
}

let lastFlashAlpha = -1;
let lastFlashTick = null;   // debug: last (t, alpha) seen inside tickWhiteFlash
// DepthOfField gaussian blur (Volume.weight -> PPPV_Lobby_Airi_D, gaussianMaxRadius=1.5).
// Attached to the whole stage only while the intro flash blur is active; a zero
// strength filter would still force an offscreen render pass every frame, so it is
// added/removed rather than kept at 0.
const flashBlur = new BlurFilter({ strength: 0, quality: 3 });
let flashBlurOn = false;
// Drive the #whiteflash DOM overlay (live view) + keep it in sync each frame.
function tickWhiteFlash() {
  // 特寫壽司退場：本體進場（introDelay 到，白閃起）時移除 scene 物件
  if (closeupArmAt >= 0 && performance.now() - closeupArmAt >= introBodyStart() * 1000) {
    closeupArmAt = -1;
    removeSceneCloseup();
  }
  const t = introFlashTime();
  const alpha = whiteFlashAlpha(t);
  lastFlashTick = { t, alpha };
  if (alpha !== lastFlashAlpha) {
    lastFlashAlpha = alpha;
    whiteFlashEl.style.opacity = alpha > 0 ? String(alpha) : '0';
  }
  const c = flashCurves();
  const dof = (c && t >= 0) ? cubicAt(c.dof, t) : 0;
  const on = dof > 0.01;
  if (on !== flashBlurOn) {
    flashBlurOn = on;
    app.stage.filters = on ? [flashBlur] : null;
  }
  if (on) flashBlur.strength = clamp(dof * 1.5, 0, 1.5);   // 1.5 = game gaussianMaxRadius
}
function resetWhiteFlash() {
  lastFlashAlpha = -1;
  whiteFlashEl.style.opacity = '0';
  if (flashBlurOn) {
    flashBlurOn = false;
    app.stage.filters = null;
  }
}

// ---- Akari 開場壽司特寫（獨立 scene spine）退場 ----
// BA 中 Akari_Scene 是獨立 spine：開場特寫播完、本體進場（白閃）時整隻移除。
// 這裡直接把 scene 物件從舞台移除並銷毀，對應遊戲「切換後移除 scene 骨架」的行為。
let closeupArmAt = -1;        // 特寫開始時間戳（performance.now()），用於判斷本體進場時機
function armSceneCloseup() { closeupArmAt = performance.now(); }
function removeSceneCloseup() {
  if (!scene) return;          // 已移除（冪等）
  const s = scene;
  scene = null;               // 先置空，避免 loadLobby 拆卸時重複銷毀
  if (s.parent) s.parent.removeChild(s);
  destroyTextures(collectTextures(s));
  s.destroy();
  log('scene closeup removed');
}

function playStart() {
  if (!spine) return;
  const introName = resolveStartClip();
  const hasStart = !!introName;
  if (!idleClip) idleClip = resolveIdleClip();
  // ---- BA PlayableDirector 播放軌道（lobby_timelines.json）----
  // 有排程資料就精確照播：把「本體骨架」的 clips 依 start 排進 track 0
  // （delay 鏈），Idle_01 之後 loop。多段開場（體育服優香 Start_Idle_01 →
  // 10.67s Start_Idle_02 → 24s Idle_01）自動正確，不再一個一個改。
  const tl = TIMELINES?.[currentLobby] ?? TIMELINES?.[currentLobby.toLowerCase()];
  if (tl?.tracks?.length) {
    // timeline 的多條 spine track：本體 = 含 t≈0 clip 的那條（開場特寫骨架是另一條，
    // 通常 start>0 或由 scene 層處理）。選定 track 後過濾掉本體骨架沒有的動畫名。
    const byTrack = new Map();
    for (const t of tl.tracks) {
      if (!byTrack.has(t.spineTrack)) byTrack.set(t.spineTrack, []);
      byTrack.get(t.spineTrack).push(t);
    }
    let best = null;
    for (const [, clips] of byTrack) {
      const startsAtZero = clips.some(c => c.start <= 0.05);
      if (startsAtZero && (!best || clips.length > best.length)) best = clips;
    }
    const bodyClips = (best || [])
      .filter(t => has(t.anim))
      .sort((a, b) => a.start - b.start);
    if (bodyClips.length) {
      state.introBlock = true;
      startIntroClock();
      // 排隊鏈：第一個 clip setAnimation（delay=首 clip.start），後續 addAnimation
      // （delay 相對前一個的「排程結束點」，用絕對 start 差計算）。
      let schedEnd = 0;   // 前一個 clip 的排程絕對結束時間
      let first = true;
      let queuedIdle = false;
      for (const clip of bodyClips) {
        const isIdle = clip.anim === idleClip;
        if (first) {
          spine.state.setAnimation(0, clip.anim, isIdle, Math.max(0, clip.start));
          first = false;
        } else {
          const gap = Math.max(0, clip.start - schedEnd);
          spine.state.addAnimation(0, clip.anim, isIdle, gap);
        }
        schedEnd = clip.start + (isIdle ? 1e9 : clip.duration);   // Idle 無限循環
        if (isIdle) { queuedIdle = true; break; }
      }
      if (!queuedIdle) spine.state.addAnimation(0, idleClip, true, 0);
      startBgSequence();
      log(`[timeline] ${currentLobby}: ${bodyClips.length} clips, total ${tl.duration}s`);
      return;
    }
  }
  if (hasStart) {
    // Memorial intro timeline (PlayableDirector) occupies the screen and locks
    // interaction until it finishes (matching UILobby memory lobby flow). Track 0
    // completion of the intro clears the lock (see onTrackComplete).
    state.introBlock = true;
    startIntroClock();
    const introEntry = spine.state.setAnimation(0, introName, false);
    // Hold track 0 in the setup pose for the Timeline's body start delay (Akari:
    // 3.0s — the Akari_Scene spine + opening flash run first), so the intro clip
    // runs bodyStart -> bodyStart+10.3333s and the Idle hand-off lands at
    // 13.3333s exactly like the PlayableDirector.
    introEntry.delay = introBodyStart();
    spine.state.addAnimation(0, idleClip, true, 0);
    // 背景序列與特寫（獨立 spine 物件）依 BA PlayableDirector 由 startBgSequence 統一驅動：
    // bg 與本體同在 bodyStart(3s) 進場；scene 特寫從 0s 播放，本體進場（白閃）時移除。
    startBgSequence();
  } else {
    spine.state.setAnimation(0, idleClip, true);
    startBgSequence();
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
  introVirtual = false;
  introWindowEnd = 0;
  closeupArmAt = -1;
  removeSceneCloseup();
  spine.state.setAnimation(0, idleClip || 'Idle_01', true);
  startBgSequence({ skip: true });
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
  playVoiceProbe: (v) => playVoice(v),
  typeProbe: (v) => dialogTypeFor(v),
  timelinesProbe: (lobby) => {
    const tl = TIMELINES?.[lobby] ?? TIMELINES?.[lobby?.toLowerCase()];
    return tl ? { n: tl.tracks.length, dur: tl.duration, first: tl.tracks[0] } : null;
  },
  timelinesCount: () => (TIMELINES ? Object.keys(TIMELINES).length : -1),
  queueProbe: () => {
    if (!spine) return null;
    return [0, 1, 2].map(t => {
      const q = spine.state.tracks?.[t];
      const arr = [];
      let cur = q;
      while (cur) { arr.push(`${cur.animation?.name}${cur.loop ? '(loop)' : ''}@${(cur.trackLast||0).toFixed(1)}/${cur.trackEnd?.toFixed(1)}`); cur = cur.next; }
      return arr;
    });
  },
  // 目前 track0/1/1 播放中的動畫名（headless 測試 Start_Idle 解析用）
  animProbe: () => {
    if (!spine) return null;
    return [0, 1, 2].map(t => {
      const e = spine.state.getCurrent(t);
      return e && e.animation ? `${t}:${e.animation.name}` : `${t}:null`;
    });
  },
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
  railPos: () => {
    if (!spine) return null;
    const b = spine.skeleton.findBone('rail_left');
    const t3 = spine.state.getCurrent(3);
    return b ? {
      x: Math.round(b.worldX), y: Math.round(b.worldY),
      t3: t3 ? t3.animation.name : null,
    } : null;
  },
  spineInfo: () => {
    if (!spine) return null;
    const cur = spine.state.getCurrent(0);
    return {
      cur: cur ? cur.animation.name : null,
      dur: cur ? cur.animation.duration : null,
      anims: animNames(),
      idleClip,
      slots: spine.skeleton.slots.map(s => s.data.name),
    };
  },
  sceneInfo: () => {
    if (!scene) return null;
    const cur = scene.state.getCurrent(0);
    return {
      cur: cur ? cur.animation.name : null,
      dur: cur ? cur.animation.duration : null,
      anims: scene.state.data.skeletonData.animations.map(a => a.name),
      slots: scene.skeleton.slots.map(s => s.data.name),
      visible: scene.visible,
    };
  },
  sceneBoundsNow: () => {
    if (!scene) return null;
    try {
      const b = scene.getBounds();
      return { x: Math.round(b.minX), y: Math.round(b.minY), w: Math.round(b.maxX - b.minX), h: Math.round(b.maxY - b.minY) };
    } catch (e) { return { err: e.message }; }
  },
  skeletonInfo: () => {
    const dump = (obj) => {
      if (!obj) return null;
      const data = obj.skeleton ? obj.skeleton.data : obj.skeletonData;
      if (!data) return null;
      const attach = {};
      for (const skin of data.skins || []) {
        if (!skin || !skin.attachments) continue;
        for (const [slotName, atts] of Object.entries(skin.attachments)) {
          attach[slotName] = (attach[slotName] || 0) + Object.keys(atts || {}).length;
        }
      }
      return {
        bones: (data.bones || []).map(b => b.name),
        slots: (data.slots || []).map(s => s.name),
        skins: (data.skins || []).map(s => s.name),
        animations: (data.animations || []).map(a => a.name),
        attachments: attach,
      };
    };
    return { scene: dump(scene), bg: dump(bg), spine: dump(spine) };
  },
  spineBoundsNow: () => {
    if (!spine) return null;
    try {
      const b = spine.getBounds();
      return { x: Math.round(b.minX), y: Math.round(b.minY), w: Math.round(b.maxX - b.minX), h: Math.round(b.maxY - b.minY) };
    } catch (e) { return { err: e.message }; }
  },
  sceneViewport: () => {
    if (!scene) return { err: 'no scene' };
    try {
      const b = scene.getBounds();
      const sk = scene.skeleton;
      const off = new Vector2(), size = new Vector2();
      let setup = null;
      try { sk.getBounds(off, size); setup = { x: Math.round(off.x), y: Math.round(off.y), w: Math.round(size.x), h: Math.round(size.y) }; } catch (e) { setup = { err: e.message }; }
      return {
        vw: app.canvas.width, vh: app.canvas.height,
        scenePos: [Math.round(scene.x), Math.round(scene.y)],
        sceneScale: scene.scale.x.toFixed(3),
        sceneGlobal: { x: Math.round(b.minX), y: Math.round(b.minY), w: Math.round(b.maxX - b.minX), h: Math.round(b.maxY - b.minY) },
        setup,
        sceneVisible: !(b.maxX <= 0 || b.maxY <= 0 || b.minX >= app.canvas.width || b.minY >= app.canvas.height),
      };
    } catch (e) { return { err: e.message }; }
  },
  bgViewport: () => {
    if (!bg) return { err: 'no bg' };
    try {
      const cb = contentWorldBounds(bg);
      const b = bg.getBounds();
      const sk = bg.skeleton;
      const off = new Vector2(), size = new Vector2();
      let setup = null;
      try { sk.getBounds(off, size); setup = { x: Math.round(off.x), y: Math.round(off.y), w: Math.round(size.x), h: Math.round(size.y) }; } catch (e) { setup = { err: e.message }; }
      return {
        vw: app.canvas.width, vh: app.canvas.height,
        bgPos: [Math.round(bg.x), Math.round(bg.y)],
        bgScale: bg.scale.x.toFixed(3),
        bgGlobal: { x: Math.round(b.minX), y: Math.round(b.minY), w: Math.round(b.maxX - b.minX), h: Math.round(b.maxY - b.minY) },
        setup,
        content: (() => { try { const cb = contentWorldBounds(bg); if (!cb) return null; if (cb.err) return { err: cb.err }; return { x: Math.round(cb.minX), y: Math.round(cb.minY), w: Math.round(cb.maxX - cb.minX), h: Math.round(cb.maxY - cb.minY), cxs: Math.round((cb.minX + cb.maxX) / 2), cys: Math.round((cb.minY + cb.maxY) / 2) }; } catch (e) { return { err: e.message }; } })(),
        bgVisible: !(b.maxX <= 0 || b.maxY <= 0 || b.minX >= app.canvas.width || b.minY >= app.canvas.height),
      };
    } catch (e) { return { err: e.message }; }
  },
  fitState: () => ({
    sceneScale, sceneXTarget, sceneBoundsCenterY, bgCenterX, bgCenterY, sceneCenterX,
    camW: (typeof CAMERA !== 'undefined') && CAMERA ? CAMERA.weight : null,
    spine: spine ? { x: Math.round(spine.x), y: Math.round(spine.y), s: +spine.scale.x.toFixed(3) } : null,
    scene: scene ? { x: Math.round(scene.x), y: Math.round(scene.y), s: +scene.scale.x.toFixed(3) } : null,
    bg: bg ? { x: Math.round(bg.x), y: Math.round(bg.y), s: +bg.scale.x.toFixed(3) } : null,
  }),
  gridView: (cols = 20, rows = 9) => {
    try {
      app.render();
      const w = app.canvas.width, h = app.canvas.height;
      if (!w || !h) return { err: 'no view' };
      const gl = app.renderer.gl;
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      const ramp = ' .:-=+*#%@';
      const out = [];
      const px = (x, y) => { const i = ((h - 1 - y) * w + x) * 4; return [buf[i], buf[i + 1], buf[i + 2]]; };
      for (let r = 0; r < rows; r++) {
        const y0 = Math.floor(r * h / rows), y1 = Math.floor((r + 1) * h / rows);
        let line = '';
        for (let c = 0; c < cols; c++) {
          const x0 = Math.floor(c * w / cols), x1 = Math.floor((c + 1) * w / cols);
          let R = 0, G = 0, B = 0, n = 0, col = 0;
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const [pr, pg, pb] = px(x, y);
            R += pr; G += pg; B += pb; n++;
            if (Math.abs(pr - pg) > 24 || Math.abs(pg - pb) > 24) col++;
          }
          const br = (R + G + B) / 3 / n / 255;
          const ch = ramp[Math.min(9, Math.floor(br * 10))];
          line += (col / n > 0.3 ? 'C' : ' ') + ch + ' ';
        }
        out.push(line);
      }
      return { grid: out, w, h };
    } catch (e) { return { err: e.message }; }
  },
  gridShot: (cols = 20, rows = 9, which = 'stage') => {
    try {
      app.render();
      const obj = which === 'scene' ? scene : which === 'spine' ? spine : which === 'bg' ? bg : app.stage;
      if (!obj) return { err: 'no ' + which };
      const cv = app.renderer.extract.canvas(obj);
      if (!cv.width || !cv.height) return { err: 'empty' };
      const ctx = cv.getContext('2d');
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      const ramp = ' .:-=+*#%@';
      const out = [];
      for (let r = 0; r < rows; r++) {
        const y0 = Math.floor(r * cv.height / rows), y1 = Math.floor((r + 1) * cv.height / rows);
        let line = '';
        for (let c = 0; c < cols; c++) {
          const x0 = Math.floor(c * cv.width / cols), x1 = Math.floor((c + 1) * cv.width / cols);
          let R = 0, G = 0, B = 0, n = 0, col = 0;
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const i = (y * cv.width + x) * 4;
            R += d[i]; G += d[i + 1]; B += d[i + 2]; n++;
            if (Math.abs(d[i] - d[i + 1]) > 24 || Math.abs(d[i + 1] - d[i + 2]) > 24) col++;
          }
          const br = (R + G + B) / 3 / n / 255;
          const ch = ramp[Math.min(9, Math.floor(br * 10))];
          line += (col / n > 0.3 ? 'C' : ' ') + ch + ' ';
        }
        out.push(line);
      }
      return { grid: out, w: cv.width, h: cv.height };
    } catch (e) { return { err: e.message }; }
  },
  shotStats: (which = 'stage') => {
    try {
      app.render();
      const obj = which === 'scene' ? scene : which === 'spine' ? spine : which === 'bg' ? bg : app.stage;
      if (!obj) return { err: 'no ' + which };
      const cv = app.renderer.extract.canvas(obj);
      if (!cv.width || !cv.height) return { err: 'empty' };
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      const n = cv.width * cv.height;
      let nonBlack = 0, colorful = 0, bright = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        if (r > 8 || g > 8 || b > 8) nonBlack++;
        if (Math.abs(r - g) > 24 || Math.abs(g - b) > 24) colorful++;
        if ((r + g + b) / 3 > 180) bright++;
      }
      return {
        w: cv.width, h: cv.height,
        nonBlack: (nonBlack / n * 100).toFixed(1),
        colorful: (colorful / n * 100).toFixed(1),
        bright: (bright / n * 100).toFixed(1),
      };
    } catch (e) { return { err: e.message }; }
  },
  stageShot: (maxW = 900) => {
    try {
      app.render();
      const cv = app.renderer.extract.canvas(app.stage);
      if (!cv.width || !cv.height) return { err: 'empty canvas' };
      const s = maxW / cv.width;
      const t = document.createElement('canvas');
      t.width = maxW;
      t.height = Math.round(cv.height * s);
      const c = t.getContext('2d');
      c.drawImage(cv, 0, 0, t.width, t.height);
      return { w: t.width, h: t.height, b64: t.toDataURL('image/jpeg', 0.85).split(',')[1] };
    } catch (e) { return { err: e.message }; }
  },
  sceneShot: (maxW = 900) => {
    if (!scene) return { err: 'no scene' };
    try {
      app.render();
      const cv = app.renderer.extract.canvas(scene);
      if (!cv.width || !cv.height) return { err: 'empty scene canvas' };
      const s = maxW / cv.width;
      const t = document.createElement('canvas');
      t.width = maxW;
      t.height = Math.round(cv.height * s);
      const c = t.getContext('2d');
      c.drawImage(cv, 0, 0, t.width, t.height);
      return { w: t.width, h: t.height, b64: t.toDataURL('image/jpeg', 0.85).split(',')[1] };
    } catch (e) { return { err: e.message }; }
  },
  sceneDetail: () => {
    if (!scene) return null;
    const cur = scene.state.getCurrent(0);
    let bounds = null;
    try {
      const b = scene.getBounds();
      bounds = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.maxX - b.minX), h: Math.round(b.maxY - b.minY), empty: !(b.maxX > b.minX && b.maxY > b.minY) };
    } catch (e) { bounds = { err: e.message }; }
    const slots = [];
    for (const s of scene.skeleton.slots) {
      slots.push({ name: s.data.name, att: s.attachment ? s.attachment.name : null, blend: s.data.blendMode });
    }
    return {
      cur: cur ? cur.animation.name : null,
      dur: cur ? cur.animation.duration : null,
      time: cur ? cur.time : null,
      loop: cur ? cur.loop : null,
      timeScale: scene.state.timeScale,
      anims: scene.state.data.skeletonData.animations.map(a => a.name),
      visible: scene.visible,
      alpha: scene.alpha,
      scale: [scene.scale.x, scene.scale.y],
      pos: [scene.x, scene.y],
      bounds,
      skin: scene.skeleton.skin ? scene.skeleton.skin.name : null,
      slots: slots.slice(0, 16),
      slotCount: scene.skeleton.slots.length,
    };
  },
  texUids: () => {
    const collect = (obj) => {
      if (!obj) return [];
      const out = [];
      if (obj.attachmentCacheData) {
        for (const row of obj.attachmentCacheData) {
          if (!row) continue;
          for (const cd of Object.values(row)) {
            if (cd && cd.texture) out.push({ uid: cd.texture.uid, srcUid: cd.texture.source ? cd.texture.source.uid : null, destroyed: cd.texture.source ? cd.texture.source.destroyed : 'no-src' });
          }
        }
      }
      return out;
    };
    return { spine: collect(spine), scene: collect(scene) };
  },
  scanAttachments: () => {
    const report = (obj, label) => {
      if (!obj) return { label, bad: [], count: 0 };
      const bad = [];
      let count = 0;
      if (obj.attachmentCacheData) {
        for (const row of obj.attachmentCacheData) {
          if (!row) continue;
          for (const [name, cd] of Object.entries(row)) {
            if (!cd || !cd.texture) continue;
            count++;
            const src = cd.texture.source;
            if (!src || src.destroyed || src.style === null) {
              bad.push({ name, uid: cd.texture.uid, srcUid: src ? src.uid : null, destroyed: src ? src.destroyed : 'no-src', styleNull: src ? src.style === null : 'n/a' });
            }
          }
        }
      }
      return { label, bad, count };
    };
    return { spine: report(spine, 'spine'), scene: report(scene, 'scene') };
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
  flash: {
    alphaAt: (t) => whiteFlashAlpha(t),
    curveAt: (name, t) => cubicAt((flashCurves() || {})[name], t),
    introTime: () => introFlashTime(),
    windowEnd: () => introWindowEnd,
    virtual: () => (introVirtual ? introVirtualTime : null),
    lastTick: () => lastFlashTick,
    elOpacity: () => lastFlashAlpha,
    blurOn: () => flashBlurOn,
    blurStrength: () => flashBlur.strength,
    defaultMix: () => (spine ? spine.state.data.defaultMix : null),
    lobbyCurves: () => (flashCurves() || null),
    tableLoaded: () => !!FLASH_TABLE,
  },
  dbgRenderer: () => ({ type: app.renderer.type, w: app.canvas.width, h: app.canvas.height, spineVisible: spine ? spine.visible : null }),
  pixelSum: () => {
    try {
      app.render();
      const pixels = app.renderer.extract.pixels(app.stage);
      let sum = 0;
      for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] + pixels[i+1] + pixels[i+2];
      return { w: app.renderer.width, h: app.renderer.height, sum, px: pixels.length / 4 };
    } catch (e) { return { err: String(e) }; }
  },
  swapStageChildren: () => {
    if (app.stage.children.length >= 2) {
      const c0 = app.stage.children[0];
      const c1 = app.stage.children[1];
      app.stage.setChildIndex(c0, 1);
      app.stage.setChildIndex(c1, 0);
      return 'swapped';
    }
    return 'not-enough-children';
  },
  pixelStats: () => {
    try {
      app.render();
      const c = app.renderer.extract.canvas(app.stage);
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let nonBlack = 0, bright = 0, colored = 0, rSum = 0, gSum = 0, bSum = 0;
      const px = c.width * c.height;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i+1], b = d[i+2], a = d[i+3];
        if (r + g + b > 30) nonBlack++;
        if (r > 100 && g > 100 && b > 100) bright++;
        if (Math.max(r,g,b) - Math.min(r,g,b) > 40) colored++;
        rSum += r; gSum += g; bSum += b;
      }
      return {
        w: c.width, h: c.height,
        nonBlackPct: (nonBlack / px * 100).toFixed(1),
        brightPct: (bright / px * 100).toFixed(1),
        coloredPct: (colored / px * 100).toFixed(1),
        avgRGB: [Math.round(rSum/px), Math.round(gSum/px), Math.round(bSum/px)],
      };
    } catch (e) { return { err: String(e) }; }
  },
  patchRender: () => {
    const tb = app.renderer.texture.bind.bind(app.renderer.texture);
    app.renderer.texture.bind = (source, ...rest) => {
      try { return tb(source, ...rest); } catch (e) {
        window.__badSrc = { uid: source && source.uid, label: source && (source.label || source.label2), styleNull: source ? source.style === null : 'null', destroyed: source ? source.destroyed : 'na', w: source && source.width, h: source && source.height };
        throw e;
      }
    };
    const orig = app.renderer.render.bind(app.renderer);
    app.renderer.render = (...a) => {
      try { return orig(...a); } catch (e) {
        window.__renderErr = { msg: String(e && e.message), stack: (e && e.stack || '').split('\n').slice(0, 3).join('|') };
        const bad = [];
        const walk = (c) => {
          if (!c) return;
          if (c.texture) bad.push({ type: c.constructor?.name, hasSource: !!c.texture.source, sd: c.texture.source ? c.texture.source.destroyed : 'na', styleNull: c.texture.source ? c.texture.source.style === null : 'na' });
          if (c.filters) bad.push({ filters: c.filters.map(f => f.constructor?.name) });
          if (c.children) for (const ch of c.children) walk(ch);
        };
        walk(app.stage);
        window.__renderBad = bad;
        throw e;
      }
    };
    return 'patched';
  },
  scanStage: () => {
    const bad = [];
    const walk = (c) => {
      if (!c) return;
      if (c.texture && c.texture.source === null) bad.push({ type: c.constructor?.name || '?', tex: 'null-source' });
      if (c.texture && c.texture.source && c.texture.source.destroyed) bad.push({ type: c.constructor?.name || '?', tex: 'destroyed-source' });
      if (c.children) for (const ch of c.children) walk(ch);
    };
    walk(app.stage);
    return bad;
  },
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
  stageOrder: () => app.stage.children.map((c, i) => {
    let b = null;
    try { const bb = c.getBounds(); b = { x: Math.round(bb.x), y: Math.round(bb.y), w: Math.round(bb.width), h: Math.round(bb.height) }; } catch {}
    return { i, type: c.constructor?.name, label: c.label || null, slots: c.skeleton ? c.skeleton.slots.length : null, bounds: b };
  }),
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
  dbgExport: () => ({ exporting, animActive, animAbort, exportingDlg: !!exportBalloonActive }),
  anim: {
    start: () => startAnimExport(),
    stop: () => stopAnimExport(true),
    active: () => animActive,
    dbg: () => ({ animActive, animAbort, exporting, tickerStarted: app.ticker.started, autoUpdate: spine ? spine.autoUpdate : null }),
  },
};

// ---- 動畫匯出 ----
// 逐幀編碼：暫停 app.ticker 與 spine 的 autoUpdate，每幀以固定 dt=1/fps 手動推進
// 動畫並 renderer.extract 讀出畫面，把 WebP 幀串流進 main 的 ffmpeg 編碼，產出
// 精確 fps / 精確時長的 MP4 / WebM。支援三種動畫：Idle（loop，可選時長）、
// Start_Idle（一次）、Talk（Idle 底 + 指定 Talk clip 一次）。
// 語音不即時播放：依 lobby_voice_schedule.json 用 OfflineAudioContext 預混成 PCM
// 給 ffmpeg；對話框是 DOM 疊層（readPixels 拍不到），由時間軸驅動直接畫進 canvas。
let exporting = false;
let recRestore = null;     // renderer 原狀態（resize 復原用）
let recSizeStr = '';
let animActive = false;
let animAbort = false;
let animPrevAutoUpdate = true;
let animPixels = null;        // 重複使用的 readPixels 緩衝
let animScratchCanvas = null; // 重複使用的幀編碼 canvas
let animFlipCanvas = null;   // readPixels 翻正用的暫存 canvas
let exportBalloonActive = false;
let balloonImg = null;
let balloonImg2 = null;

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
  if (on.dataset.r !== undefined) return on.dataset.r;
  if (on.dataset.k !== undefined) return on.dataset.k;
  return on.dataset.fmt;
}

function exportClipType() { return segVal('expClip') || 'idle'; }

function openExportPanel() {
  if (!spine) { showToast(t('msg.noChar')); return; }
  expChar.textContent = prettyName(currentLobby);
  const talks = animNames().filter(n => n.startsWith('Talk_') && n.endsWith('_M')).sort();
  expTalkSel.innerHTML = '';
  for (const t of talks) {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    expTalkSel.appendChild(opt);
  }
  expTalkSel.disabled = talks.length === 0;
  updateClipUI();
  updateResUI();
  exportPanel.classList.add('open');
}
function closeExportPanel() { exportPanel.classList.remove('open'); }

// ---- settings panel (language / download mode / assets) ----
const settingsPanel = document.getElementById('settingsPanel');
const setClose = document.getElementById('setClose');
const setLangSegs = document.getElementById('setLangSegs');
const setModeSegs = document.getElementById('setModeSegs');
const setCursorCk = document.getElementById('setCursorCk');
const setClickFxCk = document.getElementById('setClickFxCk');
const setAssetsStatus = document.getElementById('setAssetsStatus');
const setDownloadBtn = document.getElementById('setDownloadBtn');
const setAssetsProgress = document.getElementById('setAssetsProgress');
const setProgressFill = document.getElementById('setProgressFill');
const setProgressText = document.getElementById('setProgressText');

function setUiLanguage(mode) {
  langMode = mode;
  try { localStorage.setItem('ba_lang', mode); } catch {}
  uiLang = mode;                     // UI language follows the name-language cycle
  applyI18n();
  if (currentLobby) renderStudentName(currentLobby);
  if (sidePanel.classList.contains('open')) renderSidebar();
  syncSettingsLangSegs();
  log(t('log.lang', { label: langLabel(langMode), ui: i18nTag(langMode) }));
}

function buildLangSegs() {
  setLangSegs.innerHTML = '';
  for (const [mode, label] of LANG_MODES) {
    const b = document.createElement('button');
    b.textContent = label;
    b.dataset.lang = mode;
    b.addEventListener('click', () => setUiLanguage(mode));
    setLangSegs.appendChild(b);
  }
}

function syncSettingsLangSegs() {
  for (const b of setLangSegs.querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.lang === langMode);
  }
}

// ---- 語音語言（jp/kr）----
const setVoiceLangSegs = document.getElementById('setVoiceLangSegs');
function syncVoiceLangSegs() {
  if (!setVoiceLangSegs) return;
  for (const b of setVoiceLangSegs.querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.v === voiceLang);
  }
}
setVoiceLangSegs?.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b || b.dataset.v === voiceLang) return;
  voiceLang = b.dataset.v;
  try { localStorage.setItem('ba_voiceLang', voiceLang); } catch {}
  syncVoiceLangSegs();
  log('voice lang: ' + voiceLang);
});

function settingsStreaming() {
  return window.ba?.getStreamingMode
    ? window.ba.getStreamingMode()
    : Promise.resolve(false);
}

async function syncSettingsModeSegs() {
  const streaming = await settingsStreaming();
  for (const b of setModeSegs.querySelectorAll('button')) {
    b.classList.toggle('on', (b.dataset.m === 'streaming') === streaming);
  }
}

function fmtBytes(n) {
  if (!Number.isFinite(n)) return '?';
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
  if (n >= 1048576) return (n / 1048576).toFixed(0) + ' MB';
  return (n / 1024).toFixed(0) + ' KB';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let _settingsAssetInfo = null;

async function refreshSettingsAssets() {
  try {
    _settingsAssetInfo = await window.ba.checkAssets();
  } catch {
    _settingsAssetInfo = null;
  }
  renderSettingsAssets();
}

function renderSettingsAssets() {
  const info = _settingsAssetInfo;
  if (!info || !info.remoteVersion) {
    setAssetsStatus.innerHTML = `<span class="warn">${t('set.statusOffline')}</span>`;
    setDownloadBtn.style.display = 'none';
    return;
  }
  const local = info.localVersion;
  const verRow = t('set.statusVersion', { remote: info.remoteVersion, local: local || t('dl.localNone') });
  let html = `${info.needsDownload ? '<span class="warn">⚠</span>' : '<span class="ok">✓</span> '}${verRow}`;
  if (info.needsDownload && Array.isArray(info.needsDownloadPacks) && info.needsDownloadPacks.length) {
    const packs = info.packages || {};
    let bytes = 0;
    for (const k of info.needsDownloadPacks) bytes += packs[k]?.size || 0;
    html += `<br><span class="warn">⤓</span> ${t('set.pending', { n: info.needsDownloadPacks.length, size: fmtBytes(bytes) })}`;
    setDownloadBtn.style.display = 'block';
  } else {
    setDownloadBtn.style.display = 'none';
  }
  setAssetsStatus.innerHTML = html;
}

function startSettingsDownload() {
  const info = _settingsAssetInfo;
  if (!info?.remoteVersion || !Array.isArray(info.packages)) return;
  setDownloadBtn.style.display = 'none';
  setAssetsProgress.style.display = 'block';
  window.ba.onDownloadProgress?.((p) => {
    if (p.status === 'downloading') {
      setProgressText.textContent = `${p.package} (${p.index + 1}/${p.total}) — ${p.percent}%`;
      setProgressFill.style.width = p.percent + '%';
    } else if (p.status === 'done') {
      setProgressFill.style.width = '100%';
    } else if (p.status === 'error') {
      setProgressText.textContent = `⚠ ${p.error}`;
    }
  });
  // 下載全部缺的包（尊重目前模式：串流模式時 check-assets 已只回 core/intro）
  const version = info.remoteVersion || '1.0.0';
  const pkgs = {};
  for (const k of info.needsDownloadPacks || []) pkgs[k] = info.packages[k];
  window.ba.downloadAssets({ version, packages: pkgs }).then(async () => {
    setAssetsProgress.style.display = 'none';
    await refreshSettingsAssets();
  }).catch((e) => {
    setProgressText.textContent = `⚠ ${e?.message || e}`;
  });
}

function settingsPref(key, dflt) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? dflt : v === '1';
  } catch { return dflt; }
}

function syncSettingsEffectCks() {
  if (setCursorCk) setCursorCk.checked = settingsPref('ba_cursor', true);
  if (setClickFxCk) setClickFxCk.checked = settingsPref('ba_clickfx', true);
}

// ---- 管理空間（已下載資源包檢視 + 刪除）----
const setSpaceSummary = document.getElementById('setSpaceSummary');
const setSpaceToggle = document.getElementById('setSpaceToggle');
const setSpaceList = document.getElementById('setSpaceList');
let _spaceInfo = null;
let _spaceOpen = false;

function spaceKindLabel(kind) {
  const map = { core: t('set.space.kindCore'), intro: t('set.space.kindIntro'), lobby: t('set.space.kindLobby'), voice: t('set.space.kindVoice') };
  return map[kind] || kind;
}

async function refreshSpaceManager() {
  try {
    _spaceInfo = await window.ba.assetsManageList?.();
  } catch { _spaceInfo = null; }
  renderSpaceSummary();
  if (_spaceOpen) renderSpaceList();
}

function renderSpaceSummary() {
  if (!setSpaceSummary || !setSpaceToggle) return;
  if (!_spaceInfo || !_spaceInfo.packs?.length) {
    setSpaceSummary.textContent = t('set.space.empty');
    setSpaceToggle.style.display = 'none';
    setSpaceList.style.display = 'none';
    return;
  }
  const n = _spaceInfo.packs.length;
  setSpaceSummary.textContent = `${t('set.space.summary', { n, size: fmtBytes(_spaceInfo.totalSize) })} · v${_spaceInfo.version || '?'}`;
  setSpaceToggle.style.display = 'inline-block';
}

function renderSpaceList() {
  if (!setSpaceList || !_spaceInfo) return;
  const packs = _spaceInfo.packs || [];
  let html = '';
  for (const p of packs) {
    const delBtn = p.deletable
      ? `<button class="spaceDel" data-key="${p.key}" data-i18n-title="set.space.delete" title="刪除">✕</button>`
      : `<span class="spaceLock" data-i18n-title="set.space.locked" title="必要資源">🔒</span>`;
    html += `<div class="spaceRow">
      <div class="spaceMain">
        <span class="spaceName">${escapeHtml(p.name)}</span>
        <span class="spaceKind">${spaceKindLabel(p.kind)}</span>
        ${p.present ? '' : `<span class="warn" style="font-size:10px;">⚠</span>`}
      </div>
      <span class="spaceSize">${fmtBytes(p.size)}</span>
      ${delBtn}
    </div>`;
  }
  setSpaceList.innerHTML = html;
  for (const btn of setSpaceList.querySelectorAll('.spaceDel')) {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.key;
      if (!confirm(t('set.space.confirm', { key }))) return;
      btn.disabled = true;
      try {
        await window.ba.assetsManageDelete([key]);
        await refreshSpaceManager();
      } finally {
        btn.disabled = false;
      }
    });
  }
}

setSpaceToggle?.addEventListener('click', () => {
  _spaceOpen = !_spaceOpen;
  setSpaceList.style.display = _spaceOpen ? 'block' : 'none';
  if (_spaceOpen) renderSpaceList();
  setSpaceToggle.textContent = _spaceOpen ? t('set.space.close') : t('set.space.open');
});

function toggleSettingsPanel(force) {
  // force 可能是 addEventListener 傳入的 Event 物件（truthy）——只接受真正的 boolean。
  const open = typeof force === 'boolean' ? force : !settingsPanel.classList.contains('open');
  if (open) {
    exportPanel.classList.remove('open');
    sidePanel.classList.remove('open');
    syncSettingsLangSegs();
    syncSettingsModeSegs();
    syncVoiceLangSegs();
    syncSettingsEffectCks();
    refreshSettingsAssets();
    refreshSpaceManager();
  }
  settingsPanel.classList.toggle('open', open);
}


function showRecBadge(duration) {
  recTime.textContent = '0:00';
  recDur.textContent = fmtClock(duration);
  recBadge.classList.add('show');
}
function hideRecBadge() { recBadge.classList.remove('show'); }

// 解析度：目前視窗 / 目前螢幕 / kivo 適應 / 自訂（輸出四捨五入到偶數，H.264 yuv420p）
async function resolveExportSize() {
  const mode = segVal('expRes') || 'win';
  if (mode === 'win') return { w: app.renderer.width, h: app.renderer.height };
  if (mode === 'screen') {
    try {
      const s = await window.ba.screenSize();
      if (s && s.width && s.height) return { w: Math.round(s.width) & ~1, h: Math.round(s.height) & ~1 };
    } catch (e) { console.warn('[anim] 讀取螢幕尺寸失敗', e); }
    return { w: app.renderer.width, h: app.renderer.height };
  }
  if (mode === 'custom') {
    const w = clamp(Math.round(+expCustomW.value || 0), 64, 7680);
    const h = clamp(Math.round(+expCustomH.value || 0), 64, 4320);
    if (!w || !h) return { w: app.renderer.width, h: app.renderer.height };
    return { w: w & ~1, h: h & ~1 };
  }
  const s = await kivoFitSize();
  return s && s.w && s.h ? { w: s.w & ~1, h: s.h & ~1 } : { w: app.renderer.width, h: app.renderer.height };
}

// kivo.wiki spine 檢視器的「適應」尺寸。反混淆 kivo bundle 後解出的兩個 fit 函式
// （_0xe87989 的 contain、_0x5e2800 的 zoom clamp）都屬於圖片裁切器
// （naturalWidth/naturalHeight），spine 檢視器本身沒有專屬的尺寸公式；
// 因此映射為「視窗原生 backing store」= innerWidth×devicePixelRatio，
// 與 kivo fill 的 charScale = vw/3000 邏輯一致。
async function kivoFitSize() {
  try {
    const dpr = window.devicePixelRatio || 1;
    return { w: Math.round(window.innerWidth * dpr), h: Math.round(window.innerHeight * dpr) };
  } catch (e) { return null; }
}

// ---- 語音時間軸 ----
// 從 lobby_voice_schedule.json 把指定動畫的語音事件展開成 {start, end, voiceId, text,
// dtype, lang}，end = 事件時間 + 實際語音長度（probeVoiceLength 有快取）。
async function buildVoiceTimeline(animName, duration) {
  const schAnim = SCHEDULE?.lobbies?.[currentLobby]?.animations?.[animName];
  const lines = schAnim?.voice || [];
  const out = [];
  for (const l of lines) {
    if (!l || typeof l.name !== 'string') continue;
    // Strip path-like prefixes (Sound/, Talk/, etc.) consistent with onAnimationEvent.
    const raw = l.name.replace(/^[A-Za-z]+\//, '');
    const lower = raw.toLowerCase();
    if (voiceSkip.has(lower)) continue;
    if (validVoices && !validVoices.has(lower)) continue;
    const len = await probeVoiceLength(raw);
    out.push({
      start: l.t,
      end: Math.min(duration, l.t + len),
      voiceId: raw,
      text: subtitleFor(raw),
      dtype: dialogTypeFor(raw),
      lang: subtitleLang(raw),
    });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

// OfflineAudioContext 把語音混成一條 s16le PCM（不含 BGM — 動畫匯出不放 BGM，
// BGM 只有「匯出 BGM」會輸出原檔）。來源多為單聲道，接進立體 dest 會置中。
async function mixVoicePcm(timeline, duration) {
  if (!timeline || !timeline.length) return null;
  const sr = 44100;
  const total = Math.max(1, Math.ceil(duration * sr));
  let offline;
  try {
    offline = new OfflineAudioContext(2, total, sr);
  } catch (e) {
    console.warn('[anim] OfflineAudioContext 不可用，匯出無語音', e);
    return null;
  }
  for (const e of timeline) {
    if (e.start >= duration || !currentLobbyVoiceFolder) continue;
    try {
      const buf = await fetchRetry(voiceUrl(currentLobbyVoiceFolder, e.voiceId.toLowerCase())).then(r => r.arrayBuffer());
      const ab = await offline.decodeAudioData(buf);
      const src = offline.createBufferSource();
      src.buffer = ab;
      src.connect(offline.destination);
      src.start(Math.max(0, e.start));
    } catch (err) {
      console.warn('[anim] 語音混音失敗', e.voiceId, err);
    }
  }
  const rendered = await offline.startRendering();
  const n = rendered.length;
  const L = rendered.getChannelData(0);
  const R = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : L;
  const out = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) {
    let l = L[i], r = R[i];
    l = l < -1 ? -1 : l > 1 ? 1 : l;
    r = r < -1 ? -1 : r > 1 ? 1 : r;
    out[i * 2] = l < 0 ? l * 0x8000 : l * 0x7fff;
    out[i * 2 + 1] = r < 0 ? r * 0x8000 : r * 0x7fff;
  }
  return { pcm: new Uint8Array(out.buffer), sampleRate: sr, channels: 2 };
}

// ---- 對話框繪進 canvas ----
// readPixels 只拍得到 WebGL canvas，DOM 對話框不會入鏡；這裡用與 #chatDialog 相同
// 的 CSS 規則（9-slice Lobby_balloon/2.png、padding、min-height、字體/行高/間距、
// positionChat 錨點 + flip）把氣泡直接畫上輸出畫布。
function balloonFont(lang) {
  if (lang === 'ja' || lang === 'jp') return `'BA MPlus1p','M PLUS 1p','Noto Sans JP','Noto Sans TC',sans-serif`;
  if (lang === 'en') return `'BA NotoSans','Noto Sans','Segoe UI',sans-serif`;
  return `'BA NotoSansTC','Noto Sans TC','Microsoft JhengHei','PingFang TC',sans-serif`;
}
function wrapCanvasText(ctx, text, maxW) {
  const lines = [];
  for (const raw of String(text).split('\n')) {
    if (raw === '') { lines.push(''); continue; }
    let line = '';
    for (const ch of raw) {
      const test = line + ch;
      if (line && ctx.measureText(test).width > maxW) { lines.push(line); line = ch; }
      else line = test;
    }
    lines.push(line);
  }
  return lines;
}
function loadBalloonImages() {
  return new Promise((res) => {
    if (!balloonImg) {
      balloonImg = new Image();
      balloonImg.src = assetUrl('assets/ui/Lobby_balloon.png');
      balloonImg2 = new Image();
      balloonImg2.src = assetUrl('assets/ui/Lobby_balloon2.png');
    }
    const ok = () => balloonImg.complete && balloonImg2.complete;
    if (ok()) return res(true);
    const done = () => (ok() ? res(true) : res(false));
    balloonImg.onload = done;
    balloonImg2.onload = done;
    setTimeout(() => res(ok()), 3000);
  });
}
function drawNineSlice(c2, img, boxX, boxY, bw, bh, bs, brd, flip) {
  const [t, r, b, l] = brd;
  const sw = img.naturalWidth, sh = img.naturalHeight;
  const mw = sw - l - r, mh = sh - t - b;
  const tl = l * bs, tr = r * bs, tt = t * bs, tb = b * bs;
  const slice = (sx, sy, sw2, sh2, dx, dy, dw, dh) => {
    if (dw <= 0 || dh <= 0 || sw2 <= 0 || sh2 <= 0) return;
    c2.drawImage(img, sx, sy, sw2, sh2, dx, dy, dw, dh);
  };
  c2.save();
  if (flip) {
    c2.translate(boxX + bw / 2, boxY + bh / 2);
    if (flip & 1) c2.scale(-1, 1);
    if (flip & 2) c2.scale(1, -1);
    c2.translate(-(boxX + bw / 2), -(boxY + bh / 2));
  }
  slice(0, 0, l, t, boxX, boxY, tl, tt);
  slice(sw - r, 0, r, t, boxX + bw - tr, boxY, tr, tt);
  slice(0, sh - b, l, b, boxX, boxY + bh - tb, tl, tb);
  slice(sw - r, sh - b, r, b, boxX + bw - tr, boxY + bh - tb, tr, tb);
  slice(l, 0, mw, t, boxX + tl, boxY, bw - tl - tr, tt);
  slice(l, sh - b, mw, b, boxX + tl, boxY + bh - tb, bw - tl - tr, tb);
  slice(0, t, l, mh, boxX, boxY + tt, tl, bh - tt - tb);
  slice(sw - r, t, r, mh, boxX + bw - tr, boxY + tt, tr, bh - tt - tb);
  slice(l, t, mw, mh, boxX + tl, boxY + tt, bw - tl - tr, bh - tt - tb);
  c2.restore();
}
// 畫一幀白閃（mirror of #whiteflash, drawn into the export canvas like the
// balloon — readPixels 拍不到 DOM 疊層）。在氣泡之前畫：遊戲的 post-processing
// 作用於相機畫面，NGUI 對話框在它之上。
function drawExportWhiteFlash(c2, vw, vh, alpha) {
  if (alpha <= 0) return;
  c2.save();
  c2.globalAlpha = clamp(alpha, 0, 1);
  c2.fillStyle = '#fff';
  c2.fillRect(0, 0, vw, vh);
  c2.restore();
}

// 畫一幀氣泡。layout 完全對應 #chatDialog CSS + positionChat()（以輸出寬度為 vw）。
function drawExportBalloon(c2, vw, vh, line) {  if (!balloonImg || !balloonImg2) return;
  const bs = vw / 3840;
  const isThink = line.dtype === 'Think';
  const img = isThink ? balloonImg2 : balloonImg;
  const padL = (isThink ? 130 : 79) * bs, padR = (isThink ? 50 : 59) * bs;
  const padT = (isThink ? 43 : 45) * bs, padB = (isThink ? 55 : 44) * bs;
  const minH = (isThink ? 222 : 213) * bs;
  const maxW = 740 * bs;
  const fontSize = 52 * bs, lineH = 62 * bs, ls = -2 * bs;
  const fam = balloonFont(line.lang || '');
  const prevLs = c2.letterSpacing;
  c2.font = `${fontSize}px ${fam}`;
  c2.letterSpacing = ls + 'px';
  const lines = wrapCanvasText(c2, line.text || '', maxW);
  let maxLineW = 0;
  for (const l of lines) { const w = c2.measureText(l).width; if (w > maxLineW) maxLineW = w; }
  c2.letterSpacing = prevLs;

  const textH = lines.length * lineH;
  const bw = Math.ceil(maxLineW) + padL + padR;
  const bh = Math.max(minH, Math.ceil(textH) + padT + padB);

  const a = CHAT_ANCHORS[currentLobby] || { tx: 0, ty: 0, skY: -962 };
  let tx = a.tx, ty = a.ty;
  if (isThink) { tx += (a.thinkOffsetX || 0); ty += (a.thinkOffsetY || 0); }
  const flip = a.flip || 0;
  const skUp = -a.skY;
  const g = spine ? spine.toGlobal({ x: 0, y: 0 }) : { x: vw / 2, y: vh };
  let x = g.x + tx * bs;
  if (flip & 1) x = g.x - tx * bs - bw;
  let y = g.y - (skUp + ty) * bs - bh;
  const maxX = vw - bw - 6, maxY = vh - bh - 6;
  if (x < 6) x = 6;
  if (x > maxX) x = maxX;
  if (y < 6) y = 6;
  if (y > maxY) y = maxY;

  drawNineSlice(c2, img, x, y, bw, bh, bs, isThink ? [85, 50, 55, 130] : [84, 50, 60, 80], flip);

  const contentH = bh - padT - padB;
  const textTop = padT + (contentH - textH) / 2;
  c2.save();
  c2.font = `${fontSize}px ${fam}`;
  c2.letterSpacing = ls + 'px';
  c2.fillStyle = '#3E444A';
  c2.textBaseline = 'top';
  c2.textAlign = 'left';
  for (let i = 0; i < lines.length; i++) c2.fillText(lines[i], x + padL, y + textTop + i * lineH);
  c2.restore();
  c2.letterSpacing = '0px';
}

// ---- 逐幀動畫匯出主流程 ----
async function startAnimExport() {
  if (!spine || animActive || exporting) return;
  const clipType = exportClipType();
  const fps = Math.min(60, Math.max(10, +segVal('expFps') || 30));
  const fmt = segVal('expFmt') || 'mp4';
  const withVoice = expVoice.checked;
  const withDialog = expDialog.checked;

  let animName, track1 = null, track2 = null;
  if (clipType === 'talk') {
    const m = expTalkSel.value;
    if (!m || !has(m)) { showErr(t('msg.noTalk')); return; }
    animName = m;
    track1 = m;
    const a2 = m.replace(/_M$/, '_A');
    track2 = has(a2) ? a2 : null;
  } else if (clipType === 'start') {
    const startClip = resolveStartClip();
    if (!startClip) { showErr(t('msg.noStartIdle')); return; }
    animName = startClip;
  } else {
    animName = idleClip || 'Idle_01';
  }
  const clipDur = has(animName) ? (spine.state.data.skeletonData.findAnimation(animName)?.duration || 10) : 10;
  const duration = clipDur;

  exporting = true;
  animActive = true;
  animAbort = false;

  // 先停 ticker / autoUpdate：後續 await（語音混音、儲存對話框）期間動畫不能推進
  app.ticker.stop();
  animPrevAutoUpdate = spine.autoUpdate;
  spine.autoUpdate = false;
  spine.state.timeScale = 1;

  memoryLobbySkip();          // 先固定 Idle 底
  clearTimers();
  scheduleAutonomy();         // 取消隨機說話

  // setAnimation 一律會 crossfade（mix，本資料 0.2s = SkeletonData.defaultMix）。若直接開始輸出，
  // 片頭幾幀會混入舊動畫 pose，影片頭尾對不上（loop 播放會有明顯接縫）。
  // 先把 track0 的 transition 跑完、倒帶到 loop 起點，頭部即為乾淨的 Idle pose。
  const _t0 = spine.state.getCurrent(0);
  if (_t0) {
    const _settle = (_t0.mixDuration || 0) + 0.05;
    if (_settle > 0) spine.update(_settle);
    const _cur = spine.state.getCurrent(0);
    if (_cur && _cur.animation === _t0.animation) {
      _cur.trackTime = 0;
      spine.update(0);
    }
  }

  if (clipType === 'talk') {
    spine.state.setAnimation(1, track1, false);
    if (track2) spine.state.setAnimation(2, track2, false);
    else spine.state.setEmptyAnimation(2, 0.3);
  } else if (clipType === 'start') {
    spine.state.setEmptyAnimation(1, 0.3);
    spine.state.setEmptyAnimation(2, 0.3);
    spine.state.setAnimation(0, animName, false);   // animName = resolveStartClip()
    startIntroClock();
  } else {
    restTracks();             // idle：清掉可能殘留的 talk/摸頭 track
  }

  const timeline = (clipType === 'idle' || !withVoice) ? [] : await buildVoiceTimeline(animName, duration);
  const audio = timeline.length ? await mixVoicePcm(timeline, duration) : null;

  recRestore = { resizeTo: app.renderer.resizeTo, w: app.renderer.width, h: app.renderer.height };
  const { w, h } = await resolveExportSize();
  if (w !== app.renderer.width || h !== app.renderer.height) {
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
  const clipTag = clipType === 'idle' ? 'idle' : clipType === 'start' ? 'start' : 'talk';
  const sess = await window.ba.startAnimVideo({
    w: app.renderer.width,
    h: app.renderer.height,
    fps,
    duration,
    ext,
    defaultName: `${currentLobby}_${clipTag}_${Math.round(duration)}s_${recSizeStr}.${ext}`,
    audioPcm: audio ? audio.pcm : null,
    sampleRate: audio ? audio.sampleRate : 44100,
    channels: audio ? audio.channels : 2,
  });
  if (!sess || sess.canceled) { await cleanupAnimExport(); return; }
  if (sess.error) { await cleanupAnimExport(); showErr(t('msg.expStartFail', { err: sess.error })); return; }

  document.body.classList.add('recording');

  let balloonReady = false;
  if (withDialog && timeline.length) {
    try {
      await document.fonts.ready;
      await Promise.all([
        document.fonts.load('52px "BA NotoSansTC"'),
        document.fonts.load('52px "BA MPlus1p"'),
        document.fonts.load('52px "BA NotoSans"'),
      ]);
      balloonReady = await loadBalloonImages();
    } catch (e) {
      console.warn('[anim] 對話框資源預載失敗', e);
    }
  }

  showRecBadge(duration);
  log(`動畫匯出開始: ${clipType} ${duration}s ${recSizeStr} ${fps}fps ${ext} frames=${total} voice=${timeline.length}`);

  const vw = app.renderer.width, vh = app.renderer.height;
  const need = vw * vh * 4;
  if (!animPixels || animPixels.length !== need) animPixels = new Uint8Array(need);
  if (!animScratchCanvas) animScratchCanvas = document.createElement('canvas');
  const scratch = animScratchCanvas;
  if (scratch.width !== vw || scratch.height !== vh) { scratch.width = vw; scratch.height = vh; }
  const c2 = scratch.getContext('2d');
  c2.imageSmoothingEnabled = true;
  c2.imageSmoothingQuality = 'high';
  // readPixels 的內容是 bottom-up（第一列在最底下）。putImageData 會忽略
  // canvas transform，所以以前那組 translate/scale 沒生效、影片是上下顛倒的。
  // 先把原始資料放進 flip canvas，再用 drawImage（會套用 transform）翻正。
  if (!animFlipCanvas) animFlipCanvas = document.createElement('canvas');
  const flip = animFlipCanvas;
  if (flip.width !== vw || flip.height !== vh) { flip.width = vw; flip.height = vh; }
  const f2 = flip.getContext('2d');

  let tlIdx = 0;
  for (let i = 0; i < total; i++) {
    if (animAbort) break;
    const T = i / fps;
    spine.update(dt);
    advanceIntroClock(dt);
    try {
      app.render();
      const gl = app.canvas.getContext('webgl2') || app.canvas.getContext('webgl');
      gl.readPixels(0, 0, vw, vh, gl.RGBA, gl.UNSIGNED_BYTE, animPixels);
      const img = new ImageData(new Uint8ClampedArray(animPixels.buffer, 0, need), vw, vh);
      f2.putImageData(img, 0, 0);
      c2.setTransform(1, 0, 0, 1, 0, 0);
      c2.translate(0, vh);
      c2.scale(1, -1);
      c2.drawImage(flip, 0, 0, vw, vh);
      c2.setTransform(1, 0, 0, 1, 0, 0);

      while (tlIdx < timeline.length && timeline[tlIdx].start <= T) tlIdx++;
      let active = null;
      if (tlIdx > 0) { const prev = timeline[tlIdx - 1]; if (prev.end > T) active = prev; }
      lipActive = !!active;
      const flashA = whiteFlashAlpha(introFlashTime());
      drawExportWhiteFlash(c2, vw, vh, flashA);
      tickWhiteFlash();
      exportBalloonActive = !!(balloonReady && active && active.text);
      if (exportBalloonActive) drawExportBalloon(c2, vw, vh, active);

      const blob = await new Promise((r) => scratch.toBlob(r, 'image/webp', 90));
      if (blob && blob.size) window.ba.animFrame(await blob.arrayBuffer());
    } catch (e) {
      console.error('[anim] 幀處理失敗', e);
      animAbort = true;
    }
    recTime.textContent = fmtClock(T);
    recDur.textContent = `${i + 1}/${total}`;
    if (i % 15 === 0) await nextFrame();
  }

  let res = null;
  if (animAbort) { window.ba.abortAnimVideo(); }
  else {
    try { res = await window.ba.finishAnimVideo(); } catch (e) { res = { error: e.message }; }
  }

  await cleanupAnimExport();
  if (res?.path) { log(`動畫匯出完成: ${res.path}`); showToast(t('msg.animSaved')); }
  else if (animAbort) log('動畫匯出已取消');
  else showErr(t('msg.animFail', { err: res?.error || t('msg.unknown') }));
}

function stopAnimExport(abort = false) {
  animAbort = true;
  if (abort) log('動畫匯出取消中…');
}

async function cleanupAnimExport() {
  animActive = false;
  exporting = false;
  lipActive = false;
  exportBalloonActive = false;
  hideRecBadge();
  document.body.classList.remove('recording');
  try { app.ticker.start(); } catch {}
  if (spine) {
    spine.autoUpdate = animPrevAutoUpdate;
    restTracks();              // 清掉匯出用的 track1/track2 殘留
    memoryLobbySkip();         // 回到 Idle 循環
  }
  await restoreRendererState();
  scheduleAutonomy();
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
    console.warn('[anim] 復原 renderer 失敗', e);
  }
  recRestore = null;
}

// ---- 匯出 BGM（原檔複製，不做混音）----
async function exportBgm() {
  const file = bgmForLobby(currentLobby);
  if (!file) { showErr(t('msg.noBgm')); return; }
  try {
    const res = await window.ba.exportBgm({ filename: file, defaultName: file });
    if (res?.canceled) log('BGM 匯出已取消');
    else if (res?.path) { log(`BGM 匯出完成: ${res.path}`); showToast(t('msg.bgmSaved')); }
    else showErr(t('msg.bgmFail', { err: res?.error || t('msg.noResult') }));
  } catch (e) {
    showErr(t('msg.bgmFail', { err: e.message }));
  }
}

function updateClipUI() {
  const k = exportClipType();
  const isTalk = k === 'talk';
  const talks = spine ? animNames().filter(n => n.startsWith('Talk_') && n.endsWith('_M')).sort() : [];
  expTalkRow.style.display = isTalk ? '' : 'none';
  const canVoice = k !== 'idle';
  expDialogCk.classList.toggle('dis', !canVoice);
  if (!canVoice) expDialog.checked = false;
  for (const b of document.querySelectorAll('#expClip button')) {
    const bb = b.dataset.k;
    const dis = (bb === 'start' && !resolveStartClip()) || (bb === 'talk' && talks.length === 0);
    b.classList.toggle('dis', dis);
    if (dis && b.classList.contains('on')) {
      b.classList.remove('on');
      document.querySelector('#expClip button[data-k="idle"]').classList.add('on');
    }
  }
}
function updateResUI() {
  const m = segVal('expRes') || 'win';
  expCustomRow.style.display = m === 'custom' ? '' : 'none';
}

// ---- asset loading ----
const IS_ELECTRON = typeof window !== 'undefined' && !!window.ba?.__electron;
// Electron prod 用 file: 載入 + app:// 協議服務資產；dev（vite http）與網頁版都用相對路徑
const IS_ELECTRON_PROD = IS_ELECTRON && location.protocol === 'file:';
// 網頁版（GitHub Pages）：無 Electron preload，由 ba-web.js 提供 window.ba
const WEB_MODE = typeof window !== 'undefined' && !IS_ELECTRON && !!window.ba;
function assetUrl(p) {
  return IS_ELECTRON_PROD ? 'app://' + p : p;
}

async function fetchRetry(url, retries = 4) {
  const fullUrl = url.startsWith('assets/') ? assetUrl(url) : url;
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(fullUrl);
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

// ---- lobby grouping (same character -> one sidebar group) ----
// lobby_index.json keys come from resource-bundle names, so one character can
// appear several times: official costume variants (_swimsuit/_newyear/_ridingsuit/
// _casual), the Abydos "multi" lobbies (Lobby*_multi / UILobbySpecial2), _Teen
// packs, and plain resource copies (Airi0_home, *_home_GL) that duplicate the
// main lobby and should be hidden from the picker.
function lobbyGroupInfo(key) {
  const low = key.toLowerCase();
  let rest = low;
  let isDup = false;
  const labels = [];
  // Outer suffixes (strip repeatedly so e.g. Izumi_swimsuit_home_Teen resolves).
  while (true) {
    let changed = false;
    if (rest.endsWith('_home_gl')) { rest = rest.slice(0, -'_home_gl'.length); isDup = true; changed = true; }
    else if (rest.endsWith('_home')) { rest = rest.slice(0, -'_home'.length); changed = true; }
    else if (rest.endsWith('_gl')) { rest = rest.slice(0, -'_gl'.length); isDup = true; changed = true; }
    else if (rest.endsWith('_multi')) { rest = rest.slice(0, -'_multi'.length); labels.push(t('variant.multi')); changed = true; }
    else if (rest.endsWith('_teen')) { rest = rest.slice(0, -'_teen'.length); labels.push(t('variant.teen')); changed = true; }
    if (!changed) break;
  }
  if (rest.startsWith('lobby')) rest = rest.slice(5);
  // Inner costume suffixes (sit between the name and "_home").
  for (const [suf, key] of [['_swimsuit', 'variant.swimsuit'], ['_newyear', 'variant.newyear'], ['_ridingsuit', 'variant.ridingsuit'], ['_casual', 'variant.casual']]) {
    if (rest.endsWith(suf)) { rest = rest.slice(0, -suf.length); labels.push(t(key)); }
  }
  labels.reverse();
  // Airi0_home duplicates Airi_home -> treat the trailing 0 as a duplicate copy.
  if (rest.endsWith('0') && LOBBY_INDEX) {
    const target = rest.slice(0, -1) + '_home';
    if (Object.keys(LOBBY_INDEX).some(k => k.toLowerCase() === target)) {
      rest = rest.slice(0, -1);
      isDup = true;
    }
  }
  return { core: rest, labels, isDup };
}

// ---- student display names (students_data.csv, keyed by file_id) ----
// The same mode also selects the UI language via I18N_UI (see t()/applyI18n).
const LANG_MODES = [
  ['tw', '繁', 'name_tw'],
  ['jp', '日', 'name_jp'],
  ['cn', '簡', 'name_cn'],
  ['en', 'EN', 'name_en'],
  ['kr', '한', 'name_kr'],
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
    const info = lobbyGroupInfo(key);
    if (info.isDup) continue;                 // resource copies (Airi0_home, *_home_GL)
    if (!groups.has(info.core)) groups.set(info.core, { core: info.core, display: null, rec: null, children: [] });
    groups.get(info.core).children.push({ key, info });
  }
  for (const g of groups.values()) {
    // main variant first, then the rest in index order
    g.children.sort((a, b) => {
      const am = a.info.labels.length === 0 ? 0 : 1;
      const bm = b.info.labels.length === 0 ? 0 : 1;
      if (am !== bm) return am - bm;
      return ORDER.indexOf(a.key) - ORDER.indexOf(b.key);
    });
    // group display name comes from the main variant (if any), else the first child
    const mainChild = g.children.find(c => c.info.labels.length === 0) || g.children[0];
    const rec = studentForLobby(mainChild.key);
    g.rec = rec;
    g.display = studentDisplay(rec) || prettyName(mainChild.key);
  }
  return [...groups.values()].sort((a, b) => a.display.localeCompare(b.display, 'zh-Hant'));
}

function variantText(g, c) {
  if (c.info.labels.length === 0) return g.display;
  return c.info.labels.join(' ');
}

function groupMatches(g, q) {
  if (!q) return true;
  if (g.display.toLowerCase().includes(q)) return true;
  if (g.rec && SIDEBAR_FIELDS.some(f => g.rec[f] && g.rec[f].toLowerCase().includes(q))) return true;
  return g.children.some(c => c.key.toLowerCase().includes(q) || variantText(g, c).toLowerCase().includes(q));
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
      : g.children.filter(c => c.key.toLowerCase().includes(q) || variantText(g, c).toLowerCase().includes(q));
    if (!kids.length) continue;
    shown += kids.length;
    for (const c of kids) {
      const b = document.createElement('button');
      b.className = 'sb-item';
      b.dataset.key = c.key;
      const ico = STUDENT_ICONS[c.info.core];
      if (ico) {
        const img = document.createElement('img');
        img.className = 'sb-ico';
        img.src = assetUrl(`assets/students/${ico}`);
        img.alt = '';
        b.appendChild(img);
      }
      b.appendChild(document.createTextNode(variantText(g, c)));
      if (c.key === currentLobby) b.classList.add('cur');
      sbList.appendChild(b);
    }
  }
  if (!shown) {
    const e = document.createElement('div');
    e.className = 'sb-empty';
    e.textContent = t('sidebar.noMatch');
    sbList.appendChild(e);
  }
}

function toggleSidebar(force) {
  const open = typeof force === 'boolean' ? force : !sidePanel.classList.contains('open');
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
  const s = entry?.scene;
  const b = entry?.bg;
  // 允許只有 bg（背景）而無 scene（特寫）的角色（如 Yuzu：僅有 Yuzu_BG，無 Yuzu_Scene）
  if (!s && !b) return;
  // 如果主骨架已合併場景（has Start_Idle_03），不需要載入獨立 scene/bg
  const animNames = spine?.state?.data?.skeletonData?.animations?.map(a => a.name) || [];
  if (animNames.includes('Start_Idle_03')) return;
  try {
    const loadOne = async (res) => {
      if (!res || !res.skel || !res.atlas) return null;
      const base = `assets/scene/${currentLobby}/`;
      const skel = assetUrl(base + res.skel), atlas = assetUrl(base + res.atlas);
      await Assets.load(skel);
      await Assets.load(atlas);
      const obj = Spine.from({ skeleton: skel, atlas });
      for (const slot of obj.skeleton.slots) {
        if (isTopLightSlot(slot.data.name)) slot.data.blendMode = 3;
      }
      // 不在此自動播放——由 startBgSequence 依 BA 時間軸統一驅動（避免搶在
      // intro 之前就跑 idle 迴圈，導致 startBgSequence 的冪等判斷誤判而跳過開場）。
      return obj;
    };
    scene = await loadOne(s);
    bg = await loadOne(b);
    // 圖層：bg 插到最底，scene 置頂（特寫前景）；spine 由 loadLobby 排在 bg 之上、scene 之下。
    if (bg) app.stage.addChildAt(bg, 0);
    if (scene) app.stage.addChild(scene);
    if (scene || bg) log(`場景: ${currentLobby}`);
  } catch (e) {
    console.warn('[lobby] 場景載入失敗，略過', e);
    if (scene) { destroyTextures(collectTextures(scene)); scene.destroy(); scene = null; }
    if (bg) { destroyTextures(collectTextures(bg)); bg.destroy(); bg = null; }
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
  const push = (rel, base) => { if (rel) urls.push(assetUrl(base + rel.replace(/^\.\//, ''))); };
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
  if (entry.bg) {
    const bgBase = `assets/scene/${lobbyName}/`;
    push(entry.bg.skel, bgBase);
    push(entry.bg.atlas, bgBase);
    for (const p of entry.bg.png || []) push(p, bgBase);
  }
  for (const u of urls) { try { Assets.unload(u); } catch {} }
  // 清除 Spine.from 的全域 skeletonData cache：Assets.unload 會銷毀 atlas texture，
  // 但 Spine.from 的 Cache（key = `${skeleton}-${atlas}-${scale}`）仍保留舊 skeletonData，
  // 下次載入同一角色會復用已銷毀 texture 的 attachment，導致 render 每幀拋錯。
  const spineCacheKeys = [];
  const charSkel = assetUrl(`assets/spine/${lobbyName}/${entry.skel}`);
  const charAtlas = assetUrl(`assets/spine/${lobbyName}/${entry.atlas}`);
  if (entry.skel && entry.atlas) spineCacheKeys.push(`${charSkel}-${charAtlas}-1`);
  if (entry.scene && entry.scene.skel && entry.scene.atlas) {
    const sceneSkel = assetUrl(`assets/scene/${lobbyName}/${entry.scene.skel}`);
    const sceneAtlas = assetUrl(`assets/scene/${lobbyName}/${entry.scene.atlas}`);
    spineCacheKeys.push(`${sceneSkel}-${sceneAtlas}-1`);
  }
  if (entry.bg && entry.bg.skel && entry.bg.atlas) {
    const bgSkel = assetUrl(`assets/scene/${lobbyName}/${entry.bg.skel}`);
    const bgAtlas = assetUrl(`assets/scene/${lobbyName}/${entry.bg.atlas}`);
    spineCacheKeys.push(`${bgSkel}-${bgAtlas}-1`);
  }
  for (const k of spineCacheKeys) { try { if (Cache.has(k)) Cache.remove(k); } catch {} }
}

async function loadLobby(name) {
  if (exporting) return;
  clearTimeout(sceneStabTimer);
  const oldLobby = currentLobby;
  let oldTextures = new Set();
  if (spine) {
    oldTextures = collectTextures(spine);
    spine.state.clearListeners?.();
    spine.destroy();
    spine = null;
  }
  // Tear down the old scene BEFORE unloading its assets: Assets.unload destroys
  // the atlas Textures, and rendering a still-mounted scene whose textures were
  // just destroyed throws inside pixi's texture system on every frame (which in
  // turn kills the app ticker and the white-flash clock).
  if (scene) {
    for (const t of collectTextures(scene)) oldTextures.add(t);
    scene.destroy();
    scene = null;
  }
  if (bg) {
    for (const t of collectTextures(bg)) oldTextures.add(t);
    bg.destroy();
    bg = null;
  }
  unloadLobbyAssets(oldLobby);
  destroyTextures(oldTextures);
  clearTimers();
  resetWhiteFlash();
  state.busy = null;
  state.blockInteractionOnPlay = false;
  state.blockList = [];
  state.introBlock = false;
  introVirtual = false;
  introWindowEnd = 0;
  patting = false;
  headAnchorBone = null;

  const entry = LOBBY_INDEX[name];
  if (!entry) { showErr(t('msg.notInIndex', { name })); return; }
  // web 模式：等 Service Worker 接管頁面。首次訪問/硬重載後 SW 在 installing，
  // 未接管的頁面 fetch 不經 SW → Cache Storage 裡剛下載的 spine/voice 全部 404。
  if (WEB_MODE && navigator.serviceWorker) {
    try {
      await Promise.race([
        (async () => {
          if (navigator.serviceWorker.controller) return;
          await navigator.serviceWorker.ready;
          await new Promise((r) => {
            const chk = () => (navigator.serviceWorker.controller ? r() : setTimeout(chk, 100));
            chk();
          });
        })(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('sw ready timeout')), 3000)),
      ]);
    } catch (e) {
      console.warn('[lobby] SW 未及時接管', e.message);
    }
    // 強制重新載入（Ctrl+Shift+R）會讓「本次導航」完全繞過 SW：controller 恒 null，
    // Cache Storage 的 spine/voice 全部讀不到 → 打網路 404。
    // 對策：此頁面注定拿不到快取 → 存旗標自動一般重載一次（reload 後 SW 接管即恢復；
    // sessionStorage 防止無限循環——使用者若連按硬重載，最多自動重載一次）。
    if (!navigator.serviceWorker.controller && !sessionStorage.getItem('ba_forceReloaded')) {
      try {
        sessionStorage.setItem('ba_forceReloaded', '1');
        location.reload();
        return;   // 不 return 之後的程式碼會在 reload 前繼續跑
      } catch {}
    }
  }
  // 串流模式：確保該 lobby 的資源已在本地（隨播隨下）
  if (!_assetInfo && window.ba?.checkAssets) {
    // 首訪/硬重載後 checkAssets 可能尚未完成；deep-link 直接進大廳時在此補跑一次
    try { _assetInfo = await window.ba.checkAssets(); } catch {}
  }
  if (_assetInfo?.lobbies?.[name]) {
    try { await ensureLobbyAssets(name); retryBgmIfSilent(); } catch (e) { console.warn('[lobby] 串流下載失敗', e.message); }
  }
  loadIdleClip(entry);
  loadingEl.classList.add('show');
  loadingText.textContent = t('loading.load', { name: prettyName(name) });
  try {
    const charAssets = entry.skel && entry.atlas
      ? [assetUrl(`assets/spine/${name}/${entry.skel}`), assetUrl(`assets/spine/${name}/${entry.atlas}`)]
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
    spine.state.data.defaultMix = 0.2;
    setupLipHook(spine);
    setupEyes();
    setupInteraction();
    app.stage.addChild(spine);
    currentLobby = name;
  } catch (e) {
    showErr(t('msg.loadFail', { name, err: e.message }));
    loadingEl.classList.remove('show');
    return;
  }

  await loadScene(entry);
  // Akari 為三獨立 spine（spine=本體 / bg=背景 / scene=特寫）：本體無 Start_Idle_03，
  // 故 sceneIndependent=true，由 fitScene/applyCamera 對獨立 scene 物件個別定位。
  const animNames2 = spine?.state?.data?.skeletonData?.animations?.map(a => a.name) || [];
  sceneIndependent = animNames2.includes('Start_Idle_03')
    ? false
    : !!(entry.bg) || !!(entry.scene && entry.scene.skel && entry.scene.skel !== entry.skel);
  // 圖層順序：bg 最底 → spine（本體）中 → scene（特寫）最頂（前景）。其餘 UI/對話在互動時
  // 才 addChild，自然位於最上層。
  if (bg && scene) {
    app.stage.setChildIndex(bg, 0);
    app.stage.setChildIndex(spine, 1);
    app.stage.setChildIndex(scene, app.stage.children.length - 1);
  } else if (scene) {
    app.stage.setChildIndex(scene, app.stage.children.length - 1);
    app.stage.setChildIndex(spine, app.stage.children.length - 2 >= 0 ? app.stage.children.length - 2 : 0);
  } else {
    app.stage.setChildIndex(spine, Math.max(0, app.stage.children.length - 1));
  }
  fitted = false;
  // frame on the Idle pose (mesh geometry only exists after a render), then play the intro
  idleClip = resolveIdleClip();
  spine.state.setAnimation(0, idleClip, true);
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
  setBgm(bgmForLobby(name));
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
  const order = ORDER.filter(k => !lobbyGroupInfo(k).isDup);   // skip resource copies
  if (!order.length) return;
  const i = Math.max(0, order.indexOf(currentLobby));
  const next = order[(i + dir + order.length) % order.length];
  if (next === currentLobby) return;
  fadeIn().then(() => loadLobby(next));
}

// spine track completion -> return reactive tracks to rest
function onTrackComplete(entry) {
  // Intro (Start_Idle_01) finished on track 0 -> release the interaction lock so
  // the player can tap/pat; track 0 now loops the idle clip.
  // 背景序列（track 3）自 t=0 獨立運行，與 track 0 完成與否無關——
  // 不在此重啟，否則輸送帶會跳回起點（見 startBgSequence 冪等註解）。
  if (entry.trackIndex === 0 && state.introBlock) {
    state.introBlock = false;
  }
  if (entry.trackIndex === 1 && !state.busy) {
    if (state.busy === 'talk') return; // handled by timer
    restTracks();
  }
}

// Background + closeup sequence. Akari_home 為三個獨立物件：spine=角色本體、
// bg=背景骨架、scene=開場壽司特寫。時間軸還原自各 lobby 的 SpineClip 資產
// （spinelobbies-<char>_home dependency-assets，非猜測）：
//   - scene(特寫): Start_Idle_01 @0s，播完本體進場（白閃）時移除
//   - bg(背景)   : track0 = main idle（IsTrackMainIdle=1）立即循環；
//                  若有 BaseRandom clip（Akari_bg: Start_Idle_01 IntroDelay=3.0 → Next=Idle_01）
//                  則以「Start_X 延遲 → X 迴圈」取代 track0 播法。
//   - spine(本體): 由 playStart 驅動（HoshinoTimeline/Akari_Timeline 的 Spine Animation State Track）
// 星野（Hoshino_home_background）特殊：Idle_01 是 main idle（水族館常駐循環），
// 鯨魚序列在 track1 疊加——Start_WhaleMove_01_R 於 RandomTiming delay 3~4s 後播一次，
// FinishType=PlayNext 接 WhaleMove_01_R（loop）。此為遊戲 Hoshino_home_background
// SpineClip 的 PlayMode/Track/IntroDelay 實際欄位值。
function startBgSequence({ skip = false } = {}) {
  // ---- BG（獨立 spine 物件）----
  if (bg && bg.state) {
    const bgAnims = bg.state.data.skeletonData.animations.map(a => a.name);
    const has = n => bgAnims.includes(n);
    const bgLoopMain = has('Idle_01') ? 'Idle_01' : bgAnims[0];
    // 星野鯨魚序列（track1 疊加）：僅當骨架同時具備三者才走此路徑
    const whaleIntro = has('Start_WhaleMove_01_R') && has('WhaleMove_01_R') && has('Idle_01');
    if (!skip) {
      // 冪等：已在目標狀態就別重啟——setAnimation 會從 t=0 重播造成頓挫。
      const cur = bg.state.getCurrent(whaleIntro ? 1 : 0);
      if (cur && cur.animation &&
          cur.animation.name === (whaleIntro ? 'Start_WhaleMove_01_R' : bgLoopMain) &&
          (whaleIntro || cur.loop)) return;
      if (whaleIntro) {
        // track0：水族館常駐 idle 立即循環（遊戲 IsTrackMainIdle 行為）
        bg.state.setAnimation(0, 'Idle_01', true);
        // track1：鯨魚進場事件——RandomTimingIntroDelayMode=Random(1), 3~4s
        const delay = 3 + Math.random();
        const wEntry = bg.state.setAnimation(1, 'Start_WhaleMove_01_R', false);
        wEntry.delay = delay;
        // FinishType=PlayNext(3)：接 WhaleMove_01_R loop
        bg.state.addAnimation(1, 'WhaleMove_01_R', true, 0);
        log(`bg: Idle_01@0 + 鯨魚序列 track1 (+${delay.toFixed(2)}s)`);
      } else {
        // 一般 lobby：Start_X 延遲 introBodyStart() 後播一次 → X 迴圈
        const bgIntro = bgAnims.find(n => n.startsWith('Start_') && bgAnims.includes(n.slice(6)));
        const bgLoop = bgIntro ? bgIntro.slice(6) : bgLoopMain;
        if (bgIntro) {
          const bgEntry = bg.state.setAnimation(0, bgIntro, false);
          bgEntry.delay = introBodyStart();
          bg.state.addAnimation(0, bgLoop, true, 0);
        } else {
          bg.state.setAnimation(0, bgLoop, true);
        }
      }
    } else {
      // skip（略過開場）：直接進入穩定態。鯨魚序列維持完整（遊戲 skip 只跳 timeline，
      // bg 的 BaseRandom 事件照常排程），但為了畫面即時穩定，直接把鯨魚放到 loop。
      if (whaleIntro) {
        bg.state.setAnimation(0, 'Idle_01', true);
        bg.state.setAnimation(1, 'WhaleMove_01_R', true);
      } else {
        const bgIntro = bgAnims.find(n => n.startsWith('Start_') && bgAnims.includes(n.slice(6)));
        bg.state.setAnimation(0, bgIntro ? bgIntro.slice(6) : bgLoopMain, true);
      }
    }
  }
  // ---- SCENE（開場壽司特寫，獨立 spine 物件）----
  if (scene && scene.state) {
    if (!skip) {
      // 特寫從 0s 起播一次（BA 時間軸 m_Start=0）；播至本體進場（白閃）時由
      // removeSceneCloseup 整個移除（見 tickWhiteFlash）。動畫名由 scene 骨架
      // 實際內容解析（防大小寫變體，同 resolveStartClip 的處理）。
      const sa = scene.state.data.skeletonData.animations.map(a => a.name);
      const sIntro = sa.find(n => /^start_idle/i.test(n)) || sa.find(n => /^start/i.test(n));
      if (sIntro) { scene.state.setAnimation(0, sIntro, false); armSceneCloseup(); }
    } else {
      removeSceneCloseup();
    }
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
  if (bgmOn && !bgmAudio) setBgm(bgmForLobby(currentLobby));
  if (e.pointerType === 'touch') e.preventDefault();
  downTime = performance.now();
  downPos = { x: e.clientX, y: e.clientY };
  longPressTimer = setTimeout(() => {
    if (downPos && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) < 10) {
      // Hold gesture: on the head region → Pat (or the special Pinch/Touch when
      // the lobby owns it), anywhere else → Look (or HandFollow when owned).
      if (interactionMode === 'pinch') startPinch();
      else if (isHeadRegion(e.clientX, e.clientY)) {
        if (interactionMode === 'touch') startTouch();
        else startPat();
      } else if (interactionMode === 'handfollow') startHandFollow();
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
      // Special gestures first: HandFollow owns any drag, Pinch owns the face drag.
      if (interactionMode === 'handfollow' && has('HandFollow_01_M')) startHandFollow();
      else if (isHeadRegion(downPos.x, downPos.y)) {
        if (interactionMode === 'pinch') startPinch();
        else startPat();
      } else startLook();
    }
  }
  hud.classList.toggle('idle', performance.now() - userActiveAt > 2600);
}

function onPointerUp(e) {
  clearTimeout(longPressTimer);
  if (downPos) {
    const dt = performance.now() - downTime;
    const d = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    // Quick tap (short, still) → Talk (one-shot _M + _A + voice); for Touch
    // lobbies a face-region tap is the poke reaction instead. A tap while a hold
    // is active is ignored — the hold branches below handle the release.
    if (dt < 340 && d < 10 && !state.introBlock && state.busy !== 'look' &&
        state.busy !== 'pat' && state.busy !== 'pinch' && state.busy !== 'handfollow' && state.busy !== 'touch') {
      if (interactionMode === 'touch' && isHeadRegion(e.clientX, e.clientY)) startTouch();
      else playTalk();
    }
  }
  if (pinchActive) endPinch();
  else if (handFollowActive) endHandFollow();
  else if (state.busy === 'touch') endTouch();
  else if (state.busy === 'look') endLook();
  else if (patting) endPat();
  downPos = null;
  downTime = 0;
}

// ---- Tap To Start：asset check 完成後顯示，點擊進入 lobby ----
// loadingScreen 的影片背景持續播放；此處只把 spinner 換成 TAP TO START，
// 並接手 pv-a.ogg 音軌（音軌在 init() 一啟動就提前起播，不被更新檢查擋住）。

// 提前起播的 intro 音軌（pv-a.ogg）；showTapToStart 重用同一元素
let _introAudio = null;
function startIntroAudioEarly() {
  // fire-and-forget：任何失敗都靜默（web 首訪 intro 包未裝 → introMedia 為 null）
  try {
    Promise.resolve(window.ba?.introMedia?.()).then((media) => {
      if (!media?.audio || _introAudio) return;
      const a = new Audio(media.audio);
      a.play().catch(() => {});
      _introAudio = a;
    }).catch(() => {});
  } catch {}
}

function showTapToStart() {
  return new Promise(async (resolve) => {
    const ls = document.getElementById('loadingScreen');
    const indicator = document.getElementById('loadingIndicator');
    const tts = document.getElementById('tapToStart');
    if (!ls || ls.classList.contains('hidden')) { resolve(); return; }
    // dev：URL 帶 autostart=1 時跳過等待（自動化測試 / hash 直連 lobby）
    if (/autostart=1/.test(location.search + location.hash)) { fadeOutLoadingScreen(); resolve(); return; }
    let finished = false;
    let guard = null;
    // 音軌已由 startIntroAudioEarly() 提前起播；此處只在尚未起播時補播
    try {
      if (!_introAudio) {
        const media = window.ba && window.ba.introMedia ? await window.ba.introMedia() : null;
        if (media && media.audio) {
          _introAudio = new Audio(media.audio);
          _introAudio.play().catch(() => {});
        }
      }
    } catch {}
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(guard);
      document.removeEventListener('keydown', onKey);
      if (_introAudio) { _introAudio.pause(); _introAudio = null; }
      fadeOutLoadingScreen();
      resolve();
    };
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish(); }
    };
    if (indicator) indicator.style.display = 'none';
    if (tts) tts.style.display = 'block';
    document.addEventListener('pointerdown', finish, { once: true });
    document.addEventListener('keydown', onKey);
    // 60 秒保險：無論如何都放行，避免卡在標題畫面
    guard = setTimeout(finish, 60000);
  });
}

// ---- init ----
function fadeOutLoadingScreen() {
  const ls = document.getElementById('loadingScreen');
  if (!ls || ls.classList.contains('hidden')) return;
  const lv = document.getElementById('loadingVideo');
  if (lv) { try { lv.pause(); } catch {} }
  ls.classList.add('fade-out');
  setTimeout(() => ls.classList.add('hidden'), 900);
}

let _assetInfo = null; // 全域快取（供串流模式隨播隨下）

async function ensureLobbyAssets(lobbyName) {
  if (!window.ba?.ensureLobby || !_assetInfo?.packages || !_assetInfo?.lobbies) return;
  const need = _assetInfo.lobbies[lobbyName];
  if (!need) return;
  // 快速檢查：若本地已齊，ensureLobby 會立刻返回 cached
  const loading = document.getElementById('loading');
  const loadingText = document.getElementById('loadingText');
  let shown = false;
  const showLoading = (msg) => {
    if (!shown) { loading.classList.add('show'); shown = true; }
    if (loadingText) loadingText.textContent = msg;
  };
  window.ba.onDownloadProgress?.((p) => {
    showLoading(t('dl.lobbyDl', { pkg: p.package, i: p.index + 1, n: p.total, pct: p.percent || 0 }));
  });
  try {
    const res = await window.ba.ensureLobby({
      lobby: lobbyName,
      version: _assetInfo.remoteVersion,
      packages: _assetInfo.packages,
      lobbies: _assetInfo.lobbies,
    });
    if (res && !res.cached && res.results) {
      const failed = res.results.filter(r => !r.ok);
      if (failed.length) console.warn('[lobby] 部分資源下載失敗', failed);
    }
  } catch (e) {
    console.warn('[lobby] ensureLobby 失敗:', e.message);
  } finally {
    if (shown) { loading.classList.remove('show'); if (loadingText) loadingText.textContent = t('loading.loading'); }
  }
}

// 串流模式啟動：自動下載必要包（core+intro），進度寫進 loading 文字。
// 回傳 true=全部成功（可進 lobby）；false=有失敗（呼叫端應彈下載面板）。
async function autoStreamBootstrap(assetInfo) {
  const loadingText2 = document.getElementById('loadingText');
  const packs = (assetInfo.needsDownloadPacks || []).filter(k => assetInfo.packages?.[k]);
  if (!packs.length) return true;
  const done = await new Promise((resolve) => {
    window.ba.onDownloadProgress?.((p) => {
      if (p.status === 'downloading' && loadingText2) {
        loadingText2.textContent = t('dl.downloading', { pkg: p.package, i: p.index + 1, n: p.total });
      }
    });
    window.ba.downloadAssets({
      version: assetInfo.remoteVersion,
      packages: assetInfo.packages,
      onlyPacks: packs,
    }).then(resolve).catch(() => resolve(null));
  });
  return Array.isArray(done) && done.every(r => r.ok);
}

async function showAssetDownload(assetInfo) {
  const downloadPanel = document.getElementById('downloadPanel');
  const status = document.getElementById('assetStatus');
  const progress = document.getElementById('assetProgress');
  const fill = document.getElementById('assetProgressFill');
  const pctText = document.getElementById('assetProgressText');
  const detail = document.getElementById('assetDetail');
  const btn = document.getElementById('assetBtn');
  const streamingRow = document.getElementById('streamingRow');
  const streamingCk = document.getElementById('streamingCk');

  downloadPanel.style.display = 'block';
  progress.style.display = 'none';
  btn.style.display = 'none';
  if (streamingRow) streamingRow.style.display = 'flex';

  // 串流模式勾選框（僅打包模式有效，dev 模式提示）
  let isStreaming = false;
  try { isStreaming = await window.ba?.getStreamingMode?.(); } catch {}
  if (streamingCk) {
    streamingCk.checked = !!isStreaming;
    streamingCk.onchange = async () => {
      try { await window.ba?.setStreamingMode?.(streamingCk.checked); } catch {}
      // 切換後重算顯示
      isStreaming = streamingCk.checked;
      updateDetail();
    };
  }

  const isIncremental = assetInfo.schema === 2 && assetInfo.needsDownloadPacks;
  const packsToShow = isIncremental
    ? assetInfo.needsDownloadPacks.map(k => assetInfo.packages[k]).filter(Boolean)
    : (assetInfo.packages ? Object.values(assetInfo.packages) : []);
  const namesToShow = isIncremental ? assetInfo.needsDownloadPacks : (assetInfo.packages ? Object.keys(assetInfo.packages) : []);

  const totalBytes = packsToShow.reduce((s, p) => s + (p.size || 0), 0);
  const totalGB = (totalBytes / 1073741824).toFixed(1);

  const updateDetail = () => {
    if (isIncremental) {
      if (namesToShow.length === 0) {
        status.textContent = t('dl.upToDate');
        detail.textContent = t('dl.allLatest', { n: Object.keys(assetInfo.packages).length });
        if (streamingCk?.checked) detail.textContent += t('dl.streamUpd');
      } else {
        const modeNote = isStreaming ? t('dl.streamCore') : '';
        detail.textContent = t('dl.pending', { n: namesToShow.length, gb: totalGB, note: modeNote })
          + namesToShow.slice(0, 8).join('、') + (namesToShow.length > 8 ? '…' : '');
      }
    } else {
      detail.textContent = namesToShow.length ? namesToShow.join('、') : '';
    }
  };

  if (assetInfo.hasAssets && assetInfo.remoteVersion) {
    status.textContent = t('dl.versionFound', { remote: assetInfo.remoteVersion, local: assetInfo.localVersion || t('dl.localNone') });
    updateDetail();
  } else if (!assetInfo.hasAssets) {
    status.textContent = t('dl.firstRun');
    updateDetail();
    if (streamingCk) detail.textContent += t('dl.firstRunHint');
  } else {
    status.textContent = t('dl.upToDate');
    btn.style.display = 'none';
    await new Promise(r => setTimeout(r, 1200));
    downloadPanel.style.display = 'none';
    return;
  }

  btn.textContent = assetInfo.hasAssets ? t('dl.update') : t('dl.start');
  btn.style.display = 'inline-block';

  return new Promise((resolve) => {
    btn.onclick = async () => {
      btn.style.display = 'none';
      if (streamingRow) streamingRow.style.display = 'none';
      progress.style.display = 'block';
      fill.style.width = '0%';
      pctText.textContent = '0%';
      if (streamingCk) {
        try { await window.ba?.setStreamingMode?.(streamingCk.checked); } catch {}
      }

      window.ba.onDownloadProgress?.((p) => {
        if (p.status === 'downloading') {
          status.textContent = t('dl.downloading', { pkg: p.package, i: p.index + 1, n: p.total });
          fill.style.width = p.percent + '%';
          pctText.textContent = p.percent + '%';
          if (p.bytesTotal) detail.textContent = `${(p.downloaded / 1048576).toFixed(0)} MB / ${(p.bytesTotal / 1048576).toFixed(0)} MB`;
        } else if (p.status === 'extracting') {
          status.textContent = t('dl.extracting', { pkg: p.package });
          detail.textContent = '';
        } else if (p.status === 'done') {
          status.textContent = t('dl.packDone', { pkg: p.package });
        } else if (p.status === 'error') {
          detail.textContent = `⚠ ${p.error}`;
        }
      });

      const version = assetInfo.remoteVersion || '1.0.0';
      const results = await window.ba.downloadAssets({ version, packages: assetInfo.packages });

      // 有包失敗（如 release 缺檔 404）：顯示錯誤並保留面板讓使用者重試，
      // 不關閉面板、不 resolve（避免半套資源被當成安裝完成）。
      if (Array.isArray(results) && results.some(r => !r.ok)) {
        const failed = results.filter(r => !r.ok);
        status.textContent = t('dl.failed');
        detail.textContent = t('dl.failedDetail', { n: failed.length, err: failed[0]?.error || '' });
        btn.textContent = t('dl.retry');
        btn.style.display = 'inline-block';
        progress.style.display = 'none';
        return;
      }

      status.textContent = t('dl.finished');
      fill.style.width = '100%';
      pctText.textContent = '100%';
      detail.textContent = '';
      btn.style.display = 'none';
      await new Promise(r => setTimeout(r, 800));
      downloadPanel.style.display = 'none';
      resolve();
    };
  });
}

async function init() {
  // ---- intro PV 音軌（pv-a.ogg）：一啟動就起播，不等更新檢查／下載 ----
  // （web 首訪 intro 包未裝時 introMedia 為 null → 靜默跳過；showTapToStart 會補播）
  startIntroAudioEarly();

  // ---- i18n: load UI dictionary first so the asset-check panel and every
  // later message renders in the user's language. Falls back to zh-TW source
  // strings when the dict is missing (dev without assets/data).
  await loadI18n();
  buildLangSegs();
  applyI18n();

  // ---- 標題畫面 BGM：檢查更新中就開始播（進 lobby 後被 setBgm 換成大廳曲）----
  if (bgmOn) setBgm('Theme_152_Title.ogg');

  // ---- Asset check: show download UI if assets missing ----
  // loadingScreen 保持顯示（spinner），檢查／下載完成後才換成 TAP TO START。
  if (window.ba?.checkAssets) {
    try {
      // 加 10 秒逾時，避免網路問題卡住整個 init
      const assetInfo = await Promise.race([
        window.ba.checkAssets(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('checkAssets timeout')), WEB_MODE ? 30000 : 10000)),
      ]);
      _assetInfo = assetInfo;
      // skipUpdate=1（headless 自動化）跳過下載，直接進入 lobby。
      if (assetInfo.needsDownload && !/(?:^|&)skipUpdate=1/.test(location.search + location.hash)) {
        // 串流模式（預設）：自動補齊必要包（core/intro），不出面板；全量安裝走設定面板。
        if (assetInfo.streaming && assetInfo.needsDownloadPacks?.length) {
          const ok = await autoStreamBootstrap(assetInfo);
          if (ok) {
            try { _assetInfo = await window.ba.checkAssets(); } catch {}
          } else {
            await showAssetDownload(assetInfo);
            try { _assetInfo = await window.ba.checkAssets(); } catch {}
          }
        } else if (!assetInfo.streaming) {
          // 完整安裝模式：維持舊面板流程
          await showAssetDownload(assetInfo);
          try { _assetInfo = await window.ba.checkAssets(); } catch {}
        }
      }
    } catch (e) {
      console.warn('[lobby] Asset check failed/skipped:', e.message);
    }
  }

  await app.init({ resizeTo: window, antialias: true, backgroundColor: 0x05060d, autoDensity: true });
  const canvas = app.canvas;
  document.getElementById('app').appendChild(canvas);

  // ---- BA Click FX（蔚藍檔案點擊特效；設定可關閉，切換後下次啟動生效）----
  try {
    if (settingsPref('ba_clickfx', true)) {
      initClickFx();
      console.log('[lobby] BAClickFX initialized');
    } else {
      console.log('[lobby] BAClickFX disabled by settings');
    }
  } catch (e) {
    console.warn('[lobby] BAClickFX init failed:', e.message);
  }

  try {
    const cr = await fetchRetry('assets/data/lobby_camera_config.json');
    const c = await cr.json();
    if (typeof c.MaxScale === 'number') CAMERA.maxScale = c.MaxScale;
    if (typeof c.Weight === 'number') CAMERA.weight = c.Weight;
  } catch (e) {
    console.warn('[lobby] 鏡頭設定載入失敗，使用預設', e);
  }

  // 純下載模式：lobby_index.json 在 data 包裡（assets/data/）。
  // 開發模式：在 assets/ 根目錄。先試 data/ 再 fallback 根目錄。
  let idx;
  try {
    idx = await fetchRetry('assets/data/lobby_index.json').then(r => r.json());
  } catch (e) {
    idx = await fetchRetry('assets/lobby_index.json').then(r => r.json());
  }
  LOBBY_INDEX = idx;
  ORDER = Object.keys(idx);
  try {
    LOBBY_TRANSFORMS = await fetchRetry('assets/data/lobby_transforms.json').then(r => r.json());
  } catch (e) {
    console.warn('[lobby] lobby_transforms 載入失敗，背景改用內容置中推測', e);
  }
  try {
    STUDENT_ICONS = await fetchRetry('assets/students/icon_index.json').then(r => r.json());
  } catch (e) {
    console.warn('[lobby] 學生頭像索引載入失敗，側欄不顯示縮圖', e);
  }
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
  try {
    TIMELINES = await fetchRetry('assets/data/lobby_timelines.json').then(r => r.json());
  } catch {
    TIMELINES = null;   // 缺檔 → 走 resolveStartClip fallback
  }
  try {
    FLASH_TABLE = normalizeFlashTable(await fetchRetry('assets/data/flash_curves.json').then(r => r.json()));
  } catch (e) {
    console.warn('[lobby] 白色閃爍曲線資料載入失敗，使用內建模板', e);
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

  // ---- Tap To Start：資料就緒後把 spinner 換成 TAP TO START，點擊才進 lobby ----
  await showTapToStart();

  // camera smoothing
  app.ticker.add(() => {
    if (spine && fitted) applyCamera(CAMERA.weight);
    tickWhiteFlash();
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
  // Skip button mirrors the game: UILobby.OnClickMemoryLobbySkip opens a
  // UIPopup_System confirm first; MemoryLobbySkip() runs only on OK.
  const skipConfirmEl = document.getElementById('skipConfirm');
  const openSkipConfirm = () => skipConfirmEl && skipConfirmEl.classList.add('show');
  const closeSkipConfirm = () => skipConfirmEl && skipConfirmEl.classList.remove('show');
  btnSkip.addEventListener('click', openSkipConfirm);
  document.getElementById('skipYes')?.addEventListener('click', () => { closeSkipConfirm(); memoryLobbySkip(); });
  document.getElementById('skipNo')?.addEventListener('click', closeSkipConfirm);
  skipConfirmEl?.addEventListener('click', (e) => { if (e.target === skipConfirmEl) closeSkipConfirm(); });
  // ---- focus mode (cinema) ---- btnLang repurposed as focus mode toggle
  const toggleFocusMode = (on) => {
    if (on === undefined) on = !document.body.classList.contains('focusMode');
    document.body.classList.toggle('focusMode', on);
    log('focus mode ' + (on ? 'on' : 'off'));
  };
  btnLang.addEventListener('click', () => toggleFocusMode());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('focusMode')) {
      toggleFocusMode(false);
      e.preventDefault();
    }
  });

  // ---- settings panel ----
  btnSettings.addEventListener('click', toggleSettingsPanel);
  setClose.addEventListener('click', toggleSettingsPanel);

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
  expStart.addEventListener('click', () => { closeExportPanel(); startAnimExport(); });
  expBgm.addEventListener('click', () => { closeExportPanel(); exportBgm(); });
  recStop.addEventListener('click', () => { if (animActive) stopAnimExport(true); });

  // ---- settings panel wiring ----
  if (setCursorCk) setCursorCk.addEventListener('change', () => {
    const on = setCursorCk.checked;
    try { localStorage.setItem('ba_cursor', on ? '1' : '0'); } catch {}
    document.documentElement.classList.toggle('ba-cursor-off', !on);
  });
  if (setClickFxCk) setClickFxCk.addEventListener('change', () => {
    try { localStorage.setItem('ba_clickfx', setClickFxCk.checked ? '1' : '0'); } catch {}
    showToast(t('set.restartHint'));
  });
  setModeSegs.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || b.classList.contains('on')) return;
    const streaming = b.dataset.m === 'streaming';
    try { await window.ba?.setStreamingMode?.(streaming); } catch {}
    await syncSettingsModeSegs();
  });
  setDownloadBtn.addEventListener('click', startSettingsDownload);

  for (const id of ['expClip', 'expRes', 'expFps', 'expFmt']) {
    const box = document.getElementById(id);
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.classList.contains('dis')) return;
      for (const sib of box.children) sib.classList.remove('on');
      b.classList.add('on');
      if (id === 'expClip') updateClipUI();
      if (id === 'expRes') updateResUI();
    });
  }
  expTalkSel.addEventListener('change', () => {});
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && exportPanel.classList.contains('open')) closeExportPanel();
  });
  // fullscreen toggle (button + F11 / F)
  const updateFullBtn = () => {
    const on = !!document.fullscreenElement;
    btnFull.textContent = on ? '⤡' : '⤢';
    btnFull.title = on ? t('hud.fullscreenExit') : t('hud.fullscreen');
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
    const m = location.hash.match(/[?#]lobby=([^&]+)/);
    const first = m && LOBBY_INDEX[m[1]] ? m[1] : ORDER[0];
    await loadLobby(first);
  } else {
    showErr(t('msg.emptyIndex'));
  }
}

// Headless self-test: with PROBE=1 the renderer dumps i18n state to the console
// (main relays [renderer] lines). Must run before CAPTURE_DELAY elapses.
if (/PROBE=1/.test(location.search + location.hash)) {
  // 可選：PROBE 加 cursorOff=1 預置 ba_cursor=0，驗證游標關閉 class
  if (/cursorOff=1/.test(location.search + location.hash)) {
    try { localStorage.setItem('ba_cursor', '0'); } catch {}
  }
  window.__probeRun = async () => {
    // 1) BGM：init 時就應該有 title BGM 在播
    const bgmEarly = !!bgmAudio && !bgmAudio.paused;
    // 2) 設定面板開 → 點 ✕ 關
    toggleSettingsPanel(true);
    await new Promise(r => setTimeout(r, 400));
    await syncSettingsModeSegs();
    document.getElementById('setClose')?.click();
    await new Promise(r => setTimeout(r, 300));
    const panelClosed = !settingsPanel.classList.contains('open');
    // 3) 效果開關存在 + 游標 class 初始狀態
    toggleSettingsPanel(true);
    await new Promise(r => setTimeout(r, 200));
    // 游標即時關閉驗證：取消勾選 → html class 應切換
    const cursorCk2 = document.getElementById('setCursorCk');
    cursorCk2.checked = false;
    cursorCk2.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 100));
    const probe = {
      cursorOffAfterToggle: document.documentElement.classList.contains('ba-cursor-off'),
      bgmEarly,
      panelClosed,
      cursorCk: document.getElementById('setCursorCk')?.checked,
      clickfxCk: document.getElementById('setClickFxCk')?.checked,
      // cursorOffClass moved('ba-cursor-off'),
      fxCanvas: !!document.querySelector('#fx canvas, .baclickfx, [id*="clickfx" i]'),
      uiLang,
      dictLoaded: !!i18nDict,
      btnLangLabel: document.getElementById('btnLang')?.textContent,
      loadingText: loadingText?.textContent,
      expTitle: document.querySelector('#exportPanel .panel-title')?.childNodes[0]?.textContent?.trim(),
      resWin: document.querySelector('[data-r="win"]')?.textContent,
      voiceCk: document.querySelector('label.ck span[data-i18n="exp.voice"]')?.textContent,
      searchPh: sbSearch.placeholder,
      prevTitle: btnPrev.title,
      langTitle: btnLang.title,
      settingsBtnTitle: document.getElementById('btnSettings')?.title,
      setLangSegs: document.getElementById('setLangSegs')?.children.length,
      setModeSegs: [...(document.getElementById('setModeSegs')?.children || [])].map(b => `${b.dataset.m}:${b.classList.contains('on') ? 1 : 0}`).join(','),
      setAssetsStatus: document.getElementById('setAssetsStatus')?.textContent?.slice(0, 80),
      panelVisible: getComputedStyle(settingsPanel).display !== 'none',
      panelClass: settingsPanel.className,
      hasOpen: settingsPanel.classList.contains('open'),
      panelRect: (() => { const r = settingsPanel.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.left)},${Math.round(r.top)}`; })(),
      langOn: [...setLangSegs.querySelectorAll('button')].map(b => `${b.dataset.lang}:${b.classList.contains('on') ? 1 : 0}`).join(','),
      charName: charNameEl.textContent,
      lobbyCount: ORDER.length,
    };
    console.log('[i18n-probe] ' + JSON.stringify(probe));
  };
}

init().then(() => window.__probeRun?.()).catch((e) => { console.error('[probe] init failed:', e); showErr(e); });
