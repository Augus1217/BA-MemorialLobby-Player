import { SkeletonBinary, SkeletonJson, TextureAtlas, AtlasAttachmentLoader } from '@esotericsoftware/spine-core';
import fs from 'fs';
import { skeletonDataToJson } from '/home/augus/BA_MemorialLobbyElectron/scripts/spine-serialize.mjs';

const files = [
  ['ROLE', '/home/augus/BA_MemorialLobbyElectron/assets/spine/Akari_home/Akari_home/akari_home_official.skel', '/home/augus/BA_MemorialLobbyElectron/assets/spine/Akari_home/Akari_home/akari_home_official.atlas'],
  ['SCENE', '/home/augus/BA_MemorialLobbyElectron/assets/scene/Akari_home/akari_scene.skel', '/home/augus/BA_MemorialLobbyElectron/assets/scene/Akari_home/akari_scene.atlas'],
  ['BG', '/home/augus/BA_MemorialLobbyElectron/assets/scene/Akari_home/akari_bg.skel', '/home/augus/BA_MemorialLobbyElectron/assets/scene/Akari_home/akari_bg.atlas'],
  ['KIVO', '/tmp/opencode/kivo/akari_home.skel', '/tmp/opencode/kivo/akari_home.atlas'],
];

const EPS = 1e-3;
let failures = 0;
let checks = 0;

function near(a, b, eps = EPS) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= eps;
  return a === b;
}
function arrNear(a, b, eps = EPS) {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!near(a[i], b[i], eps)) return false;
  return true;
}
function check(cond, msg) {
  checks++;
  if (!cond) { failures++; console.log('  FAIL:', msg); }
}

function load(skelPath, atlasPath) {
  const atlas = new TextureAtlas(fs.readFileSync(atlasPath, 'utf8'), { load: () => {} });
  return new SkeletonBinary(new AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(fs.readFileSync(skelPath)));
}

function colorCmp(c1, c2, msg) {
  check(c1 && c2, msg + ' color exists');
  if (!c1 || !c2) return;
  check(near(c1.r, c2.r) && near(c1.g, c2.g) && near(c1.b, c2.b) && near(c1.a, c2.a), msg + ` color ${JSON.stringify([c1.r,c1.g,c1.b,c1.a])} vs ${JSON.stringify([c2.r,c2.g,c2.b,c2.a])}`);
}

function describeTimeline(tl) {
  const d = { type: tl.constructor.name, frames: Array.from(tl.frames) };
  if (tl.curves) d.curves = Array.from(tl.curves);
  if (tl.attachmentNames) d.attachmentNames = Array.from(tl.attachmentNames);
  if (tl.events) d.events = tl.events.map(e => ({ time: e.time, name: e.data.name, int: e.intValue, float: e.floatValue, string: e.stringValue }));
  if (tl.drawOrders) d.drawOrders = tl.drawOrders.map(x => x ? Array.from(x) : null);
  if (tl.vertices) d.vertices = tl.vertices.map(v => v ? Array.from(v) : null);
  if (tl.delays) d.delays = Array.from(tl.delays);
  return d;
}

