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
const data = fs.readFileSync(path);
const sk = p.readSkeletonData(data);
console.log('ANIMATIONS:', sk.animations.map(a=>a.name).join(', '));
console.log('---');
for (const anim of sk.animations) {
  if (!/^(Look|Pat|LookEnd|PatEnd)/.test(anim.name)) continue;
  const targets = new Set();
  for (const tk of anim.timelines) {
    if (tk.boneIndex !== undefined) {
      const b = sk.bones[tk.boneIndex];
      targets.add(b.name);
    }
  }
  console.log(`${anim.name} [${anim.duration.toFixed(2)}s] ->`, [...targets].join(', '));
}
