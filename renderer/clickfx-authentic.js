// clickfx-authentic.js — BA UI 觸控特效「原版重製」
// 參數逐項轉錄自 game bundle assets-_mx-etceffects-uifx-uiuserinteraction_fx
// （完整規格見 BA-MemorialLobby-Assets/data/clickfx_choreography.json，commit b775c28）。
// 22 系統中的 tap 家族（Touch_Start_01 ×8 + Touch_End_01 ×13）+ 拖曳筆線
// （Progress_Trail_01/02 子系統；遊戲以 dragTouchEffects 沿路徑生成實例，本模組同構）。
// 貼圖＝遊戲原版 FX_TEX_*（assets/clickfx/，由 Assets repo manual/clickfx 管線供給）。
// 渲染：Canvas2D additive（lighter + CSS plus-lighter）模擬 Unity HDR bloom——
// 小粒子多尺度疊 draw 出白心，大粒子（巨環／漣漪）單層保忠實 alpha；
// Stretch 系統沿速度方向拉伸；3D 環 mesh 以 Circle_Ring_10 貼圖近似。

// 貼圖路徑：以頁面 URL 相對解析（dev 根路徑與 prod 打包都成立；
// 不要用 new URL(x, import.meta.url)——vite 會把動態模板字串轉成 import.meta.glob 導致路徑錯亂）
const texURL = (n) => new URL(`assets/clickfx/${n}.png`, location.href).href;
const PX = 50;            // Unity world unit → px（巨環自動 clamp 螢幕）

// ---- 貼圖清單（遊戲原版，檔名＝bundle 內材質 _MainTex 名）----
const TEX_LIST = [
  'FX_TEX_Circle_Glow_01_Clamp_1', // Glow_A/B 軟光盤（Circle_Glow_01_UI）
  'FX_TEX_Circle_01',              // Circle 白閃盤（Circle_Glow_02_UI）
  'FX_TEX_Bulletline_08',          // P_Dot 圓點（Shot_01_UI）
  'FX_TEX_Flare_26',               // P_Flare 金閃（Flare_01_UI）
  'FX_TEX_Stretch_Line_01a_Clamp', // P_Spot 楔形三角（Spot_Light_01_UI）
  'FX_TEX_Hit_07i',                // HIt_01 金星爆（Hit_02_UI）
  'FX_TEX_Shock_Wave_14',          // HIt_02 碎片（Hit_01_UI mask）
  'FX_TEX_Circle_Ring_10',         // Ring 環（Ring_Glow_01_UI／3D mesh 近似）
  'FX_TEX_Flare_18',               // Trail Light 光斑（TopConfrontationGauge_1）
  'FX_TEX_Circle_Glow_02',         // Trail aura_2（Trail_Wave_02_UI main）
  'FX_TEX_Glow_13',                // Trail aura_6（Trail_Wave_03_UI main）
  'FX_TEX_Glow_Trail_01',          // Trail aura_1/3/7/8（Trail_Wave_01_UI main）
  'FX_TEX_Lightning_Line_19',      // Trail 閃電（Lightning_01_UI main）
];

