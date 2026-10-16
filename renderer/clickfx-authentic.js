// clickfx-authentic.js — BA UI 觸控特效「原版重製」v2
// ═══ 依據真實全域點擊特效 FX_Touch prefab 重寫（2026-10-15 定位）═══
// 源頭：base APK 內建資料 23c05e7f…（資源路徑 UI/FX_TouchUI，管理器
// TouchEffectCreater 掛內建 level1 場景）——不是下載 bundle，全域恆在。
// 完整規格：BA-MemorialLobby-Assets/data/fx_touch_spec.json。
//
// ⚠ 歷史：v1 轉錄的 FX_UIUserInteractionTouch_Start/End_01（22 系統，
// choreography.json）屬 UIUserInteractionTouch/Progress QTE 框架
// （slider/touchAccuracy/GetProgressRatio）＝特殊情境效果，非全域點擊——已棄用。
//
// 五個子系統（Unity 真值 × 舊版仿製模組的像素校準，兩源逐項吻合）：
//   disk    1 顆閃盤  200ms  r64.8px   FX_TEX_Circle_01（白→#3D64FF，擴張後熄滅）
//   rings   2 道細環  600ms  r69/80px  FX_TEX_Grad_Ring3（白→#4CA6FF）
//           ——Grad_Ring3 實為「兩端透明中央不透明」的漸層帶（非環形圖），
//             遊戲以 arc-mesh 繞圓；此處以徑向漸層細環帶重現（band≈6% 半徑），
//             尺寸 0.42→1 擴張、後段旋轉收弧（dissolve wipe）＋淡出
//   shards  4 片三角  600-700ms  spawn r49.9px、speed 50-66.5px/s
//           FX_TEX_Triangle_02_1 兩幀 atlas（左右半幅各一三角；白→#5AA6FF）
//   trail   拖曳    300ms  core 2.7px + glow   FX_TEX_Trail_03（左亮右暗，
//           亮側朝移動方向）＋ 拖曳細環 puffs（Ring(4)：200-400ms）
// 校準：設計高 1080（FA=540）；ring 系速度 ×PA=FA×0.3078824（原模組同源）。
// 遊戲原值：MeshTri maxParticles=3、Ring(3) life 0.6-0.7s/speed 0.3-0.4、
// Ring(4) loop 0.2s、TrailRenderer m_Time 0.3——仿製版 clickCount=4 為其微調，從之。

const texURL = (n) => new URL(`assets/clickfx/${n}.png`, location.href).href;

// ---- 貼圖（檔名＝bundle 內材質 _MainTex 名）----
const TEX_LIST = [
  'FX_TEX_Circle_01',     // disk：白閃盤（黑角透明）
  'FX_TEX_Grad_Ring3',    // rings：漸層帶 256x128（alpha 中央峰）
  'FX_TEX_Triangle_02_1', // shards：三角兩幀 atlas 256x128
  'FX_TEX_Trail_03',      // trail：左亮右暗彗星 256x256
];

// ---- 校準常數（原仿製模組同源）----
const DESIGN_H = 1080;
const FA = DESIGN_H / 2;                    // 540
const OT = 1.0636684;                       // rings 半徑係數
const PA = FA * 0.3078824;                  // 166.26 px per particle-world-unit
const RING_ROT_MULT = 11.170107;
const RING_ROT_DIR = -1;

