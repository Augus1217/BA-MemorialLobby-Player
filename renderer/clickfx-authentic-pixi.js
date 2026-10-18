// clickfx-authentic-pixi.js — BA UI 觸控特效「原版重製」Pixi/WebGL HDR 後端
// ═══════════════════════════════════════════════════════════════════════════
// 為什麼要這個後端：
//   Canvas2D 後端（clickfx-authentic.js）幾何/動態完全正確，但 8-bit framebuffer
//   上限就是 1.0 —— 材質 _Color 的 HDR 倍率（盤 2.0 / 環 5.99 / 碎片 5.99 /
//   Trail 23.97）存不住，也沒有真正的 GPU bloom。本後端把同一份真值畫進
//   rgba16float RenderTexture：核心可以真的 >1，再餵給 app.js 現成的 URP bloom 鏈
//   （threshold/knee/8 級降採樣/上採樣 scatter，參數對齊遊戲 MXBloomSettings）。
//
// 與 Canvas2D 版的差異（唯一）：HDR 以「疊繪 reps 次」逼近（環/碎片），盤改為
//   「遮罩(normal) + add×2」精確重現 One/OneMinusSrcAlpha ＋ _Color 2.0；
//   Trail 則是 Trail_03 貼圖綬帶 + 逐頂點 float32 HDR 漸層，單次繪製即為真 HDR。
//
// 資料層與 clickfx-authentic.js 共用 clickfx-data.js，零數值漂移。
// ═══════════════════════════════════════════════════════════════════════════
import {
  Container, Sprite, Graphics, Texture, RenderTexture, Rectangle,
  Mesh, Shader, Geometry, Buffer, BufferUsage, Matrix,
} from 'pixi.js';
import { compileHighShaderGlProgram, compileHighShaderGpuProgram } from 'pixi.js';
import {
  localUniformBit, localUniformBitGl, colorBit, colorBitGl,
  textureBit, textureBitGl, roundPixelsBit, roundPixelsBitGl,
} from 'pixi.js';
import {
  TEX_LIST, texURL, DESIGN_H, FA, PA, RING_OUTER, RING_BAND,
  evalKeys, evalColor, rand, TAU, DISK, RINGS, SHARDS, PUFFS, TRAIL, HDR,
} from './clickfx-data.js';

// 疊繪上限（僅盤/環/碎片）：_Color 最大 5.99 → reps ≤ 6，8 就夠。
// Trail 不再走疊繪：改為「Trail_03 貼圖綬帶 × 逐頂點 float32 HDR 漸層」單次繪製。
const HDR_REP_MAX = 8;
const reps = (g) => Math.max(1, Math.min(HDR_REP_MAX, Math.round(g)));

const rgbNum = (c) => ((Math.max(0, Math.min(255, c[0] | 0)) << 16)
  | (Math.max(0, Math.min(255, c[1] | 0)) << 8)
  | Math.max(0, Math.min(255, c[2] | 0)));

function loadImage(url) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => { console.warn('[clickfx-pixi] tex fail:', url); res(null); };
    img.src = url;
  });
}

