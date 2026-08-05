import { SkeletonBinary, AtlasAttachmentLoader, MeshAttachment, RegionAttachment, BoundingBoxAttachment, PathAttachment, PointAttachment, ClippingAttachment } from '@esotericsoftware/spine-core';
import fs from 'fs';
class NullAtlas { findRegion() { return null; } }
class NullLoader extends AtlasAttachmentLoader {
  constructor() { super(new NullAtlas()); }
  newMeshAttachment(s,a,n) { return new MeshAttachment(a,n); }
  newRegionAttachment(s,a,n) { return new RegionAttachment(a,n); }
  newBoundingBoxAttachment(s,a) { return new BoundingBoxAttachment(a); }
  newPathAttachment(s,a) { return new PathAttachment(a); }
  newPointAttachment(s,a) { return new PointAttachment(a); }
  newClippingAttachment(s,a) { return new ClippingAttachment(a); }
}
const loader = new NullLoader();
const p = new SkeletonBinary(loader); p.scale=1;
RegionAttachment.prototype.updateRegion = function(){};
MeshAttachment.prototype.updateRegion = function(){};
const path = process.argv[2];
const sk = p.readSkeletonData(fs.readFileSync(path));
console.log('=== bones with Touch/Sweat ===');
for (const b of sk.bones) {
  if (/Touch|Sweat/.test(b.name)) console.log(`${b.name}: parent=${b.parent?.name||'ROOT'} x=${b.x.toFixed(2)} y=${b.y.toFixed(2)}`);
}
console.log('=== slots referencing Touch/Sweat bones ===');
const boneByName = {};
sk.bones.forEach(b=>boneByName[b.name]=b);
for (const slot of sk.slots) {
  const b = boneByName[slot.bone.name];
  if (/Touch|Sweat/.test(slot.bone.name)) console.log(`slot ${slot.name} -> bone ${slot.bone.name}`);
}
console.log('=== skin attachments on Touch/Sweat slots ===');
for (const skin of sk.skins) {
  for (const [slotName, entries] of Object.entries(skin.attachments)) {
    if (!/Touch|Sweat/.test(slotName)) continue;
    for (const [attachName, att] of Object.entries(entries)) {
      console.log(`skin '${skin.name}' slot '${slotName}' attach '${attachName}' ${att ? att.constructor.name : 'null(remove)'}`);
    }
  }
}
console.log('=== animations keying Touch/Sweat bones (with keyframe values) ===');
for (const anim of sk.animations) {
  for (const tk of anim.timelines) {
    if (tk.boneIndex===undefined) continue;
    const b = sk.bones[tk.boneIndex];
    if (!/Touch|Sweat/.test(b.name)) continue;
    console.log(`${anim.name} -> ${b.name} (${tk.constructor.name})`);
  }
}