// ---- 曲線工具（keys: [[t, v, ...], ...] 取值線性插值，相切數分量忽略）----
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
function evalColor(keys, k) {   // keys: [[t, [r,g,b]], ...] → [r,g,b] 0-255
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

// ---- 子系統參數（像素、原模組校準值）----
const DISK = {
  lifeMs: 200, radius: 0.12 * FA,             // 64.8px
  colorKeys: [[0, [255, 255, 255]], [0.1205921, [0.24056602 * 255, 0.39061815 * 255, 255]], [1, [0.24056602 * 255, 0.39061815 * 255, 255]]],
  alphaKeys: [[0, 1], [0.1088273, 1], [1, 0]],
  sizeKeys: [[0, 0.32583582], [0.21392822, 0.7159773], [1, 1]],   // ×radius
};
const RINGS = {
  count: 2, lifeMs: 600,
  radiusMin: 0.12 * FA * OT, radiusMax: 0.14 * FA * OT,   // 68.9 / 80.4px（終值）
  bandToOuterRadius: 0.0598573766034603,
  colorKeys: [[0.1117723, [255, 255, 255]], [0.5000076, [0.2971698 * 255, 0.6532865 * 255, 255]], [1, [0.2971698 * 255, 0.6532865 * 255, 255]]],
  sizeKeys: [[0.007209778, 0.42050898], [0.21392822, 0.7159773], [1, 1]],   // 0.42→1 擴張
  alphaKeys: [[0, 1], [0.35, 0.92], [1, 0]],
  wipeKeys: [[0, 0], [0.35, 0], [1, 1]],      // 後段旋轉收弧（dissolve wipe）
};
const SHARDS = {
  clickCount: 4,                              // 遊戲 MeshTri maxParticles=3；仿製版 4，從之
  lifeMinMs: 600, lifeMaxMs: 700,
  spawnRadius: 0.3 * PA,                      // 49.9px
  speedMin: 0.3 * PA, speedMax: 0.4 * PA,     // 49.9 / 66.5 px/s
  sizeMin: 0.1 * PA, sizeMax: 0.2 * PA,       // 16.6 / 33.3px
  sizeKeys: [[0, 0], [0.15445095, 1], [1, 0]],
  colorKeys: [[0, [255, 255, 255]], [0.1823606, [255, 255, 255]], [0.282353, [0.3726415 * 255, 0.7731873 * 255, 255]], [0.6617685, [0.3529412 * 255, 0.6532865 * 255, 255]], [1, [0.3529412 * 255, 0.6532865 * 255, 255]]],
  rotMult: RING_ROT_MULT,
};
const TRAIL = {
  lifetimeMs: 300,                            // TrailRenderer m_Time 0.3
  coreWidth: 0.005 * FA,                      // 2.7px
  glowWidth: 9,                               // outerGlowWidth
  minVertexDist: 0.01 * FA,                   // 5.4px
  puffLifeMinMs: 200, puffLifeMaxMs: 400,     // Ring(4)：拖曳細環 puffs
  puffRadius: 0.15 * PA,                      // 24.9px
  puffSpeedMin: 0.2 * PA, puffSpeedMax: 0.3 * PA,
  puffSpacingPx: 26,                          // puffs 沿路徑間距
  colorKeys: [[0, [255, 255, 255]], [0.3, [0.3529412 * 255, 0.6532865 * 255, 255]], [1, [0.2971698 * 255, 0.6532865 * 255, 255]]],
  puffColorKeys: [[0, [255, 255, 255]], [0.5, [0.3529412 * 255, 0.6532865 * 255, 255]], [1, [0.2971698 * 255, 0.6532865 * 255, 255]]],
};

// ---- 引擎 ----
export function initClickFxAuthentic() {
  if (window.__baClickFxAuthentic) return window.__baClickFxAuthentic;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;mix-blend-mode:plus-lighter;';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const texs = {};        // 短名 → Image
  const tints = new Map();// `${tex}|${endColor}` → [9 張預染色 offscreen canvas]
  let alive = false, raf = 0, last = 0;
  const parts = [];       // 所有活動粒子
  let scale = 1;          // 設計高 → 螢幕縮放

  function resize() {
    canvas.width = Math.round(canvas.clientWidth * devicePixelRatio);
    canvas.height = Math.round(canvas.clientHeight * devicePixelRatio);
    scale = (canvas.clientHeight / devicePixelRatio) / DESIGN_H;
  }
  window.addEventListener('resize', resize, { passive: true });
  resize();

  // 貼圖載入（additive：黑＝不加色、透明＝不加色，兩種底皆可）
  let loadFail = 0;
  Promise.all(TEX_LIST.map((n) => new Promise((res) => {
    const img = new Image();
    img.onload = () => { texs[n.replace(/^FX_TEX_/, '')] = img; res(); };
    img.onerror = () => { loadFail++; console.warn('[clickfx-authentic] tex fail:', texURL(n)); res(); };
    img.src = texURL(n);
  }))).then(() => {
    if (loadFail) console.warn(`[clickfx-authentic] ${loadFail} 張貼圖載入失敗（需 assets/clickfx/FX_TEX_*.png）`);
  });

  // ---- 預染色 ramp：白→endColor 9 階（白貼圖 × 色乘法，一次烘焙終身使用）----
  const RAMP_N = 9;
  function tintRamp(texName, endColor) {
    const key = `${texName}|${endColor.join()}`;
    let ramp = tints.get(key);
    if (ramp) return ramp;
    const img = texs[texName];
    if (!img) return null;
    ramp = [];
    for (let i = 0; i < RAMP_N; i++) {
      const f = i / (RAMP_N - 1);
      const r = Math.round(255 + (endColor[0] - 255) * f);
      const g = Math.round(255 + (endColor[1] - 255) * f);
      const b = Math.round(255 + (endColor[2] - 255) * f);
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
  // 依生命相位取染色圖（以色曲線終點決定 ramp）
  function tinted(p, k, alpha) {
    const end = p._end || (p._end = evalColor(p.colorKeys, 1));
    const ramp = tintRamp(p.tex, end);
    if (!ramp) return null;
    const rgb = evalColor(p.colorKeys, k);
    // 投影到 白→end 線上取最近階（f = 1 - r/255 對此二色線皆單調）
    const f = Math.max(0, Math.min(1, 1 - rgb[0] / 255));
    const c = ramp[Math.round(f * (RAMP_N - 1))];
    return { c, a: alpha };
  }

  function spawn(p) { parts.push(p); kick(); }

  // ---- tap：disk + rings ×2 + shards ×N ----
  function runDown(x, y) {
    const S = scale;
    // disk（ring 子系統：Circle_01 閃盤，擴張後熄滅）
    spawn({
      kind: 'sprite', tex: 'Circle_01', x, y, t: 0, life: DISK.lifeMs / 1000,
      sizeKeys: DISK.sizeKeys, colorKeys: DISK.colorKeys, alphaKeys: DISK.alphaKeys,
      radius: DISK.radius * S, rot: rand(0, TAU),
    });
    // rings（Ring(3)：兩道細環，反向旋轉＋後段收弧）
    for (let i = 0; i < RINGS.count; i++) {
      spawn({
        kind: 'ring', x, y, t: 0, life: RINGS.lifeMs / 1000,
        radius: rand(RINGS.radiusMin, RINGS.radiusMax) * S,
        rot: rand(0, TAU), rotV: rand(0, 1) * RING_ROT_MULT * RING_ROT_DIR,
        colorKeys: RINGS.colorKeys, sizeKeys: RINGS.sizeKeys,
        alphaKeys: RINGS.alphaKeys, wipeKeys: RINGS.wipeKeys,
        bandK: RINGS.bandToOuterRadius,
      });
    }
    // shards（MeshTri：三角碎片，atlas 兩幀隨機、隨機自旋、外飛）
    for (let i = 0; i < SHARDS.clickCount; i++) {
      const ang = rand(0, TAU);
      const d = SHARDS.spawnRadius * S;
      spawn({
        kind: 'tri', tex: 'Triangle_02_1', frame: (Math.random() * 2) | 0,
        x: x + Math.cos(ang) * d, y: y + Math.sin(ang) * d, t: 0,
        life: rand(SHARDS.lifeMinMs, SHARDS.lifeMaxMs) / 1000,
        vx: Math.cos(ang) * rand(SHARDS.speedMin, SHARDS.speedMax) * S,
        vy: Math.sin(ang) * rand(SHARDS.speedMin, SHARDS.speedMax) * S,
        size: rand(SHARDS.sizeMin, SHARDS.sizeMax) * S,
        sizeKeys: SHARDS.sizeKeys, colorKeys: SHARDS.colorKeys,
        rot: rand(0, TAU), rotV: rand(-1, 1) * SHARDS.rotMult * 0.3,
      });
    }
    kick();
  }

  // ---- 拖曳：Trail（TrailRenderer）＋拖曳細環 puffs（Ring(4)）----
  let dragging = false, lx = 0, ly = 0;
  const trailPts = [];   // {x, y, t0} ribbon 控制點
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
    // 拖曳細環 puffs（Ring(4)：0.2-0.4s 小環，沿路徑間距觸發）
    puffAcc += Math.hypot(dx, dy);
    if (puffAcc >= TRAIL.puffSpacingPx * scale) {
      puffAcc = 0;
      spawn({
        kind: 'ring', x: e.clientX, y: e.clientY, t: 0,
        life: rand(TRAIL.puffLifeMinMs, TRAIL.puffLifeMaxMs) / 1000,
        radius: rand(TRAIL.puffSizeMin, TRAIL.puffSizeMax) * scale,
        rot: rand(0, TAU), rotV: rand(-1, 1) * 2,
        colorKeys: TRAIL.puffColorKeys,
        sizeKeys: [[0, 0.55], [0.4, 1], [1, 1]],
        alphaKeys: [[0, 0], [0.12, 0.75], [1, 0]],
        wipeKeys: null, bandK: 0.09,
        vx: 0, vy: 0,
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
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.globalCompositeOperation = 'lighter';

    // trail ribbon 先畫（在最底層）
    drawTrailRibbon(now);

    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) { parts.splice(i, 1); continue; }

      // 位置積分（輕微阻尼）
      if (p.vx || p.vy) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - 2.2 * dt; p.vy *= 1 - 2.2 * dt; }
      if (p.rotV) p.rot += p.rotV * dt;

      let alpha = evalKeys(p.alphaKeys, k);
      if (p.base != null) alpha *= p.base;
      if (alpha <= 0.004) continue;
      const rgb = evalColor(p.colorKeys, k);

      if (p.kind === 'sprite') {
        // 閃盤：Circle_01 白盤擴張＋白→藍染色
        const r = p.radius * evalKeys(p.sizeKeys, k);
        const t = tinted(p, k, alpha);
        if (!t) continue;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot || 0);
        ctx.globalAlpha = t.a;
        ctx.drawImage(t.c, -r, -r, r * 2, r * 2);
        ctx.restore();
      } else if (p.kind === 'ring') {
        // 細環帶：Grad_Ring3 漸層帶繞圓＝徑向漸層描邊（band 中央亮、內外緣透明）
        const outer = p.radius * evalKeys(p.sizeKeys, k);
        const band = Math.max(2, outer * p.bandK * 2);
        const wipe = p.wipeKeys ? evalKeys(p.wipeKeys, k) : 0;
        ctx.save();
        ctx.beginPath();
        // 收弧：弧長 2π→0，起點隨 rot 旋轉（dissolve wipe）
        ctx.arc(p.x, p.y, outer, p.rot, p.rot + TAU * (1 - wipe));
        const g = ctx.createRadialGradient(p.x, p.y, Math.max(0, outer - band / 2), p.x, p.y, outer + band / 2);
        const [r0, g0, b0] = rgb.map((v) => v | 0);
        g.addColorStop(0, `rgba(${r0},${g0},${b0},0)`);
        g.addColorStop(0.5, `rgba(${r0},${g0},${b0},${alpha})`);
        g.addColorStop(1, `rgba(${r0},${g0},${b0},0)`);
        ctx.strokeStyle = g;
        ctx.lineWidth = band;
        ctx.stroke();
        ctx.restore();
      } else if (p.kind === 'tri') {
        // 三角碎片：atlas 左右半幅各一三角，縮放自旋＋染色
        const s = p.size * evalKeys(p.sizeKeys, k);
        const t = tinted(p, k, alpha);
        if (!t) continue;
        const img = texs[p.tex];
        const fx = (p.frame || 0) * (img.width / 2);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = t.a;
        ctx.drawImage(t.c, fx, 0, img.width / 2, img.height, -s, -s, s * 2, s * 2);
        ctx.restore();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    if (parts.length || trailPts.length) { raf = requestAnimationFrame(tick); }
    else { alive = false; ctx.clearRect(0, 0, canvas.width, canvas.height); }
  }

  // TrailRenderer 重現：0.3s ribbon，Trail_03 亮側朝移動方向，逐段染色
  function drawTrailRibbon(now) {
    const lifeS = TRAIL.lifetimeMs / 1000;
    while (trailPts.length && (now - trailPts[0].t0) / 1000 > lifeS) trailPts.shift();
    if (trailPts.length < 2) return;
    const img = texs['Trail_03'];
    if (!img) return;
    const H = Math.max(6, (TRAIL.coreWidth + TRAIL.glowWidth) * 2 * scale);
    for (let i = 1; i < trailPts.length; i++) {
      const a = trailPts[i - 1], b = trailPts[i];
      const k = (now - b.t0) / 1000 / lifeS;
      if (k >= 1) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.5) continue;
      const ang = Math.atan2(dy, dx);
      const p = { tex: 'Trail_03', colorKeys: TRAIL.colorKeys };
      const t = tinted(p, k, (1 - k) * 0.9);
      if (!t) continue;
      ctx.save();
      ctx.translate(b.x, b.y);          // 段前端＝最新點
      ctx.rotate(ang);
      ctx.scale(-1, 1);                 // 亮側（貼圖左）朝移動方向
      ctx.globalAlpha = t.a;
      ctx.drawImage(t.c, -len * 1.3, -H / 2, len * 1.3, H);
      ctx.restore();
    }
  }

  window.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp, { passive: true });
  window.addEventListener('pointercancel', onUp, { passive: true });

  const handle = { canvas, runDown, runUp: onUp, _parts: parts, _texs: texs };
  window.__baClickFxAuthentic = handle;
  return handle;
}
