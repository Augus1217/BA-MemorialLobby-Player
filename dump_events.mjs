import { SkeletonBinary, AtlasAttachmentLoader, RegionAttachment, MeshAttachment } from '@esotericsoftware/spine-core';
import fs from 'fs';
class NullAtlas { findRegion() { return null; } }
class NullLoader extends AtlasAttachmentLoader {
  constructor() { super(new NullAtlas()); }
  newMeshAttachment(s,n,p,sq){return new MeshAttachment(n,p);}
  newRegionAttachment(s,n,p,sq){return new RegionAttachment(n,p);}
  newBoundingBoxAttachment(s,n){return ({});}
  newPathAttachment(s,n){return ({});}
  newPointAttachment(s,n){return ({});}
  newClippingAttachment(s,n){return ({});}
}
const path = process.argv[2];
const data = fs.readFileSync(path);
const loader = new NullLoader();
const parser = new SkeletonBinary(loader);
parser.scale = 1;
RegionAttachment.prototype.updateRegion = function() {};
MeshAttachment.prototype.updateRegion = function() {};
const sk = parser.readSkeletonData(data);
// print all events with all fields
console.log("== events defined ==");
for (const ev of sk.events) {
  console.log(JSON.stringify({name:ev.name, stringValue:ev.stringValue, intValue:ev.intValue, floatValue:ev.floatValue, audioPath:ev.audioPath, volume:ev.volume}));
}
// for each Talk animation, print event timeline entries
console.log("== Talk animation events ==");
for (const a of sk.animations) {
  if (!a.name.startsWith("Talk_") || !a.name.endsWith("_M")) continue;
  for (const tl of a.timelines) {
    if (tl.constructor.name === 'EventTimeline') {
      for (let i=0;i<tl.events.length;i++){
        const ev = tl.events[i];
        if (ev){
          console.log(`${a.name} t=${tl.frames[i].toFixed(2)} name="${ev.data.name}" str="${ev.stringValue||''}" int=${ev.intValue} float=${ev.floatValue}`);
        }
      }
    }
  }
}