for (const [name, sk, at] of files) {
  const sd1 = load(sk, at);
  const json = skeletonDataToJson(sd1);
  const atlas2 = new TextureAtlas(fs.readFileSync(at, 'utf8'), { load: () => {} });
  const sd2 = new SkeletonJson(new AtlasAttachmentLoader(atlas2)).readSkeletonData(json);

  console.log(`== ${name} ==`);
  // bones
  check(sd1.bones.length === sd2.bones.length, `bone count ${sd1.bones.length} vs ${sd2.bones.length}`);
  for (let i = 0; i < sd1.bones.length; i++) {
    const a = sd1.bones[i], b = sd2.bones[i];
    const p = `bone[${i}] ${a.name}`;
    check(a.name === b.name, p + ' name');
    check((a.parent ? a.parent.name : null) === (b.parent ? b.parent.name : null), p + ' parent');
    for (const f of ['length', 'x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY'])
      check(near(a[f], b[f]), `${p} ${f} ${a[f]} vs ${b[f]}`);
    check(a.inherit === b.inherit, p + ` inherit ${a.inherit} vs ${b.inherit}`);
    check(a.skinRequired === b.skinRequired, p + ' skinRequired');
  }
  // slots
  check(sd1.slots.length === sd2.slots.length, `slot count ${sd1.slots.length} vs ${sd2.slots.length}`);
  for (let i = 0; i < sd1.slots.length; i++) {
    const a = sd1.slots[i], b = sd2.slots[i];
    const p = `slot[${i}] ${a.name}`;
    check(a.name === b.name, p + ' name');
    check(a.boneData.name === b.boneData.name, p + ' bone');
    check(a.attachmentName === b.attachmentName, p + ` attachmentName ${a.attachmentName} vs ${b.attachmentName}`);
    check(a.blendMode === b.blendMode, p + ` blendMode ${a.blendMode} vs ${b.blendMode}`);
    check(a.visible === b.visible, p + ' visible');
    colorCmp(a.color, b.color, p);
  }
  // constraints
  check(sd1.ikConstraints.length === sd2.ikConstraints.length, `ik count`);
  for (let i = 0; i < sd1.ikConstraints.length; i++) {
    const a = sd1.ikConstraints[i], b = sd2.ikConstraints[i];
    check(a.name === b.name && a.target.name === b.target.name && a.bones.length === b.bones.length, `ik[${i}] ${a.name} structure`);
    for (const f of ['mix', 'softness']) check(near(a[f], b[f]), `ik[${i}] ${f} ${a[f]} vs ${b[f]}`);
    check(a.bendDirection === b.bendDirection && a.compress === b.compress && a.stretch === b.stretch && a.uniform === b.uniform, `ik[${i}] booleans`);
  }
  check(sd1.transformConstraints.length === sd2.transformConstraints.length, `transform count`);
  for (let i = 0; i < sd1.transformConstraints.length; i++) {
    const a = sd1.transformConstraints[i], b = sd2.transformConstraints[i];
    check(a.name === b.name && a.target.name === b.target.name, `tc[${i}] structure`);
    for (const f of ['offsetRotation', 'offsetX', 'offsetY', 'offsetScaleX', 'offsetScaleY', 'offsetShearY', 'mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY'])
      check(near(a[f], b[f]), `tc[${i}] ${f} ${a[f]} vs ${b[f]}`);
    check(a.local === b.local && a.relative === b.relative, `tc[${i}] local/relative`);
  }
  check(sd1.pathConstraints.length === sd2.pathConstraints.length, `path count`);
  check(sd1.physicsConstraints.length === sd2.physicsConstraints.length, `physics count`);
  // events
  check(sd1.events.length === sd2.events.length, `event count ${sd1.events.length} vs ${sd2.events.length}`);
  for (let i = 0; i < sd1.events.length; i++) {
    const a = sd1.events[i], b = sd2.events[i];
    const p = `event[${i}] ${a.name}`;
    check(a.name === b.name, p + ' name');
    for (const f of ['intValue', 'floatValue']) check(near(a[f], b[f]), `${p} ${f} ${a[f]} vs ${b[f]}`);
    check(a.stringValue === b.stringValue, p + ' stringValue');
    check(a.audioPath === b.audioPath, p + ' audioPath');
    if (a.audioPath) check(near(a.volume, b.volume) && near(a.balance, b.balance), p + ' volume/balance');
  }
  // skins
  check(sd1.skins.length === sd2.skins.length, `skin count ${sd1.skins.length} vs ${sd2.skins.length}`);
  for (let s = 0; s < sd1.skins.length; s++) {
    const sk1 = sd1.skins[s], sk2 = sd2.skins[s];
    check(sk1.name === sk2.name, `skin[${s}] name`);
    check(sk1.bones.length === sk2.bones.length && sk1.bones.every((b, i) => b.name === sk2.bones[i].name), `skin[${s}] bones`);
    for (let si = 0; si < sd1.slots.length; si++) {
      const d1 = sk1.attachments[si], d2 = sk2.attachments[si];
      const n1 = d1 ? Object.keys(d1).length : 0, n2 = d2 ? Object.keys(d2).length : 0;
      check(n1 === n2, `skin[${s}] slot[${si}] att count ${n1} vs ${n2}`);
      if (!d1 || !d2) continue;
      for (const an of Object.keys(d1)) {
        const a = d1[an], b = d2[an];
        const p = `skin[${s}] slot[${si}] ${an}`;
        check(a.constructor.name === b.constructor.name, `${p} type ${a.constructor.name} vs ${b.constructor.name}`);
        if (a.constructor.name !== b.constructor.name) continue;
        check(a.path === b.path, `${p} path ${a.path} vs ${b.path}`);
        if (a.constructor.name === 'MeshAttachment') {
          check(arrNear(a.regionUVs, b.regionUVs, 1e-4), p + ' uvs');
          check(arrNear(a.triangles, b.triangles), p + ' triangles');
          check(arrNear(a.vertices, b.vertices, 1e-3), p + ' vertices');
          check(a.bones === null ? b.bones === null : (b.bones !== null && arrNear(a.bones, b.bones)), p + ' bones');
          check(near(a.hullLength, b.hullLength), p + ` hull ${a.hullLength} vs ${b.hullLength}`);
          check(near(a.width, b.width), p + ' width');
          check(near(a.height, b.height), p + ' height');
          check(arrNear(a.edges || [], b.edges || []), p + ' edges');
          colorCmp(a.color, b.color, p);
        } else if (a.constructor.name === 'RegionAttachment') {
          for (const f of ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'width', 'height']) check(near(a[f], b[f]), `${p} ${f} ${a[f]} vs ${b[f]}`);
          colorCmp(a.color, b.color, p);
        }
      }
    }
  }
  // animations
  check(sd1.animations.length === sd2.animations.length, `anim count ${sd1.animations.length} vs ${sd2.animations.length}`);
  for (let i = 0; i < sd1.animations.length; i++) {
    const a1 = sd1.animations[i], a2 = sd2.animations[i];
    check(a1.name === a2.name, `anim[${i}] name`);
    check(a1.timelines.length === a2.timelines.length, `anim ${a1.name} timeline count ${a1.timelines.length} vs ${a2.timelines.length}`);
    const n = Math.min(a1.timelines.length, a2.timelines.length);
    for (let t = 0; t < n; t++) {
      const d1 = describeTimeline(a1.timelines[t]);
      const d2 = describeTimeline(a2.timelines[t]);
      const p = `anim ${a1.name} tl[${t}] ${d1.type}`;
      check(d1.type === d2.type, p + ' type');
      check(arrNear(d1.frames, d2.frames), p + ' frames');
      if (d1.curves) check(arrNear(d1.curves, d2.curves, 2e-3), p + ' curves (bezier chain)');
      if (d1.attachmentNames) check(arrNear(d1.attachmentNames, d2.attachmentNames), p + ' attachmentNames');
      if (d1.events) check(JSON.stringify(d1.events) === JSON.stringify(d2.events), p + ' events');
      if (d1.drawOrders) check(JSON.stringify(d1.drawOrders) === JSON.stringify(d2.drawOrders), p + ' drawOrders');
      if (d1.vertices) check(JSON.stringify(d1.vertices) === JSON.stringify(d2.vertices), p + ' deform vertices');
      if (d1.delays) check(arrNear(d1.delays, d2.delays), p + ' sequence delays');
    }
  }
  console.log(`  wrote ${JSON.stringify(json).length} bytes of JSON`);
}

console.log(`\n${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
