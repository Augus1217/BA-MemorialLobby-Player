# 遊戲 Spine 著色器參考與最終像素級公式（全部由遊戲資料推導）

## 遊戲材質實測（bundle dump，2026-10-01）
- 兩個材質（page1/page2）皆為 Spine/Skeleton：
  - `_StraightAlphaInput = 1.0`（**in-shader 預乘 tex.rgb×=tex.a 開啟**）
  - `m_ShaderKeywords = ''`、無 `_Color`（非 BlendModes 變體）
  - Blend（shader 固定）：**One OneMinusSrcAlpha**
- pmaVertexColors：大廳 spine 為 runtime 建立（bundle 無 SkeletonRenderer 元件）
  → spine-unity 預設 **false**（頂點色不做 CPU 預乘）

## 最終像素級公式（線性空間）

```
vertexColor = sk×sl×att 合成（rgb 不預乘）= (1,1,1,0.302) for toplight
v = PMAGammaToTargetSpace(vertexColor):
    a≠0 → v.rgb = GammaToLinear(rgb/a) × a
    toplight: GammaToLinear(1/0.302)×0.302 = 13.9×0.302 = **4.2（HDR 頂點色！）**
v.a = 0.302

frag.rgb = tex.rgb × tex.a × v.rgb      [_STRAIGHT_ALPHA_INPUT=1 + 頂點轉換]
frag.a   = tex.a × v.a                  = tex.a × 0.302
out.rgb  = frag.rgb + dst.rgb × (1 − frag.a)   [Blend One OneMinusSrcAlpha]
```

## 機制解釋：為什麼遊戲的光這麼亮

attachment alpha 0.302 經 PMAGammaToTargetSpace 的「除以 a 再線性化」：
`linear(1/0.302)×0.302 = 4.2` —— **頂點色變成 HDR ×4.2**。
toplight（灰紫 rgb 0.267 線性）× tex.a × 4.2：
- beam 核心（texA 0.87）：+0.976 線性 → 台座/穹頂爆白 ✓
- 台座羽化（texA 0.15）：+0.168 → 250 白 ✓
- 零 alpha texel（洋紅）：×0 ✓ 無洩漏，左下乾淨 ✓
- 霧/水（beam 中段）：強提亮 ✓
所有實機觀察由同一公式解釋。kivo 的 screen 為 LDR 近似（柔性和模擬 HDR 滾降）。

## 我們的實作路徑
光槽自訂 shader（pixi batcher 客製或 filter）：取樣 raw straight 貼圖，
輸出 tex.rgb(lin)×tex.a×4.2 加法項＋alpha=tex.a×0.302 的 dst 衰減。
