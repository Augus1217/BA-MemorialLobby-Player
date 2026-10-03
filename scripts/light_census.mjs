// 全 lobby 光槽普查：每個 .skel 的 additive/screen 槽 → 世界面積、attA、slotA、attachment path
// 輸出 /tmp/bq/light_census_skel.json（python 端接 atlas 貼圖亮度與材質欄位）
import { SkeletonBinary, AtlasAttachmentLoader, MeshAttachment, RegionAttachment, BoundingBoxAttachment, PathAttachment, PointAttachment, ClippingAttachment, Skeleton, AnimationState, AnimationStateData } from '@esotericsoftware/spine-core';
import fs from 'fs';
import path from 'path';

class NullAtlas { findRegion() { return null; } }
class NullLoader extends AtlasAttachmentLoader {
  constructor() { super(new NullAtlas()); }
  newMeshAttachment(skin, name, p, sequence) { const a = new MeshAttachment(name, p); return a; }
  newRegionAttachment(skin, name, p, sequence) { const a = new RegionAttachment(name, p); return a; }
  newBoundingBoxAttachment(skin, name) { return new BoundingBoxAttachment(name); }
  newPathAttachment(skin, name) { return new PathAttachment(name); }
  newPointAttachment(skin, name) { return new PointAttachment(name); }
  newClippingAttachment(skin, name) { return new ClippingAttachment(name); }
}
const ROOT = '/home/augus/BA-MemorialLobby-Player/assets/spine';
const out = [];
const lobbies = fs.readdirSync(ROOT).filter(d => fs.statSync(path.join(ROOT, d)).isDirectory());

for (const lobby of lobbies) {
  const skels = [];
  (function walk(dir) {
    for (const f of fs.readdirSync(dir)) {
      const fp = path.join(dir, f);
      if (fs.statSync(fp).isDirectory()) { if (f !== 'Texture') walk(fp); }
      else if (f.endsWith('.skel')) skels.push(fp);
    }
  })(path.join(ROOT, lobby));
  for (const skelPath of skels) {
    try {
      const parser = new SkeletonBinary(new NullLoader());
      parser.scale = 1;
      RegionAttachment.prototype.updateRegion = function() {};
      MeshAttachment.prototype.updateRegion = function() {};
      const data = parser.readSkeletonData(fs.readFileSync(skelPath));
      const skeleton = new Skeleton(data);
      skeleton.setToSetupPose();
      skeleton.setSkin(data.defaultSkin ?? data.skins[0]);
      skeleton.setSlotsToSetupPose();
      // 播 idle 5s（動畫展開後量測——Hanako dome/Seia top_light 都靠動畫長出來）
      let idleName = null;
      const animNames = data.animations.map(a => a.name);
      for (const cand of ['Idle_01', 'S2_01']) if (animNames.includes(cand)) { idleName = cand; break; }
      if (!idleName) idleName = animNames.find(n => /^(idle|s\d)/i.test(n)) || animNames.find(n => !/^(start|talk|pat|look|dummy)/i.test(n)) || animNames[0] || null;
      if (idleName) {
        try {
          const st = new AnimationState(new AnimationStateData(data));
          st.data.defaultMix = 0.2;
          // 完整序列：Start_Idle_01 → Idle_01（燈光群組 intro 期才就位/降下）
          const startName = animNames.find(n => /^start_idle/i.test(n)) || animNames.find(n => /^start/i.test(n)) || null;
          if (startName) st.setAnimation(0, startName, false);
          else st.setAnimation(0, idleName, true);
          if (startName) st.addAnimation(0, idleName, true, 0);
          const dt = 1 / 30;
          const startDur = startName ? (data.animations.find(a => a.name === startName)?.duration ?? 0) : 0;
          const target = startDur + 5;   // idle 5s
          for (let t = 0; t < target; t += dt) { st.update(dt); st.apply(skeleton); }
        } catch {}
      }
      skeleton.updateWorldTransform(1);
      const w = new Float32Array(8192);
      const additive = [];
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const slot of skeleton.slots) {
        const att = slot.getAttachment();
        if (!att) continue;
        const n = att.worldVerticesLength;
        if (!n || n > w.length) continue;
        att.computeWorldVertices(slot, 0, n, w, 0, 2);
        for (let i = 0; i < n; i += 2) {
          minX = Math.min(minX, w[i]); maxX = Math.max(maxX, w[i]);
          minY = Math.min(minY, w[i+1]); maxY = Math.max(maxY, w[i+1]);
        }
        if (slot.data.blendMode === 0) continue;
        // 多邊形面積（shoelace）
        let area = 0;
        const m = n / 2;
        for (let i = 0; i < m; i++) {
          const j = (i + 1) % m;
          area += w[i*2] * w[j*2+1] - w[j*2] * w[i*2+1];
        }
        area = Math.abs(area) / 2;
        additive.push({
          slot: slot.data.name, bm: slot.data.blendMode, att: att.name,
          path: att.path ?? att.name,
          area: Math.round(area),
          slotA: +slot.color.a.toFixed(3),
          attA: att.color ? +att.color.a.toFixed(3) : 1,
        });
      }
      out.push({
        lobby, skel: path.relative(ROOT, skelPath),
        anims: data.animations.length,
        idle: idleName,
        slots: data.slots.length,
        bounds: isFinite(minX) ? [Math.round(minX), Math.round(minY), Math.round(maxX), Math.round(maxY)] : null,
        additive,
      });
    } catch (e) {
      out.push({ lobby, skel: path.relative(ROOT, skelPath), err: String(e?.message || e) });
    }
  }
}
fs.writeFileSync('/tmp/bq/light_census_skel.json', JSON.stringify(out, null, 1));
console.log('skeletons:', out.length, 'errors:', out.filter(o => o.err).length);
