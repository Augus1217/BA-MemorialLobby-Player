// clickfx-authentic-pixi.js — BA UI 觸控特效「原版重製」Pixi/WebGL HDR 後端
// ═══════════════════════════════════════════════════════════════════════════
// 為什麼要這個後端：
//   Canvas2D 後端（clickfx-authentic.js）幾何/動態完全正確，但 8-bit framebuffer
//   上限就是 1.0 —— 材質 _Color 的 HDR 倍率（盤 2.0 / 環 5.99 / 碎片 5.99 /
//   Trail 23.97）存不住，也沒有真正的 GPU bloom。本後端把同一份真值畫進
//   rgba16float RenderTexture：核心可以真的 >1，再餵給 app.js 現成的 URP bloom 鏈
//   （threshold/knee/8 級降採樣/上採樣 scatter，參數對齊遊戲 MXBloomSettings）。
//
// 與 Canvas2D 版的差異（唯一）：HDR 以「同一部件加法疊繪 reps 次」達成；
//   reps = round(_Color 倍率)（上限 HDR_REP_MAX）。float RT 內加法不裁切，
//   所以疊繪後的值是真正的 HDR（>1），這正是 Canvas2D 做不到的部分。
//
// 資料層與 clickfx-authentic.js 共用 clickfx-data.js，零數值漂移。
// ═══════════════════════════════════════════════════════════════════════════
import { Container, Sprite, Graphics, Texture, RenderTexture, Rectangle } from 'pixi.js';
import {
  TEX_LIST, texURL, DESIGN_H, FA, PA, RING_OUTER, RING_BAND,
  evalKeys, evalColor, rand, TAU, DISK, RINGS, SHARDS, PUFFS, TRAIL, HDR,
} from './clickfx-data.js';

// 疊繪上限：_Color 最大 23.97（Trail）→ round = 24 次，全數照做（不再「8 次夠用」）。
// 成本只落在拖曳中的 Trail（同一條路徑畫 24 遍），桌機 GPU 無感。
const HDR_REP_MAX = 24;
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

// 切割三角形圖集（256x128 = 2 框）成 12 個滑動視窗子貼圖（MeshTri UVModule WholeSheet）。
function buildTriFrames(img) {
  const out = [];
  const N = 12, halfW = img.width / 2;
  const base = Texture.from(img);
  for (let i = 0; i < N; i++) {
    const off = (i / (N - 1)) * halfW;
    out.push(new Texture({ source: base.source, frame: new Rectangle(off, 0, halfW, img.height) }));
  }
  return out;
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
  function step(now) {
    if (!last) last = now;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const busy = parts.length > 0 || trailPts.length > 0 || dragging;
    if (!busy && !content) return;      // 閒置：rt 已清空，不必再畫
    spriteN = 0; trailN = 0;
    fxRoot.removeChildren();
    const sx = px(), sy = py(), sc = designScale();

    drawTrail(now, sx, sy, sc);

    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) { parts.splice(i, 1); continue; }
      if (p.vx || p.vy) { p.x += p.vx * dt; p.y += p.vy * dt; }
      if (p.rotV) p.rot += p.rotV * dt;
      const alpha = evalKeys(p.alphaKeys, k);
      if (alpha <= 0.004) continue;
      if (!Number.isFinite(p.x + p.y + alpha)) continue;
      const rgb = evalColor(p.colorKeys, k);
      const tint = rgbNum(rgb);

      if (p.kind === 'disk') {
        const r = p.rBase * evalKeys(p.sizeKeys, k) * sc;
        if (!Number.isFinite(r) || r <= 0) continue;
        const n = reps(HDR.disk);
        const repsA = Math.min(1, alpha * HDR.disk / n);
        // 不另加「光暈近似層」：APK 只有 Circle_01 一顆（_Color 2.0），光暈由真 bloom 產生。
        for (let q = 0; q < n; q++) {
          const s = pick();
          s.texture = texs.Circle_01; s.tint = tint; s.rotation = p.rot || 0;
          s.alpha = repsA; s.position.set(p.x, p.y); s.width = s.height = r * 2;
          fxRoot.addChild(s);
        }
      } else if (p.kind === 'ring') {
        const outer = p.rBase * evalKeys(p.sizeKeys, k) * sc;
        if (!Number.isFinite(outer) || outer <= 0) continue;
        const n = reps(HDR.ring);
        const a = Math.min(1, alpha * HDR.ring / n);
        for (let q = 0; q < n; q++) {
          const s = pick();
          s.texture = texs.__ring; s.tint = tint; s.rotation = p.rot || 0;
          s.alpha = a; s.position.set(p.x, p.y); s.width = s.height = outer * 2;
          fxRoot.addChild(s);
        }
      } else if (p.kind === 'tri') {
        const s = p.sBase * evalKeys(p.sizeKeys, k) * sc;
        if (!Number.isFinite(s) || s <= 0) continue;
        const fp = Math.min(1, p.sf + p.fo * k);
        const tex = texs.__tri[Math.min(texs.__tri.length - 1, Math.round(fp * (texs.__tri.length - 1)))];
        const n = reps(HDR.shard);
        const a = Math.min(1, alpha * HDR.shard / n) * (p.mul || 1);
        for (let q = 0; q < n; q++) {
          const sp = pick();
          sp.texture = tex; sp.tint = tint;
          sp.alpha = a; sp.position.set(p.x, p.y); sp.width = sp.height = s;
          fxRoot.addChild(sp);
        }
      }
    }

    // 真正把 FX 畫進 HDR rt（float，加法疊繪不裁切 → 真 HDR）
    app.renderer.render({ container: fxRoot, target: rt, clear: true });
    content = fxRoot.children.length > 0;
    // z 序：ensurePostWrap 每幀會把 stage 子節點重掛進 postWrap，順序不保證；
    // 觸控特效在遊戲裡屬 UI 層（蓋在角色/場景之上），所以每幀把 fxRoot 移到最上層。
    const par = fxRoot.parent;
    if (par && par.children[par.children.length - 1] !== fxRoot) par.addChild(fxRoot);
  }

  function drawTrail(now, sx, sy, sc) {
    const lifeS = TRAIL.lifetimeMs / 1000;
    while (trailPts.length && (now - trailPts[0].t0) / 1000 > lifeS) trailPts.shift();
    if (trailPts.length < 2) return;
    const headT = (now - trailPts[trailPts.length - 1].t0) / 1000 / lifeS;
    if (headT >= 1) return;
    const base = 0.85 * (1 - headT);
    const width = Math.max(2, (TRAIL.coreWidth + TRAIL.glowWidth) * sc);
    const grad = TRAIL.lenGradient;
    const colAt = (t) => {
      for (let i = 1; i < grad.length; i++) {
        if (t <= grad[i][0]) {
          const [t0, c0] = grad[i - 1], [t1, c1] = grad[i];
          const f = t1 === t0 ? 1 : (t - t0) / (t1 - t0);
          return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
        }
      }
      return grad[grad.length - 1][1];
    };
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
    _debug: { reps, HDR, HDR_REP_MAX, designScale },
  };
  window.__baClickFxPixi = handle;
  return handle;
}
