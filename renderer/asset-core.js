// asset-core.js — 資源包選擇／URL／manifest 合併的唯一純邏輯來源（無 I/O、無平台依賴）。
//
// 使用方：
//   - renderer/ba-web.js（web 版）直接 import（ESM，會被 vite 打進 dist）。
//   - main.js（Electron 主進程，CJS 且正式版不帶 renderer/ 源碼）保留一份同語義
//     鏡像（voiceLangKeep/audioPackFor/selectPacks），由 scripts/check_asset_core_parity.py
//     在 CI 逐字比對，漂移即擋下。改這裡必須同步改 main.js（或反之），否則 CI 會紅。
//
// 語義：語言（jp/kr）＋格式（ogg/m4a）過濾；ogg key 有 m4a 對端即改取 m4a；
// 去重保序；只留 manifest 有的 key。

export function voiceLangKeep(key, wantKr) {
  const f = key.startsWith('voice-m4a/') ? key.slice('voice-m4a/'.length)
    : key.startsWith('voice/') ? key.slice('voice/'.length) : null;
  if (f === null) return true;
  return wantKr ? f.startsWith('KR_') : f.startsWith('JP_');
}

export function audioPackFor(key, fmt, packages) {
  if (fmt !== 'm4a' || typeof key !== 'string' || !key.startsWith('voice/')) return key;
  const alt = 'voice-m4a/' + key.slice('voice/'.length);
  if (packages && packages[alt]) return alt;
  return key;
}

export function selectPacks(names, { voice, audioFmt, packages }) {
  const wantKr = voice === 'kr';
  const fmt = audioFmt === 'm4a' ? 'm4a' : 'ogg';
  const pkgs = packages || {};
  const out = [];
  for (const k of names || []) {
    if (!voiceLangKeep(k, wantKr)) continue;
    const m = audioPackFor(k, fmt, pkgs);
    if (pkgs[m] && !out.includes(m)) out.push(m);
  }
  return out;
}

// ---- BGM 對照表（lobby_bgm_mapping.csv）解析 --------------------------------
// CSV 的 name 欄是角色核心名（Airi／Hanako／CH0070），但安裝 bookkeeping 用的是
// lobby 目錄名，可能帶造型、複本、GL 等後綴（Airi0_home、Izumi_swimsuit_home、
// Hanako_home_GL）。直接拿目錄名查表會全部 miss，靜默把所有 BGM 當成沒人用 →
// 「清除未使用的 BGM」會把還在用的一起砍掉。這裡提供共用的正規化。
//
// map 的 key 必須先轉小寫（呼叫端建立對照表時處理）。
// 外層後綴可疊（Izumi_swimsuit_home_Teen）；內層再處理造型後綴。
export function lobbyCoreName(key) {
  let rest = String(key || '').toLowerCase();
  for (;;) {
    let hit = null;
    for (const suf of ['_home_gl', '_home', '_gl', '_multi', '_teen']) {
      if (rest.endsWith(suf)) { hit = suf; break; }
    }
    if (!hit) break;
    rest = rest.slice(0, -hit.length);
  }
  if (rest.startsWith('lobby')) rest = rest.slice(5);
  for (const suf of ['_swimsuit', '_newyear', '_ridingsuit', '_casual']) {
    if (rest.endsWith(suf)) rest = rest.slice(0, -suf.length);
  }
  return rest;
}

// 先精確比對（CH0070 不能被砍成 CH007），再試去掉結尾 0（Airi0 → Airi）。
export function bgmForLobbyDir(map, dir) {
  if (!map) return null;
  const core = lobbyCoreName(dir);
  return map[core] || map[core.replace(/0$/, '')] || null;
}

// companion release tag（GitHub 單 release 1000 上限分流）：主版號 + '-m4a'
export function companionTag(version) {
  return `v${version}-m4a`;
}

// companion manifest 合併：m4a 表覆蓋主表（key 互斥，正常無碰撞）
export function mergeManifests(mainMeta, m4aMeta) {
  return { ...(mainMeta?.packages || {}), ...(m4aMeta?.packages || {}) };
}