// Grad_Ring3 → 環形貼圖：真值 Cylinder002 是 r=[1/1.0637, 1] 的薄環面。
// UV0 已由 mesh 資產直接解出（130 頂點、stride 48、UV0 在 offset 40）：
//   V 與半徑完全相關（r=1.0 → V=0.0005；r=1.0637 → V=0.9995）→ V = 帶寬方向（內→外）
//   U 與角度相關（角度↑ → U↓）→ U = 環周角度
// 因此 Grad_Ring3 的 U 剖面（7→242→8 的強隆起）＝「環角向亮度」（新月形亮弧），
// V 剖面（96→107→96）＝帶寬方向近乎均勻（邊緣 ≈0.376）。
// 把 (角度, 帶寬) 取樣 Grad_Ring3 的 alpha 灌進一張方形環圖，之後就能用 Sprite
// 縮放/旋轉（旋轉即真值 RotationModule 的環自轉）。
function buildRingTexture(img) {
  const D = 256;
  const rin = 1 / RING_OUTER;                 // 0.94013
  const src = document.createElement('canvas');
  src.width = img.width; src.height = img.height;
  const sx = src.getContext('2d', { willReadFrequently: true });
  sx.drawImage(img, 0, 0);
  let id;
  try { id = sx.getImageData(0, 0, img.width, img.height).data; } catch (e) { return null; }
  const c = document.createElement('canvas');
  c.width = c.height = D;
  const ctx = c.getContext('2d');
  const out = ctx.createImageData(D, D);
  for (let y = 0; y < D; y++) {
    const dy = (y + 0.5) / D * 2 - 1;
    for (let x = 0; x < D; x++) {
      const dx = (x + 0.5) / D * 2 - 1;
      const rr = Math.sqrt(dx * dx + dy * dy);
      let a = 0;
      if (rr >= rin && rr <= 1) {
        const t = (rr - rin) / (1 - rin);                              // 帶寬 0..1（內→外）＝V
        const ang = (Math.atan2(dy, dx) + Math.PI) / TAU;              // 環周 0..1＝U
        const tu = Math.min(img.width - 1, Math.round(ang * (img.width - 1)));
        const tv = Math.min(img.height - 1, Math.round(t * (img.height - 1)));
        a = id[(tv * img.width + tu) * 4 + 3];
      }
      const o = (y * D + x) * 4;
      out.data[o] = 255; out.data[o + 1] = 255; out.data[o + 2] = 255; out.data[o + 3] = a;
    }
  }
  ctx.putImageData(out, 0, 0);
  const tex = Texture.from(c);
  tex._isRing = true;
  return tex;
}

// 切割三角形圖集（256x128 = 2 框）。真值 UVModule：mode=0 WholeSheet、tilesX=2、
// tilesY=1 → frame = clamp(floor(v×2), 0, 1)，v = startFrame + frameOverTime×k。
// 這是「離散取框」：v<0.5 一律取左框（倒三角）、v≥0.5 取右框（正三角），兩框永不混合。
// （舊版做成 12 個連續滑動視窗＝把兩框切碎拼接，碎片生命期大部分時間顯示半截碎塊，
//   遊戲裡看到的卻是乾淨三角形——即「我們的不是三角形」投訴根因。frame 運算在 Unity
//   native 端、不在 UnityCsReference，spec 的「滑動視窗」說法無出處，屬誤讀。）
function buildTriFrames(img) {
  const halfW = Math.floor(img.width / 2);
  const base = Texture.from(img);
  return [
    new Texture({ source: base.source, frame: new Rectangle(0, 0, halfW, img.height) }),
    new Texture({ source: base.source, frame: new Rectangle(halfW, 0, halfW, img.height) }),
  ];
}

// Circle_01 → 形狀 alpha 貼圖。真值 shader FX_SHADER_AlphaBlend_Add：
//   a_out = tex.x（紅通道）× vcolor.a；rgb_out = tex.rgb × vcolor.rgb × tex.x × 2.0
// 而 Circle_01 的 alpha 通道「全 255」（圓形只存在於 RGB/紅通道）——直接用原圖當遮罩會
// 變成整張方塊不透明。把 alpha 烘成紅通道後，pixi 的 normal（遮罩）/add（HDR）兩道
// 取到的形狀與 shader 完全一致。失敗傳 null，繪製端退回舊加法路徑。
function buildDiskTexture(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  try {
    ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, c.width, c.height);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) d[i + 3] = d[i];
    ctx.putImageData(id, 0, 0);
    return Texture.from(c);
  } catch (e) {
    return null;
  }
}

