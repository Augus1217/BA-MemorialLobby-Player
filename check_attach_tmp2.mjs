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
console.log('=== slots referencing Touch/Sweat bones ===');
for (const slot of sk.slots) {
  if (/Touch|Sweat/.test(slot.bone.name)) console.log(`slot ${slot.name} -> bone ${slot.bone.name}`);
}
console.log('=== skin attachments on those slots ===');
const slotNames = new Set(sk.slots.filter(s=>/Touch|Sweat/.test(s.bone.name)).map(s=>s.name));
for (const skin of sk.skins) {
  for (const [slotName, entries] of Object.entries(skin.attachments)) {
    if (!slotNames.has(slotName)) continue;
    for (const [attachName, att] of Object.entries(entries)) {
      console.log(`skin '${skin.name}' slot '${slotName}' attach '${attachName}' ${att ? att.constructor.name : 'null(remove)'}`);
    }
  }
}
console.log('=== animations keying Touch/Sweat bones ===');
for (const anim of sk.animations) {
  for (const tk of anim.timelines) {
    if (tk.boneIndex===undefined) continue;
    const b = sk.bones[tk.boneIndex];
    if (!/Touch|Sweat/.test(b.name)) continue;
    console.log(`${anim.name} -> ${b.name}`);
  }
}
