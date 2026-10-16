// clickfx-authentic.js — BA UI 觸控特效「原版重製」v3
// ═══ 2026-10-16：FX_Touch prefab CAB（23c05e7f…）typetree 完整解剖後重寫 ═══
// 本版所有數值直接取自 CAB 反序列化（fx_cab_full.json / fx_truth.json），不含猜測。
// v2.x 的「dissolve 收弧／碎片自旋／中心三角／puffs 小環／速度阻尼／環淡出」皆為
// 猜測，已全數依真資料修正。真實架構（單位→px = ×FA(540)×該系統 localScale）：
//
//   ring(PS_15)      白閃盤   Circle_01 billboard  burst1  life0.2s   scale1
//   MeshTri(PS_16)   擴張環×2 Cylinder002 環面網格（外徑1.0637/內徑1.0，
//                    帶寬=5.99%半徑）Grad_Ring3  burst2  life0.6s  scale1
//   Ring(3)(PS_18)   碎片×4   Triangle_02_1 兩框 billboard、CircleEdge r=0.3、
//                    外飛0.3-0.4、life0.6-0.7s、alpha 三連閃、不旋轉
//                    scale=0.3078824（＝PA 常數的出處，CAB Transform T7/T8）
//   Ring(4)(PS_17)   拖曳小片 同 Ring(3) 材質，CircleEdge r=0.15、外飄0.2-0.3、
//                    life0.2-0.4s、rateOverDistance=5/單位（每 108px 一顆）
//   Trail(GO_3)      TrailRenderer time0.3 width0.005 Trail_03
//                    colorGradient：頭(0,.39,1)→(0,.095,.28)→尾黑
// 材質映射（CAB renderer m_Materials）：Ring(3)/Ring(4)→FX_MAT_Touch_Tri 2
// （=Triangle_02_1）；MeshTri→FX_MAT_Touch_Tri3（=Grad_Ring3）；
// ring→FX_MAT_Touch_Cross2（=Circle_01）；Trail→FX_MAT_TouchFXTrail（=Trail_03）。
//
// ── v3.1 第二輪 CAB 驗證補正（2026-10-16）──
//  • Unity 2021.3.56f2；shapeType 10=CircleEdge（生成環=radius1.0×scale）、18=Donut；
//    disk/MeshTri 的 shape 停用 → 中心生成
//  • MinMaxGradient 語意（UnityCsReference）：Color 模式生效值 = m_ColorMax →
//    碎片/puffs startColor = 灰 0.5377（壓暗），盤/環 = 白；「藍 minColor」為切模式殘值
//  • bursts：disk 1、MeshTri 2、Ring3 4、Ring4 無爆發（rateOverDistance=5.0）
//  • 盤 startSize = rand(0.12,0.14)（InitialModule state 3，非固定值）
//  • UVModule 真行為 = WholeSheet 滑動視窗（startFrame/frameOverTime ∈ [0,0.5]），
//    視窗由框 0 滑向框 1（非隨機固定框）
//  • Cylinder002 UV0：u=環周角度、v=帶寬方向（130 頂點、雙圈 r=1.0/1.0637）
//
// ── v3.2 第三輪：APK 資料堆挖出「shader／NGUI 縮放／bloom」三件事（2026-10-16）──
//  • Shader 本體（各 FX 材質 externals[0]）名字與 blend 全解出：
//      Tri 2（碎片/puffs） DSFX/FX_SHADER_Additive_0    blend One/One（純加法）
//      TouchFXTrail（Trail）同 shader                    blend One/One
//      Tri3（環）          Shader Graphs/FX_SHADER_Dissolve_GachaGauge_P  SrcAlpha/One
//      Cross2（盤）        DSFX/FX_SHADER_AlphaBlend_Add One/OneMinusSrcAlpha（alpha 疊合）
//    → Canvas2D 'lighter' 對碎片/puffs/Trail/環成立；盤嚴格說是 One/OneMinusSrcAlpha（近似）
//  • HDR 倍率（材質 _Color >1 即 HDR，光暈的真正來源）：
//      Tri 2 ×5.992157（碎片/puffs，再乘 startColor 0.5377 → 3.222）
//      Tri3 ×5.992157（環；屬性名 Color_D20A2F66）  Cross2 ×2.0（盤）  Trail ×23.968628
//  • NGUI 縮放鏈：level1 UICamera 正交 orthographicSize=1.0 → 半高 1 世界單位 →
//      1 單位 = 畫面高/2 px（1080p=540）＝FA 的直接來源（不再只是校準）
//      FX 生成於 scale=1 的父節點（TouchEffectCreater／場景根），不吃 UI Root 的 0.00114
//  • 泛光真的存在：URP + 自訂 renderer feature（UIRenderFeature 掛在 PotalRenderer）
//      MXBloomSettings{Threshold 1.0, SoftKnee, Diffusion 1.7, AnamorphicRatio} +
//      UIRenderPassSettings{GrabRTBeforeUI, UIRenderWidth/Height, scatter…} + compute blur
//    → Canvas2D 無法複製 GPU bloom，改以 _Color 的 HDR 疊繪近似其「核心過曝」
//  • FX 物件 layer：碎片/puffs=8(LetterBox)、盤/環/Trail=13(UIAlwaysVisible)

