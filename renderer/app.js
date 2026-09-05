import { Application, Assets, Texture, Sprite, MeshSimple, Container, BlurFilter, ColorMatrixFilter, Cache, UniformGroup, GlProgram, Filter } from 'pixi.js';
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
const btnSkip = document.getElementById('btnSkip');
const btnStudents = document.getElementById('btnStudents');
const sidePanel = document.getElementById('sidePanel');
const sbSearch = document.getElementById('sbSearch');
const sbList = document.getElementById('sbList');
const sbClose = document.getElementById('sbClose');
const btnCtlBgm = document.getElementById('btnCtlBgm');
const btnCtlFull = document.getElementById('btnCtlFull');
const btnCtlFocus = document.getElementById('btnCtlFocus');
const btnCtlExport = document.getElementById('btnCtlExport');
const btnCtlSettings = document.getElementById('btnCtlSettings');
const btnCtlVignette = document.getElementById('btnCtlVignette');
const ctlVoiceSegs = document.getElementById('ctlVoiceSegs');
const fxEl = document.getElementById('fx');
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
// ---- 角色介紹面板（ⓘ）----
const btnInfo = document.getElementById('btnInfo');
const infoPanel = document.getElementById('infoPanel');
const infoClose = document.getElementById('infoClose');
const infoIcon = document.getElementById('infoIcon');
const infoName = document.getElementById('infoName');
const infoSub = document.getElementById('infoSub');
const infoStatus = document.getElementById('infoStatus');
const infoMeta = document.getElementById('infoMeta');
const infoIntro = document.getElementById('infoIntro');
const infoLines = document.getElementById('infoLines');
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

// ---- i18n (UI language, bound to the settings/側欄語言 cycle) ----
// Dictionary: assets/ui/ui_i18n.json — flat "key": text per UI lang
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
  // language on first load / explicit override; 設定切語言後再同步。
  try {
    if (fromUrlLang() || !localStorage.getItem('ba_lang')) {
      localStorage.setItem('ba_lang', uiLang);
      langMode = uiLang;
    }
  } catch {}
  try {
    i18nDict = await fetchRetry('assets/ui/ui_i18n.json').then(r => r.json());
  } catch (e) {
    console.warn('[lobby] ui_i18n 載入失敗，UI 文字退回原始碼字串', e);
    i18nDict = null;
  }
}

// 本機備援字典：pack 的 ui_i18n.json（SW cache-first 優先）缺這些 key 時立即生效，
// 避免選單顯示成原始 key（skip.title / set.space.*…）。pack 未來補 key 仍優先。
const LOCAL_I18N = {
  'skip.title':   { 'zh-TW': '紀念大廳的開始動畫', 'zh-CN': '纪念大厅的开幕动画', 'ja': '記念ホールのオープニング', 'en': 'Memorial lobby opening', 'ko': '메모리얼 로비 오프닝' },
  'skip.confirm': { 'zh-TW': '是否跳過開場動畫？', 'zh-CN': '是否跳过开场动画？', 'ja': 'オープニングをスキップしますか？', 'en': 'Skip the opening?', 'ko': '오프닝을 건너뛸까요?' },
  'skip.cancel':  { 'zh-TW': '取消', 'zh-CN': '取消', 'ja': 'キャンセル', 'en': 'Cancel', 'ko': '취소' },
  'skip.ok':      { 'zh-TW': '確定', 'zh-CN': '确定', 'ja': 'OK', 'en': 'OK', 'ko': '확인' },
  'set.list':        { 'zh-TW': '角色列表', 'zh-CN': '角色列表', 'ja': 'キャラクターリスト', 'en': 'Student list', 'ko': '캐릭터 목록' },
  'set.jpOnly':      { 'zh-TW': '顯示日服限定角色', 'zh-CN': '显示日服限定角色', 'ja': '日服限定キャラを表示', 'en': 'Show JP-only students', 'ko': '일섭 한정 캐릭터 표시' },
  'set.jpOnlyDesc':  { 'zh-TW': '日服限定角色只有日文語音（沒有韓文語音）。', 'zh-CN': '日服限定角色只有日文语音（没有韩文语音）。', 'ja': '日服限定キャラは日本語ボイスのみです（韓国語ボイスなし）。', 'en': 'JP-only students have Japanese voice only (no Korean voice).', 'ko': '일섭 한정 캐릭터는 일본어 보이스만 있습니다 (한국어 보이스 없음).' },
  'sidebar.pinned':  { 'zh-TW': '已釘選', 'zh-CN': '已钉选', 'ja': 'ピン留め', 'en': 'Pinned', 'ko': '고정됨' },
  'sidebar.others':  { 'zh-TW': '其他', 'zh-CN': '其他', 'ja': 'その他', 'en': 'Others', 'ko': '기타' },
  'set.space.title':  { 'zh-TW': '管理空間', 'zh-CN': '管理空间', 'ja': '容量管理', 'en': 'Storage', 'ko': '저장 공간' },
  'set.space.open':   { 'zh-TW': '檢視已下載資源', 'zh-CN': '查看已下载资源', 'ja': 'ダウンロード済みを表示', 'en': 'View downloaded packs', 'ko': '다운로드 목록 보기' },
  'set.space.close':  { 'zh-TW': '收合資源清單', 'zh-CN': '收起资源列表', 'ja': '一覧を閉じる', 'en': 'Collapse list', 'ko': '목록 접기' },
  'set.space.empty':  { 'zh-TW': '沒有可管理的資源。', 'zh-CN': '没有可管理的资源。', 'ja': '管理できるリソースはありません。', 'en': 'No managed resources.', 'ko': '관리할 리소스가 없습니다.' },
  'set.space.summary':{ 'zh-TW': '{n} 個資源包（約 {size}）', 'zh-CN': '{n} 个资源包（约 {size}）', 'ja': '{n} 個のパック（約 {size}）', 'en': '{n} packs (≈ {size})', 'ko': '팩 {n}개 (약 {size})' },
  'set.space.delete': { 'zh-TW': '刪除', 'zh-CN': '删除', 'ja': '削除', 'en': 'Delete', 'ko': '삭제' },
  'set.space.locked': { 'zh-TW': '必要資源', 'zh-CN': '必要资源', 'ja': '必須リソース', 'en': 'Required', 'ko': '필수 리소스' },
  'set.space.confirm':{ 'zh-TW': '確定刪除 {key}？', 'zh-CN': '确定删除 {key}？', 'ja': '{key} を削除しますか？', 'en': 'Delete {key}?', 'ko': '{key}을(를) 삭제할까요?' },
  'set.space.kindCore':  { 'zh-TW': '核心', 'zh-CN': '核心', 'ja': 'コア', 'en': 'Core', 'ko': '코어' },
  'set.space.kindIntro': { 'zh-TW': '開場', 'zh-CN': '开场', 'ja': 'オープニング', 'en': 'Intro', 'ko': '오프닝' },
  'set.space.kindLobby': { 'zh-TW': '大廳', 'zh-CN': '大厅', 'ja': 'ホール', 'en': 'Lobby', 'ko': '로비' },
  'set.space.kindVoice': { 'zh-TW': '語音', 'zh-CN': '语音', 'ja': 'ボイス', 'en': 'Voice', 'ko': '보이스' },
};

