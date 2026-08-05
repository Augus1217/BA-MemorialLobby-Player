import { SkeletonBinary, AtlasAttachmentLoader, MeshAttachment, RegionAttachment, BoundingBoxAttachment, PathAttachment, PointAttachment, ClippingAttachment } from '@esotericsoftware/spine-core';
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

const path = process.argv[2];
const mode = process.argv[3] || 'compact';
const data = fs.readFileSync(path);
const loader = new NullLoader();
const parser = new SkeletonBinary(loader);
parser.scale = 1;
RegionAttachment.prototype.updateRegion = function() {};
MeshAttachment.prototype.updateRegion = function() {};

try {
  const skeleton = parser.readSkeletonData(data);
  if (mode === 'full') {
    console.log('=== All animations ===');
    for (const a of skeleton.animations) {
      console.log(`  ${a.name.padEnd(30)} dur=${a.duration.toFixed(2)}s`);
    }
    console.log(`=== ${skeleton.events.length} events ===`);
    for (let i = 0; i < skeleton.events.length; i++) {
      const ev = skeleton.events[i];
      console.log(`  [${i}] ${ev.name} str="${ev.stringValue||''}"`);
    }
  } else {
    // Compact: only print animations matching Talk/Pat/Look/Idle/Start_Idle
    const keepPrefixes = ['Talk_', 'Pat', 'Look', 'Idle', 'Start_Idle'];
    for (const a of skeleton.animations) {
      if (!keepPrefixes.some(p => a.name.startsWith(p))) continue;
      const events = [];
      for (const tl of a.timelines) {
        if (tl.constructor.name === 'EventTimeline') {
          for (let i = 0; i < tl.frames.length; i++) {
            const ev = tl.events[i];
            if (ev) events.push({ time: tl.frames[i], name: ev.name, str: ev.stringValue });
          }
        }
      }
      console.log(`${a.name.padEnd(28)} dur=${a.duration.toFixed(2)}s ev=${events.length}`);
      for (const ev of events) {
        const v = ev.str || ev.name;
        console.log(`    t=${ev.time.toFixed(2)}s  "${v}"`);
      }
    }
  }
} catch (e) {
  console.error('parse error:', e.message);
}