const texURL = (n) => new URL(`assets/clickfx/${n}.png`, location.href).href;

const TEX_LIST = [
  'FX_TEX_Circle_01',     // disk（ring PS_15 → FX_MAT_Touch_Cross2）
  'FX_TEX_Grad_Ring3',    // 擴張環（MeshTri → FX_MAT_Touch_Tri3）；U 剖面＝環角向亮度
  'FX_TEX_Triangle_02_1', // 碎片/puffs（Ring(3)/Ring(4) → FX_MAT_Touch_Tri 2，兩框）
  'FX_TEX_Trail_03',      // Trail（FX_MAT_TouchFXTrail）——Canvas2D 版以漸層重現
];

const DESIGN_H = 1080;
// FA：盤/環/trail 的 px/單位。由 level1 UICamera.orthographicSize=1.0 推導：
// 相機半高=1 世界單位 → 1 單位 = 畫面高/2 px（1080p=540），不再是校準值
const FA = DESIGN_H / 2;
const PASC = 0.3078824;                      // Ring(3)/Ring(4) localScale（CAB T7/T8）
const PA = FA * PASC;                        // 166.26 px/單位（碎片/puffs）
const RING_OUTER = 1.0637;                   // Cylinder002 外圈頂點半徑
const RING_BAND = 0.0599;                    // (1.0637-1)/1.0637 ＝帶寬/外徑

// ---- 曲線工具（keys: [[t, v, ...], ...] 線性插值；Unity 相切數分量忽略）----
function evalKeys(keys, k) {
  if (!keys || !keys.length) return 1;
  if (k <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (k <= keys[i][0]) {
      const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
      return t1 === t0 ? v1 : v0 + (v1 - v0) * (k - t0) / (t1 - t0);
    }
  }
  return keys[keys.length - 1][1];
}
function evalColor(keys, k) {   // keys: [[t, [r,g,b]], ...] → [r,g,b]
  if (!keys || !keys.length) return [255, 255, 255];
  if (k <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (k <= keys[i][0]) {
      const [t0, c0] = keys[i - 1], [t1, c1] = keys[i];
      const f = t1 === t0 ? 1 : (k - t0) / (t1 - t0);
      return c1.map((c, j) => c0[j] + (c - c0[j]) * f);
    }
  }
  return keys[keys.length - 1][1];
}
const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

