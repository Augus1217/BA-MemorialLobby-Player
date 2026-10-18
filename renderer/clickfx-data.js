// clickfx-data.js — BA UI 觸控特效「原版重製」共用真值資料層
// ═══ 所有數值直接取自 APK 內 FX_Touch prefab CAB 反序列化（fx_cab_full.json /
//     fx_truth.json）＋材質 shader/HDR 倍率，不含猜測。 ═══
// 這個模組只放「資料與純函式」，不含任何渲染後端；
//   renderer/clickfx-authentic.js       → Canvas2D 後端（LDR 近似）
//   renderer/clickfx-authentic-pixi.js  → Pixi/WebGL HDR 後端（真 bloom）
// 兩者共用同一份真值，避免數值漂移。

export const texURL = (n) => new URL(`assets/clickfx/${n}.png`, location.href).href;

export const TEX_LIST = [
  'FX_TEX_Circle_01',     // disk（ring PS_15 → FX_MAT_Touch_Cross2）
  'FX_TEX_Grad_Ring3',    // 擴張環（MeshTri → FX_MAT_Touch_Tri3）；U 剖面＝環角向亮度
  'FX_TEX_Triangle_02_1', // 碎片/puffs（Ring(3)/Ring(4) → FX_MAT_Touch_Tri 2，兩框）
  'FX_TEX_Trail_03',      // Trail（FX_MAT_TouchFXTrail）
];

export const DESIGN_H = 1080;
// FA：盤/環/trail 的 px/單位。由 level1 UICamera.orthographicSize=1.0 推導：
// 相機半高=1 世界單位 → 1 單位 = 畫面高/2 px（1080p=540），不再是校準值
export const FA = DESIGN_H / 2;
export const PASC = 0.3078824;                      // Ring(3)/Ring(4) localScale（CAB T7/T8）
export const PA = FA * PASC;                        // 166.26 px/單位（碎片/puffs）
export const RING_OUTER = 1.0637;                   // Cylinder002 外圈頂點半徑
export const RING_BAND = 0.0599;                    // (1.0637-1)/1.0637 ＝帶寬/外徑

// ---- 曲線工具（keys: [[t, v, ...], ...] 線性插值；Unity 相切數分量忽略）----
export function evalKeys(keys, k) {
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
export function evalColor(keys, k) {   // keys: [[t, [r,g,b]], ...] → [r,g,b]
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
export const rand = (a, b) => a + Math.random() * (b - a);
export const TAU = Math.PI * 2;

// ---- 子系統真值（CAB）----
export const DISK = {   // ring PS_15：Circle_01 白閃盤
  lifeMs: 200,
  sizeMin: 0.12, sizeMax: 0.12,             // startSize state 0＝常數 0.12（fx_cab_full PS15
                                             // 機器解析重驗；spec 的「state3 rand(0.12,0.14)」
                                             // 是 PS16 環的值誤植到 PS15 行上）
  sizeScalar: 2.0,                          // SizeModule scalar（直徑倍率）→ 半徑 64.8px
  sizeKeys: [[0, 0.3258358], [0.21392822, 0.7159773], [1, 1]],
  colorKeys: [[0, [255, 255, 255]], [0.1205921, [61.3, 99.6, 255]], [1, [0, 0, 0]]],
  alphaKeys: [[0, 1], [0.1088273, 1], [1, 0]],
};
export const RINGS = {  // MeshTri PS_16：Cylinder002 環面網格 × Grad_Ring3
  count: 2, lifeMs: 600,
  sizeMin: 0.12, sizeMax: 0.14,             // 半徑 = size0 × 1.0637 × curve × FA
  sizeKeys: [[0.0072098, 0.42050898], [0.21392822, 0.7159773], [1, 1]],
  colorKeys: [[0.1117723, [255, 255, 255]], [0.5, [75.8, 166.6, 255]], [1, [0, 20.9, 204.5]]],
  alphaKeys: [[0, 1], [0.9971, 1], [1, 0]], // 常亮、生命末端急滅（ColorModule 真值）
  rotVMax: 1,                                // RotationModule：0-1 rad/s 隨機
};
export const SHARDS = { // Ring(3) PS_18：三角碎片 ×4（三連閃、無自旋、無阻尼）
  count: 4, lifeMinMs: 600, lifeMaxMs: 700,
  mul: 0.5377358,                           // startColor 常數 = maxColor 灰 0.5377（真值壓暗）
  spawnR: 0.3 * PA, speedMin: 0.3 * PA, speedMax: 0.4 * PA,
  sizeMin: 0.1 * PA, sizeMax: 0.2 * PA,
  sizeKeys: [[0, 0], [0.15445095, 1], [1, 0]],
  colorKeys: [[0.1823606, [255, 255, 255]], [0.282353, [95, 197, 255]], [0.4617647, [95, 197, 255]], [0.6617647, [90, 186, 241]], [0.8264732, [95, 197, 255]], [1, [95, 197, 255]]],
  // ColorModule alpha 時間軸：1→0→1→0→1→0→1 停亮（三連閃）
  alphaKeys: [[0, 1], [0.2881996, 1], [0.3646943, 0], [0.4706475, 1], [0.5735445, 0], [0.6676084, 1], [0.7558647, 0], [0.8529488, 1], [1, 1]],
};
export const PUFFS = {  // Ring(4) PS_17：拖曳小片（同 Ring(3) 材質與閃爍）
  spacingPx: FA / 5,                        // rateOverDistance 5/單位 → 每 108px
  mul: 0.5377358,                           // startColor 常數 = maxColor 灰 0.5377（真值壓暗）
  spawnR: 0.15 * PA, speedMin: 0.2 * PA, speedMax: 0.3 * PA,
  lifeMinMs: 200, lifeMaxMs: 400,
  sizeMin: 0.1 * PA, sizeMax: 0.2 * PA,
  sizeKeys: SHARDS.sizeKeys, colorKeys: SHARDS.colorKeys, alphaKeys: SHARDS.alphaKeys,
};
export const TRAIL = {  // Trail GO：TrailRenderer 真值
  lifetimeMs: 300,
  coreWidth: 0.005 * FA, glowWidth: 9,      // 核心 2.7px（全寬）；+9 為仿製版 outerGlow，
                                            // 僅 Canvas2D 備援使用；Pixi 綬帶路徑只用 coreWidth。
  minVertexDist: 0.01 * FA,
  // TrailRenderer colorGradient（頭亮→尾黑；此處以尾→頭表示，數值同真值）
  lenGradient: [[0, [0, 0, 0]], [0.5794156, [0, 24.19, 72]], [0.97941558, [0, 99.6, 255]], [1, [0, 99.6, 255]]],
};

// ---- HDR 倍率：材質 _Color（>1 即 HDR，光暈的真正來源）----
//   Tri 2（碎片/puffs）5.992157、Tri3（環）5.992157、Cross2（盤）2.0、Trail 23.968628
//   （碎片/puffs 的 startColor 0.5377 已含在 SHARDS.mul／PUFFS.mul，這裡只乘 _Color）
// 真值出處：各材質 externals[0] shader 的 m_Color 屬性（fx_touch_spec.json shaders/hdrColor）
export const HDR = { disk: 2.0, ring: 5.992157, shard: 5.992157, trail: 23.968628 };
