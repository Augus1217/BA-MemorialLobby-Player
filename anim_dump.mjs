import { SkeletonBinary, AtlasAttachmentLoader, MeshAttachment, RegionAttachment, BoundingBoxAttachment, PathAttachment, PointAttachment, ClippingAttachment, RotateTimeline, TranslateTimeline, ScaleTimeline, ShearTimeline, AttachmentTimeline, DeformTimeline, EventTimeline, DrawOrderTimeline, IkConstraintTimeline, TransformConstraintTimeline, PathConstraintPositionTimeline, PathConstraintSpacingTimeline, PathConstraintMixTimeline } from '@esotericsoftware/spine-core';
import fs from 'fs';

class NullAtlas { findRegion() { return null; } }
class NullLoader extends AtlasAttachmentLoader {
  constructor() { super(new NullAtlas()); }
  newMeshAttachment(skin, name, path, sequence) { return new MeshAttachment(name, path); }
  newRegionAttachment(skin, name, path, sequence) { return new RegionAttachment(name, path); }
  newBoundingBoxAttachment(skin, name) { return new BoundingBoxAttachment(name); }
  newPathAttachment(skin, name) { return new PathAttachment(name); }
  newPointAttachment(skin, name) { return new PointAttachment(name); }
  newClippingAttachment(skin, name) { return new ClippingAttachment(name); }
}

const file = process.argv[2];
const animFilter = process.argv[3] || 'Look';
const data = fs.readFileSync(file);
const loader = new NullLoader();
const parser = new SkeletonBinary(loader);
parser.scale = 1;
RegionAttachment.prototype.updateRegion = function() {};
MeshAttachment.prototype.updateRegion = function() {};
const sd = parser.readSkeletonData(data);

console.log('== bones (' + sd.bones.length + '):');
console.log(sd.bones.map(b => b.name).join(', '));

console.log('\n== ik constraints (' + (sd.ikConstraints?.length||0) + '):');
for (const ik of sd.ikConstraints || []) {
  console.log(`  ${ik.name}: bones=[${ik.bones.map(b=>b.name)}] target=${ik.target.name} mix=${ik.mix} bendDirection=${ik.bendDirection}`);
}
console.log('== transform constraints (' + (sd.transformConstraints?.length||0) + '):');
for (const tc of sd.transformConstraints || []) {
  console.log(`  ${tc.name}: bones=[${tc.bones.map(b=>b.name)}] target=${tc.target.name} rotateMix=${tc.rotateMix} translateMix=${tc.translateMix}`);
}
console.log('== path constraints:', (sd.pathConstraints||[]).map(p=>p.name));

for (const a of sd.animations) {
  if (!a.name.includes(animFilter)) continue;
  console.log('\n================== animation:', a.name, 'dur=' + a.duration.toFixed(2));
  const rows = [];
  for (const tl of a.timelines) {
    let bone = null;
    let frames = 0;
    let detail = '';
    let props = tl.propertyIds ? tl.propertyIds.join(',') : (tl.propertyId || '');
    if (tl.boneIndex !== undefined) bone = sd.bones[tl.boneIndex]?.name;
    const cls = tl.constructor.name;
    if (tl.frames) frames = tl.frames.length;
    if (tl instanceof RotateTimeline) {
      detail = tl.frames.map(f => Math.round(f.angle)).join(',');
    } else if (tl instanceof TranslateTimeline) {
      detail = tl.frames.map(f => `${Math.round(f.x)},${Math.round(f.y)}`).join(' ');
    } else if (tl instanceof ScaleTimeline) {
      detail = tl.frames.map(f => `${f.x.toFixed(2)},${f.y.toFixed(2)}`).join(' ');
    } else if (tl instanceof AttachmentTimeline) {
      detail = tl.frames.map((f,i) => `${f}s=${tl.attachmentNames[i]||'null'}`).join(' ');
    } else if (tl instanceof DeformTimeline) {
      detail = 'deform slots=' + tl.slotIndex + ' frames=' + frames;
    } else if (tl instanceof EventTimeline) {
      detail = tl.frames.map((f,i) => `${f}s:${tl.events[i]?.name}(${tl.events[i]?.stringValue||''})`).join(' ');
    }
    rows.push({ cls, props, bone, frames, detail });
  }
  for (const r of rows) {
    console.log(`  ${r.cls.padEnd(26)} ${(r.bone||'?').padEnd(22)} f=${r.frames}  ${r.detail.slice(0,300)}`);
  }
}