// ---- 子系統真值（CAB）----
const DISK = {   // ring PS_15：Circle_01 白閃盤
  lifeMs: 200,
  sizeMin: 0.12, sizeMax: 0.14,             // startSize state 3：rand(0.12,0.14)（真值）
  sizeScalar: 2.0,                          // SizeModule scalar（直徑倍率）→ 半徑 64.8–75.6px
  sizeKeys: [[0, 0.3258358], [0.21392822, 0.7159773], [1, 1]],
  colorKeys: [[0, [255, 255, 255]], [0.1205921, [61.3, 99.6, 255]], [1, [0, 0, 0]]],
  alphaKeys: [[0, 1], [0.1088273, 1], [1, 0]],
};
const RINGS = {  // MeshTri PS_16：Cylinder002 環面網格 × Grad_Ring3
  count: 2, lifeMs: 600,
  sizeMin: 0.12, sizeMax: 0.14,             // 半徑 = size0 × 1.0637 × curve × FA
  sizeKeys: [[0.0072098, 0.42050898], [0.21392822, 0.7159773], [1, 1]],
  colorKeys: [[0.1117723, [255, 255, 255]], [0.5, [75.8, 166.6, 255]], [1, [0, 20.9, 204.5]]],
  alphaKeys: [[0, 1], [0.9971, 1], [1, 0]], // 常亮、生命末端急滅（ColorModule 真值）
  rotVMax: 1,                                // RotationModule：0-1 rad/s 隨機
};
const SHARDS = { // Ring(3) PS_18：三角碎片 ×4（三連閃、無自旋、無阻尼）
  count: 4, lifeMinMs: 600, lifeMaxMs: 700,
  mul: 0.5377358,                           // startColor 常數 = maxColor 灰 0.5377（真值壓暗）
  spawnR: 0.3 * PA, speedMin: 0.3 * PA, speedMax: 0.4 * PA,
  sizeMin: 0.1 * PA, sizeMax: 0.2 * PA,
  sizeKeys: [[0, 0], [0.15445095, 1], [1, 0]],
  colorKeys: [[0.1823606, [255, 255, 255]], [0.282353, [95, 197, 255]], [0.4617647, [95, 197, 255]], [0.6617647, [90, 186, 241]], [0.8264732, [95, 197, 255]], [1, [95, 197, 255]]],
  // ColorModule alpha 時間軸：1→0→1→0→1→0→1 停亮（三連閃）
  alphaKeys: [[0, 1], [0.2881996, 1], [0.3646943, 0], [0.4706475, 1], [0.5735445, 0], [0.6676084, 1], [0.7558647, 0], [0.8529488, 1], [1, 1]],
};
const PUFFS = {  // Ring(4) PS_17：拖曳小片（同 Ring(3) 材質與閃爍）
  spacingPx: FA / 5,                        // rateOverDistance 5/單位 → 每 108px
  mul: 0.5377358,                           // startColor 常數 = maxColor 灰 0.5377（真值壓暗）
  spawnR: 0.15 * PA, speedMin: 0.2 * PA, speedMax: 0.3 * PA,
  lifeMinMs: 200, lifeMaxMs: 400,
  sizeMin: 0.1 * PA, sizeMax: 0.2 * PA,
  sizeKeys: SHARDS.sizeKeys, colorKeys: SHARDS.colorKeys, alphaKeys: SHARDS.alphaKeys,
};
const TRAIL = {  // Trail GO：TrailRenderer 真值
  lifetimeMs: 300,
  coreWidth: 0.005 * FA, glowWidth: 9,      // 核心 2.7px；+仿製版 outerGlow 9
  minVertexDist: 0.01 * FA,
  // TrailRenderer colorGradient（頭亮→尾黑；此處以尾→頭表示，數值同真值）
  lenGradient: [[0, [0, 0, 0]], [0.5794156, [0, 24.19, 72]], [0.97941558, [0, 99.6, 255]], [1, [0, 99.6, 255]]],
};

