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
const bones = sk.bones;
const interesting = bones.filter(b=>/Touch_|_Eye_Key|Sweat|Pat|Look/i.test(b.name));
console.log('File:', path.split('/').slice(-2).join('/'));
for (const b of interesting) {
  console.log(`  bone ${b.name}: x=${b.x} y=${b.y} parent=${b.parent?.name||'ROOT'}`);
}