export async function initClickFxAuthenticPixi({ app } = {}) {
  if (window.__baClickFxPixi) return window.__baClickFxPixi;
  if (!app || !app.renderer) return null;

  const imgs = {};
  await Promise.all(TEX_LIST.map(async (n) => {
    const img = await loadImage(texURL(n));
    if (img) imgs[n.replace(/^FX_TEX_/, '')] = img;
  }));
  const texs = {};
  for (const k of Object.keys(imgs)) texs[k] = Texture.from(imgs[k]);
  if (imgs.Grad_Ring3) texs.__ring = buildRingTexture(imgs.Grad_Ring3);
  if (imgs.Triangle_02_1) texs.__tri = buildTriFrames(imgs.Triangle_02_1);
  if (imgs.Circle_01) texs.__disk = buildDiskTexture(imgs.Circle_01);
  if (!texs.Circle_01 || !texs.__ring || !texs.__tri) {
    console.warn('[clickfx-pixi] 必要貼圖缺失，放棄 Pixi 後端');
    return null;
  }

  let W = app.renderer.width, H = app.renderer.height;
  const mkRT = (w, h) => RenderTexture.create({
    width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)),
    format: 'rgba16float', resolution: 1, antialias: false, dynamic: true,
  });
  let rt = mkRT(W, H);

  // ---- Trail 貼圖綬帶：Trail_03 × 逐頂點 float32 HDR 漸層，單次繪製 ----
  // 舊做法＝繪 hd 24 次 stroke（硬邊、無貼圖、寬度還混入仿製版的 +9px 發明值）。
  // 真值（CAB TrailRenderer + 材質）：
  //   顏色 = Trail_03(u=沿長度、v=帶寬) × colorGradient(頂點隨年齡取樣) × _Color 23.968628
  //   幾何 = widthCurve 恆定 × widthMultiplier 0.005（全寬 0.005×FA=2.7px@1080）
  //   貼圖 Trail_03：alpha 全不透明；亮度＝U 方向頭 235→0.62 處歸零 × V 方向鐘形軟邊
  // blend One/One（additive）且 alpha 全不透明 → 輸出 alpha 對外觀無作用，
  // aColor 直接編「漸層色 × _Color」（可 >1），一次繪製、float RT 內不裁切 = 真 HDR。
  let trailMesh = null, trailOK = false;
  let trailBufPos = null, trailBufUV = null, trailBufCol = null;
  let trailPos, trailUV, trailCol;
  const TRAIL_MAXPTS = 48;
  try {
    const glProgram = compileHighShaderGlProgram({ name: 'clickfx-trail-gl',
      bits: [localUniformBitGl, colorBitGl, textureBitGl, roundPixelsBitGl] });
    const gpuProgram = compileHighShaderGpuProgram({ name: 'clickfx-trail-gpu',
      bits: [localUniformBit, colorBit, textureBit, roundPixelsBit] });
    const tsrc = texs.Trail_03.source;
    const trailShader = new Shader({
      glProgram, gpuProgram,
      resources: {
        uTexture: tsrc,
        uSampler: tsrc.style,
        textureUniforms: { uTextureMatrix: { type: 'mat3x3<f32>', value: new Matrix() } },
      },
    });
    trailPos = new Float32Array(TRAIL_MAXPTS * 4);
    trailUV = new Float32Array(TRAIL_MAXPTS * 4);
    trailCol = new Float32Array(TRAIL_MAXPTS * 8);
    const idx = new Uint16Array((TRAIL_MAXPTS - 1) * 6);
    for (let i = 0; i < TRAIL_MAXPTS - 1; i++) {
      const v = i * 2, o = i * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
      idx[o + 3] = v + 1; idx[o + 4] = v + 3; idx[o + 5] = v + 2;
    }
    const geo = new Geometry({
      attributes: {
        aPosition: { buffer: new Buffer({ data: trailPos, label: 'cfx-trail-pos',
          usage: BufferUsage.VERTEX | BufferUsage.COPY_DST }), format: 'float32x2', stride: 8, offset: 0 },
        aUV: { buffer: new Buffer({ data: trailUV, label: 'cfx-trail-uv',
          usage: BufferUsage.VERTEX | BufferUsage.COPY_DST }), format: 'float32x2', stride: 8, offset: 0 },
        aColor: { buffer: new Buffer({ data: trailCol, label: 'cfx-trail-col',
          usage: BufferUsage.VERTEX | BufferUsage.COPY_DST }), format: 'float32x4', stride: 16, offset: 0 },
      },
      indexBuffer: new Buffer({ data: idx, label: 'cfx-trail-idx',
        usage: BufferUsage.INDEX | BufferUsage.COPY_DST }),
    });
    trailBufPos = geo.getBuffer('aPosition');
    trailBufUV = geo.getBuffer('aUV');
    trailBufCol = geo.getBuffer('aColor');
    trailMesh = new Mesh({ geometry: geo, shader: trailShader, texture: texs.Trail_03, blendMode: 'add' });
    trailMesh.visible = false;
    trailOK = true;
  } catch (e) {
    console.warn('[clickfx-pixi] trail mesh 初始化失敗，Trail 退回 stroke 路徑:', e);
  }

  // fxRoot：直接掛進 app.stage（ensurePostWrap 會收進 postWrap）→ 在 app 現成的 HDR 管線裡
  // 與大廳一起渲進 rgba16float hdrRT，吃 encode/tonemap；各部件以 blend 'add' 疊繪。
  // step() 另外把同一份 fxRoot 再畫進 rt —— 那張 rt 專供 bloom prefilter 使用
  //（＝只泛光觸控特效、不泛光大廳）。
  const fxRoot = new Container();
  fxRoot.eventMode = 'none';
  app.stage.addChild(fxRoot);

  // ---- 物件池：每幀重建 fxRoot 的 children（加法疊繪 reps 次）----
  const spritePool = [];
  let spriteN = 0;
  function pick() {
    let s = spritePool[spriteN];
    if (!s) { s = new Sprite(); s.anchor.set(0.5); s.blendMode = 'add'; spritePool[spriteN] = s; }
    spriteN++;
    return s;
  }
  const trailGfxPool = [];
  let trailN = 0;
  function pickTrail() {
    let g = trailGfxPool[trailN];
    if (!g) { g = new Graphics(); g.blendMode = 'add'; trailGfxPool[trailN] = g; }
    trailN++;
    return g;
  }

  // ---- 類比 Canvas2D 版的模擬狀態 ----
  const parts = [];
  const trailPts = [];
  let dragging = false, lx = 0, ly = 0, puffAcc = 0;
  let last = 0, content = false;   // content＝rt 目前是否非空（app.js 據此決定要不要跑 bloom）

  const px = () => app.renderer.width / Math.max(1, window.innerWidth);
  const py = () => app.renderer.height / Math.max(1, window.innerHeight);
  const designScale = () => app.renderer.height / DESIGN_H;

  function spawn(p) { parts.push(p); }

  function runDown(x, y) {
    const sc = designScale();
    spawn({ kind: 'disk', tex: 'Circle_01', x, y, t: 0, life: DISK.lifeMs / 1000,
      rBase: rand(DISK.sizeMin, DISK.sizeMax) * DISK.sizeScalar / 2 * FA,
      sizeKeys: DISK.sizeKeys, colorKeys: DISK.colorKeys, alphaKeys: DISK.alphaKeys, rot: rand(0, TAU) });
    for (let i = 0; i < RINGS.count; i++) {
      spawn({ kind: 'ring', x, y, t: 0, life: RINGS.lifeMs / 1000,
        rBase: rand(RINGS.sizeMin, RINGS.sizeMax) * RING_OUTER * FA,
        rot: rand(0, TAU), rotV: rand(0, RINGS.rotVMax),
        sizeKeys: RINGS.sizeKeys, colorKeys: RINGS.colorKeys, alphaKeys: RINGS.alphaKeys });
    }
    for (let i = 0; i < SHARDS.count; i++) {
      const ang = rand(0, TAU);
      spawn({ kind: 'tri', sf: rand(0, 0.5), fo: rand(0, 0.5), mul: SHARDS.mul,
        x: x + Math.cos(ang) * SHARDS.spawnR * sc, y: y + Math.sin(ang) * SHARDS.spawnR * sc,
        t: 0, life: rand(SHARDS.lifeMinMs, SHARDS.lifeMaxMs) / 1000,
        vx: Math.cos(ang) * rand(SHARDS.speedMin, SHARDS.speedMax) * sc,
        vy: Math.sin(ang) * rand(SHARDS.speedMin, SHARDS.speedMax) * sc,
        sBase: rand(SHARDS.sizeMin, SHARDS.sizeMax),
        sizeKeys: SHARDS.sizeKeys, colorKeys: SHARDS.colorKeys, alphaKeys: SHARDS.alphaKeys });
    }
  }
  function onDown(e) {
    dragging = true; lx = e.clientX; ly = e.clientY;
    trailPts.length = 0;
    trailPts.push({ x: lx, y: ly, t0: performance.now() });
    runDown(lx * px(), ly * py());
  }
  function onMove(e) {
    if (!dragging) return;
    const now = performance.now();
    const dx = e.clientX - lx, dy = e.clientY - ly;
    const sc = designScale();
    if (Math.hypot(dx, dy) < TRAIL.minVertexDist * sc) return;
    trailPts.push({ x: e.clientX, y: e.clientY, t0: now });
    if (trailPts.length > 48) trailPts.shift();
    puffAcc += Math.hypot(dx, dy);
    if (puffAcc >= PUFFS.spacingPx * sc) {
      puffAcc = 0;
      const ang = rand(0, TAU);
      spawn({ kind: 'tri', sf: rand(0, 0.5), fo: rand(0, 0.5), mul: PUFFS.mul,
        x: e.clientX * px() + Math.cos(ang) * PUFFS.spawnR * sc,
        y: e.clientY * py() + Math.sin(ang) * PUFFS.spawnR * sc,
        t: 0, life: rand(PUFFS.lifeMinMs, PUFFS.lifeMaxMs) / 1000,
        vx: Math.cos(ang) * rand(PUFFS.speedMin, PUFFS.speedMax) * sc,
        vy: Math.sin(ang) * rand(PUFFS.speedMin, PUFFS.speedMax) * sc,
        sBase: rand(PUFFS.sizeMin, PUFFS.sizeMax),
        sizeKeys: PUFFS.sizeKeys, colorKeys: PUFFS.colorKeys, alphaKeys: PUFFS.alphaKeys });
    }
    lx = e.clientX; ly = e.clientY;
  }
  function onUp() { dragging = false; }

  // ---- 每幀（由 app.js 的 hdrTwoPass 呼叫）：更新模擬 → 組成 fxRoot → 畫進 rt ----
  // 繪製序＝fx_touch_spec 真值 layers + GameObject 序：
  //   碎片/puffs＝layer8（最底）→ Trail(layer13) → ring 盤(GO4) → MeshTri 環(GO6)
  // （盤是唯一非加法部件，序會影響它遮住誰——遊戲裡碎片在盤下方被閃盤蓋過。）
  function drawPart(p, sc) {
    const k = p.t / p.life;
    const alpha = evalKeys(p.alphaKeys, k);
    if (alpha <= 0.004) return;
    if (!Number.isFinite(p.x + p.y + alpha)) return;
    const tint = rgbNum(evalColor(p.colorKeys, k));

    if (p.kind === 'disk') {
      const r = p.rBase * evalKeys(p.sizeKeys, k) * sc;
      if (!Number.isFinite(r) || r <= 0) return;
      if (texs.__disk) {
        // 真值 FX_SHADER_AlphaBlend_Add（blend One/OneMinusSrcAlpha）：
        //   rgb_out = tex.rgb × vcolor.rgb × tex.x × 2.0   ← 不乘 alpha（ premult 會蓋場景）
        //   a_out   = tex.x × vcolor.a                     ← 遮罩走紅通道
        // 拆兩道精確重現：①黑 tint normal ＝ dst×(1−a) 遮罩（tint=0 對 premult/straight
        // 都相同）②add ×reps(HDR.disk) 次＝+rgb×2.0（遊戲 _Color 2.0 直出 HDR，會 bloom）。
        const occ = pick();
        occ.texture = texs.__disk; occ.tint = 0x000000; occ.blendMode = 'normal';
        occ.alpha = alpha; occ.position.set(p.x, p.y); occ.width = occ.height = r * 2;
        occ.rotation = p.rot || 0;
        fxRoot.addChild(occ);
        const n = reps(HDR.disk);
        for (let q = 0; q < n; q++) {
          const s = pick();
          s.texture = texs.__disk; s.tint = tint; s.blendMode = 'add';
          s.alpha = 1; s.position.set(p.x, p.y); s.width = s.height = r * 2;
          s.rotation = p.rot || 0;
          fxRoot.addChild(s);
        }
      } else {
        // 形狀貼圖烘壞時的備援：舊加法疊繪（無遮罩，僅相位近似）
        const n = reps(HDR.disk);
        const repsA = Math.min(1, alpha * HDR.disk / n);
        for (let q = 0; q < n; q++) {
          const s = pick();
          s.texture = texs.Circle_01; s.tint = tint; s.blendMode = 'add';
          s.alpha = repsA; s.position.set(p.x, p.y); s.width = s.height = r * 2;
          s.rotation = p.rot || 0;
          fxRoot.addChild(s);
        }
      }
    } else if (p.kind === 'ring') {
      const outer = p.rBase * evalKeys(p.sizeKeys, k) * sc;
      if (!Number.isFinite(outer) || outer <= 0) return;
      const n = reps(HDR.ring);
      const a = Math.min(1, alpha * HDR.ring / n);
      for (let q = 0; q < n; q++) {
        const s = pick();
        s.texture = texs.__ring; s.tint = tint; s.blendMode = 'add';
        s.alpha = a; s.position.set(p.x, p.y); s.width = s.height = outer * 2;
        s.rotation = p.rot || 0;
        fxRoot.addChild(s);
      }
    } else if (p.kind === 'tri') {
      const s = p.sBase * evalKeys(p.sizeKeys, k) * sc;
      if (!Number.isFinite(s) || s <= 0) return;
      // WholeSheet 離散取框：v = sf + fo×k，frame = clamp(floor(v×2),0,1)
      const v = Math.min(1, p.sf + p.fo * k);
      const tex = texs.__tri[v < 0.5 ? 0 : 1];
      const n = reps(HDR.shard);
      const a = Math.min(1, alpha * HDR.shard / n) * (p.mul || 1);
      for (let q = 0; q < n; q++) {
        const sp = pick();
        sp.texture = tex; sp.tint = tint; sp.blendMode = 'add';
        sp.alpha = a; sp.position.set(p.x, p.y); sp.width = sp.height = s;
        fxRoot.addChild(sp);
      }
    }
  }

  function step(now) {
    if (!last) last = now;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const busy = parts.length > 0 || trailPts.length > 0 || dragging;
    if (!busy && !content) return;      // 閒置：rt 已清空，不必再畫
    spriteN = 0; trailN = 0;
    fxRoot.removeChildren();
    const sx = px(), sy = py(), sc = designScale();

    // pass 0：推進年齡、剔除死亡（與繪製分離，繪製序由圖層決定）
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.t += dt;
      if (p.t / p.life >= 1) { parts.splice(i, 1); continue; }
      if (p.vx || p.vy) { p.x += p.vx * dt; p.y += p.vy * dt; }
      if (p.rotV) p.rot += p.rotV * dt;
    }
    // pass 1：碎片/puffs（layer8 最底）
    for (const p of parts) if (p.kind === 'tri') drawPart(p, sc);
    // pass 2：Trail（layer13，遊戲 GO 序在盤之前）
    drawTrail(now, sx, sy, sc);
    // pass 3：盤、環（spawn 序：盤先環後 ＝ GO4 → GO6）
    for (const p of parts) if (p.kind !== 'tri') drawPart(p, sc);

    // 真正把 FX 畫進 HDR rt（float，加法疊繪不裁切 → 真 HDR）
    app.renderer.render({ container: fxRoot, target: rt, clear: true });
    content = fxRoot.children.length > 0;
    // z 序：ensurePostWrap 每幀會把 stage 子節點重掛進 postWrap，順序不保證；
    // 觸控特效在遊戲裡屬 UI 層（蓋在角色/場景之上），所以每幀把 fxRoot 移到最上層。
    const par = fxRoot.parent;
    if (par && par.children[par.children.length - 1] !== fxRoot) par.addChild(fxRoot);
  }

  // Trail 顏色真值取樣：lenGradient 的 key 是「尾→頭」位置比例（0=尾黑、1=頭亮）。
  const lifeS = TRAIL.lifetimeMs / 1000;
  const colAt = (t) => {
    const grad = TRAIL.lenGradient;
    for (let i = 1; i < grad.length; i++) {
      if (t <= grad[i][0]) {
        const [t0, c0] = grad[i - 1], [t1, c1] = grad[i];
        const f = t1 === t0 ? 1 : (t - t0) / (t1 - t0);
        return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
      }
    }
    return grad[grad.length - 1][1];
  };

  function drawTrail(now, sx, sy, sc) {
    while (trailPts.length && (now - trailPts[0].t0) / 1000 > lifeS) trailPts.shift();
    const N = trailPts.length;
    if (N < 2) { if (trailOK) trailMesh.visible = false; return; }
    if (!trailOK) return drawTrailGfx(now, sx, sy, sc);   // shader 建不出來 → 舊 strokes
    const halfW = TRAIL.coreWidth * sc * 0.5;             // 0.005 × FA = 2.7px@1080 全寬
    const kg = HDR.trail / 255;                           // 頂點色 = 漸層 × _Color（可 >1）
    for (let i = 0; i < N; i++) {
      const p = trailPts[i];
      const cx = p.x * sx, cy = p.y * sy;
      const prev = trailPts[i > 0 ? i - 1 : 0], next = trailPts[i < N - 1 ? i + 1 : N - 1];
      let dx = (next.x - prev.x) * sx, dy = (next.y - prev.y) * sy;
      const dl = Math.hypot(dx, dy) || 1;
      const nx = -dy / dl * halfW, ny = dx / dl * halfW;   // 橫向 ±halfW（綬帶半寬）
      const t = Math.min(1, (now - p.t0) / 1000 / lifeS); // 真值：顏色隨「點的年齡」漸黑
      const c = colAt(1 - t);                             // lenGradient 以尾→頭為 key
      const o4 = i * 4, o8 = i * 8, u = 1 - i / (N - 1);
      trailPos[o4] = cx + nx; trailPos[o4 + 1] = cy + ny;
      trailPos[o4 + 2] = cx - nx; trailPos[o4 + 3] = cy - ny;
      trailUV[o4] = u; trailUV[o4 + 1] = 0;
      trailUV[o4 + 2] = u; trailUV[o4 + 3] = 1;
      const rr = c[0] * kg, gg = c[1] * kg, bb = c[2] * kg;
      trailCol[o8] = rr; trailCol[o8 + 1] = gg; trailCol[o8 + 2] = bb; trailCol[o8 + 3] = 1;
      trailCol[o8 + 4] = rr; trailCol[o8 + 5] = gg; trailCol[o8 + 6] = bb; trailCol[o8 + 7] = 1;
    }
    for (let i = N; i < TRAIL_MAXPTS; i++) {              // 未用點塌縮到最後一點 → 退化三角形不成像
      for (let k = 0; k < 4; k++) trailPos[i * 4 + k] = trailPos[(N - 1) * 4 + k];
      for (let k = 0; k < 4; k++) trailUV[i * 4 + k] = trailUV[(N - 1) * 4 + k];
      for (let k = 0; k < 8; k++) trailCol[i * 8 + k] = trailCol[(N - 1) * 8 + k];
    }
    trailBufPos.update(); trailBufUV.update(); trailBufCol.update();
    trailMesh.visible = true;
    fxRoot.addChild(trailMesh);
  }

  // 舊 stroke 路徑，只在 trail mesh 建構失敗時作為備援。
  function drawTrailGfx(now, sx, sy, sc) {
    const base = 0.85 * (1 - (now - trailPts[trailPts.length - 1].t0) / 1000 / lifeS);
    const width = Math.max(2, (TRAIL.coreWidth + TRAIL.glowWidth) * sc);
    const n = reps(HDR.trail);
    const a = Math.min(1, base * HDR.trail / n);
    const N = trailPts.length;
    for (let q = 0; q < n; q++) {
      const g = pickTrail();
      g.clear();
      for (let i = 1; i < N; i++) {
        const p0 = trailPts[i - 1], p1 = trailPts[i];
        const c = colAt(i / (N - 1));
        g.moveTo(p0.x * sx, p0.y * sy);
        g.lineTo(p1.x * sx, p1.y * sy);
        g.stroke({ width, color: rgbNum(c), alpha: a, cap: 'round', join: 'round' });
      }
      fxRoot.addChild(g);
    }
  }

  // ---- resize：重建 rt 與合成貼圖綁定 ----
  function resize() {
    const w = app.renderer.width, h = app.renderer.height;
    if (w === W && h === H) return;
    W = w; H = h;
    try { rt.destroy(true); } catch {}
    rt = mkRT(W, H);
  }
  window.addEventListener('resize', resize, { passive: true });

  window.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp, { passive: true });
  window.addEventListener('pointercancel', onUp, { passive: true });

  const handle = {
    rt: () => rt,
    step,
    hasContent: () => content,
    runDown: (x, y) => runDown(x * px(), y * py()),
    runUp: onUp,
    destroy() {
      try { rt.destroy(true); } catch {}
      if (trailMesh) { try { trailMesh.destroy(); } catch {} trailMesh = null; }
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      delete window.__baClickFxPixi;
    },
    _parts: parts,
    _texs: texs,
    _app: app,
    _root: fxRoot,
    _debug: { reps, HDR, HDR_REP_MAX, designScale, trailOK },
  };
  window.__baClickFxPixi = handle;
  return handle;
}