// ---- HDR 倍率：材質 _Color（>1 即 HDR）----
//   Tri 2（碎片/puffs）5.992157、Tri3（環）5.992157、Cross2（盤）2.0、Trail 23.968628
// （碎片/puffs 的 startColor 0.5377 已含在 SHARDS.mul／PUFFS.mul，這裡只乘 _Color）
// Canvas2D 無 HDR framebuffer → 以「重複加法疊繪 n 次」近似：核心自然疊到白＝遊戲過曝
const HDR = { disk: 2.0, ring: 5.992157, shard: 5.992157, trail: 23.968628 };
const HDR_REP_MAX = 4;
const hdrReps = (g) => Math.max(1, Math.min(HDR_REP_MAX, Math.round(g)));

// ---- 引擎 ----
export function initClickFxAuthentic() {
  if (window.__baClickFxAuthentic) return window.__baClickFxAuthentic;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;mix-blend-mode:plus-lighter;';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const texs = {};        // 短名 → Image
  const tints = new Map();// `${tex}|${colorKeys}` → [12 張預染色 canvas]
  let alive = false, raf = 0, last = 0;
  const parts = [];
  let scale = 1;          // 設計高 → 螢幕
  let ringProfile = null; // Grad_Ring3 中心列 alpha（0-1 × 256）＝環的角向亮度

  function resize() {
    canvas.width = Math.round(canvas.clientWidth * devicePixelRatio);
    canvas.height = Math.round(canvas.clientHeight * devicePixelRatio);
    scale = (canvas.clientHeight / devicePixelRatio) / DESIGN_H;
  }
  window.addEventListener('resize', resize, { passive: true });
  resize();

  let loadFail = 0;
  Promise.all(TEX_LIST.map((n) => new Promise((res) => {
    const img = new Image();
    img.onload = () => { texs[n.replace(/^FX_TEX_/, '')] = img; if (n.includes('Grad_Ring3')) buildRingProfile(img); res(); };
    img.onerror = () => { loadFail++; console.warn('[clickfx-authentic] tex fail:', texURL(n)); res(); };
    img.src = texURL(n);
  }))).then(() => {
    if (loadFail) console.warn(`[clickfx-authentic] ${loadFail} 張貼圖載入失敗（需 assets/clickfx/FX_TEX_*.png）`);
  });

  function buildRingProfile(img) {
    try {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0);
      const d = x.getImageData(0, img.height >> 1, img.width, 1).data;
      ringProfile = [];
      for (let i = 0; i < img.width; i++) ringProfile.push(d[i * 4 + 3] / 255);
    } catch (e) { ringProfile = null; }
  }

  // ---- 預染色 ramp：沿該部件自己的色曲線取 12 樣（白→藍→深藍→黑 都精確）----
  const RAMP_N = 12;
  function tintRamp(texName, colorKeys, mul) {
    const key = `${texName}|${mul}|${JSON.stringify(colorKeys)}`;
    let ramp = tints.get(key);
    if (ramp) return ramp;
    const img = texs[texName];
    if (!img) return null;
    ramp = [];
    for (let i = 0; i < RAMP_N; i++) {
      const [r, g, b] = evalColor(colorKeys, i / (RAMP_N - 1)).map((v) => Math.min(255, (v * mul) | 0));
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      x.globalCompositeOperation = 'multiply';
      x.fillStyle = `rgb(${r},${g},${b})`;
      x.fillRect(0, 0, c.width, c.height);
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(img, 0, 0);
      ramp.push(c);
    }
    tints.set(key, ramp);
    return ramp;
  }
  function tinted(p, k, alpha) {
    const ramp = p._ramp || (p._ramp = tintRamp(p.tex, p.colorKeys, p.mul || 1));
    if (!ramp) return null;
    const f = Math.max(0, Math.min(1, k));
    return { c: ramp[Math.round(f * (RAMP_N - 1))], a: alpha };
  }

  function spawn(p) { parts.push(p); kick(); }

  // ---- tap：盤 + 環×2 + 碎片×4（全依 CAB burst 真值）----
  function runDown(x, y) {
    // ring(PS_15)：白閃盤，1 顆，0.2s
    spawn({
      kind: 'sprite', tex: 'Circle_01', x, y, t: 0, life: DISK.lifeMs / 1000,
      rBase: rand(DISK.sizeMin, DISK.sizeMax) * DISK.sizeScalar / 2 * FA,
      sizeKeys: DISK.sizeKeys, colorKeys: DISK.colorKeys,
      alphaKeys: DISK.alphaKeys, rot: rand(0, TAU),
    });
    // MeshTri(PS_16)：擴張環 ×2（burst 2），隨機尺寸、隨機初轉、0-1 rad/s 慢旋
    for (let i = 0; i < RINGS.count; i++) {
      spawn({
        kind: 'ring', x, y, t: 0, life: RINGS.lifeMs / 1000,
        rBase: rand(RINGS.sizeMin, RINGS.sizeMax) * RING_OUTER * FA,
        rot: rand(0, TAU), rotV: rand(0, RINGS.rotVMax),
        sizeKeys: RINGS.sizeKeys, colorKeys: RINGS.colorKeys, alphaKeys: RINGS.alphaKeys,
      });
    }
    // Ring(3)(PS_18)：三角碎片 ×4（burst 4），CircleEdge 隨機角、外飛、無自旋
    for (let i = 0; i < SHARDS.count; i++) {
      const ang = rand(0, TAU);
      // UVModule 真值：startFrame/frameOverTime 各 U[0,0.5]（WholeSheet 滑動視窗）
      const sf = rand(0, 0.5), fo = rand(0, 0.5);
      spawn({
        kind: 'tri', tex: 'Triangle_02_1', sf, fo, mul: SHARDS.mul,
        x: x + Math.cos(ang) * SHARDS.spawnR * scale, y: y + Math.sin(ang) * SHARDS.spawnR * scale,
        t: 0, life: rand(SHARDS.lifeMinMs, SHARDS.lifeMaxMs) / 1000,
        vx: Math.cos(ang) * rand(SHARDS.speedMin, SHARDS.speedMax) * scale,
        vy: Math.sin(ang) * rand(SHARDS.speedMin, SHARDS.speedMax) * scale,
        sBase: rand(SHARDS.sizeMin, SHARDS.sizeMax),
        sizeKeys: SHARDS.sizeKeys, colorKeys: SHARDS.colorKeys, alphaKeys: SHARDS.alphaKeys,
      });
    }
    kick();
  }

  // ---- 拖曳：Trail 綬帶 + Ring(4) 小片（rateOverDistance）----
  let dragging = false, lx = 0, ly = 0;
  const trailPts = [];
  let puffAcc = 0;
  function onDown(e) {
    dragging = true; lx = e.clientX; ly = e.clientY;
    trailPts.length = 0;
    trailPts.push({ x: lx, y: ly, t0: performance.now() });
    runDown(lx, ly);
  }
  function onMove(e) {
    if (!dragging) return;
    const now = performance.now();
    const dx = e.clientX - lx, dy = e.clientY - ly;
    if (Math.hypot(dx, dy) < TRAIL.minVertexDist * scale) return;
    trailPts.push({ x: e.clientX, y: e.clientY, t0: now });
    if (trailPts.length > 48) trailPts.shift();
    // Ring(4)：rateOverDistance 5/單位 → 每 108px 一顆，CircleEdge 隨機角、外飄
    puffAcc += Math.hypot(dx, dy);
    if (puffAcc >= PUFFS.spacingPx * scale) {
      puffAcc = 0;
      const ang = rand(0, TAU);
      const sf = rand(0, 0.5), fo = rand(0, 0.5);
      spawn({
        kind: 'tri', tex: 'Triangle_02_1', sf, fo, mul: PUFFS.mul,
        x: e.clientX + Math.cos(ang) * PUFFS.spawnR * scale,
        y: e.clientY + Math.sin(ang) * PUFFS.spawnR * scale,
        t: 0, life: rand(PUFFS.lifeMinMs, PUFFS.lifeMaxMs) / 1000,
        vx: Math.cos(ang) * rand(PUFFS.speedMin, PUFFS.speedMax) * scale,
        vy: Math.sin(ang) * rand(PUFFS.speedMin, PUFFS.speedMax) * scale,
        sBase: rand(PUFFS.sizeMin, PUFFS.sizeMax),
        sizeKeys: PUFFS.sizeKeys, colorKeys: PUFFS.colorKeys, alphaKeys: PUFFS.alphaKeys,
      });
    }
    kick();
    lx = e.clientX; ly = e.clientY;
  }
  function onUp() { dragging = false; }

  function kick() {
    if (alive) return;
    alive = true; last = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function tick(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    try {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(devicePixelRatio, devicePixelRatio);
      ctx.globalCompositeOperation = 'lighter';

      drawTrailRibbon(now);

      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.t += dt;
        const k = p.t / p.life;
        if (k >= 1) { parts.splice(i, 1); continue; }

        // 等速直線（Unity 無外力＝無阻尼）
        if (p.vx || p.vy) { p.x += p.vx * dt; p.y += p.vy * dt; }
        if (p.rotV) p.rot += p.rotV * dt;

        const alpha = evalKeys(p.alphaKeys, k);
        if (alpha <= 0.004) continue;
        if (!Number.isFinite(p.x + p.y + alpha)) continue;
        const rgb = evalColor(p.colorKeys, k);

        if (p.kind === 'sprite') {
          // 白閃盤：0.12×2.0 單位直徑 × sizeCurve
          const r = p.rBase * evalKeys(p.sizeKeys, k) * scale;
          if (!Number.isFinite(r) || r <= 0) continue;
          const t = tinted(p, k, alpha);
          if (!t) continue;
          const n = hdrReps(HDR.disk);
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot || 0);
          ctx.globalAlpha = t.a * 0.35;         // 光暈近似層（固定，不乘 gain）
          const gr = r * 1.35;
          ctx.drawImage(t.c, -gr, -gr, gr * 2, gr * 2);
          // 核心 × HDR 2.0（材質 _Color）
          ctx.globalAlpha = Math.min(1, t.a * HDR.disk / n);
          for (let q = 0; q < n; q++) ctx.drawImage(t.c, -r, -r, r * 2, r * 2);
          ctx.restore();
        } else if (p.kind === 'ring') {
          // 擴張環：外徑 = size0×1.0637×curve，帶寬 5.99% 外徑
          const outer = p.rBase * evalKeys(p.sizeKeys, k) * scale;
          if (!Number.isFinite(outer) || outer <= 0) continue;
          const band = Math.max(1.5, outer * RING_BAND);
          const rn = hdrReps(HDR.ring);
          const [r0, g0, b0] = rgb.map((v) => v | 0);
          ctx.save();
          // 光暈近似層（仿製版 bloom 的 Canvas2D 替代）
          const gw = ctx.createRadialGradient(p.x, p.y, Math.max(0, outer - band * 1.5), p.x, p.y, outer + band * 1.5);
          gw.addColorStop(0, `rgba(${r0},${g0},${b0},0)`);
          gw.addColorStop(0.5, `rgba(${r0},${g0},${b0},${alpha * 0.3})`);
          gw.addColorStop(1, `rgba(${r0},${g0},${b0},0)`);
          ctx.strokeStyle = gw;
          ctx.lineWidth = band * 3;
          ctx.beginPath();
          ctx.arc(p.x, p.y, outer, 0, TAU);
          ctx.stroke();
          // 核心：角向亮度＝Grad_Ring3 U 剖面（貼圖繞圓，MeshTri 真行為）
          if (typeof ctx.createConicGradient === 'function') {
            const cg = ctx.createConicGradient(p.rot, p.x, p.y);
            const N = 32;
            for (let s = 0; s <= N; s++) {
              const tt = s / N;
              const a = ringProfile ? ringProfile[Math.min(255, (tt * 255) | 0)] : 1;
              cg.addColorStop(tt, `rgba(${r0},${g0},${b0},${(alpha * a).toFixed(3)})`);
            }
            ctx.strokeStyle = cg;
            ctx.lineWidth = band;
            for (let q = 0; q < rn; q++) { ctx.beginPath(); ctx.arc(p.x, p.y, outer, 0, TAU); ctx.stroke(); }
          } else {
            const g = ctx.createRadialGradient(p.x, p.y, Math.max(0, outer - band / 2), p.x, p.y, outer + band / 2);
            g.addColorStop(0, `rgba(${r0},${g0},${b0},0)`);
            g.addColorStop(0.5, `rgba(${r0},${g0},${b0},${alpha})`);
            g.addColorStop(1, `rgba(${r0},${g0},${b0},0)`);
            ctx.strokeStyle = g;
            ctx.lineWidth = band;
            for (let q = 0; q < rn; q++) { ctx.beginPath(); ctx.arc(p.x, p.y, outer, 0, TAU); ctx.stroke(); }
          }
          ctx.restore();
        } else if (p.kind === 'tri') {
          // 三角碎片/puffs：atlas billboard，quad 邊長 = size，無旋轉；UVModule WholeSheet：
          // 視窗位置 framepos = startFrame + frameOverTime×lifeK，由框 0 滑向框 1
          const s = p.sBase * evalKeys(p.sizeKeys, k) * scale;
          if (!Number.isFinite(s) || s <= 0) continue;
          const t = tinted(p, k, alpha);
          if (!t) continue;
          const img = texs[p.tex];
          const fp = Math.min(1, p.sf + p.fo * k);
          const x0 = fp * (img.width / 2);
          const n = hdrReps(HDR.shard);
          ctx.save();
          ctx.translate(p.x, p.y);
          // 核心 × HDR 5.992（材質 _Color；startColor 0.5377 已含在 mul）
          ctx.globalAlpha = Math.min(1, t.a * HDR.shard / n);
          for (let q = 0; q < n; q++) ctx.drawImage(t.c, x0, 0, img.width / 2, img.height, -s / 2, -s / 2, s, s);
          ctx.restore();
        }
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    } catch (e) {
      console.warn('[clickfx-authentic] tick 錯誤（略過此幀）:', e);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    } finally {
      if (parts.length || trailPts.length) { raf = requestAnimationFrame(tick); }
      else { alive = false; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); }
    }
  }

  // TrailRenderer：0.3s 連續綬帶，尾黑→頭亮藍（真 colorGradient）
  function drawTrailRibbon(now) {
    const lifeS = TRAIL.lifetimeMs / 1000;
    while (trailPts.length && (now - trailPts[0].t0) / 1000 > lifeS) trailPts.shift();
    if (trailPts.length < 2) return;
    const tail = trailPts[0], head = trailPts[trailPts.length - 1];
    const headAge = (now - head.t0) / 1000 / lifeS;
    if (headAge >= 1) return;
    const grad = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
    const al = 0.85 * (1 - headAge);
    for (const [t, c] of TRAIL.lenGradient) {
      grad.addColorStop(t, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${al})`);
    }
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    for (let i = 1; i < trailPts.length; i++) ctx.lineTo(trailPts[i].x, trailPts[i].y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = grad;
    ctx.lineWidth = Math.max(2, (TRAIL.coreWidth + TRAIL.glowWidth) * scale);
    // × HDR 23.97（材質 _Color）：重複疊繪使核心過曝發白（近似遊戲 HDR+bloom）
    const tn = hdrReps(HDR.trail);
    for (let q = 0; q < tn; q++) ctx.stroke();
  }

  window.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp, { passive: true });
  window.addEventListener('pointercancel', onUp, { passive: true });

  const handle = { canvas, runDown, runUp: onUp, _parts: parts, _texs: texs };
  window.__baClickFxAuthentic = handle;
  return handle;
}
