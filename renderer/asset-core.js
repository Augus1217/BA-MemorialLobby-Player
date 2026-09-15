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

// companion release tag（GitHub 單 release 1000 上限分流）：主版號 + '-m4a'
export function companionTag(version) {
  return `v${version}-m4a`;
}

// companion manifest 合併：m4a 表覆蓋主表（key 互斥，正常無碰撞）
export function mergeManifests(mainMeta, m4aMeta) {
  return { ...(mainMeta?.packages || {}), ...(m4aMeta?.packages || {}) };
}
