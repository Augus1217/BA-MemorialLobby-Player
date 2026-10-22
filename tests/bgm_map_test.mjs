// bgm_map_test.mjs — lobby_bgm_mapping.csv 的 lobby 目錄名解析（Node，無網路）
//   node tests/bgm_map_test.mjs
// 迴歸重點：對照表的 name 欄是角色核心名（Airi/CH0070），bookkeeping 卻是
// lobby 目錄名（Airi0_home/CH0070_home）。舊版直接拿目錄名查表 → 全部 miss
// → 「清除未使用的 BGM」會把「已安裝大廳正在用」的曲子一起砍掉。

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  OK ${m}`); };
const bad = (m) => { fail++; console.log(`  FAIL ${m}`); };

const { lobbyCoreName, bgmForLobbyDir } = await import('../renderer/asset-core.js');

// 模擬 main.js／ba-web.js 建立的小寫 key 對照表
const map = {
  airi: 'Theme_36.ogg',
  hanako: 'Theme_09.ogg',
  ch0070: 'Theme_264.ogg',
  eimi: 'Theme_36.ogg',
};

const cases = [
  ['lobbyCoreName', 'Airi0_home', 'airi0'],   // 尾碼 0 由 bgmForLobbyDir 再退一次
  ['lobbyCoreName', 'Airi_home', 'airi'],
  ['lobbyCoreName', 'Hanako_home_GL', 'hanako'],
  ['lobbyCoreName', 'CH0070_home', 'ch0070'],
  ['lobbyCoreName', 'LobbyCH0070', 'ch0070'],
  ['lobbyCoreName', 'Izumi_swimsuit_home_Teen', 'izumi'],
  ['lobbyCoreName', 'Mutsuki_newyear_home', 'mutsuki'],
];
for (const [, input, want] of cases) {
  const got = lobbyCoreName(input);
  got === want ? ok(`${input} → ${want}`) : bad(`${input} → ${got}（預期 ${want}）`);
}

const dirCases = [
  ['Airi0_home', 'Theme_36.ogg', '尾碼 0 的複本目錄'],
  ['Airi_home', 'Theme_36.ogg', '標準目錄'],
  ['Hanako_home_GL', 'Theme_09.ogg', 'GL 後綴'],
  ['CH0070_home', 'Theme_264.ogg', '結尾是 0 的核心名不能被砍成 CH007'],
  ['CH0070_home_GL', 'Theme_264.ogg', '結尾 0 ＋ GL'],
  ['Eimi', 'Theme_36.ogg', '直接給核心名'],
  ['Izumi_swimsuit_home', null, '對照表沒有的角色 → null'],
  ['', null, '空字串 → null'],
];
for (const [dir, want, label] of dirCases) {
  const got = bgmForLobbyDir(map, dir);
  got === want ? ok(`${label}：${dir || '(空)'} → ${want}`)
    : bad(`${label}：${dir || '(空)'} → ${got}（預期 ${want}）`);
}

// 大小寫不敏感（CSV name 可能是 Airi，呼叫端一律轉小寫）
bgmForLobbyDir(map, 'AIRI0_HOME') === 'Theme_36.ogg'
  ? ok('目錄名大小寫不敏感') : bad('目錄名大小寫不敏感');

console.log(`\nPASS=${pass} FAIL=${fail}`);
if (fail) process.exit(1);
