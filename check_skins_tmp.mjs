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
const bbs = [];
for (const skin of sk.skins) {
  for (const [slotName, entries] of Object.entries(skin.attachments)) {
    for (const [attachName, att] of Object.entries(entries)) {
      if (att instanceof BoundingBoxAttachment) {
        bbs.push({slot: slotName, name: attachName, verts: att.vertices.length});
      }
    }
  }
}
console.log('BoundingBox attachments in', path.split('/').slice(-2).join('/')+':');
console.log(JSON.stringify(bbs, null, 1));
