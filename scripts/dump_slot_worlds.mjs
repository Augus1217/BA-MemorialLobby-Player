import fs from 'node:fs';
import * as SC from '@esotericsoftware/spine-core';
const _s = (a) => a.filter((x) => typeof x === 'string').pop() ?? 'stub';
class StubLoader {
  newRegionAttachment(...a) { const n = _s(a); const r = new SC.RegionAttachment(n, n); r.region = { name: n }; return r; }
  newMeshAttachment(...a) { const n = _s(a); const m = new SC.MeshAttachment({ name: n }); m.region = { name: n }; m.path = n; m.name = n; return m; }
  newBoundingBoxAttachment(...a) { return new SC.BoundingBoxAttachment(_s(a)); }
  newPathAttachment(...a) { return new SC.PathAttachment(_s(a)); }
  newPointAttachment(...a) { return new SC.PointAttachment(_s(a)); }
  newClipAttachment(...a) { return new SC.ClipAttachment(_s(a)); }
  newClippingAttachment(...a) { return { name: _s(a) }; }
}
const loader = new SC.SkeletonBinary(new SC.SkeletonData());
loader.attachmentLoader = new StubLoader();
const data = loader.readSkeletonData(new Uint8Array(fs.readFileSync('/home/augus/BA-MemorialLobby-Assets/assets/spine/Hanako_home/Hanako_home.skel')));
const skeleton = new SC.Skeleton(data);
skeleton.setToSetupPose();
skeleton.updateWorldTransform(SC.Physics.update);
const world = new Float32Array(8192);
for (const slot of skeleton.slots) {
  const att = slot.getAttachment();
  if (!att || !att.computeWorldVertices) continue;
  if (!/light_effect/.test(att.name ?? '')) continue;
  const n = Math.min(att.worldVerticesLength, world.length);
  att.computeWorldVertices(slot, 0, n, world, 0, 2);
  let cx=0, cy=0, cnt=0;
  for (let v=0; v<n; v+=2) { cx+=world[v]; cy+=world[v+1]; cnt++; }
  console.log(`${att.name}\t${slot.data.name}\t${(cx/cnt).toFixed(0)}\t${(cy/cnt).toFixed(0)}`);
}
