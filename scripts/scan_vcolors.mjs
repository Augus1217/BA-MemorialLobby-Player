// 掃描全庫 spine 頂點色：slot setup color / attachment color / RGBA 色軌的非白 rgb。
// 用途：判定 lobby 是否受頂點色 G2L 修正（PMAGammaToTargetSpace）影響。2026-10-04 掃描：
// 269 廳中 111 廳有非白頂點色（Hanako/CH0070 有、CH0230/CH0284 全白＝與需修歸組吻合）。
import fs from 'node:fs';
import path from 'node:path';
import { SkeletonBinary, AtlasAttachmentLoader, TextureAtlas } from '@esotericsoftware/spine-core';
const ROOT = '/home/augus/BA-MemorialLobby-Player/assets/spine';
const tex = { width: 4, height: 4, setFilters(){}, setWraps(){}, setWrap(){}, source: { width:4, height:4 } };
const lobbies = fs.readdirSync(ROOT).filter(d => { try { return fs.readdirSync(path.join(ROOT,d)).some(f=>f.endsWith('.skel')); } catch { return false; } });
let ok = 0, errs = [];
const hits = [];
const tintedTl = [];
for (const lobby of lobbies) {
  const dir = path.join(ROOT, lobby);
  const skelFile = fs.readdirSync(dir).find(f => f.endsWith('.skel'));
  try {
    const atlas = new TextureAtlas(fs.readFileSync(path.join(dir, skelFile.replace('.skel','.atlas')), 'utf8'));
    for (const page of atlas.pages) page.setTexture(tex);
    const bin = new SkeletonBinary(new AtlasAttachmentLoader(atlas));
    const data = bin.readSkeletonData(new Uint8Array(fs.readFileSync(path.join(dir, skelFile))));
    ok++;
    const check = (who, c) => {
      if (c && (Math.abs(c.r-1)>0.001 || Math.abs(c.g-1)>0.001 || Math.abs(c.b-1)>0.001))
        hits.push({ lobby, who, rgb: [c.r, c.g, c.b].map(v=>+v.toFixed(3)) });
    };
    for (const s of data.slots) check('slot:'+s.name, s.color);
    for (const sk of data.skins) {
      const entries = sk.attachments instanceof Map ? [...sk.attachments.entries()] : Object.entries(sk.attachments || {});
      for (const [si, map] of entries) {
        const atts = map instanceof Map ? [...map.entries()] : Object.entries(map || {});
        for (const [an, att] of atts) if (att && att.color) check('att:'+(att.name||an), att.color);
      }
    }
    for (const a of data.animations) {
      for (const t of a.timelines) {
        const tn = t.constructor.name;
        if (tn === 'RGBATimeline' || tn === 'RGBATimeline2') {
          const f = t.frames;
          for (let i = 0; i < f.length; i += 5) {
            if (Math.abs(f[i+1]-1)>0.001 || Math.abs(f[i+2]-1)>0.001 || Math.abs(f[i+3]-1)>0.001) {
              tintedTl.push({ lobby, anim: a.name, slot: data.slots[t.slotIndex]?.name, tl: tn });
              break;
            }
          }
        } else if (tn === 'RGBA2Timeline') {
          const f = t.frames;
          for (let i = 0; i < f.length; i += 7) {  // RGBA2: time,r,g,b,a,r2,g2,b2 = stride 8? 保險掃全值
            if (Math.abs(f[i+1]-1)>0.001 || Math.abs(f[i+2]-1)>0.001 || Math.abs(f[i+3]-1)>0.001) {
              tintedTl.push({ lobby, anim: a.name, slot: data.slots[t.slotIndex]?.name, tl: tn });
              break;
            }
          }
        }
      }
    }
  } catch (e) { errs.push(lobby + ': ' + String(e).slice(0, 60)); }
}
console.log('ok:', ok, 'err:', errs.length, errs.slice(0,5));
console.log('非白 slot/att 色:', hits.length, JSON.stringify(hits.slice(0,10)));
console.log('非白色軌:', tintedTl.length, JSON.stringify(tintedTl.slice(0,10)));
