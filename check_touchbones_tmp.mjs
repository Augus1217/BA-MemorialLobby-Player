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
const base = '/home/augus/BA_Extracted_Full/Assets/_MX/SpineLobbies';
const dirs = fs.readdirSync(base);
let total=0, withTP=0, withTE=0, both=0, none=0;
const report=[];
for (const d of dirs) {
  const path = base+'/'+d+'/'+d+'.skel';
  if (!fs.existsSync(path)) continue;
  total++;
  const sk = p.readSkeletonData(fs.readFileSync(path));
  const names = new Set(sk.bones.map(b=>b.name));
  const tp = names.has('Touch_Point'), te = names.has('Touch_Eye');
  if (tp&&te) both++; else { none++; report.push(d+` (TP:${tp} TE:${te})`); }
  // check if Touch_Eye animated in Look_01_M or Pat_01_M
  for (const anim of sk.animations) {
    if (!/^(Look_01_M|Pat_01_M|LookEnd_01_M|PatEnd_01_M)$/.test(anim.name)) continue;
    for (const tk of anim.timelines) {
      if (tk.boneIndex!==undefined) {
        const b = sk.bones[tk.boneIndex];
        if (/Touch|Sweat/.test(b.name)) console.log(`${d} ${anim.name} animates ${b.name}`);
      }
    }
  }
}
console.log(`total:${total} both:${both} missing:${none}`);
if (report.length) console.log('MISSING:', report.join(', '));
