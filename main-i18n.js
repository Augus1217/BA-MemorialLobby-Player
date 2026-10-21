// main-i18n.js — 主程序端（系統匣 / 桌面通知）的小型多語表。
//
// 為什麼需要：renderer 的 ui_i18n.json 走 assets pack 或 dist，主程序在
// 建立系統匣時（app ready）還讀不到，而且使用者選的語言存在 renderer 的
// localStorage。renderer 會在啟動/切換語言時用 IPC `set-ui-lang` 告知這裡，
// 未收到之前才退回 app.getLocale()（OS 語言常與 app 語言不同：ja/ko 使用者
// 以前一律看到英文，zh-CN 使用者看到繁中）。
'use strict';
const { app } = require('electron');

const SUPPORTED = ['zh-TW', 'zh-CN', 'ja', 'ko', 'en'];
let uiLang = null;

function normalize(tag) {
  const s = String(tag || '').toLowerCase();
  if (!s) return null;
  if (s.startsWith('zh')) return /hans|cn|sg|my/.test(s) ? 'zh-CN' : 'zh-TW';
  if (s.startsWith('ja')) return 'ja';
  if (s.startsWith('ko')) return 'ko';
  if (s.startsWith('en')) return 'en';
  return null;
}

function current() {
  if (uiLang) return uiLang;
  try { return normalize(app.getLocale()) || 'en'; } catch { return 'en'; }
}

function setUiLang(tag) {
  const n = normalize(tag);
  if (n || tag === '') uiLang = n;
  return current();
}

// keys：系統匣＋桌布通知會用到的字串（其餘 UI 文字一律在 renderer 字典）
const STRINGS = {
  'tray.showPlayer': {
    'zh-TW': '顯示播放器', 'zh-CN': '显示播放器', ja: 'プレイヤーを表示', ko: '플레이어 표시', en: 'Show Player',
  },
  'tray.startWallpaper': {
    'zh-TW': '啟動桌布', 'zh-CN': '启动壁纸', ja: '壁紙を開始', ko: '배경화면 시작', en: 'Start Wallpaper',
  },
  'tray.stopWallpaper': {
    'zh-TW': '停止桌布', 'zh-CN': '停止壁纸', ja: '壁紙を停止', ko: '배경화면 중지', en: 'Stop Wallpaper',
  },
  'tray.chooseLobby': {
    'zh-TW': '選擇桌布大廳…', 'zh-CN': '选择壁纸大厅…', ja: '壁紙のロビーを選択…', ko: '배경화면 로비 선택…', en: 'Choose Wallpaper Lobby…',
  },
  'tray.interactive': {
    'zh-TW': '互動模式（可點擊桌布）', 'zh-CN': '互动模式（可点击壁纸）', ja: '操作モード（壁紙をクリック可）', ko: '상호작용 모드(배경화면 클릭 가능)', en: 'Interactive (clickable)',
  },
  'tray.launchAtLogin': {
    'zh-TW': '開機自啟（桌布）', 'zh-CN': '开机自启（壁纸）', ja: 'ログイン時に起動（壁紙）', ko: '로그인 시 시작(배경화면)', en: 'Launch at Login (Wallpaper)',
  },
  'tray.quit': { 'zh-TW': '離開', 'zh-CN': '退出', ja: '終了', ko: '종료', en: 'Quit' },

  // Windows WorkerW 掛載失敗 → 該螢幕不顯示桌布（見 wallpaper.js ready-to-show）
  'wp.mountFailed': {
    'zh-TW': '無法把桌布掛到桌面層（WorkerW）：{why}', 'zh-CN': '无法把壁纸挂到桌面层（WorkerW）：{why}',
    ja: '壁紙をデスクトップ層（WorkerW）に装着できません: {why}', ko: '배경화면을 데스크톱 레이어(WorkerW)에 장착할 수 없습니다: {why}',
    en: 'Could not attach the wallpaper to the desktop layer (WorkerW): {why}',
  },
  'wp.updateFailed': {
    'zh-TW': '桌布更新失敗，保留原桌布（{why}）', 'zh-CN': '壁纸更新失败，保留原壁纸（{why}）',
    ja: '壁紙の更新に失敗したため元の壁紙を維持します（{why}）', ko: '배경화면 갱신 실패, 기존 배경화면을 유지합니다({why})',
    en: 'Wallpaper update failed; keeping the previous wallpaper ({why})',
  },
  'wp.stopped': {
    'zh-TW': '桌布已停止（{why}）', 'zh-CN': '壁纸已停止（{why}）',
    ja: '壁紙を停止しました（{why}）', ko: '배경화면을 중지했습니다({why})', en: 'Wallpaper stopped ({why})',
  },
  'wp.screenStopped': {
    'zh-TW': '螢幕 {n} 的桌布已停止：{why}', 'zh-CN': '屏幕 {n} 的壁纸已停止：{why}',
    ja: 'モニター {n} の壁紙を停止しました: {why}', ko: '모니터 {n}의 배경화면을 중지했습니다: {why}',
    en: 'Wallpaper stopped on display {n}: {why}',
  },
  // 慢網首訪：桌布 worker 在下載整個大廳（數百 MB）時，桌面會空著幾分鐘
  'wp.firstDownload': {
    'zh-TW': '桌布：首次需要下載這個大廳的資源，慢網可能要數分鐘（進度可在播放器設定查看）',
    'zh-CN': '壁纸：首次需要下载该大厅的资源，慢速网络可能需要数分钟',
    ja: '壁紙: このロビーのリソースを初回ダウンロード中です（回線が遅いと数分かかります）',
    ko: '배경화면: 이 로비 리소스를 처음 내려받는 중입니다(느린 회선에서는 몇 분 걸립니다)',
    en: 'Wallpaper: downloading this lobby\'s assets for the first time (can take minutes on slow links)',
  },
  'wp.workerFailed': {
    'zh-TW': '桌布已停止（worker 無法啟動）', 'zh-CN': '壁纸已停止（worker 无法启动）',
    ja: '壁紙を停止しました（ワーカーを起動できません）', ko: '배경화면을 중지했습니다(워커를 시작할 수 없음)',
    en: 'Wallpaper stopped (the renderer worker could not start)',
  },
  'wp.notAvailable': {
    'zh-TW': '此平台不支援桌布模式', 'zh-CN': '此平台不支持壁纸模式',
    ja: 'このプラットフォームでは壁紙モードを利用できません', ko: '이 플랫폼에서는 배경화면 모드를 지원하지 않습니다',
    en: 'Wallpaper mode is not available on this platform',
  },
  'wp.packMissing': {
    'zh-TW': '該大廳資源尚未下載完成，稍後再試', 'zh-CN': '该大厅资源尚未下载完成，请稍后再试',
    ja: 'そのロビーのリソースが未ダウンロードです。しばらくしてからお試しください', ko: '해당 로비 리소스를 아직 다운로드하지 못했습니다. 잠시 후 다시 시도해 주세요',
    en: 'That lobby\'s assets are not downloaded yet; please try again later',
  },
};

function mainT(key, params) {
  const entry = STRINGS[key];
  if (!entry) return key;
  let s = entry[current()] ?? entry.en ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

module.exports = { mainT, setUiLang, current, SUPPORTED };