// ---- 曲線工具 ----
function evalKeys(keys, k) {          // keys: [[t,v],...] 升冪；回傳線性插值
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
const rand = (a, b) => a + Math.random() * (b - a);

// ---- 系統資料表（轉錄；colorEnv 為 alpha 包絡近似——加法混合下等效）----
// tex: 貼圖鍵（TEX_LIST 去前綴）、c: startColor、life/speed/size: [min,max] 或常數、
// sz: 尺寸曲線 keys（t 0-1, v 0-1）×mul、env: alpha 包絡、stretch: 沿速度拉伸倍率、
// burst: [[t,count],...]、sort: 繪製序（大者後畫→在上層）
const S = (o) => o;

const TOUCH_START = [
  S({ name: 'Glow_B(暗盤-吸入)', tex: 'Circle_Glow_01_Clamp_1', c: '#1b1c1f', life: 0.7, speed: 0, size: 2.82,
      sz: { keys: [[0, 0.88], [0.57, 0]], mul: 1 }, env: [[0, 1], [0.3, 1], [1, 0]], sort: 0 }),
  S({ name: 'Glow_A(閃盤)', tex: 'Circle_Glow_01_Clamp_1', c: '#5facff', life: 0.4, speed: 0, size: 1.52,
      sz: { keys: [[0, 1], [1, 0]], mul: 1.5 }, env: [[0, 1], [0.15, 1], [0.3, 0.6], [1, 0]], sort: 2 }),
  S({ name: 'Ring_Glow(慢漣漪)', tex: 'Circle_Ring_10', c: '#1b699c', life: 0.5, speed: 0, size: 2.25,
      sz: { keys: [[0, 0], [0.15, 0.82], [1, 1]], mul: 1 }, env: [[0, 0], [0.03, 1], [1, 0]], sort: 2 }),
  S({ name: 'Ring_Glow_2(快環)', tex: 'Circle_Ring_10', c: '#1b699c', life: 0.3, speed: 0, size: 5.59,
      sz: { keys: [[0, 1], [0.5, 0.24], [1, 0.19]], mul: 1 }, env: [[0, 0], [0.15, 1], [0.676, 0.5], [1, 0]], sort: 2 }),
  S({ name: 'Circle(軟盤)', tex: 'Circle_01', c: '#49a5ff', life: 0.8, speed: 0, size: 0.39,
      sz: { keys: [[0, 0.36], [0.21, 1]], mul: 1 }, env: [[0, 0.36], [0.2, 1], [0.819, 0.4], [1, 0]], sort: 3 }),
  S({ name: 'Ring(3D環)', tex: 'Circle_Ring_10', c: '#69b3ff', life: 0.6, speed: 0, size: 0.25,
      sz: { keys: [[0, 1], [0.38, 0.33], [1, 0.29]], mul: 1 }, env: [[0, 0], [0.144, 1], [0.75, 0.7], [1, 0]], sort: 4 }),
  S({ name: 'P_Dot(淚滴)', tex: 'Bulletline_08', c: '#66aeff', life: [0.3, 0.7], speed: [5, 12], size: [0.1, 0.2],
      sz: { keys: [[0, 0], [0.08, 1], [1, 0]], mul: 0.365 }, env: [[0, 0], [0.08, 1], [1, 0]], stretch: 5, burst: 5,
      shapeR: 0.11, sort: 5 }),
  S({ name: 'P_Flare(金星)', tex: 'Flare_26', c: '#ffdc6d', life: [0.3, 0.65], speed: [3, 3.4], size: [0.2, 0.6],
      sz: { keys: [[0, 0], [0.07, 1], [0.22, 0.34], [0.31, 0.9], [0.43, 0.31], [0.53, 0.84], [0.67, 0.35], [0.81, 0.7], [1, 0]], mul: 1 },
      env: [[0, 0.9], [0.2, 1], [0.5, 0.8], [0.942, 0], [1, 0]], rot0: Math.PI / 4, burst: 7, shapeR: 0.4, sort: 6 }),
];

const TOUCH_END = [
  S({ name: 'Glow_B(暗盤)', tex: 'Circle_Glow_01_Clamp_1', c: '#1b1c1f', life: 0.5, speed: 0, size: 3.78,
      sz: { keys: [[0, 0.88], [0.57, 0]], mul: 1 }, env: [[0, 0.89], [0.3, 0.7], [1, 0]], sort: 0 }),
  S({ name: 'Glow_A(成長盤)', tex: 'Circle_Glow_01_Clamp_1', c: '#4e86ff', life: 0.4, speed: 0, size: 1.64,
      sz: { keys: [[0, 0], [0.1, 0.81], [1, 1]], mul: 1.5 }, env: [[0, 0], [0.1, 1], [1, 0]], sort: 2 }),
  S({ name: 'Circle(白閃盤)', tex: 'Circle_01', c: '#ffffff', life: 0.6, speed: 0, size: 0.6,
      sz: { keys: [[0, 0.34], [0.17, 1], [1, 0]], mul: 1 }, env: [[0, 1], [0.026, 1], [0.672, 0.3], [0.819, 0], [1, 0]], sort: 3 }),
  S({ name: 'Ring_Glow(主漣漪)', tex: 'Circle_Ring_10', c: '#288bcc', life: 0.7, speed: 0, size: 2.85,
      sz: { keys: [[0, 0], [0.3, 0.85], [1, 1]], mul: 1 }, env: [[0, 0], [0.03, 1], [1, 0]], sort: 2 }),
  S({ name: 'Ring_Glow_1(巨環)', tex: 'Circle_Ring_10', c: '#3488d9', life: 0.4, speed: 0, size: 33,
      sz: { keys: [[0, 0], [1, 1]], mul: 1 }, env: [[0, 0], [0.03, 1], [1, 0]], sort: 2, clampScreen: true }),
  S({ name: 'Ring(3D環)', tex: 'Circle_Ring_10', c: '#9eceff', life: 0.4, speed: 0, size: 0.21,
      sz: { keys: [[0, 0.02], [0.38, 0.84], [1, 1]], mul: 1 }, env: [[0, 0], [0.144, 1], [0.432, 0.8], [0.629, 0.6], [0.9, 0.3], [1, 0]], sort: 4 }),
  S({ name: 'P_Dot_01(藍點爆)', tex: 'Bulletline_08', c: '#5491d6', life: [0.2, 0.6], speed: [6, 10], size: [0.07, 0.22],
      sz: { keys: [[0, 0], [0.11, 1], [1, 0]], mul: 0.603 }, env: [[0, 0], [0.11, 1], [1, 0]], stretch: 3, burst: 12,
      shapeR: 0.09, sort: 5 }),
  S({ name: 'P_Dot_01(白塵)', tex: 'Bulletline_08', c: '#fefeff', life: [0.2, 0.5], speed: [0.5, 1.2], size: [0.04, 0.06],
      sz: { keys: [[0, 1], [0.08, 0.57], [0.18, 0.91], [0.33, 0.44], [0.46, 0.92], [0.56, 0.38], [0.7, 0.8], [0.85, 0.3], [1, 0]], mul: 1 },
      env: [[0, 1], [0.309, 0.8], [1, 0]], burst: 10, shapeR: 0.16, sort: 5 }),
  S({ name: 'P_Flare(金星)', tex: 'Flare_26', c: '#ffdc6d', life: [0.15, 0.6], speed: [3, 4], size: [0.15, 0.85],
      sz: { keys: [[0, 0], [0.07, 1], [0.22, 0.34], [0.31, 0.9], [0.43, 0.31], [0.53, 0.84], [0.67, 0.35], [0.81, 0.7], [1, 0]], mul: 1 },
      env: [[0, 0.9], [0.2, 1], [0.5, 0.8], [0.942, 0], [1, 0]], rot0: Math.PI / 4, burst: 8, shapeR: 0.37, sort: 6 }),
  S({ name: 'P_Spot(白三角)', tex: 'Stretch_Line_01a_Clamp', c: '#55a7ff', life: [0.4, 0.55], speed: 0.001, size: [0.1, 0.5],
      sz: { keys: [[0, 1], [0.39, 0.9], [1, 0.33]], mul: 1 }, env: [[0, 0], [0.03, 1], [0.7, 0.6], [1, 0]],
      stretch: 2.2, burst: [[0, 3], [0.04, 2]], shapeR: 0.0001, sort: 6 }),
  S({ name: 'HIt_02(藍碎片)', tex: 'Shock_Wave_14', c: '#83c6ff', life: [0.25, 0.4], speed: 1.28, size: [0.35, 0.4],
      sz: { keys: [[0, 1], [1, 1]], mul: 1 }, env: [[0, 1], [0.185, 0.8], [0.731, 0.4], [1, 0]], stretch: 3, burst: 3,
      shapeR: 0.0001, sort: 6 }),
  S({ name: 'HIt_01(金星爆)', tex: 'Hit_07i', c: '#ffc669', life: 0.1, speed: 0, size: 1.35,
      sz: { keys: [[0, 0.45], [0.11, 1], [0.47, 0.45], [1, 0.02]], mul: 1 }, env: [[0, 1], [0.819, 0.8], [1, 0]],
      rot0Rand: true, burst: 1, sort: 9 }),
];

// ---- 拖曳筆線（Progress_Trail_01/02 子系統；藍芯＋橘火）----
const TRAIL = {
  stamps: [
    S({ name: 'Light(藍芯光斑)', tex: 'Flare_18', c: '#006cff', life: 0.35, speed: 0, size: 0.9,
        sz: { keys: [[0, 0.6], [0.15, 1], [1, 0.2]], mul: 1 }, env: [[0, 0], [0.06, 1], [1, 0]], alignVel: true, sort: 5 }),
    S({ name: 'Glow_A(柔光)', tex: 'Circle_Glow_01_Clamp_1', c: '#016dff', life: 0.4, speed: 0, size: 1.1,
        sz: { keys: [[0, 0.7], [1, 1]], mul: 1 }, env: [[0, 0.8], [0.2, 1], [1, 0]], sort: 3 }),
  ],
  auras: [ // 每個 stamp 隨機一道（遊戲 aura_1-8：TW01 橘/深藍、TW02 深藍、TW03）
    S({ name: 'aura(橘波)', tex: 'Glow_Trail_01', c: '#ffa434', life: 0.5, speed: 0, size: 1.3,
        sz: { keys: [[0, 0.3], [0.4, 1], [1, 1.2]], mul: 1 }, env: [[0, 0], [0.12, 0.7], [1, 0]], alignVel: true, sort: 2 }),
    S({ name: 'aura(深藍波)', tex: 'Circle_Glow_02', c: '#00519a', life: 0.5, speed: 0, size: 1.1,
        sz: { keys: [[0, 0.4], [1, 1.15]], mul: 1 }, env: [[0, 0], [0.1, 0.8], [1, 0]], sort: 2 }),
    S({ name: 'aura(藍波)', tex: 'Glow_Trail_01', c: '#258eff', life: 0.5, speed: 0, size: 1.2,
        sz: { keys: [[0, 0.3], [0.4, 1], [1, 1.2]], mul: 1 }, env: [[0, 0], [0.12, 0.7], [1, 0]], alignVel: true, sort: 2 }),
  ],
  dot: S({ name: 'P_Dot(橘火)', tex: 'Bulletline_08', c: '#ffa312', life: [0.25, 0.45], speed: [1.5, 3], size: [0.05, 0.12],
      sz: { keys: [[0, 0], [0.1, 1], [1, 0]], mul: 0.5 }, env: [[0, 0], [0.1, 1], [1, 0]], stretch: 4, shapeR: 0.02, sort: 6 }),
  dotBlue: S({ name: 'P_Dot(藍)', tex: 'Bulletline_08', c: '#7ebfff', life: [0.3, 0.5], speed: [1, 2.5], size: [0.05, 0.1],
      sz: { keys: [[0, 0], [0.1, 1], [1, 0]], mul: 0.5 }, env: [[0, 0], [0.1, 1], [1, 0]], stretch: 4, shapeR: 0.02, sort: 6 }),
  lightningColor: '#ffa240',
};

// ---- 引擎 ----
export function initClickFxAuthentic() {
  if (window.__baClickFxAuthentic) return window.__baClickFxAuthentic;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;mix-blend-mode:plus-lighter;';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const texs = {};      // 短名 → 原版 Image（黑底、alpha=255——加法混合下黑＝透明，與遊戲一致）
  const tintedCache = {}; // tex短名+startColor → {img} 染色版（texture.rgb × startColor.rgb）
  let alive = false, raf = 0, last = 0;
  const parts = [];

  function resize() {
    canvas.width = Math.round(canvas.clientWidth * devicePixelRatio);
    canvas.height = Math.round(canvas.clientHeight * devicePixelRatio);
  }
  window.addEventListener('resize', resize, { passive: true });
  resize();

  // 貼圖載入
  let loadFail = 0;
  Promise.all(TEX_LIST.map((n) => new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      texs[n.replace(/^FX_TEX_/, '')] = img;
      res();
    };
    img.onerror = () => { loadFail++; console.warn('[clickfx-authentic] tex fail:', texURL(n)); res(); };
    img.src = texURL(n);
  }))).then(() => {
    if (loadFail) console.warn(`[clickfx-authentic] ${loadFail} 張貼圖載入失敗（需 assets/clickfx/FX_TEX_*.png）`);
  });

  // 染色（texture.rgb × startColor.rgb，等價遊戲 DSFX/FX_SHADER_AlphaBlend_Add）：
  // multiply 疊色後黑底維持黑、形狀亮度 × 色；plus-lighter 下黑不加色＝視覺透明。
  // 最後 destination-in 邊緣羽化——clamp 類貼圖的漸變會頂到邊被硬切，
  // 不羽化會出現方形邊界殘影。
  const edgeMaskCache = {};
  function edgeMask(w, h) {
    const key = `${w}x${h}`;
    let m = edgeMaskCache[key];
    if (m) return m;
    m = document.createElement('canvas');
    m.width = w; m.height = h;
    const mc = m.getContext('2d');
    mc.fillStyle = '#fff';
    mc.fillRect(0, 0, w, h);
    const F = Math.max(2, Math.round(Math.min(w, h) * 0.07));  // 邊緣羽化寬（7%）
    const fade = (x0, y0, x1, y1) => {
      const g = mc.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(255,255,255,1)');
      mc.globalCompositeOperation = 'destination-out';
      mc.fillStyle = g;
      if (x0 === 0 && x1 === 0) mc.fillRect(0, Math.min(y0, y1), w, F);
      else mc.fillRect(Math.min(x0, x1), 0, F, h);
    };
    fade(0, 0, 0, F); fade(0, h, 0, h - F);                    // 上、下
    fade(0, 0, F, 0); fade(w, 0, w - F, 0);                    // 左、右
    mc.globalCompositeOperation = 'source-over';
    edgeMaskCache[key] = m;
    return m;
  }
  function tinted(name, color) {
    const key = `${name}|${color}`;
    let t = tintedCache[key];
    if (t) return t;
    const src = texs[name];
    if (!src) return null;
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const cc = c.getContext('2d');
    cc.drawImage(src, 0, 0);
    cc.globalCompositeOperation = 'multiply';
    cc.fillStyle = color;
    cc.fillRect(0, 0, c.width, c.height);
    cc.globalCompositeOperation = 'destination-in';
    cc.drawImage(edgeMask(c.width, c.height), 0, 0);
    t = { img: c };
    tintedCache[key] = t;
    return t;
  }

  function spawn(sys, x, y, baseAng) {
    let bursts;
    if (sys.burst == null) bursts = [[0, 1]];
    else if (typeof sys.burst === 'number') bursts = [[0, sys.burst]];
    else if (typeof sys.burst[0] === 'number') bursts = [[0, sys.burst]];
    else bursts = sys.burst;
    for (const [bt, count] of bursts) {
      for (let i = 0; i < count; i++) {
        const ang = rand(0, Math.PI * 2);   // tap 家族全系統隨機方向（choreography 一致）
        const spd = Array.isArray(sys.speed) ? rand(sys.speed[0], sys.speed[1]) : (sys.speed || 0);
        const life = Array.isArray(sys.life) ? rand(sys.life[0], sys.life[1]) : sys.life;
        const size0 = Array.isArray(sys.size) ? rand(sys.size[0], sys.size[1]) : sys.size;
        const R = (sys.shapeR || 0) * PX;
        parts.push({
          sys, x: x + Math.cos(ang) * R, y: y + Math.sin(ang) * R,
          vx: Math.cos(ang) * spd * PX, vy: Math.sin(ang) * spd * PX,
          life, t: -bt, size0,
          rot: sys.rot0Rand ? rand(0, Math.PI * 2) : (sys.alignVel || sys.stretch ? ang : (sys.rot0 || 0)),
        });
      }
    }
  }

  function runDown(x, y) { for (const s of TOUCH_START) spawn(s, x, y); kick(); }
  function runUp(x, y) { for (const s of TOUCH_END) spawn(s, x, y); kick(); }

  // 拖曳：距離累積 → stamp（Light+Glow_A+aura，30% 橘火點、8% 閃電）
  let dragging = false, acc = 0, lx = 0, ly = 0, pang = 0;
  function onDown(e) { dragging = true; acc = 0; lx = e.clientX; ly = e.clientY; runDown(lx, ly); }
  function onMove(e) {
    if (!dragging) return;
    const dx = e.clientX - lx, dy = e.clientY - ly;
    const d = Math.hypot(dx, dy);
    pang = Math.atan2(dy, dx);
    acc += d;
    if (acc >= 12) {
      acc = 0;
      const x = e.clientX, y = e.clientY;
      spawn(TRAIL.stamps[0], x, y, pang);
      spawn(TRAIL.stamps[1], x, y, pang);
      spawn(TRAIL.auras[(Math.random() * TRAIL.auras.length) | 0], x, y, pang);
      if (Math.random() < 0.3) spawn(Math.random() < 0.5 ? TRAIL.dot : TRAIL.dotBlue, x, y, pang);
      if (Math.random() < 0.08) spawnLightning(x, y, pang);
      kick();
    }
    lx = e.clientX; ly = e.clientY;
  }
  function onUp(e) { if (dragging) { dragging = false; runUp(e.clientX, e.clientY); } }

  function spawnLightning(x, y, ang) {
    const segs = 4 + (Math.random() * 3 | 0), len = rand(30, 70) * (PX / 50);
    const pts = [[0, 0]];
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      pts.push([t * len * Math.cos(ang) + rand(-9, 9), t * len * Math.sin(ang) + rand(-9, 9)]);
    }
    parts.push({ lightning: pts, life: 0.14, t: 0, c: TRAIL.lightningColor, x, y, sort: 7 });
  }

  function kick() {
    if (alive) return;
    alive = true; last = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function tick(now) {
    const dt = Math.min(0.1, (now - last) / 1000);  // 鉗制載入卡頓時的慢動作（Unity maximumDeltaTime 概念）
    last = now;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.globalCompositeOperation = 'lighter';

    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.t += dt;
      if (p.t < 0) continue;                      // burst 延遲
      const k = p.t / p.life;
      if (k >= 1) { parts.splice(i, 1); continue; }

      if (p.lightning) {                          // 程序閃電
        const a = Math.max(0, 1 - k) * 0.9;
        ctx.strokeStyle = p.c; ctx.globalAlpha = a;
        ctx.lineWidth = 2; ctx.shadowColor = p.c; ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(p.x + p.lightning[0][0], p.y + p.lightning[0][1]);
        for (let j = 1; j < p.lightning.length; j++) ctx.lineTo(p.x + p.lightning[j][0], p.y + p.lightning[j][1]);
        ctx.stroke();
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
        continue;
      }

      const sys = p.sys;
      const tex = tinted(sys.tex, sys.c);
      if (!tex) continue;
      const sizePx = p.size0 * evalKeys(sys.sz?.keys, k) * (sys.sz?.mul || 1) * PX * 2;
      const alpha = evalKeys(sys.env, k);
      if (alpha <= 0.003) continue;
      const spd = Math.hypot(p.vx, p.vy);
      if (sys.stretch && spd > 1) {               // 拉伸：沿速度
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.rot = Math.atan2(p.vy, p.vx);
        p.vx *= 1 - 1.6 * dt; p.vy *= 1 - 1.6 * dt;
      }
      const w = sys.stretch ? sizePx * sys.stretch : sizePx;
      const h = sys.stretch ? sizePx : sizePx;
      let W = w, H = h;
      if (sys.clampScreen) {                      // 巨環 clamp 螢幕
        const m = Math.max(canvas.width, canvas.height) / devicePixelRatio * 1.15;
        W = H = Math.min(W, m);
      }
      // 多尺度 bloom（HDR 白心感）：同貼圖逐級放大低 alpha 疊 draw——
      // 光暈隨粒子尺寸等比（螢幕空間），不因貼圖解析度失真。
      // 大粒子（巨環／主漣漪）單層繪製：bloom 複本會把掃出的環過曝成白洗。
      const bk = Math.min(1, Math.max(0, (520 - W) / 300));
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (bk > 0.01) {
        ctx.globalAlpha = alpha * 0.12 * bk;
        ctx.drawImage(tex.img, -W, -H, W * 2, H * 2);
        ctx.globalAlpha = alpha * 0.3 * bk;
        ctx.drawImage(tex.img, -W * 0.72, -H * 0.72, W * 1.45, H * 1.45);
      }
      ctx.globalAlpha = alpha * 0.85;
      ctx.drawImage(tex.img, -W / 2, -H / 2, W, H);
      ctx.restore();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    if (parts.length) { raf = requestAnimationFrame(tick); }
    else { alive = false; ctx.clearRect(0, 0, canvas.width, canvas.height); }
  }

  window.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp, { passive: true });
  window.addEventListener('pointercancel', () => { dragging = false; }, { passive: true });

  const handle = { canvas, runDown, runUp, _parts: parts, _texs: texs };
  window.__baClickFxAuthentic = handle;
  return handle;
}
