import { SkeletonBinary, SkeletonJson, TextureAtlas, AtlasAttachmentLoader, Skeleton, AnimationState, AnimationStateData, MeshAttachment } from '@esotericsoftware/spine-core';
import fs from 'fs';

const mergedSkel = '/tmp/opencode/akari_merged/akari_home.json';
const mergedAtlas = '/tmp/opencode/akari_merged/akari_home.atlas';
const kivoSkel = '/tmp/opencode/kivo/akari_home.skel';
const kivoAtlas = '/tmp/opencode/kivo/akari_home.atlas';

function loadMerged() {
  const atlas = new TextureAtlas(fs.readFileSync(mergedAtlas, 'utf8'), { load: () => {} });
  const sd = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(JSON.parse(fs.readFileSync(mergedSkel, 'utf8')));
  return { sd, atlas };
}
function loadKivo() {
  const atlas = new TextureAtlas(fs.readFileSync(kivoAtlas, 'utf8'), { load: () => {} });
  const sd = new SkeletonBinary(new AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(fs.readFileSync(kivoSkel)));
  return { sd, atlas };
}

let failures = 0, checks = 0;
function check(cond, msg) {
  checks++;
  if (!cond) { failures++; console.log('  FAIL:', msg); }
}
function near(a, b, eps = 1e-3) { return Math.abs(a - b) <= eps; }

const { sd: sdM, atlas: atlasM } = loadMerged();
const { sd: sdK, atlas: atlasK } = loadKivo();

console.log('merged bones/slots/animations:', sdM.bones.length, sdM.slots.length, sdM.animations.map(a=>a.name).join(','));
console.log('kivo   bones/slots/animations:', sdK.bones.length, sdK.slots.length, sdK.animations.map(a=>a.name).join(','));

check(sdM.bones.length === sdK.bones.length, `bone count ${sdM.bones.length} vs ${sdK.bones.length}`);
check(sdM.slots.length === sdK.slots.length, `slot count ${sdM.slots.length} vs ${sdK.slots.length}`);

// slot order must match kivo exactly
for (let i = 0; i < Math.min(sdM.slots.length, sdK.slots.length); i++) {
  check(sdM.slots[i].name === sdK.slots[i].name, `slot[${i}] ${sdM.slots[i].name} vs ${sdK.slots[i].name}`);
}

// every merged mesh attachment must resolve a region in the merged atlas
let meshes = 0, noRegion = 0;
for (const skin of sdM.skins) for (const e of skin.attachments) {
  if (!e) continue;
  for (const name of Object.keys(e)) {
    const att = e[name];
    if (att instanceof MeshAttachment) {
      meshes++;
      if (!att.region) noRegion++;
    }
  }
}
console.log(`merged meshes=${meshes} without region=${noRegion}`);
check(noRegion === 0, 'all meshes resolve regions');

// world transform comparison across animations
const boneNameToIdx = {};
sdK.bones.forEach((b, i) => boneNameToIdx[b.name] = i);

function compare(animName) {
  const animM = sdM.findAnimation(animName);
  const animK = sdK.findAnimation(animName);
  check(!!animM, `merged has animation ${animName}`);
  check(!!animK, `kivo has animation ${animName}`);
  if (!animM || !animK) return;
  const dur = Math.max(animM.duration, animK.duration);
  const skM = new Skeleton(sdM), skK = new Skeleton(sdK);
  const stM = new AnimationState(new AnimationStateData(sdM));
  const stK = new AnimationState(new AnimationStateData(sdK));
  let t = 0;
  while (t <= dur + 0.01) {
    stM.setAnimation(0, animName, false);
    stK.setAnimation(0, animName, false);
    stM.update(t);
    stK.update(t);
    stM.apply(skM);
    stK.apply(skK);
    skM.updateWorldTransform(false);
    skK.updateWorldTransform(false);
    for (const bM of skM.bones) {
      const idx = boneNameToIdx[bM.data.name];
      if (idx === undefined) continue;
      const bK = skK.bones[idx];
      for (const f of ['a', 'b', 'c', 'd', 'worldX', 'worldY']) {
        check(near(bM[f], bK[f], 5e-3), `${animName} t=${t.toFixed(3)} ${bM.data.name}.${f} ${bM[f]} vs ${bK[f]}`);
      }
    }
    // slot attachments + colors by slot order
    for (let i = 0; i < skM.slots.length; i++) {
      const sM = skM.slots[i], sK = skK.slots[i];
      const aM = sM.attachment ? sM.attachment.name : null;
      const aK = sK.attachment ? sK.attachment.name : null;
      check(aM === aK, `${animName} t=${t.toFixed(3)} slot[${i}] attachment ${aM} vs ${aK}`);
      check(near(sM.color.r, sK.color.r) && near(sM.color.g, sK.color.g) && near(sM.color.b, sK.color.b) && near(sM.color.a, sK.color.a), `${animName} t=${t.toFixed(3)} slot[${i}] color`);
    }
    if (dur > 0) t += 0.05;
    else break;
  }
}

const kivoOnly = new Set((process.env.KIVO_ONLY_ANIMS || '').split(',').filter(Boolean));

for (const animK of sdK.animations) {
  if (kivoOnly.has(animK.name)) {
    console.log('  INFO: kivo-only animation not in merged:', animK.name);
    continue;
  }
  compare(animK.name);
}
// merged must not have unexpected extra animations beyond kivo (minus renames is none)
for (const aM of sdM.animations) {
  check(!!sdK.findAnimation(aM.name), `merged animation ${aM.name} also in kivo`);
}

console.log(`\n${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
