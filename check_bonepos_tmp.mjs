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
const skd = p.readSkeletonData(fs.readFileSync(path));
// manual world transform (no animation, just bone hierarchy)
const bones = skd.bones;
const byName = {}; bones.forEach(b=>byName[b.name]=b);
const world = {};
function worldPos(name, parentWorldX, parentWorldY, parentRotDeg) {
  const b = byName[name];
  if (!b) return null;
  const rad = ((b.rotation) * Math.PI)/180;
  const px = parentWorldX + Math.cos(rad)*b.x - Math.sin(rad)*b.y;
  const py = parentWorldY + Math.sin(rad)*b.x + Math.cos(rad)*b.y;
  world[name] = {x:px, y:py};
  return {x:px, y:py, rot: b.rotation};
}
worldPos('root', 0,0,0);
for (const name of ['All_Layer','PC_Layer','Hip','Spine_01_Root','Spine_02_Root','Torso_1','Neck_Root','Neck','Head_Root','head','head_Rot','Touch_Point','Touch_Eye']) {
  const parent = byName[name].parent ? byName[name].parent.name : 'root';
  const pw = world[parent] || world['root'];
  const pr = pw ? pw.rot||0 : 0;
  const w = worldPos(name, pw.x, pw.y, pr);
  if (w) console.log(`${name}: world=(${w.x.toFixed(1)}, ${w.y.toFixed(1)})`);
}
console.log('Touch_Point world:', world['Touch_Point'], 'Touch_Eye world:', world['Touch_Eye']);