function t(key, params) {
  const tag = i18nTag(uiLang);
  let s =
    i18nDict?.[tag]?.[key]
    ?? i18nDict?.[I18N_TAG_FALLBACK]?.[key]
    ?? LOCAL_I18N[key]?.[tag]
    ?? LOCAL_I18N[key]?.[I18N_TAG_FALLBACK]
    ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

// ---- 側欄控制區文字：自建小字典，不依賴 pack 的 ui_i18n（SW 快取會蓋過
// Pages 副本，改 pack 字典需整個資源重建）。放 app.js 立即對所有語言生效。
const CTL_I18N = {
  bgm:       { 'zh-TW': '音樂',          'zh-CN': '音乐',      'ja': '音楽',                'en': 'Music',                'ko': '음악' },
  full:      { 'zh-TW': '全螢幕',        'zh-CN': '全屏',      'ja': 'フルスクリーン',      'en': 'Fullscreen',           'ko': '전체 화면' },
  fullExit:  { 'zh-TW': '結束全螢幕',    'zh-CN': '退出全屏',  'ja': 'フルスクリーン解除',  'en': 'Exit fullscreen',      'ko': '전체 화면 종료' },
  focus:     { 'zh-TW': '專注模式',      'zh-CN': '专注模式',  'ja': 'フォーカスモード',    'en': 'Focus mode',           'ko': '집중 모드' },
  export:    { 'zh-TW': '匯出影片',      'zh-CN': '导出视频',  'ja': '動画を書き出す',      'en': 'Export video',         'ko': '영상 내보내기' },
  settings:  { 'zh-TW': '設定',          'zh-CN': '设置',      'ja': '設定',                'en': 'Settings',             'ko': '설정' },
  vignette:  { 'zh-TW': '電影燈光效果',  'zh-CN': '电影灯光效果', 'ja': '映画ライト効果',    'en': 'Cinematic lighting',   'ko': '시네마 조명 효과' },
  voiceLang: { 'zh-TW': '語音',          'zh-CN': '语音',      'ja': 'ボイス',              'en': 'Voice',                'ko': '보이스' },
  voiceJp:   { 'zh-TW': '日文',          'zh-CN': '日文',      'ja': '日本語',              'en': 'JP',                   'ko': '일본어' },
  voiceKr:   { 'zh-TW': '韓文',          'zh-CN': '韩文',      'ja': '韓国語',              'en': 'KR',                   'ko': '한국어' },
};

function ctlText(key) {
  const m = CTL_I18N[key];
  return m ? (m[i18nTag(uiLang)] || m['zh-TW'] || key) : key;
}

function applyCtlI18n() {
  const setLabel = (key, el) => {
    if (!el) return;
    const tt = el.querySelector?.('.tt');
    if (tt) tt.textContent = ctlText(key);
    el.title = ctlText(key);
  };
  setLabel('bgm', btnCtlBgm);
  setLabel('export', btnCtlExport);
  setLabel('settings', btnCtlSettings);
  setLabel('focus', btnCtlFocus);
  setLabel('vignette', btnCtlVignette);
  const vl = document.getElementById('ctlVoiceLbl');
  if (vl) vl.textContent = ctlText('voiceLang');
  for (const b of (ctlVoiceSegs?.querySelectorAll('button') ?? [])) {
    b.textContent = ctlText(b.dataset.ck || (b.dataset.v === 'kr' ? 'voiceKr' : 'voiceJp'));
  }
}

// ---- 聊天/對話 UI 字體：不再寫死在 index.html @font-face（官方字體不 static
// 散佈），改為 runtime 從 assets/fonts/（pack 安裝後由 SW 快取提供）動態
// 註冊 FontFace。未載入前以系統字體 fallback，註冊成功後瀏覽器自動重繪。
async function loadGameFonts() {
  const defs = [
    { family: 'BA MPlus1p',    file: 'assets/fonts/BA-MPLUS1p-Medium.ttf',      fmt: 'truetype' },
    { family: 'BA NotoSansTC', file: 'assets/fonts/BA-NotoSansTC-Medium.otf',   fmt: 'opentype' },
    { family: 'BA NotoSans',   file: 'assets/fonts/BA-NotoSans-Regular.ttf',    fmt: 'truetype' },
  ];
  for (const { family, file, fmt } of defs) {
    try {
      const face = new FontFace(family, `url('${assetUrl(file)}') format('${fmt}')`);
      await face.load();
      document.fonts.add(face);
    } catch {
      // core 已保證就位：仍失敗表示 pack 損壞，退回系統字體（不重試）
    }
  }
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
   let extras = [];           // 額外骨架（timeline 上非本體的 skeleton，如 CH0184_00 / Shigure_00）
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
  // SpineClip IntroMix 資料（從 assets/spine/<Lobby>/<Lobby>-*.json 讀取）
  // key = 動畫名（如 "Talk_01_M"），value = { IntroMix, UseDefaultIntroMix }
  let CLIP_CONFIGS = {};
  // per-lobby SpineClip 互動圖（assets/data/clip_graph.json，由遊戲 bundle 的
  // SpineClip ScriptableObject 直接解析）：key = lobby 資料夾名（如 CH0242_home）
  // → 動畫名 → { Track, PlayMode, FinishMode, Loop, NextClip, Sync, ... }。
  // 進階手勢沿用真實遊戲的 Track / FM=PlayNext(_01 → _02 循環) / End 命名。
  let CLIP_GRAPH = {};
  // Title 開場喊聲索引（assets/data/title_voices.json）：
  // { "JP_Aru": ["Aru_Title.ogg"], ... } → assets/voice_title/<folder>/<file>
  let TITLE_VOICES = null;
 let SCHEDULE = null;
 let BGM_MAP = {};
 let ORDER = [];
 let STUDENT_ICONS = {};

// kivo.wiki 光線修復公式：Additive 槽且名稱含 light/flare → Screen 混色。
// 比對 kivo _fix skel 實證（Hanako 3/3、CH0220 8/8、Seia 1/1 個 Additive 槽全改）。
// 不能「全部 Additive→Screen」：全庫 4296 個 Additive 槽中有眼睛/背景/光暈等
// 非光效槽（kivo 未修角色在站上仍維持 Additive），名稱過濾才不會改壞眼睛。
const fixAdditiveSlots = (obj) => {
  let n = 0;
  for (const slot of obj.skeleton.slots) {
    if (slot.data.blendMode === 1 && /light|flare/i.test(slot.data.name)) { slot.data.blendMode = 3; n++; }
  }
  return n;
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

  if (bg || scene || extras.length) {
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
      // 額外骨架（CH0184_00 等）與本體同世界座標系（共享相機線），沿用本體同一變換。
      for (const ex of extras) setTransform(ex, spine.x, spine.y, cs);
    } else {
      const s = sceneScale * cam.scale;
      const csx = charScale * cam.scale;
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
      for (const ex of extras) setTransform(ex, spine.x, spine.y, csx);
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
let handFollowBone = null;     // skeleton position bone driven toward the cursor
let handFollowActive = false;

function setupInteraction() {
  interactionMode = null;
  pinchActive = false;
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
// 按住 → 依 clip_graph 播 Pinch_01_M（舊 lobby 直接循環 / 現代 lobby 一次後自動
// 接 Pinch_02_M 循環）。釋放 → PinchEnd。遊戲本身即「01 一次 → 02
// 循環」的 SpineClip 鏈（FM=PlayNext，見 clip_graph.json），不需額外距離推圖。
function startPinch() {
  if (!spine || pinchActive) return;
  if (state.introBlock) return;
  if (state.busy === 'talk' && !isInteractionAvailable()) return;
  const main = has('Pinch_01_M') ? 'Pinch_01_M' : (has('Pinch_01') ? 'Pinch_01' : null);
  if (!main) return;
  clearTimers();
  pinchActive = true;
  state.busy = 'pinch';
  blockInteraction('pinch', true);
  playHoldGesture(main);
  log('捏頰 (拖曳)');
}

function updatePinch() {
  // 臉頰拉伸深度已由動畫自身鏈（Pinch_01→Pinch_02 循環）演進，此處保留為空。
  if (!spine || !pinchActive) return;
}

function endPinch() {
  if (!spine || !pinchActive) return;
  pinchActive = false;
  state.busy = null;
  blockInteraction('pinch', false);
  playGestureEnd(has('Pinch_01_M') ? resolveEndClip('Pinch_01_M') : 'PinchEnd_01_M');
  after(1200, () => { if (state.busy) return; restTracks(); scheduleAutonomy(); });
  log('捏頰結束');
}

// ---- Touch (戳) ----
// 按住臉部 → Touch_01_M（一次）自動接 Touch_02_M 循環至釋放；點一下 → quick
// poke（._01 短暫後 immediately TouchEnd）。釋放播 TouchEnd —— CH0347 底線
// 版 Touch_End_01_M 由 resolveEndClip 解析。移除舊的 700ms 硬排程（遊戲是
// press-and-hold，非 tap-and-release-after-timeout）。
function startTouch() {
  if (!spine) return;
  if (state.introBlock) return;
  if (state.busy === 'talk' && !isInteractionAvailable()) return;
  const main = has('Touch_01_M') ? 'Touch_01_M' : (has('Touch_02_M') ? 'Touch_02_M' : null);
  if (!main) return;
  clearTimers();
  state.busy = 'touch';
  blockInteraction('touch', true);
  playHoldGesture(main);
  log('戳 / 觸摸');
}
function endTouch() {
  if (!spine || state.busy !== 'touch') return;
  state.busy = null;
  blockInteraction('touch', false);
  playGestureEnd(resolveEndClip('Touch_01_M'));
  after(1200, () => { if (state.busy) return; restTracks(); scheduleAutonomy(); });
  log('觸摸結束');
}

// ---- HandFollow (手部跟隨) ----
// 拖曳任意處：hand bone 朝指標移動（eased），動畫走 HandFollow_01→02 循環鏈
// （CH0310 Track2 / CH0334 Track1）。釋放播 HandFollowEnd。移除舊的
// pointer-move pulse 換圖——遊戲的 02 是循環維持，由 PlayNext 鏈自動接上。
function startHandFollow() {
  if (!spine || handFollowActive) return;
  if (state.introBlock) return;
  if (state.busy === 'talk' && !isInteractionAvailable()) return;
  if (!has('HandFollow_01_M')) return;
  clearTimers();
  handFollowActive = true;
  state.busy = 'handfollow';
  blockInteraction('handfollow', true);
  playHoldGesture('HandFollow_01_M');
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
}

function endHandFollow() {
  if (!spine || !handFollowActive) return;
  handFollowActive = false;
  state.busy = null;
  blockInteraction('handfollow', false);
  playGestureEnd(resolveEndClip('HandFollow_01_M'));
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
let CHAR_PROFILES = null;   // char_profiles.json（角色檔案/簡介，LocalizeCharProfile）
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
  // 序幕音效（memoriallobby_0_N，如睡衣優香咀嚼聲）：當 SFX 處理——有聲音、
  // 不彈氣泡、不列入台詞表（同 Airi 舔冰淇淋的裸 _0）。表格裡若掛著文字
  // 也是誤植（whisper/規則稿錯位），一律視同 miss。
  if (/_memoriallobby_0_\d+$/i.test(voiceId)) return null;
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
  btnCtlBgm.classList.toggle('off', !bgmOn);
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

// 本體（主）骨架的規範名：lobby_index 的 skel 檔名主幹（小寫）。timeline 的 per-clip
// skeleton 欄位與此比對來區分「本體」vs「額外骨架」。
function mainSkeletonName() {
  const e = LOBBY_INDEX[currentLobby];
  const s = e && (e.skel || '');
  const clean = (s.startsWith('./') ? s.slice(2) : s).replace(/\.(skel|json)$/i, '');
  const base = clean.includes('/') ? clean.slice(clean.lastIndexOf('/') + 1) : clean;
  return base.toLowerCase() || String(currentLobby).toLowerCase();
}
function skelNorm(name) { return (name || '').toLowerCase(); }
// 找已載入的物件（spine/bg/scene/extras）中 skelName 相符者。
function findLoadedSkeleton(skelName) {
  const target = skelNorm(skelName);
  for (const obj of [spine, bg, scene, ...extras]) {
    if (obj && skelNorm(obj.skelName) === target) return obj;
  }
  return null;
}
// 依 timeline 的 per-clip skeleton 播放額外骨架（非本體）的 clips。skeleton 檔案從
// assets/spine/{lobby}/{skel}/{skel}.skel 載入；若該 skeleton 已作為 bg/scene/…載入
// 則沿用（資料驅動、不特判、不重複載入）。額外骨架按 clips 的 start 排 delay 鏈。
async function playExtraSkeleton(skelName, clips) {
  // skelName 保留原始大小寫（資料/檔案名的實際大小寫，如 CH0184_00）
  const skRaw = String(skelName).replace(/\.(skel|json)$/i, '');
  let obj = findLoadedSkeleton(skRaw);
  if (!obj) {
    const base = `assets/spine/${currentLobby}/${skRaw}/`;
    const skelUrl = assetUrl(`${base}${skRaw}.skel`);
    try {
      await Assets.load(skelUrl);
      // atlas 檔名與 skel 同名；png 由 atlas 文字列出（其上層載入會帶入）
      const atlasUrl = assetUrl(`${base}${skRaw}.atlas`);
      await Assets.load(atlasUrl);
      obj = Spine.from({ skeleton: skelUrl, atlas: atlasUrl });
      fixAdditiveSlots(obj);
      obj.skelName = skelNorm(skRaw);
      extras.push(obj);
      // 圖層：額外骨架（CH0184_00 等）與本體同世界座標系，但繪製在本體「後方」
      // （官方中它是墊在角色下的附屬層； addChild 會蓋住本體）。插在本體正下方
      // = bg 之上、本體之下；本體未載入時退回置頂。
      if (spine && app.stage.children.includes(spine)) {
        app.stage.addChildAt(obj, app.stage.getChildIndex(spine));
      } else {
        app.stage.addChild(obj);
      }
    } catch (e) {
      console.warn(`[timeline] 額外骨架載入失敗 ${skRaw}:`, e?.message);
      return;
    }
  }
  // 依 start 排 delay 鏈（與本體相同的絕對 start 差邏輯），額外骨架一般是播一次即停
  // （如 CH0184_00 的 Start_Idle_01），不額外補 idle loop。
  const available = new Set(obj.state.data.skeletonData.animations.map(a => a.name));
  const playable = clips.filter(c => available.has(c.anim));
  if (!playable.length) return;
  let schedEnd = 0;
  let first = true;
  let queuedIdle = false;
  for (const clip of playable) {
    const isIdle = /^idle/i.test(clip.anim);
    if (first) {
      obj.state.setAnimation(0, clip.anim, isIdle || false, Math.max(0, clip.start));
      if (clip.start > 0) { const e = obj.state.getCurrent(0); if (e) e.delay = clip.start; }
      first = false;
    } else {
      const gap = Math.max(0, clip.start - schedEnd);
      obj.state.addAnimation(0, clip.anim, isIdle || false, gap);
    }
    schedEnd = clip.start + (isIdle ? 1e9 : clip.duration);
    if (isIdle) { queuedIdle = true; break; }
  }
  if (!queuedIdle && available.size) {
    const idleName = resolveIdleClipFor(obj);
    if (available.has(idleName)) obj.state.addAnimation(0, idleName, true, 0);
  }
}
function resolveIdleClipFor(obj) {
  if (!obj || !obj.state) return 'Idle_01';
  const names = obj.state.data.skeletonData.animations.map(a => a.name);
  for (const n of ['S2_01', 'Idle_01']) if (names.includes(n)) return n;
  return names.find(n => /^idle/i.test(n)) || (names.find(n => !/^(start|dummy)/i.test(n)) || names[0]);
}
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
  // Track 5：CH0346 Touch 系動畫運行於 Track 5；Track 2：Pinch/HandFollow Sync
  // （Pinch_01_A）+ 舊 lobby Pat/Look 的 _A。只處理互動軌，idle(track0) 不碰。
  spine.state.setEmptyAnimation(1, 0.45);
  spine.state.setEmptyAnimation(2, 0.45);
  spine.state.setEmptyAnimation(5, 0.45);
}

// 動畫播放 wrapper：讀取 SpineClip 的 IntroMix，覆蓋 defaultMix
// SpineClip.IntroMix (UseDefaultIntroMix=false) 比 state.defaultMix 更精確，
// 遊戲的 SkeletonDataAsset 是靜態值，BA code 在播放時用 IntroMix 覆蓋。
// spine.js 不知道 SpineClip，所以要這裡手動設定 entry.mixDuration。
function setAnimationWithClipMix(track, animName, loop) {
  const entry = spine.state.setAnimation(track, animName, loop);
  const cfg = CLIP_CONFIGS[animName];
  if (cfg && !cfg.UseDefaultIntroMix) {
    entry.mixDuration = cfg.IntroMix;
  } else {
    entry.mixDuration = spine.state.data.defaultMix;
  }
  return entry;
}

function addAnimationWithClipMix(track, animName, loop, delay = 0) {
  const entry = spine.state.addAnimation(track, animName, loop, delay);
  const cfg = CLIP_CONFIGS[animName];
  if (cfg && !cfg.UseDefaultIntroMix) {
    entry.mixDuration = cfg.IntroMix;
  } else {
    entry.mixDuration = spine.state.data.defaultMix;
  }
  return entry;
}

// ---- per-lobby clip graph (資產 clip_graph.json) ----
// 回傳目前 lobby 的某動畫 SpineClip 設定，無此 lobby / 動畫時回傳 null（非特殊
// lobby 保持既有行為）。欄位直接來自遊戲解剖：Track、Loop、FinishMode(PlayNext=3,
// 播完接 NextClip)、Sync（同一 Clip 於另一 Track 同時播放）、BlockInteractionOnPlay。
function clipCfg(name) {
  const L = CLIP_GRAPH && CLIP_GRAPH[currentLobby];
  return (L && L[name]) || null;
}

// 依遊戲資料播「按住手勢」動畫：
//   * 現代 lobby（Loop=false, FinishMode=PlayNext）：_01_M 播一次後自動接
//     NextClip（_02_M, Loop）並維持循環——按住期間即 02 循環。
//   * 舊 lobby（Loop=true）：直接循環 _01_M。
//   * Sync 清單（如 CH0242 Pinch_01_A）依各自 Track 同時播放。
// syncHint：無 clip_graph 資料（一般 lobby）時的手動 _A 對應清單。
function playHoldGesture(main, syncHint = null) {
  if (!spine || !has(main)) return null;
  spine.state.setEmptyAnimation(3, 0);   // 暫停眼球隨機眨眼 overlay（Eye_Close_01）
  const cfg = clipCfg(main);
  const track = cfg ? (cfg.Track || 1) : 1;
  if (cfg && !cfg.Loop) {
    setAnimationWithClipMix(track, main, false);
    // FM=PlayNext 的續播目標：優先吃圖裡的 NextClip；遇到圖為 null 但存在同族
    // _02（例：CH0346 Touch_02_M 於 Track5）時直接接上，維持按住循環的遊戲行為。
    let next = cfg.NextClip;
    if (!next) {
      const sib = main.replace(/_(0\d)(_M)?$/, '_02$2');
      if (sib !== main && has(sib)) next = sib;
    }
    if (next && has(next)) addAnimationWithClipMix(track, next, true, 0);
  } else {
    setAnimationWithClipMix(track, main, true);
  }
  let syncs = cfg ? (cfg.Sync || []) : (syncHint || []);
  for (const s0 of syncs) {
    const s = (typeof s0 === 'string') ? s0 : (s0.name || s0);
    if (!s || !has(s)) continue;
    const scfg = clipCfg(s);
    setAnimationWithClipMix(scfg ? (scfg.Track || 2) : 2, s, scfg ? !!scfg.Loop : true);
  }
  return cfg;
}

// 釋放時播放 End 動畫（從 mainName 依遊戲命名規則解析：
// TouchStart→TouchEnd / Touch_End，HandFollow→HandFollowEnd 等），含 Sync 對應。
function playGestureEnd(endName) {
  if (!spine || !has(endName)) return;
  spine.state.setEmptyAnimation(3, 0);   // 收斂時同樣暫停眨眼 overlay
  const cfg = clipCfg(endName);
  const track = cfg ? (cfg.Track || 1) : 1;
  setAnimationWithClipMix(track, endName, false);
  const twin = endName.replace(/_M$/, '_A');
  let syncs = cfg ? (cfg.Sync || []) : null;
  if (!syncs || !syncs.length) syncs = has(twin) ? [twin] : [];
  for (const s0 of syncs) {
    const s = (typeof s0 === 'string') ? s0 : (s0.name || s0);
    if (!s || !has(s)) continue;
    const scfg = clipCfg(s);
    setAnimationWithClipMix(scfg ? (scfg.Track || 2) : 2, s, false);
  }
}

// 依「_01_M → End_01_M / _End_01_M」的遊戲命名對照找出釋放動畫（吃 CH0347
// 底線版 Touch_End_01_M，也吃一般 TouchEnd_01_M）。
function resolveEndClip(mainName) {
  const candidates = [
    mainName.replace(/_(0\d)_M$/, 'End_01_M'),
    mainName.replace(/_(0\d)_M$/, '_End_01_M')
  ];
  if (/^Pat2_/.test(mainName)) {
    candidates.unshift(mainName.replace(/^Pat2_(0\d)_M$/, 'PatEnd2_01_M'));
  }
  for (const c of candidates) {
    if (has(c)) return c;
  }
  return candidates[0];
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
    setAnimationWithClipMix(1, m, false);
    if (animNames().includes(a)) setAnimationWithClipMix(2, a, false);
    else spine.state.setEmptyAnimation(2, 0.3);

    // ---- Balloon lifecycle (reversed ChatDialog.<CoDialog>d__43.MoveNext) ----
    // The balloon is ONE persistent element for the whole talk: each recorded
    // Talk voice event (lobby_voice_schedule.json) switches the text in place,
    // and the balloon stays up until the Talk animation on track 1 plays all the
    // way through — 收合時機是「Talk 動作做完」，不是最後一句音檔播完
    // （音檔常比動畫早結束，例如 Talk_04_M 跑 40s、最後一句卻在 32.9s）。
    // 由下方輪詢偵測動畫結束的瞬間收合（CSS .4s fade）；supersede 時
    // dialogSession 已換代 → finally 的收尾不會誤關新一輪的氣泡。
    const anim = spine.state.data.skeletonData.findAnimation(m);
    const animMs = (anim?.duration ?? 2.0) * 1000;
    const startToken = voiceToken;
    const t0 = performance.now();

    // Poll until the talk animation on track 1 has played through (animationTime
    // reached its end). This keeps `busy` / blockInteractionOnPlay held (mirroring
    // byte [+0xb0]) so a new line can't start until the current talk clip finishes,
    // and doubles as the balloon's close trigger: 對話框在 Talk 動作做完的那一幀收合
    // （不是最後一句音檔播完時）。Guarantees multi-line talks (e.g. Talk_01_M:
    // events at 1.33s and 8.60s) run to completion instead of cutting after the
    // first line. Bail early if the interaction was superseded.
    let voiceFired = false;
    const deadline = t0 + animMs + 500;
    while (performance.now() < deadline) {
      if (state.busy !== 'talk') return;
      const tr = spine.state.tracks[1];
      const animEnd = tr?.animationEnd || animMs;
      const animDone = tr ? tr.getAnimationTime ? tr.getAnimationTime() >= animEnd - 0.05 : tr.animationTime >= animEnd - 0.05 : true;
      if (animDone) {
        voiceFired = voiceToken > startToken;
        // Talk 動作已完成 — 對話框此刻才收（而非追最後一句音檔）。
        if (session === dialogSession) {
          dialogActive = false;
          hideChat();
        }
        break;
      }
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
//   * SpineClip assets (clip_graph.json, 直接解析自遊戲 bundle) show the hold
//     semantics per lobby: 現代 lobby Look_01_M Loop=0 + FinishMode=PlayNext →
//     Look_02_M Loop=1（CH0310 全部 Track2）；舊 lobby Look_01_M Loop=1（直接
//     循環）。釋放播 LookEnd_01_M（CH0326 有 Sync LookEnd_01_A）。
//   * Look_01_M is a single-keyframe pose on the eye-globe bones (dur 0.00) — it
//     flags "look mode"; the actual eye tracking is the per-frame Touch_Eye bone
//     movement that applyEyeFollow() performs (see setupEyes), which the face
//     transform constraints relay to the eyes.
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

  // 依 clip_graph：現代 lobby = Look_01_M 一次 → Look_02_M 循環（Track 依圖）；
  // 舊 lobby = Loop=true 直接循環。Sync（如 Look_01_A）同現行規則。
  playHoldGesture('Look_01_M', has('Look_01_A') ? ['Look_01_A'] : null);
  log('抓眼 (hold)');
}

function endLook() {
  if (!spine || state.busy !== 'look') return;
  state.busy = null;
  blockInteraction('look', false);
  state.blockInteractionOnPlay = false;
  playGestureEnd(resolveEndClip('Look_01_M'));
  after(500, () => {
    if (state.busy || patting) return;
    restTracks();
    scheduleAutonomy();
  });
  log('抓眼結束');
}

// CH0346/CH0347 同時帶 Pat 與 Pat2 兩組摸頭（骨骼/觸發區完全相同，SpineClip 欄位
// 除名稱外無差異——遊戲端差異只在 prefab 對應的觸碰區，本地無該資料）。以隨機
// 交替模擬其兩組動畫皆有可播放性的行為（對應遊戲 UILobby.MemoryRandom 圖樣）。
function pickPatGroup() {
  return has('Pat2_01_M') && Math.random() < 0.5 ? 'Pat2' : 'Pat';
}

function startPat() {
  if (!spine || patting) return;
  if (state.introBlock) return;                 // intro timeline locks input
  if (state.busy === 'talk' && !isInteractionAvailable()) return; // blocked by dialog
  patting = true;
  state.patGroup = pickPatGroup();
  const main = state.patGroup + '_01_M';
  if (!has(main)) { patting = false; state.patGroup = null; return; }
  clearTimers();              // interrupt an ongoing talk / look
  state.busy = 'pat';
  playHoldGesture(main, has(state.patGroup + '_01_A') ? [state.patGroup + '_01_A'] : null);
  log('摸頭 (' + state.patGroup + ')');
}

function endPat() {
  if (!spine || !patting) return;
  patting = false;
  if (state.busy !== 'pat') return;
  state.busy = null;
  const main = (state.patGroup || 'Pat') + '_01_M';
  state.patGroup = null;
  playGestureEnd(resolveEndClip(main));
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
  // 隨機眨眼（遊戲 Eye_Close_01：Track 3, PlayMode=RandomTiming, FM=PlayIdle）。
  // 僅在閒置無互動時排程；gesture 開始會 clearTimers() 取消，結束後再恢復。
  if (!spine || state.introBlock) return;
  if (state.busy || state.blockInteractionOnPlay) return;
  if (!has('Eye_Close_01')) return;
  state.autonomy = setTimeout(() => {
    if (!spine || state.busy || state.introBlock) return;
    if (state.blockInteractionOnPlay || !has('Eye_Close_01')) return;
    setAnimationWithClipMix(3, 'Eye_Close_01', false);
    const d = spine.state.data.skeletonData.findAnimation('Eye_Close_01');
    state.autonomy = setTimeout(scheduleAutonomy, (d ? d.duration : 0.4) * 1000 + 700);
  }, 1800 + Math.random() * 4200);
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
    // timeline 的多條 spine track：每條屬於某個 skeleton（extract_timelines.py 的 per-clip
    // skeleton 欄位）。本體骨架的 clips 播在 spine（track-agnostic 依 start 排 delay 鏈），
    // 非本體的額外 skeleton（CH0184_00 / Shigure_00 / Akari_Scene...）各自載入獨立 spine
    // 物件、按其骨架的 clips 播放——不再「只挑 t≈0 的 track、丟掉其他 track」。
    const mainSkel = mainSkeletonName();
    const e0 = LOBBY_INDEX[currentLobby];
    const s0 = e0 && (String(e0.skel).startsWith('./') ? String(e0.skel).slice(2) : String(e0.skel));
    const mainSkelOrig = s0 ? s0.replace(/\.(skel|json)$/i, '').split('/').pop() : '';
    const bySkel = new Map();
    for (const t of tl.tracks) {
      // 保留 skeleton 原始大小寫（檔案/資料夾名的實際大小寫），比對用正規化小寫。
      const skRaw = t.skeleton || mainSkelOrig;
      const sk = skelNorm(skRaw);
      if (!bySkel.has(sk)) bySkel.set(sk, []);
      bySkel.get(sk).push({ ...t, skelRaw: skRaw });
    }
    const bodyClips = (bySkel.get(mainSkel) || [])
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
          setAnimationWithClipMix(0, clip.anim, isIdle, Math.max(0, clip.start));
          first = false;
        } else {
          const gap = Math.max(0, clip.start - schedEnd);
          spine.state.addAnimation(0, clip.anim, isIdle, gap);
        }
        schedEnd = clip.start + (isIdle ? 1e9 : clip.duration);   // Idle 無限循環
        if (isIdle) { queuedIdle = true; break; }
      }
      if (!queuedIdle) spine.state.addAnimation(0, idleClip, true, 0);
      // 額外 skeleton：每個非本體 skeleton 載入獨立物件並依其 clips 播放。該 skeleton
      // 若已作為 bg/scene 載入（Yuzu_bg/Akari_Scene...）即由既有機制（startBgSequence）
      // 驅動，這裡不重複碰——只有真正缺席的（CH0184_00 / Shigure_00 / Shigure_01）才新建。
      // 此為資料驅動——不需逐一特判。
      const handledByExisting = new Set();
      for (const obj of [bg, scene]) if (obj && obj.skelName) handledByExisting.add(skelNorm(obj.skelName));
      for (const [sk, clipsA] of bySkel) {
        if (sk === mainSkel) continue;
        const extraClips = clipsA
          .slice()
          .sort((a, b) => a.start - b.start);
        if (!extraClips.length) continue;
        if (handledByExisting.has(sk)) continue;   // 已有 bg/scene 物件映同骨架 → 跳過
        playExtraSkeleton(clipsA[0].skelRaw || sk, extraClips);
      }
      startBgSequence();
      log(`[timeline] ${currentLobby}: ${bodyClips.length} body clips, ${bySkel.size - 1} extra skeleton(s), total ${tl.duration}s`);
      return;
    }
  }
  if (hasStart) {
    // Memorial intro timeline (PlayableDirector) occupies the screen and locks
    // interaction until it finishes (matching UILobby memory lobby flow). Track 0
    // completion of the intro clears the lock (see onTrackComplete).
    state.introBlock = true;
    startIntroClock();
    const introEntry = setAnimationWithClipMix(0, introName, false);
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
    setAnimationWithClipMix(0, idleClip, true);
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
  setAnimationWithClipMix(0, idleClip || 'Idle_01', true);
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
  // headless 驗證「對話框在 Talk 動畫跑完後才收」(PROBE only)：記錄 balloon
  // open/close 時刻與 track1 動畫進度。回傳 [{t, animTime, remain, close}]。
  talkTiming: async () => {
    if (!spine) return null;
    const c = document.getElementById('chatDialog');
    const rec = { events: [], anim: [], e: null };
    let open = c.classList.contains('show');
    const t0 = performance.now();
    const mark = (s) => rec.events.push({ s, t: +(performance.now() - t0) / 1000 });
    if (open) mark('wasOpen');
    const obs = new MutationObserver(() => {
      const on = c.classList.contains('show');
      if (on !== open) { open = on; mark(on ? 'open' : 'close'); }
    });
    obs.observe(c, { attributes: true, attributeFilter: ['class'] });
    const iv = setInterval(() => {
      try {
        const e = spine.state.getCurrent(1);
        if (!e || !e.animation) return;
        const at = typeof e.getAnimationTime === 'function' ? e.getAnimationTime() : (e.animationTime ?? 0);
        const end = e.animationEnd ?? e.animation.duration;
        if (!(at > 0) && !(end > 0)) return;
        rec.anim.push({
          t: +((performance.now() - t0) / 1000).toFixed(2),
          at: +at.toFixed(2),
          end: +end.toFixed(2),
          rem: +((end - at)).toFixed(2),
          nm: e.animation.name,
          tt: +((e.trackTime ?? 0)).toFixed(2),
          autom: spine.autoUpdate === true,
          ts: spine.state.timeScale,
        });
      } catch (err) { rec.e = String(err); }
    }, 30);
    await playTalk();
    clearInterval(iv);
    const e = spine.state.getCurrent(1);
    rec.final = {
      anim: e && e.animation ? e.animation.name : null,
      at: e ? +((typeof e.getAnimationTime === 'function' ? e.getAnimationTime() : 0)).toFixed(2) : null,
      end: e ? +((e.animationEnd ?? e.animation?.duration ?? 0)).toFixed(2) : null,
      balloonOpen: c.classList.contains('show'),
    };
    return rec;
  },
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
  freeze: (on) => {
    const list = [spine, scene, bg].filter(Boolean);
    for (const s of list) { try { s.state.timeScale = on ? 0 : 1; } catch {} }
    return on ? 'frozen' : 'unfrozen';
  },
  lightSlots: () => {
    if (!spine) return null;
    const out = [];
    for (const s of spine.skeleton.slots) {
      if (/light/i.test(s.data.name)) out.push(`${s.data.name}=${s.data.blendMode}`);
    }
    return out;
  },
  post: {
    on: () => { baPostOn = true; try { localStorage.setItem('ba_post', '1'); } catch {} applyPostGrade(currentLobby); return baPostOn; },
    off: () => { baPostOn = false; try { localStorage.setItem('ba_post', '0'); } catch {} if (postWrap) postWrap.filters = []; return baPostOn; },
    mode: (m) => { if (m === 'faithful' || m === 'mild') { POST_MODE = m; try { localStorage.setItem('ba_post_mode', m); } catch {} applyPostGrade(currentLobby); } return POST_MODE; },
    get status() { return { on: baPostOn, mode: POST_MODE, cfg: baPostCfgFor(currentLobby), filter: !!baPostFilter, stageF: app?.stage?.filters?.length ?? 0, onStage: !!(baPostFilter && app?.stage?.filters?.some(f => f === baPostFilter)) }; },
    apply: (lobby) => applyPostGrade(lobby || currentLobby),
    cpu: (rgb, lobby) => baPostCpu(rgb, baPostCfgFor(lobby || currentLobby)),
    test: (rgb, lobby) => { const c = baPostCfgFor(lobby || currentLobby); return c ? { in: rgb, cfg: c, out: baPostCpu(rgb, c) } : null; },
    reload: async () => { for (const k of Object.keys(POST_CONFIG)) delete POST_CONFIG[k]; POST_CONFIG_LOAD = null; await loadPostConfig(); return Object.keys(POST_CONFIG).length; },
    stageTint: (v) => { try { app.stage.filters = [new ColorMatrixFilter({ brightness: Number(v) ?? 3 })]; return app.stage.filters.length + ''; } catch (e) { return 'ERR ' + e.message; } },
    clearFilters: () => { app.stage.filters = []; return app.stage.filters.length; },
    renderNow: () => { app.render(); return 'rendered'; },
    present: async () => { app.render(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return 'presented'; },
    readPix: (fx, fy) => {
      try {
        app.render();
        const gl = app.canvas.getContext('webgl2') || app.canvas.getContext('webgl');
        const cw = gl.drawingBufferWidth, ch = gl.drawingBufferHeight;
        const px = new Uint8Array(4);
        gl.readPixels(Math.min(Math.max(0, Math.floor((fx ?? 0.5) * cw)), cw - 1), Math.min(Math.max(0, Math.floor((fy ?? 0.5) * ch)), ch - 1), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return [...px];
      } catch (e) { return 'ERR ' + e.message; }
    },
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
      .filter(s => s.data.blendMode === 3 || s.data.blendMode === 1)
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
const settingsBackdrop = document.getElementById('settingsBackdrop');
const setLangSegs = document.getElementById('setLangSegs');
const setModeSegs = document.getElementById('setModeSegs');
const setCursorCk = document.getElementById('setCursorCk');
const setClickFxCk = document.getElementById('setClickFxCk');
const setJpOnlyCk = document.getElementById('setJpOnlyCk');
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
  if (infoPanel?.classList.contains('open')) renderInfoPanel();
  syncSettingsLangSegs();
  applyCtlI18n();
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

// ---- 語音語言（jp/kr）：側欄控制區為主；settings 殘留 segs（若有）同步 ----
const setVoiceLangSegs = document.getElementById('setVoiceLangSegs');
function syncVoiceLangSegs() {
  for (const root of [setVoiceLangSegs, ctlVoiceSegs]) {
    if (!root) continue;
    for (const b of root.querySelectorAll('button')) {
      b.classList.toggle('on', b.dataset.v === voiceLang);
    }
  }
}
function onVoiceLangClick(e) {
  const b = e.target.closest('button');
  if (!b || b.dataset.v === voiceLang) return;
  voiceLang = b.dataset.v;
  try { localStorage.setItem('ba_voiceLang', voiceLang); } catch {}
  syncVoiceLangSegs();
  log('voice lang: ' + voiceLang);
}
setVoiceLangSegs?.addEventListener('click', onVoiceLangClick);
ctlVoiceSegs?.addEventListener('click', onVoiceLangClick);

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
    _settingsAssetInfo = await window.ba.checkAssets({ voice: voiceLang });
  } catch {
    _settingsAssetInfo = null;
  }
  renderSettingsAssets();
  try {
    renderStorageLine(await window.ba?.quotaInfo?.());
  } catch {}
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
    // 主按鈕標籤跟模式走：串流＝檢查更新（只補核心），完整＝下載全部（寫明大小）
    let isStream = true;
    try { isStream = !setModeSegs.querySelector('button[data-m="full"].on'); } catch {}
    try {
      setDownloadBtn.textContent = isStream
        ? t('set.checkUpdate')
        : t('set.downloadAll', { size: fmtBytes(bytes) });
    } catch {}
    setDownloadBtn.style.display = 'block';
  } else {
    setDownloadBtn.style.display = 'none';
  }
  setAssetsStatus.innerHTML = html;
}

// 雙進度條狀態（本包％＋總量％，按 manifest 標稱大小加權）
let _dlTotal = { done: 0, total: 0 };
function packSizeOf(name) {
  try { return _settingsAssetInfo?.packages?.[name]?.size || 0; }
  catch { return 0; }
}
function updateTotalProgress(curName, curPct) {
  const tfill = document.getElementById('setProgressFillTotal');
  const ttxt = document.getElementById('setProgressTextTotal');
  if (!tfill && !ttxt) return;
  const total = _dlTotal.total || 0;
  const pct = total > 0
    ? Math.min(100, Math.floor(((_dlTotal.done + packSizeOf(curName) * (curPct / 100)) / total) * 100))
    : 0;
  if (tfill) tfill.style.width = pct + '%';
  if (ttxt) ttxt.textContent = t('set.total', { pct });
}
function startSettingsDownload() {
  const info = _settingsAssetInfo;
  // packages 是 {包名: 資訊} 物件（不是陣列）——之前用 Array.isArray 擋掉一切。
  if (!info?.remoteVersion || !info.packages) return;
  setDownloadBtn.style.display = 'none';
  setAssetsProgress.style.display = 'block';
  setProgressText.textContent = t('dl.start');
  _dlTotal.done = 0;
  _dlTotal.total = pendingBytes(_settingsAssetInfo);
  setProgressFill.style.width = '0%';
  const tfill = document.getElementById('setProgressFillTotal');
  if (tfill) tfill.style.width = '0%';
  const ttxt = document.getElementById('setProgressTextTotal');
  if (ttxt) ttxt.textContent = '';
  // 進度由全域 handler 更新（開機時註冊一次；這裡只確保可見）
  // 下載全部缺的包（尊重目前模式：串流模式時 check-assets 已只回 core/intro）
  const version = info.remoteVersion || '1.0.0';
  const pkgs = {};
  for (const k of info.needsDownloadPacks || []) pkgs[k] = info.packages[k];
  window.ba.downloadAssets({ version, packages: pkgs, voice: voiceLang }).then(async () => {
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
  if (setJpOnlyCk) setJpOnlyCk.checked = settingsPref('ba_jpOnly', true);
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
        await refreshSettingsAssets();
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
  settingsBackdrop?.classList.toggle('open', open);
  if (open) switchSettingsTab(false);   // 開啟預設回設定頁
}

// ---- 直向小螢幕：提示橫向使用 ----
let _rotateDismissed = false;
function syncRotateHint() {
  const el = document.getElementById('rotateHint');
  if (!el) return;
  let portrait = false, narrow = false;
  try {
    portrait = !!window.matchMedia?.('(orientation: portrait)').matches;
    narrow = !!window.matchMedia?.('(max-width: 640px)').matches;
  } catch {}
  el.classList.toggle('open', !!(portrait && narrow && !_rotateDismissed));
}
// ---- 設定／關於分頁（共用視窗）----
function switchSettingsTab(about) {
  document.getElementById('setTabMain').style.display = about ? 'none' : '';
  document.getElementById('setTabAbout').style.display = about ? '' : 'none';
  document.getElementById('setTabBtnMain')?.classList.toggle('on', !about);
  document.getElementById('setTabBtnAbout')?.classList.toggle('on', !!about);
  if (about) { syncAboutSection(); fitSteamWidget(); }
}
// ---- Steam widget 自動縮放（原生 646px，窄視窗等比縮）----
function fitSteamWidget() {
  const wrap = document.getElementById('steamWidgetWrap');
  const frame = document.getElementById('steamWidget');
  if (!wrap || !frame) return;
  const w = wrap.clientWidth || 646;
  const s = Math.min(1, w / 646);
  frame.style.transform = `scale(${s})`;
  wrap.style.height = `${Math.round(190 * s)}px`;
}
function syncAboutSection() {
  const row = document.getElementById('setDesktopDlRow');
  if (!row) return;
  let isElectron = false;
  try { isElectron = !!window.ba?.__electron; } catch {}
  row.style.display = isElectron ? 'none' : '';
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
    setAnimationWithClipMix(1, track1, false);
    if (track2) setAnimationWithClipMix(2, track2, false);
    else spine.state.setEmptyAnimation(2, 0.3);
  } else if (clipType === 'start') {
    spine.state.setEmptyAnimation(1, 0.3);
    spine.state.setEmptyAnimation(2, 0.3);
    setAnimationWithClipMix(0, animName, false);   // animName = resolveStartClip()
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

// Per-costume sidebar icon key: keep the costume suffix (_swimsuit/...),
// strip only the outer suffixes (_home/_teen/_multi/_gl) and leading "lobby".
// e.g. hoshino_swimsuit_home -> hoshino_swimsuit. Returns null if nothing changes.
function costumeIconKey(key) {
  let rest = key.toLowerCase();
  if (rest.startsWith('lobby')) rest = rest.slice(5);
  let prev;
  do {
    prev = rest;
    for (const suf of ['_home_gl', '_home', '_teen', '_multi', '_gl']) {
      if (rest.endsWith(suf)) { rest = rest.slice(0, -suf.length); break; }
    }
  } while (rest !== prev);
  if (rest === key.toLowerCase() || rest === (key.toLowerCase().replace(/^lobby/, ''))) return null;
  return rest || null;
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

// ---- 角色介紹（char_profiles.json，官方 LocalizeCharProfile）----
// lobby → 語音排程的 characterId（最權威，如 CH0184）→ byAlias 別名索引 → profile。
function profileForLobby(lobbyKey) {
  if (!CHAR_PROFILES?.profiles || !CHAR_PROFILES.byAlias) return null;
  const byAlias = CHAR_PROFILES.byAlias, profiles = CHAR_PROFILES.profiles;
  const hit = (alias) => {
    const id = alias && byAlias[alias.toLowerCase()];
    return id != null ? profiles[String(id)] || null : null;
  };
  // 1) 語音排程的 characterId（官方 DevName 形，如 CH0184 / AruNewyear）
  const ch = SCHEDULE?.lobbies?.[lobbyKey]?.characterId
          ?? SCHEDULE?.[lobbyKey]?.characterId;
  let p = hit(ch);
  if (p) return p;
  // 2) lobby 名剝後綴（同 studentForLobby 的候選鏈）
  let b = String(lobbyKey).toLowerCase();
  let prev;
  while (b !== prev) {
    prev = b;
    for (const suf of ['_home_gl', '_home', '_gl', '_teen', '_multi']) {
      if (b.endsWith(suf)) { b = b.slice(0, -suf.length); break; }
    }
    if (b.length > 5 && b.startsWith('lobby')) b = b.slice(5);
  }
  for (const c of [b, b.replace(/_[a-z0-9]+$/, ''), b.replace(/[0-9]+$/, '')]) {
    p = hit(c);
    if (p) return p;
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

// ---- 角色介紹面板（ⓘ btnInfo / #infoPanel）----
// 顯示目前播放角色的官方檔案（LocalizeCharProfile）：頭貼、名稱、打招呼、
// 檔案欄位（生日/年齡/身高/學年/興趣/CV）、簡介、紀念大廳台詞（字幕表）。
// 台詞來源：voice_index（該 lobby 的語音檔清單）逐檔查 lobby_subtitle；
// 無字幕 = SFX，設計上就不列。
function lobbyLinesFor(lobbyKey) {
  const sch = SCHEDULE?.lobbies?.[lobbyKey] ?? SCHEDULE?.[lobbyKey];
  // voice_index 的 key 是 characterId（如 CH0184）；voiceFolder（JP_CH0184）僅用於 URL
  const files = (sch?.characterId && VOICE_INDEX?.[sch.characterId])
             || (sch?.voiceFolder && VOICE_INDEX?.[sch.voiceFolder.replace(/^(JP|KR)_/, '')])
             || null;
  if (!Array.isArray(files)) return [];
  const keyOf = (id) => {
    const m = id.match(/_memoriallobby_(\d+)(?:_(\d+))?$/);
    if (!m) return [1e9, 0];
    return [parseInt(m[1], 10), parseInt(m[2] || '0', 10)];
  };
  const out = [];
  for (const f of files) {
    const id = String(f).replace(/\.ogg$/i, '');
    const sub = subtitlePick(id);
    if (!sub?.text) continue;                     // SFX（含序幕音效 0_N）/ 空殼條目不列
    out.push({ id, no: keyOf(id), text: sub.text });
  }
  out.sort((a, b) => a.no[0] - b.no[0] || a.no[1] - b.no[1]);
  return out;
}

function infoProfileLang(profile) {
  // profile 欄位的語言偏好：跟隨介面語言，缺該語言時 fallback（cn→tw、kr→jp）
  const pref = [];
  if (langMode) pref.push(langMode);
  if (langMode === 'cn') pref.push('tw');
  if (langMode === 'kr') pref.push('jp');
  pref.push('jp', 'tw', 'en', 'kr');
  for (const k of pref) {
    if (profile?.[k]) return profile[k];
  }
  return null;
}

function renderInfoPanel() {
  if (!infoPanel) return;
  const name = currentLobby;
  if (!name) return;
  const rec = studentForLobby(name);
  const displayName = (rec && rec[langField(langMode)]) || prettyName(name);
  infoName.textContent = displayName;
  infoSub.textContent = 'MEMORIAL LOBBY';
  // 頭貼（與側欄同源：icon_index.json → assets/students/）
  const core = (SCHEDULE?.lobbies?.[name]?.characterId
             ?? SCHEDULE?.[name]?.characterId)?.toLowerCase();
  let g = name.toLowerCase(), prev;
  while (g !== prev) {
    prev = g;
    for (const suf of ['_home_gl', '_home', '_gl', '_teen', '_multi']) {
      if (g.endsWith(suf)) { g = g.slice(0, -suf.length); break; }
    }
    if (g.length > 5 && g.startsWith('lobby')) g = g.slice(5);
  }
  const ico = STUDENT_ICONS[costumeIconKey(name)] || STUDENT_ICONS[core] || STUDENT_ICONS[g] || STUDENT_ICONS[g.replace(/_[a-z0-9]+$/, '')] || STUDENT_ICONS[g.replace(/[0-9]+$/, '')];
  if (ico) { infoIcon.src = assetUrl(`assets/students/${ico}`); infoIcon.style.display = ''; }
  else infoIcon.style.display = 'none';

  const p = profileForLobby(name);
  // 打招呼
  const status = infoProfileLang(p?.statusMessage);
  infoStatus.textContent = status ? `「${status.replace(/^「|」$/g, '')}」` : '';
  // 檔案欄位（生日/年齡/身高/學年/興趣/CV）
  infoMeta.innerHTML = '';
  const addRow = (label, value) => {
    if (!value) return;
    const div = document.createElement('div');
    div.className = 'row';
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = t(label);
    div.appendChild(k);
    div.appendChild(document.createTextNode(value));
    infoMeta.appendChild(div);
  };
  if (p) {
    addRow('info.birthday', infoProfileLang(p.birthday));
    addRow('info.age', infoProfileLang(p.age));
    addRow('info.height', infoProfileLang(p.height));
    addRow('info.schoolYear', infoProfileLang(p.schoolYear));
    addRow('info.hobby', infoProfileLang(p.hobby));
    addRow('info.cv', p.characterVoice?.jp || null);
  }
  // 簡介
  infoIntro.textContent = infoProfileLang(p?.introduction) || '';
  // 紀念大廳台詞
  infoLines.innerHTML = '';
  const lines = lobbyLinesFor(name);
  if (!lines.length) {
    const empty = document.createElement('div');
    empty.className = 'info-empty';
    empty.textContent = t('info.noLines');
    infoLines.appendChild(empty);
  } else {
    lines.forEach((ln, i) => {
      const div = document.createElement('div');
      div.className = 'line';
      const no = document.createElement('span');
      no.className = 'no';
      no.textContent = String(i + 1).padStart(2, '0');
      div.appendChild(no);
      div.appendChild(document.createTextNode(ln.text));
      infoLines.appendChild(div);
    });
  }
}

function toggleInfoPanel(force) {
  const on = force !== undefined ? force : !infoPanel.classList.contains('open');
  if (on) renderInfoPanel();
  infoPanel.classList.toggle('open', on);
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

const PIN_SVG_OUTLINE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 10.2C19 15 12 21 12 21S5 15 5 10.2a7 7 0 0 1 14 0z"/><circle cx="12" cy="10.2" r="2.6"/></svg>';
const PIN_SVG_FILLED  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 10.2C19 15 12 21 12 21S5 15 5 10.2a7 7 0 0 1 14 0z" fill="currentColor" stroke="none"/><circle cx="12" cy="10.2" r="2.6"/></svg>';

const PIN_KEY = 'ba_pinned';
function readPins() {
  try { return new Set(JSON.parse(localStorage.getItem(PIN_KEY) || '[]')); } catch { return new Set(); }
}
function writePins(set) {
  try { localStorage.setItem(PIN_KEY, JSON.stringify([...set])); } catch {}
}
function togglePin(core) {
  const s = readPins();
  if (s.has(core)) s.delete(core); else s.add(core);
  writePins(s);
  if (sidePanel.classList.contains('open')) renderSidebar();
}

// 日服限定（僅日文語音）判斷：看最新版 manifest 有沒有該角色的韓文語音包
// （voice/KR_<Core>，manifest key 保留原始大小寫、sidebar core 為小寫 → 忽略大小寫）。
// 解析前/未知 → 視為有（不隱藏）。
function groupHasKrVoice(core) {
  const p = _assetInfo?.packages;
  if (!p) return true;
  const low = core.toLowerCase();
  return Object.keys(p).some(k => k.length > 9 && k.startsWith('voice/KR_') && k.slice(9).toLowerCase() === low);
}

function renderSidebar() {
  const q = sbSearch.value.trim().toLowerCase();
  const showJpOnly = settingsPref('ba_jpOnly', true);
  const pinned = readPins();
  sbList.innerHTML = '';
  let shown = 0;

  const renderGroup = (g) => {
    const nameMatch = !q || g.display.toLowerCase().includes(q)
      || (g.rec && SIDEBAR_FIELDS.some(f => g.rec[f] && g.rec[f].toLowerCase().includes(q)));
    const kids = nameMatch
      ? g.children
      : g.children.filter(c => c.key.toLowerCase().includes(q) || variantText(g, c).toLowerCase().includes(q));
    for (const c of kids) {
      const b = document.createElement('button');
      b.className = 'sb-item';
      b.dataset.key = c.key;
      const ico = STUDENT_ICONS[costumeIconKey(c.key) || c.info.core] || STUDENT_ICONS[c.info.core];
      if (ico) {
        const img = document.createElement('img');
        img.className = 'sb-ico';
        img.src = assetUrl(`assets/students/${ico}`);
        img.alt = '';
        b.appendChild(img);
      }
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = variantText(g, c);
      b.appendChild(name);
      const isPin = pinned.has(g.core);
      const pin = document.createElement('span');
      pin.className = 'sb-pin' + (isPin ? ' is-pin' : '');
      pin.title = t('sidebar.pinned');
      pin.innerHTML = isPin ? PIN_SVG_FILLED : PIN_SVG_OUTLINE;
      pin.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        togglePin(g.core);
      });
      b.appendChild(pin);
      if (c.key === currentLobby) b.classList.add('cur');
      sbList.appendChild(b);
      shown++;
    }
  };

  const groups = [];
  for (const g of buildSidebarGroups()) {
    if (!groupMatches(g, q)) continue;
    if (!showJpOnly && !groupHasKrVoice(g.core)) continue;   // 日服限定過濾
    groups.push(g);
  }
  const pinnedGroups = groups.filter(g => pinned.has(g.core));
  const restGroups = groups.filter(g => !pinned.has(g.core));

  if (pinnedGroups.length) {
    const h = document.createElement('div');
    h.className = 'sb-group-head pinned-head';
    h.textContent = `${t('sidebar.pinned')} (${pinnedGroups.length})`;
    sbList.appendChild(h);
    for (const g of pinnedGroups) renderGroup(g);
  }
  if (pinnedGroups.length && restGroups.length) {
    const h = document.createElement('div');
    h.className = 'sb-group-head';
    h.textContent = t('sidebar.others');
    sbList.appendChild(h);
  }
  for (const g of restGroups) renderGroup(g);
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

// ==================== BA 後製色調還原（各 lobby 的 Volume 資料復刻） ====================
// 資料來源：spinelobbies-<lobby>-_mxdependency-assets-* bundle 內的
// ColorAdjustments / LiftGammaGain / DepthOfField / PaniniProjection / ChromaticAberration。
// 以單一 full-screen Filter 附加到 app.stage，模擬 URP：sRGB→linear→exposure→gain/lift→(選用 tone)→gamma→contrast/saturation。
const POST_VERT = `
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
vec4 filterVertexPosition( void ) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}
vec2 filterTextureCoord( void ) {
  return aPosition * (uOutputFrame.zw * uInputSize.zw);
}
void main(void) {
  gl_Position = filterVertexPosition();
  vTextureCoord = filterTextureCoord();
}
`;
const POST_FRAG = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uOn;
uniform float uExp;
uniform float uCon;
uniform float uSat;
uniform float uChroma;
uniform vec3 uGain;
uniform vec3 uLift;
uniform vec3 uGam;
uniform vec3 uCF;
uniform vec4 uPanini;
const float MIDGRAY = 0.4135884;
float srgb2lin(float c) { return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }
float lin2srgb(float c) { return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055; }
float log10f(float x) { return log(x) / 2.302585093; }
// URP PaniniProjection.shader — Panini_Generic（d>0 時）；座標空間：uv→view(ndc*viewExtents*scale)→cyl→回 uv
vec2 paniniUv(vec2 uv) {
  float d = uPanini.z;
  if (d <= 0.001) return uv;
  vec2 vp = (2.0 * uv - 1.0) * uPanini.xy * uPanini.w;
  float viewDist = 1.0 + d;
  float hypSq = vp.x * vp.x + viewDist * viewDist;
  float isectD = vp.x * d;
  float disc = max(hypSq - isectD * isectD, 0.0);
  float cylDistMinusD = (-isectD * vp.x + viewDist * sqrt(disc)) / hypSq;
  float cylDist = cylDistMinusD + d;
  vec2 cylPos = vp * (cylDist / viewDist);
  return (cylPos / (cylDist - d)) / uPanini.xy * 0.5 + 0.5;
}
// URP UberPost — ChromaticAberration（3 sample，r@uv / g@uv+d / b@uv+2d）
vec3 sampleWarp(vec2 uv) {
  vec2 c2 = 2.0 * uv - 1.0;
  vec2 end = uv - c2 * dot(c2, c2) * uChroma;
  vec2 delta = (end - uv) / 3.0;
  float r = texture(uTexture, paniniUv(uv)).r;
  float g = texture(uTexture, paniniUv(delta + uv)).g;
  float b = texture(uTexture, paniniUv(delta * 2.0 + uv)).b;
  return vec3(r, g, b);
}
void main() {
  vec4 c = texture(uTexture, vTextureCoord);
  if (uOn <= 0.5 || c.a <= 0.003) { finalColor = c; return; }
  vec3 rgb = sampleWarp(vTextureCoord);
  // === URP LutBuilderHdr（HDR grading）+ UberPost 等價管線 ===
  vec3 lin = vec3(srgb2lin(max(rgb.r, 0.0)), srgb2lin(max(rgb.g, 0.0)), srgb2lin(max(rgb.b, 0.0)));
  // uber：input *= postExposure（線性）；LUT 索引前 saturate(LinearToLogC(input))
  lin *= uExp;
  vec3 lg = vec3(0.241514 * log10f(max(5.555556 * lin.r, 1e-6)) + 0.584878,
                 0.241514 * log10f(max(5.555556 * lin.g, 1e-6)) + 0.584878,
                 0.241514 * log10f(max(5.555556 * lin.b, 1e-6)) + 0.584878);
  lg = clamp(lg, 0.0, 1.0);
  // LUT builder：contrast（LogC 空間）
  lg = (lg - MIDGRAY) * uCon + MIDGRAY;
  lin = vec3((pow(10.0, (lg.r - 0.584878) / 0.241514) - 0.047995) / 5.555556,
             (pow(10.0, (lg.g - 0.584878) / 0.241514) - 0.047995) / 5.555556,
             (pow(10.0, (lg.b - 0.584878) / 0.241514) - 0.047995) / 5.555556);
  // LUT builder：colorFilter → max(0) → Lift/Gamma/Gain → saturation
  lin *= uCF;
  lin = max(lin, 0.0);
  lin = lin * uGain + uLift;
  lin = sign(lin) * pow(abs(lin), uGam);
  float luma = dot(lin, vec3(0.2126, 0.7152, 0.0722));
  lin = vec3(luma) + uSat * (lin - vec3(luma));
  // uber：LinearToSRGB 輸出
  vec3 outc = vec3(lin2srgb(clamp(lin.r, 0.0, 1.0)), lin2srgb(clamp(lin.g, 0.0, 1.0)), lin2srgb(clamp(lin.b, 0.0, 1.0)));
  finalColor = vec4(outc * c.a, c.a);
}
`;
let baPostFilter = null;
let postWrap = null;
// pixi v8 的 RenderGroup 忽略 root stage 上的 filter（實測 built-in 亦無作用），
// 故把動態場景全部掛到 stage 下的 wrapper，filter 綁在 wrapper 上。
function ensurePostWrap() {
  if (!postWrap) { postWrap = new Container(); postWrap.name = 'postWrap'; app.stage.addChild(postWrap); }
  for (const c of [...app.stage.children]) {
    if (c === postWrap) continue;
    app.stage.removeChild(c);
    postWrap.addChild(c);
  }
  return postWrap;
}
function ensurePostFilter() {
  if (baPostFilter) return baPostFilter;
  try {
    const baPostUniforms = new UniformGroup({
      uOn: { value: 0, type: 'f32' },
      uExp: { value: 1, type: 'f32' },
      uCon: { value: 1, type: 'f32' },
      uSat: { value: 1, type: 'f32' },
      uChroma: { value: 0, type: 'f32' },
      uGain: { value: [1, 1, 1], type: 'vec3<f32>' },
      uLift: { value: [0, 0, 0], type: 'vec3<f32>' },
      uGam: { value: [1, 1, 1], type: 'vec3<f32>' },
      uCF: { value: [1, 1, 1], type: 'vec3<f32>' },
      uPanini: { value: [1.1547, 0.57735, 0, 1], type: 'vec4<f32>' },
    });
    baPostFilter = new Filter({
      glProgram: GlProgram.from({ vertex: POST_VERT, fragment: POST_FRAG }),
      resources: { baPostUniforms },
    });
    baPostFilter._uniforms = baPostUniforms;
  } catch (e) { baPostFilter = null; log('post filter 初始化失敗: ' + e.message); }
  return baPostFilter;
}

const POST_CONFIG = {};
let POST_CONFIG_LOAD = null;
function loadPostConfig() {
  if (POST_CONFIG_LOAD) return POST_CONFIG_LOAD;
  if (globalThis.__BA_TEST_CFG) Object.assign(POST_CONFIG, globalThis.__BA_TEST_CFG);
  POST_CONFIG_LOAD = (async () => {
    try { Object.assign(POST_CONFIG, await (await fetch(assetUrl('assets/data/lobby_post_config.json'))).json()); }
    catch (e) { log('[post] config 載入失敗: ' + e.message); }
  })();
  return POST_CONFIG_LOAD;
}
let baPostOn = false;
try { baPostOn = localStorage.getItem('ba_post') === '1'; } catch {}
// mild = 跳過 exposure（官方 5.5EV 是補償遊戲內更暗的客製 shader；我們的 unlit 重現直接套會爆白）
// faithful = 完整照官方數值。panini/chroma/LGG 兩種模式都套。
let POST_MODE = 'mild';
try { POST_MODE = localStorage.getItem('ba_post_mode') === 'faithful' ? 'faithful' : 'mild'; } catch {}
const baPostCfgFor = (lobby) => POST_CONFIG[(lobby || '').toLowerCase()] || null;
// URP Panini：viewExtents = (aspect*tan(fov/2), tan(fov/2))；fov 遊戲端未知，假設 60
function postPaniniParams(cfg) {
  const d = cfg.p ? cfg.p[0] : 0;
  const crop = cfg.p ? (cfg.p.length > 1 ? cfg.p[1] : 1) : 0;
  const tanH = Math.tan(60 * Math.PI / 360);
  const aspect = app.renderer.width / Math.max(1, app.renderer.height);
  const vex = [aspect * tanH, tanH];
  let scaleF = 1;
  if (d > 0) {
    const fit = (v) => { const hyp = Math.sqrt(v * v + 1); const cd = 1 / hyp + d; return (1 / hyp) * ((1 + d) / cd); };
    scaleF = Math.min(fit(vex[0]), fit(vex[1]));
  }
  const s = 1 + (scaleF - 1) * crop;
  return [vex[0], vex[1], d, s];
}
function applyPostGrade(lobby) {
  if (!ensurePostFilter()) return null;
  const cfg = baPostOn ? baPostCfgFor(lobby) : null;
  const w = ensurePostWrap();
  if (!cfg) { w.filters = []; return null; }
  const u = baPostFilter.resources.baPostUniforms.uniforms;
  u.uOn = 1;
  u.uExp = POST_MODE === 'mild' ? 1 : (cfg.e ?? 1);
  u.uCon = cfg.c ?? 1;
  u.uSat = cfg.s ?? 1;
  u.uChroma = cfg.ch ?? 0;
  u.uGain = cfg.g || [1, 1, 1];
  u.uLift = cfg.l || [0, 0, 0];
  u.uGam = cfg.gm || [1, 1, 1];
  u.uCF = cfg.cf || [1, 1, 1];
  u.uPanini = postPaniniParams(cfg);
  baPostFilter.resources.baPostUniforms.update();
  w.filters = [baPostFilter];
  return { lobby, mode: POST_MODE };
}
// CPU 對照版：與 shader 完全同序（空間效果 chroma/panini 不在內，驗證時 config 需拿掉 ch/p）
function baPostCpu(rgb, cfg) {
  const G2L = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const L2G = c => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  const MID = 0.4135884;
  const e = POST_MODE === 'mild' ? 1 : (cfg.e ?? 1);
  let lin = rgb.map(v => G2L(Math.max(v, 0)));
  lin = lin.map(v => v * e);
  let lg = lin.map(v => 0.241514 * Math.log10(Math.max(5.555556 * v, 1e-6)) + 0.584878);
  lg = lg.map(v => Math.min(Math.max(v, 0), 1));
  lg = lg.map(v => (v - MID) * (cfg.c ?? 1) + MID);
  lin = lg.map(v => (Math.pow(10, (v - 0.584878) / 0.241514) - 0.047995) / 5.555556);
  const cf = cfg.cf || [1, 1, 1];
  lin = lin.map((v, i) => v * cf[i]);
  lin = lin.map(v => Math.max(v, 0));
  const gain = cfg.g || [1, 1, 1], lift = cfg.l || [0, 0, 0], gam = cfg.gm || [1, 1, 1];
  lin = lin.map((v, i) => v * gain[i] + lift[i]);
  lin = lin.map((v, i) => Math.sign(v) * Math.pow(Math.abs(v), gam[i]));
  const luma = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  const sat = cfg.s ?? 1;
  lin = lin.map(v => luma + sat * (v - luma));
  return lin.map(v => Math.round(L2G(Math.min(Math.max(v, 0), 1)) * 255));
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
      fixAdditiveSlots(obj);
      obj.skelName = (res.skel.startsWith('./') ? res.skel.slice(2) : res.skel).replace(/\.(skel|json)$/i, '').toLowerCase();
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
  // 額外 skeleton（timeline 非本體骨架，如 CH0184_00 / Shigure_00）位於 spine/<lobby>/<skel>/
  const spineCacheKeys = [];
  const mainSkel = entry.skel ? entry.skel.replace(/^\.\//, '').replace(/\.(skel|json)$/i, '').split('/').pop().toLowerCase() : '';
  const tl = TIMELINES?.[lobbyName] ?? TIMELINES?.[String(lobbyName).toLowerCase()];
  if (tl?.tracks) {
    const extraSkel = [...new Set(tl.tracks.map(t => (t.skeleton || '').toLowerCase()).filter(s => s && s !== mainSkel))];
    for (const sk of extraSkel) {
      const base = `assets/spine/${lobbyName}/${sk}/`;
      const skUrl = assetUrl(`${base}${sk}.skel`);
      const atUrl = assetUrl(`${base}${sk}.atlas`);
      push(sk, `${base}`);
      try { Assets.unload(skUrl); } catch {}
      try { Assets.unload(atUrl); } catch {}
      spineCacheKeys.push(`${skUrl}-${atUrl}-1`);
    }
  }
  for (const u of urls) { try { Assets.unload(u); } catch {} }
  // 清除 Spine.from 的全域 skeletonData cache：Assets.unload 會銷毀 atlas texture，
  // 但 Spine.from 的 Cache（key = `${skeleton}-${atlas}-${scale}`）仍保留舊 skeletonData，
  // 下次載入同一角色會復用已銷毀 texture 的 attachment，導致 render 每幀拋錯。
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
  for (const ex of extras) {
    for (const t of collectTextures(ex)) oldTextures.add(t);
    ex.destroy();
  }
  extras = [];
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
    fixAdditiveSlots(spine);
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
  setAnimationWithClipMix(0, idleClip, true);
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
  if (infoPanel?.classList.contains('open')) renderInfoPanel();
  subNameEl.textContent = 'MEMORIAL LOBBY';
  scheduleAutonomy();
  loadingEl.classList.remove('show');
  fadeOut();
  try { await loadPostConfig(); } catch (e) {}
  applyPostGrade(name);
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

// 臉頰（Touch_Point 骨）區：骨架自帶 Touch_Point_Key_press / Touch_Point_Rot_press
// 按壓 keyframe（例：CH0347），即「特別反應」的嵌入點——Pinch/Touch/HandFollow 按
// 住該區播放，頭區維持 Pat/Pat2 摸頭。
let faceAnchorBone = null;
const FACE_PAT_RADIUS = 85;    // spine units around the Touch_Point cheek anchor
const FACE_GESTURE = { pinch: 'Pinch', touch: 'Touch', handfollow: 'HandFollow' };
function faceBone() {
  if (faceAnchorBone) return faceAnchorBone;
  if (!spine) return null;
  faceAnchorBone =
    spine.skeleton.findBone('Touch_Point') ||
    spine.skeleton.findBone('Touch_Eye') ||
    null;
  return faceAnchorBone;
}
// 該 lobby 是否擁有某特別手勢（依實際 clip 名稱判斷，相容舊 lobby）。
function ownsFaceGesture(mode) {
  const base = FACE_GESTURE[mode];
  if (!base) return false;
  return animNames().some(n => n.startsWith(base + '_'));
}
function isFaceRegion(sx, sy) {
  const b = faceBone();
  if (!b) return false;
  const g = spine.toGlobal({ x: b.worldX, y: b.worldY });
  const r = FACE_PAT_RADIUS * spine.scale.x;
  return Math.hypot(sx - g.x, sy - g.y) <= r;
}

// 按住區路由：臉頰→特別手勢（Pinch/Touch/HandFollow），頭→Pat/Pat2，其餘→Look。
// 特別 lobby 在臉頰區保留特別反應，頭區仍可撫摸（Pat/Pat2 交替）。
function gestureForHold(sx, sy) {
  if (interactionMode && ownsFaceGesture(interactionMode) && isFaceRegion(sx, sy)) {
    return interactionMode;
  }
  if (isHeadRegion(sx, sy)) return 'head';
  return 'look';
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
      // Hold gesture: cheek → the lobby's special Pinch/Touch/HandFollow when it
      // owns one, head → Pat (or Pat2 alternate), anywhere else → Look.
      const g = gestureForHold(e.clientX, e.clientY);
      if (g === 'pinch') startPinch();
      else if (g === 'touch') startTouch();
      else if (g === 'handfollow') startHandFollow();
      else if (g === 'head') startPat();
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
      // HandFollow owns any drag (hand chases the finger anywhere) — the wiki's
      //特有手札 lesson: 掻きむしり/手に乗せる follow the finger; Pinch/Touch own
      // only the cheek (Touch_Point) gesture, head keeps Pat, rest is Look.
      if (interactionMode === 'handfollow' && has('HandFollow_01_M')) { startHandFollow(); }
      else {
        const g = gestureForHold(downPos.x, downPos.y);
        if (g === 'pinch') startPinch();
        else if (g === 'touch') startTouch();
        else if (g === 'head') startPat();
        else startLook();
      }
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
      if (interactionMode === 'touch' && isFaceRegion(e.clientX, e.clientY)) startTouch();
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
function tryStartIntroAudio() {
  if (_introAudio) return Promise.resolve(true);
  try {
    return Promise.resolve(window.ba?.introMedia?.()).then((media) => {
      if (!media?.audio || _introAudio) return false;
      const a = new Audio(media.audio);
      a.loop = true;
      _introAudio = a;
      // Web 自動播放政策：無手勢時 play() 會被拒（rejected）——呼叫端在
      // 手勢後重試；此處只靜默吞錯。
      return a.play().then(() => true, () => { _introAudio = null; return false; });
    }).catch(() => false);
  } catch { return Promise.resolve(false); }
}
function startIntroAudioEarly() {
  // fire-and-forget：任何失敗都靜默（web 首訪 intro 包未裝 → introMedia 為 null；
  // 無手勢自動播放被擋 → 等 unlockIntroAudioOnGesture 重試）
  tryStartIntroAudio();
}
// Web：第一個用戶手勢（點擊/按鍵）解鎖音訊——開機更新檢查期間點一下就有音樂，
// 不用等到 TAP TO START。Electron 預設允許自動播放，此監聽無害。
function unlockIntroAudioOnGesture() {
  const onGesture = () => {
    tryStartIntroAudio().then((ok) => {
      if (ok) {
        window.removeEventListener('pointerdown', onGesture);
        window.removeEventListener('keydown', onGesture);
      }
    });
  };
  window.addEventListener('pointerdown', onGesture);
  window.addEventListener('keydown', onGesture);
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
    // 音軌已由 startIntroAudioEarly()/手勢解鎖提前起播；此處只在尚未起播時補播
    // （TAP 本身就是手勢，這裡播一定成功）
    try { await tryStartIntroAudio(); } catch {}
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(guard);
      document.removeEventListener('keydown', onKey);
      // TAP 後不掐 intro 音軌：讓它續播進大廳，由標題 BGM 接手時停掉
      // （playTitleBgm 會 pause _introAudio；靜音設定時亦然）——Web 版否則永遠聽不到。
      fadeOutLoadingScreen();
      resolve();
    };
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish(); }
    };
    if (indicator) indicator.style.display = 'none';
    if (tts) tts.style.display = 'block';
    // 標題畫面出現：隨機播放一位學生的「ブルーアーカイブ！」開場喊聲
    // （遊戲同款時機；語音位於 core 包 voice_title/，此時必已下載）
    try {
      if (TITLE_VOICES) {
        const folders = Object.keys(TITLE_VOICES);
        const folder = folders[Math.floor(Math.random() * folders.length)];
        const files = TITLE_VOICES[folder] || [];
        const file = files[Math.floor(Math.random() * files.length)];
        if (folder && file) {
          const shout = new Audio(assetUrl(`assets/voice_title/${folder}/${file}`));
          shout.volume = 1.0;
          shout.play().catch(() => {});
        }
      }
    } catch {}
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
  // 作用域內註冊、用完即刪（之前每次進大廳註冊一個不清，之後任何下載
  // 都會彈出中央遮罩擋住畫面）
  const onLobbyProgress = (p) => {
    showLoading(t('dl.lobbyDl', { pkg: p.package, i: p.index + 1, n: p.total, pct: p.percent || 0 }));
  };
  window.ba.onDownloadProgress?.(onLobbyProgress);
  try {
    const res = await window.ba.ensureLobby({
      lobby: lobbyName,
      version: _assetInfo.remoteVersion,
      packages: _assetInfo.packages,
      lobbies: _assetInfo.lobbies,
      voice: voiceLang,
    });
    if (res && !res.cached && res.results) {
      const failed = res.results.filter(r => !r.ok);
      if (failed.length) console.warn('[lobby] 部分資源下載失敗', failed);
    }
  } catch (e) {
    console.warn('[lobby] ensureLobby 失敗:', e.message);
  } finally {
    try { window.ba.offDownloadProgress?.(onLobbyProgress); } catch {}
    if (shown) { loading.classList.remove('show'); if (loadingText) loadingText.textContent = t('loading.loading'); }
  }
}

async function showAssetDownload(assetInfo) {
  const downloadPanel = document.getElementById('downloadPanel');
  const status = document.getElementById('assetStatus');
  const progress = document.getElementById('assetProgress');
  const fill = document.getElementById('assetProgressFill');
  const pctText = document.getElementById('assetProgressText');
  const detail = document.getElementById('assetDetail');
  const btn = document.getElementById('assetBtn');
  const choiceRow = document.getElementById('bootChoiceRow');
  const btnFull = document.getElementById('assetBtnFull');
  const btnQuick = document.getElementById('assetBtnQuick');

  downloadPanel.style.display = 'block';
  progress.style.display = 'none';
  btn.style.display = 'none';
  if (choiceRow) choiceRow.style.display = 'none';

  const isIncremental = assetInfo.schema === 2 && assetInfo.needsDownloadPacks;
  const packsToShow = isIncremental
    ? assetInfo.needsDownloadPacks.map(k => assetInfo.packages[k]).filter(Boolean)
    : (assetInfo.packages ? Object.values(assetInfo.packages) : []);
  const namesToShow = isIncremental ? assetInfo.needsDownloadPacks : (assetInfo.packages ? Object.keys(assetInfo.packages) : []);

  const totalBytes = packsToShow.reduce((s, p) => s + (p.size || 0), 0);
  // 先進大廳：只抓 core＋intro（與串流定義一致）
  const quickNames = namesToShow.filter((k) => k === 'core' || k === 'intro');
  const quickBytes = quickNames.reduce((s, k) => s + (assetInfo.packages?.[k]?.size || 0), 0);

  const updateDetail = () => {
    if (isIncremental) {
      if (namesToShow.length === 0) {
        status.textContent = t('dl.upToDate');
        detail.textContent = t('dl.allLatest', { n: Object.keys(assetInfo.packages).length });
      } else {
        detail.textContent = t('dl.pending', { n: namesToShow.length, gb: (totalBytes / 1073741824).toFixed(1), note: '' })
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
  } else {
    status.textContent = t('dl.upToDate');
    btn.style.display = 'none';
    await new Promise(r => setTimeout(r, 1200));
    downloadPanel.style.display = 'none';
    return;
  }

  // 二選一：按鈕上寫明後果（大小），不再有 checkbox＋開始鈕兩段式
  if (btnFull) btnFull.textContent = t('dl.fullInstall', { size: fmtBytes(totalBytes) });
  if (btnQuick) btnQuick.textContent = t('dl.quickStart', { size: fmtBytes(quickBytes) });
  if (choiceRow) choiceRow.style.display = 'flex';
  btn.style.display = 'none';

  return new Promise((resolve) => {
    const runDownload = async (streaming) => {
      if (choiceRow) choiceRow.style.display = 'none';
      btn.style.display = 'none';
      progress.style.display = 'block';
      fill.style.width = '0%';
      pctText.textContent = '0%';
      try { await window.ba?.setStreamingMode?.(streaming); } catch {}

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
      // 先進大廳：只抓 core＋intro；完整安裝：全抓
      const pkgs = streaming
        ? Object.fromEntries(quickNames.map((k) => [k, assetInfo.packages[k]]).filter(([, v]) => v))
        : assetInfo.packages;
      const results = await window.ba.downloadAssets({ version, packages: pkgs, voice: voiceLang });

      // 有包失敗（如 release 缺檔 404）：顯示錯誤並保留面板讓使用者重試，
      // 不關閉面板、不 resolve（避免半套資源被當成安裝完成）。
      if (Array.isArray(results) && results.some(r => !r.ok)) {
        const failed = results.filter(r => !r.ok);
        status.textContent = t('dl.failed');
        detail.textContent = t('dl.failedDetail', { n: failed.length, err: failed[0]?.error || '' });
        btn.textContent = t('dl.retry');
        btn.style.display = 'inline-block';
        progress.style.display = 'none';
        btn.onclick = () => runDownload(streaming);
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
    if (btnFull) btnFull.onclick = () => runDownload(false);
    if (btnQuick) btnQuick.onclick = () => runDownload(true);
    btn.onclick = () => runDownload(false);
  });
}

// Boot 官方素材（title.webm / spinner.png / font.otf）在 vite build 時已被
// 拷進 dist/assets/（靜態檔案），首屏通常正常載入。若首屏載入失敗（舊版部署
// 或 edge case），在 core pack 就緒後由本函式補救。
async function applyBootAssets() {
  const url = (p) => assetUrl(p);
  const v = document.getElementById('loadingVideo');
  // 影片：若首屏已正常播放或快取有，不動；只在 error 時重試
  if (v && v.error) {
    const src = v.querySelector('source');
    if (src) src.remove();
    v.removeAttribute('src');
    v.src = url('assets/loading/title.webm');
    try { v.load(); } catch {}
  }
  // Spinner：通常首屏已載入，不動
  // Boot 字體：@font-face 首屏若失敗，以 FontFace API 補註冊（只一次）
  try {
    if (!document.fonts.check('1em "BA Font"')) {
      const f = new FontFace('BA Font', `url("${url('assets/loading/font.otf')}")`);
      await f.load();
      document.fonts.add(f);
    }
  } catch { /* 靜默降級系統字體 */ }
}

// ---- ensureReady：唯一的資產 gate（下載 core，不 block intro） ----
async function ensureReady() {
  const bootText = document.getElementById('bootLoadingText');
  const showP = (p) => {
    if (!bootText) return;
    if (p.status === 'downloading') {
      bootText.textContent = t('dl.downloading', { pkg: p.package, i: 1, n: 1 });
    } else if (p.status === 'extracting') {
      bootText.textContent = t('dl.extracting', { pkg: p.package });
    } else if (p.status === 'done') {
      bootText.textContent = t('dl.packDone', { pkg: p.package });
    }
  };

  if (/(?:^|&)skipUpdate=1/.test(location.search + location.hash)) return;

  // 新 API：ba-web.js ensureAssets（web 版；intro 4MB 順便裝，否則首訪無開場音樂）
  if (window.ba?.ensureAssets) {
    try { await window.ba.ensureAssets(['core', 'intro'], showP); } catch (e) {
      console.warn('[lobby] ensureAssets failed:', e.message);
    }
  }
  // 舊 API fallback（Electron preload）
  else if (window.ba?.checkAssets) {
    try {
      const info = await Promise.race([
        window.ba.checkAssets(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('checkAssets timeout')), 10000)),
      ]);
      _assetInfo = info;
      if (info.needsDownload && info.needsDownloadPacks?.length) {
        if (info.streaming) {
          await window.ba.downloadAssets({ version: info.remoteVersion, packages: info.packages, onlyPacks: ['core'] });
        } else {
          await showAssetDownload(info);
        }
        try { _assetInfo = await window.ba.checkAssets(); } catch {}
      }
    } catch (e) {
      console.warn('[lobby] checkAssets failed/skipped:', e.message);
    }
  }
  // 確保 _assetInfo 有值（ensureLobbyAssets 會用到）
  if (!_assetInfo && window.ba?.checkAssets) {
    try { _assetInfo = await window.ba.checkAssets(); } catch {}
  }
}

// ---- loadBootData：core 就位後，併發載入所有 boot 資料 ----
async function loadBootData() {
  const settle = (p) => p.catch(() => null);
  const json = async (path) => {
    const r = await fetchRetry(path);
    return r.json();
  };
  const txt = async (path) => {
    const r = await fetchRetry(path);
    return r.text();
  };

  const [camera, idx, transforms, icons, chat, schedule, voiceIdx,
         timelines, clipMix, clipGraph, titleVoices, flash,
         bgmCsv, studentsCsv, subtitles, dialogTypes, postConfig, charProfiles] = await Promise.all([
    settle(json('assets/data/lobby_camera_config.json')),
    settle(json('assets/data/lobby_index.json').catch(() => json('assets/lobby_index.json'))),
    settle(json('assets/data/lobby_transforms.json')),
    settle(json('assets/students/icon_index.json')),
    settle(json('assets/data/lobby_chat_anchors.json')),
    settle(json('assets/data/lobby_voice_schedule.json')),
    settle(json('assets/data/voice_index.json')),
    settle(json('assets/data/lobby_timelines.json')),
    settle(json('assets/data/clip_intro_mix.json')),
    settle(json('assets/data/clip_graph.json')),
    settle(json('assets/data/title_voices.json')),
    settle(json('assets/data/flash_curves.json')),
    settle(txt('assets/data/lobby_bgm_mapping.csv')),
    settle(txt('assets/data/students_data.csv')),
    settle(json('assets/data/lobby_subtitle.json')),
    settle(json('assets/data/lobby_dialog_types.json')),
    settle(json('assets/data/lobby_post_config.json')),
    settle(json('assets/data/char_profiles.json')),
  ]);

  if (camera?.MaxScale != null) CAMERA.maxScale = camera.MaxScale;
  if (camera?.Weight != null) CAMERA.weight = camera.Weight;
  if (idx) { LOBBY_INDEX = idx; ORDER = Object.keys(idx); }
  LOBBY_TRANSFORMS = transforms;
  STUDENT_ICONS = icons || {};
  CHAT_ANCHORS = chat || {};
  SCHEDULE = schedule;
  VOICE_INDEX = voiceIdx || {};
  TIMELINES = timelines;
  CLIP_CONFIGS = clipMix || {};
  CLIP_GRAPH = clipGraph || {};
  TITLE_VOICES = titleVoices;
  FLASH_TABLE = flash ? normalizeFlashTable(flash) : null;
  SUBTITLES = subtitles || {};
  DIALOG_TYPES = dialogTypes || {};
  CHAR_PROFILES = charProfiles || null;
  if (postConfig) Object.assign(POST_CONFIG, postConfig);

  // BGM mapping（CSV → object）
  if (bgmCsv) {
    for (const line of bgmCsv.trim().split('\n').slice(1)) {
      const cols = line.split(',');
      if (cols.length < 5) continue;
      BGM_MAP[cols[1].trim() + '_home'] = cols[4].trim();
    }
  }
  // Students CSV → map（與 loadStudents 相同邏輯，但併入 batch）
  if (studentsCsv) {
    const rows = parseCSV(studentsCsv);
    if (rows.length) {
      const header = rows[0].map(h => h.trim());
      const map = {};
      for (let i = 1; i < rows.length; i++) {
        const rec = {};
        for (let j = 0; j < header.length; j++) rec[header[j]] = (rows[i][j] ?? '').trim();
        const key = (rec.file_id || '').toLowerCase();
        if (key && !map[key]) map[key] = rec;
      }
      STUDENTS = map;
    }
  }
  // POST query override
  try {
    let postVal = new URL(location.href).searchParams.get('POST');
    if (postVal === null) { const m = /(?:^|[?#])POST=([01])/.exec(location.hash); postVal = m ? m[1] : null; }
    if (postVal !== null) { baPostOn = postVal === '1'; try { localStorage.setItem('ba_post', baPostOn ? '1' : '0'); } catch {} }
  } catch {}
}

// ---- init：四個純粹的 stage ----
async function init() {
  // Stage 0：intro 音軌 fire-and-forget（首訪 intro 未裝 → 靜默）
  startIntroAudioEarly();
  // Web 自動播放需手勢解鎖：loading 期間點一下即有音樂
  unlockIntroAudioOnGesture();

  // Stage 1：i18n（Pages 靜態檔案，瞬間完成）
  await loadI18n();
  buildLangSegs();
  applyI18n();

  // Stage 2：ensureReady — 下載 core（唯一的 gate）
  await ensureReady();

  // Stage 3：補救 boot 素材（若首屏失敗）
  applyBootAssets();

  // Stage 4：Pixi 初始化
  await app.init({ resizeTo: window, antialias: true, backgroundColor: 0x05060d, autoDensity: true });
  const canvas = app.canvas;
  document.getElementById('app').appendChild(canvas);

  // Stage 5：字型 + ClickFx（core 已就位，一次到位）
  await loadGameFonts();
  try {
    if (settingsPref('ba_clickfx', true)) { initClickFx(); }
  } catch (e) {
    console.warn('[lobby] BAClickFX init failed:', e.message);
  }

  // Stage 6：boot data（一次 batch，各自 degrade）
  await loadBootData();

  // Stage 7：Tap To Start
  await showTapToStart();

  // camera smoothing
  app.ticker.add(() => {
    if (baPostOn) ensurePostWrap();
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
  btnCtlBgm.addEventListener('click', toggleBgm);
  // Skip button mirrors the game: UILobby.OnClickMemoryLobbySkip opens a
  // UIPopup_System confirm first; MemoryLobbySkip() runs only on OK.
  const skipConfirmEl = document.getElementById('skipConfirm');
  const openSkipConfirm = () => skipConfirmEl && skipConfirmEl.classList.add('show');
  const closeSkipConfirm = () => skipConfirmEl && skipConfirmEl.classList.remove('show');
  btnSkip.addEventListener('click', openSkipConfirm);
  // ---- 角色介紹面板（ⓘ）----
  btnInfo?.addEventListener('click', () => toggleInfoPanel());
  infoClose?.addEventListener('click', () => toggleInfoPanel(false));
  document.getElementById('skipYes')?.addEventListener('click', () => { closeSkipConfirm(); memoryLobbySkip(); });
  document.getElementById('skipNo')?.addEventListener('click', closeSkipConfirm);
  skipConfirmEl?.addEventListener('click', (e) => { if (e.target === skipConfirmEl) closeSkipConfirm(); });
  // ---- focus mode (cinema) ---- 側欄「專注模式」開關
  const toggleFocusMode = (on) => {
    if (on === undefined) on = !document.body.classList.contains('focusMode');
    document.body.classList.toggle('focusMode', on);
    btnCtlFocus?.classList.toggle('on', on);
    btnCtlFocus?.classList.toggle('off', !on);
    log('focus mode ' + (on ? 'on' : 'off'));
  };
  btnCtlFocus.addEventListener('click', () => toggleFocusMode());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('focusMode')) {
      toggleFocusMode(false);
      e.preventDefault();
    }
  });

  // ---- 電影燈光效果（#fx 電影暈影）開關，持久化 ----
  let vignetteOn = true;
  try { vignetteOn = localStorage.getItem('ba_vignette') !== '0'; } catch {}
  const syncVignetteUI = () => {
    fxEl.style.display = vignetteOn ? '' : 'none';
    btnCtlVignette?.classList.toggle('on', vignetteOn);
    btnCtlVignette?.classList.toggle('off', !vignetteOn);
  };
  btnCtlVignette?.addEventListener('click', () => {
    vignetteOn = !vignetteOn;
    try { localStorage.setItem('ba_vignette', vignetteOn ? '1' : '0'); } catch {}
    syncVignetteUI();
  });
  syncVignetteUI();

  // ---- settings panel ----
  btnCtlSettings.addEventListener('click', toggleSettingsPanel);
  setClose.addEventListener('click', toggleSettingsPanel);
  settingsBackdrop?.addEventListener('click', () => toggleSettingsPanel(false));
  document.getElementById('setTabBtnMain')?.addEventListener('click', () => switchSettingsTab(false));
  document.getElementById('setTabBtnAbout')?.addEventListener('click', () => switchSettingsTab(true));
  window.addEventListener('resize', () => {
    if (document.getElementById('setTabAbout')?.style.display !== 'none') fitSteamWidget();
  });
  // 直向小螢幕旋轉提示（點一下當次不再顯示）
  syncRotateHint();
  window.addEventListener('resize', syncRotateHint);
  window.addEventListener('orientationchange', syncRotateHint);
  document.getElementById('rotateHint')?.addEventListener('click', () => {
    _rotateDismissed = true; syncRotateHint();
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
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsPanel.classList.contains('open')) toggleSettingsPanel(false);
  });

  // ---- video export UI ----
  btnCtlExport.addEventListener('click', openExportPanel);
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
  if (setJpOnlyCk) setJpOnlyCk.addEventListener('change', () => {
    try { localStorage.setItem('ba_jpOnly', setJpOnlyCk.checked ? '1' : '0'); } catch {}
    if (sidePanel.classList.contains('open')) renderSidebar();
  });
  setModeSegs.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || b.classList.contains('on')) return;
    const streaming = b.dataset.m === 'streaming';
    try { await window.ba?.setStreamingMode?.(streaming); } catch {}
    await syncSettingsModeSegs();
    await refreshSettingsAssets();
    // 切到完整安裝＝立刻開始抓全部（否則按鈕看似沒反應）；先過儲存門檻。
    if (!streaming) {
      if (await ensureStorageForFull()) startSettingsDownload();
      else {
        // 空間不夠：退回串流，避免抓一半失敗更亂
        try { await window.ba?.setStreamingMode?.(true); } catch {}
        await syncSettingsModeSegs();
        await refreshSettingsAssets();
      }
    }
  });
// ---- 完整安裝門檻：鎖定儲存＋配額檢查 ----
function pendingBytes(info) {
  let bytes = 0;
  const packs = info?.packages || {};
  for (const k of info?.needsDownloadPacks || []) bytes += packs[k]?.size || 0;
  return bytes;
}
async function ensureStorageForFull() {
  const info = _settingsAssetInfo;
  try { await window.ba?.ensurePersistent?.(); } catch {}
  let persisted = false;
  try {
    persisted = await navigator.storage?.persisted?.() ?? true;
  } catch { persisted = true; }
  if (!persisted) {
    setAssetsStatus.innerHTML += `<br><span class="warn">⚠ ${t('set.persistWarn')}</span>`;
  }
  let quota = { usage: 0, quota: 0 };
  try { quota = await window.ba?.quotaInfo?.() || quota; } catch {}
  renderStorageLine(quota);
  const need = pendingBytes(info);
  const free = (quota.quota || 0) - (quota.usage || 0);
  if (quota.quota > 0 && need > free) {
    setAssetsStatus.innerHTML += `<br><span class="warn">⚠ ${t('set.quotaLow', { need: fmtBytes(need), free: fmtBytes(Math.max(0, free)) })}</span>`;
    return false;
  }
  return true;
}
function renderStorageLine(quota) {
  let el = document.getElementById('setStorageLine');
  if (!el) {
    el = document.createElement('div');
    el.id = 'setStorageLine';
    el.style.cssText = 'font-size:12px; color:#c6d2f5; margin-top:6px;';
    setAssetsStatus.after(el);
  }
  if (quota?.quota > 0) {
    el.textContent = t('set.storage', { used: fmtBytes(quota.usage || 0), quota: fmtBytes(quota.quota) });
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}
  setDownloadBtn.addEventListener('click', startSettingsDownload);
  // 雙進度條狀態：本包％＋總量％（總量按 manifest 標稱大小加權）
  // 全域下載進度（註冊一次；模式切換觸發的下載也經這裡顯示）
  try {
    window.ba?.onDownloadProgress?.((p) => {
      if (!p) return;
      if (p.status === 'downloading') {
        setAssetsProgress.style.display = 'block';
        const pct = p.percent != null ? `${p.percent}%`
          : p.received != null ? `${(p.received / 1048576).toFixed(0)}MB` : '…';
        setProgressText.textContent = `${p.package} (${(p.index ?? 0) + 1}/${p.total ?? '?'}) — ${pct}`;
        if (p.percent != null) setProgressFill.style.width = p.percent + '%';
        updateTotalProgress(p.package, p.percent ?? 0);
      } else if (p.status === 'done') {
        setProgressFill.style.width = '100%';
        if (p.package) {
          _dlTotal.done += packSizeOf(p.package);
          updateTotalProgress(p.package, 0);
        }
      } else if (p.status === 'error') {
        setAssetsProgress.style.display = 'block';
        setProgressText.textContent = `⚠ ${p.error}`;
      }
    });
  } catch {}

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
    btnCtlFull.classList.toggle('is-full', on);
    btnCtlFull.querySelector('.tt').textContent = ctlText(on ? 'fullExit' : 'full');
    btnCtlFull.title = ctlText(on ? 'fullExit' : 'full');
    btnCtlFull.classList.toggle('off', false);
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      document.documentElement.requestFullscreen?.();
    }
  };
  btnCtlFull.addEventListener('click', toggleFullscreen);
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
  applyCtlI18n();
  syncVoiceLangSegs();

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
      ctlLabels: ['bgm', 'focus', 'vignette', 'voiceJp'].map(k => `${k}:${ctlText(k)}`).join(', '),
      skipTitle: t('skip.title'),
      skipOk: document.getElementById('skipYes')?.textContent,
      jpOnlyCk: document.getElementById('setJpOnlyCk')?.checked,
      postOn: baPostOn, postCfg: baPostCfgFor(currentLobby)?.ca?.postExposure ?? null,
      krPacks: Object.keys(_assetInfo?.packages ?? {}).filter(k => k.startsWith('voice/KR_')).length,
      krKeep: (() => { let n = 0; if (!_assetInfo?.packages) return -1; for (const g of buildSidebarGroups()) if (groupHasKrVoice(g.core)) n++; return n; })(),
      loadingText: loadingText?.textContent,
      expTitle: document.querySelector('#exportPanel .panel-title')?.childNodes[0]?.textContent?.trim(),
      resWin: document.querySelector('[data-r="win"]')?.textContent,
      voiceCk: document.querySelector('label.ck span[data-i18n="exp.voice"]')?.textContent,
      searchPh: sbSearch.placeholder,
      ctlVoiceLbl: document.getElementById('ctlVoiceLbl')?.textContent,
      settingsBtnTitle: document.getElementById('btnCtlSettings')?.title,
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
