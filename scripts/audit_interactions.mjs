#!/usr/bin/env node
// 全 lobby 互動靜態審計（遊戲資料把關）：
//   對 lobby_index.json 的每一 lobby，比對六份遊戲資料之間的一致性——
//   skel 動畫/事件（spine-core 解析）× 觸摸盒(bodytouch) × IK 區(ikzones)
//   × 時間軸(timelines) × 語音檔(voice/<folder>/<id>.ogg) × 字幕(subtitle)。
// 輸出 assets/data/audit_interactions.json（逐 lobby 明細）＋ stdout 摘要。
// 用法：node scripts/audit_interactions.mjs [--json-only]
import fs from 'node:fs';
import * as SC from '@esotericsoftware/spine-core';

const D = 'assets/data';
const load = (f) => JSON.parse(fs.readFileSync(`${D}/${f}`, 'utf8'));
const INDEX = load('lobby_index.json');
const BT = load('lobby_bodytouch.json');
const IK = load('lobby_ikzones.json');
const TL = load('lobby_timelines.json');
const VSCHED = load('lobby_voice_schedule.json').lobbies ?? {};
const SUB = load('lobby_subtitle.json');
const VOICE_INDEX = load('voice_index.json');
const TL_KEY = (k) => k.toLowerCase();

// .skel 解析（無 atlas：attachment 以 stub 承載，名稱保留供 zone/voice 比對）
let _stubN = 0;
const _s = (a) => a.filter((x) => typeof x === 'string').pop() ?? ('stub_' + (_stubN++));   // parser 簽名混雜；linked mesh 的 path 可為 null（稍後解析父路徑）
class StubLoader {
  newRegionAttachment(...a) { const n = _s(a); const r = new SC.RegionAttachment(n, n); r.region = { name: n }; return r; }
  newMeshAttachment(...a) { const n = _s(a); const m = new SC.MeshAttachment({ name: n }); m.region = { name: n }; m.path = n; m.name = n; return m; }
  newBoundingBoxAttachment(...a) { return new SC.BoundingBoxAttachment(_s(a)); }
  newPathAttachment(...a) { return new SC.PathAttachment(_s(a)); }
  newPointAttachment(...a) { return new SC.PointAttachment(_s(a)); }
  newClipAttachment(...a) { return new SC.ClipAttachment ? new SC.ClipAttachment(_s(a)) : { name: _s(a) }; }
  newClippingAttachment(...a) { return { name: _s(a), end: 0, color: new SC.Color(1, 1, 1, 1) }; }
}
const skelCache = new Map();
function parseSkel(absPath) {
  if (skelCache.has(absPath)) return skelCache.get(absPath);
  let out = null, err = null;
  try {
    const loader = new SC.SkeletonBinary(new SC.SkeletonData());
    loader.attachmentLoader = new StubLoader();
    const data = loader.readSkeletonData(new Uint8Array(fs.readFileSync(absPath)));
    const anims = data.animations.map((a) => a.name).filter(Boolean);
    const animSet = new Set(anims);
    const bones = new Set(data.bones.map((b) => b.name).filter(Boolean));   // parser 給的是 BoneData
    // 每動畫的語音事件（時間點＋id，含應用層會剝掉的 Sound//Talk/ 前綴）
    const voiceEvents = {};
    for (const a of data.animations) {
      const evs = [];
      for (const t of a.timelines) {
        if (!(t instanceof SC.EventTimeline)) continue;
        for (let f = 0; f < t.frames.length; f++) {
          const ev = t.events[f];
          const id = String(ev.stringValue ?? ev.data?.name ?? '').trim();
          if (id) evs.push({ t: t.frames[f], id, raw: ev.data?.name });
        }
      }
      if (evs.length) voiceEvents[a.name] = evs;
    }
    out = { anims, animSet, bones, voiceEvents, events: data.events.map((e) => e.name) };
  } catch (e) { err = String(e?.message || e); }
  const rec = { out, err };
  skelCache.set(absPath, rec);
  return rec;
}
const stripVoiceId = (id) => String(id).trim().replace(/^[A-Za-z]+\//, '').toLowerCase();

const report = {};
let nOk = 0;
const tally = { missingZones: [], missingTimeline: [], zoneClipMissing: [], zoneBoneMissing: [],
  tlAnimMissing: [], voiceFileMissing: [], voiceSubMissing: [], skelParseFail: [],
  specialMode: {}, bodytouchEmpty: [], notOnDisk: [] };

for (const [key, entry] of Object.entries(INDEX)) {
  const rep = { issues: [], info: {} };
  const dir = `assets/spine/${key}`;
  const skelPath = `${dir}/${entry.skel.replace(/^\.\//, '')}`;
  const vsInfo = VSCHED[key] ?? VSCHED[TL_KEY(key)] ?? null;
  const voiceFolder = vsInfo?.voiceFolder ?? null;
  rep.info.voiceFolder = voiceFolder;

  // 1) skel 解析（資產隨播隨下：不在磁碟＝notOnDisk，非問題）
  if (!fs.existsSync(skelPath)) {
    rep.info.notOnDisk = true; report[key] = rep;
    tally.notOnDisk.push(key); continue;
  }
  const ps = parseSkel(skelPath);
  if (ps.err) { rep.issues.push(`skel 解析失敗: ${ps.err}`); tally.skelParseFail.push(key);
    report[key] = rep; continue; }
  const { anims, animSet, bones, voiceEvents } = ps.out;
  rep.info.animations = anims.length;
  rep.info.hasIdle = animSet.has('Idle_01');
  rep.info.hasStartIdle = anims.filter((a) => a.startsWith('Start_Idle')).join(',') || null;

  // 2) 特殊互動模式（與 app 偵測規則一致：pinch > touch > handfollow）
  const hasAny = (p) => anims.some((a) => a.includes(p));
  const mode = hasAny('Pinch_') ? 'pinch' : hasAny('Touch_') ? 'touch'
    : hasAny('HandFollow_') ? 'handfollow' : null;
  rep.info.interactionMode = mode;
  if (mode) tally.specialMode[mode] = (tally.specialMode[mode] ?? 0) + 1;

  // 3) zones
  const ik = IK[key], bt = BT[key];
  rep.info.ikZones = ik ? Object.keys(ik).join(',') : null;
  rep.info.bodytouchBoxes = Array.isArray(bt) ? bt.length : null;
  if (!ik && !bt) tally.missingZones.push(key), rep.issues.push('無 bodytouch 也無 ikzones（退回點哪都 Talk）');
  if (Array.isArray(bt) && bt.length === 0) tally.bodytouchEmpty.push(key);
  const zoneRecs = [];
  if (ik) for (const [kind, rec] of Object.entries(ik)) {
    if (Array.isArray(rec)) rec.forEach((r, i) => zoneRecs.push([`${kind}[${i}]`, r]));
    else if (rec) zoneRecs.push([kind, rec]);
  }
  for (const [kind, rec] of zoneRecs) {
    if (rec.clip && !animSet.has(rec.clip)) { rep.issues.push(`zone ${kind}.clip 不存在: ${rec.clip}`); tally.zoneClipMissing.push(`${key}:${kind}:${rec.clip}`); }
    if (rec.end && !animSet.has(rec.end)) { rep.issues.push(`zone ${kind}.end 不存在: ${rec.end}`); tally.zoneClipMissing.push(`${key}:${kind}:${rec.end}`); }
    if (rec.dragBone && !bones.has(rec.dragBone)) { rep.issues.push(`zone ${kind}.dragBone 不存在: ${rec.dragBone}`); tally.zoneBoneMissing.push(`${key}:${kind}:${rec.dragBone}`); }
  }

  // 4) 時間軸（時機真值）
  const tl = TL[TL_KEY(key)];
  const vb = TL_KEY(key).replace(/_(?:gl|teen)$/, '');
  const tlBase = !tl && vb !== TL_KEY(key) ? TL[vb] : null;
  if (!tl && tlBase) { rep.info.timelineFallback = vb; tally.missingTimeline.push(key + '(base退回)'); }
  else if (!tl) { tally.missingTimeline.push(key); rep.issues.push('無 timeline（遊戲資料亦無，走 Start_Idle→Idle 預設路徑）'); }
  else {
    const tlSrc = tl ?? tlBase;
    const mainSkelFile = (entry.skel ?? '').split('/').pop().replace(/\.(skel|json)$/i, '');
    for (const tr of tlSrc.tracks ?? []) {
      const trSk = String(tr.skeleton ?? '').toLowerCase().replace(/\.(skel|json)$/i, '');
      if (trSk && trSk !== mainSkelFile.toLowerCase() && !mainSkelFile.toLowerCase().includes(trSk) && !trSk.includes(mainSkelFile.toLowerCase().split('_')[0])) continue;   // 額外骨架軌不比主 skel
      if (!animSet.has(tr.anim)) { rep.issues.push(`timeline anim 不存在（主骨架軌）: ${tr.anim}@${tr.start}s`); tally.tlAnimMissing.push(`${key}:${tr.anim}`); }
    }
    rep.info.timeline = `${(tlSrc.tracks ?? []).length} tracks / ${(tlSrc.duration ?? 0).toFixed(1)}s`;
  }

  // 5) 語音事件 → 檔案/字幕/索引
  rep.info.voiceEvents = 0; rep.info.voiceMissing = [];
  for (const [anim, evs] of Object.entries(voiceEvents)) {
    for (const ev of evs) {
      const id = stripVoiceId(ev.id);
      if (!id || id === 'talk') continue;   // 泛用 marker
      rep.info.voiceEvents++;
      if (vsInfo?.missingMedia?.some((m) => m.toLowerCase().replace(/\.ogg$/, '') === id)) continue;   // 已知缺檔
      const fp = `assets/voice/${voiceFolder ?? '?'}/${id}.ogg`;
      if (!fs.existsSync(fp)) { rep.issues.push(`語音檔缺: ${anim}@${ev.t.toFixed(2)}s ${fp}`); tally.voiceFileMissing.push(`${key}:${id}`); rep.info.voiceMissing.push(id); }
      else if (!SUB[id]) {
        const sfxLike = /(_sfx|_0)$/.test(id) || !/_\d+\d?$/.test(id);
        if (sfxLike) { rep.info.sfxNoSub = (rep.info.sfxNoSub ?? 0) + 1; }
        else { rep.issues.push(`字幕缺（非 SFX）: ${anim}@${ev.t.toFixed(2)}s ${id}`); tally.voiceSubMissing.push(`${key}:${id}`); }
      }
    }
  }

  if (!rep.issues.length) nOk++;
  report[key] = rep;
}

fs.writeFileSync(`${D}/audit_interactions.json`, JSON.stringify(report, null, 1));
const lines = [
  `lobbies: ${Object.keys(INDEX).length}, 無問題: ${nOk}`,
  `特殊互動模式: ${JSON.stringify(tally.specialMode)}`,
  `skelParseFail: ${tally.skelParseFail.length}`, `notOnDisk: ${tally.notOnDisk.length}`,
  `missingZones: ${tally.missingZones.length}`, `bodytouchEmpty: ${tally.bodytouchEmpty.length}`,
  `missingTimeline: ${tally.missingTimeline.length}`, `tlAnimMissing: ${tally.tlAnimMissing.length}`,
  `zoneClipMissing: ${tally.zoneClipMissing.length}`, `zoneBoneMissing: ${tally.zoneBoneMissing.length}`,
  `voiceFileMissing: ${tally.voiceFileMissing.length}`, `voiceSubMissing: ${tally.voiceSubMissing.length}`,
];
fs.writeFileSync(`${D}/audit_interactions_summary.json`, JSON.stringify(tally, null, 1));
if (!process.argv.includes('--json-only')) {
  console.log(lines.join('\n'));
  const show = (arr, n = 12) => arr.length ? console.log('  e.g.', arr.slice(0, n).join(' | ')) : null;
  show(tally.skelParseFail); show(tally.missingZones); show(tally.missingTimeline);
  show(tally.tlAnimMissing); show(tally.zoneClipMissing); show(tally.zoneBoneMissing);
  show(tally.voiceFileMissing); show(tally.voiceSubMissing);
}
