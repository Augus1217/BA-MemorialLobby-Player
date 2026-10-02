# 遊戲 Spine 著色器參考與最終像素級公式（全部由遊戲資料推導）

## 遊戲材質實測（bundle dump，2026-10-01）
- 兩個材質（page1/page2）皆為 Spine/Skeleton：
  - `_StraightAlphaInput = 1.0`（**in-shader 預乘 tex.rgb×=tex.a 開啟**）
  - `m_ShaderKeywords = ''`、無 `_Color`（非 BlendModes 變體）
  - Blend（shader 固定）：**One OneMinusSrcAlpha**
- pmaVertexColors：大廳 spine 為 runtime 建立（bundle 無 SkeletonRenderer 元件）
  → spine-unity 預設 **false**（頂點色不做 CPU 預乘）

## 最終像素級公式（線性空間）——2026-10-02 修訂：頂點色為 PMA 合成

```
vertexColor = sk×sl×att 合成，且為 PMA（pmaVertexColors=true，rgb 已 ×a）：
    toplight 輸入 = (0.302, 0.302, 0.302, 0.302)
v = PMAGammaToTargetSpace(vertexColor):
    v.rgb = GammaToLinear(rgb/a) × a = GammaToLinear(1) × 0.302 = 0.302   ← 無 HDR 爆發
v.a = 0.302

frag.rgb = tex.rgb(線性) × tex.a × v.rgb      [_STRAIGHT_ALPHA_INPUT=1]
frag.a   = tex.a × v.a                        = tex.a × 0.302
out.rgb  = frag.rgb + dst.rgb × (1 − frag.a)   [Blend One OneMinusSrcAlpha]
```

**舊詮釋（2026-10-01 版「att.a 經 /a×a 變 HDR ×4.89」）已被實測否定**：該推導假設
SkeletonRenderer 頂點色為 straight 合成（pmaVertexColors=false 的 spine-unity 預設），
但遊戲是 runtime 建立＋il2cpp 自訂——實機截圖中 beam 是細微高光掃過，而 HDR ×4.89
詮釋在我們管線上把整個上半屏加法飽和（face 253.5 vs 實機 220.4）。（A）PMA 詮釋的旁證：
① 實機 beam 細微；② 穹頂實測 202.5-205.7 vs 實機 200.3（+2~+5）；③ 動畫 alpha 脈衝下
兩側都線性 in s（straight 詮釋會 1/s 發散，物理不合理）；④ 舊 trueAdd 實驗（×0.302）
dome 192 為史上最接近的加法變體。**殘差 −8（trueAdd 時代）來自合成空間：遊戲在線性
空間合成後 sRGB encode，我們的 baseline 在 sRGB 空間直接合成——完整像素級需 linear RT。**

## 機制解釋（修訂）

attachment alpha 0.302 經 PMA 摺疊自然進入 frag（rgb 與 alpha 同 ×0.302）——**pixi
batcher 的 colorBit PMA 打包（vColor.rgb = aColor.rgb×aColor.a）就是遊戲語義本身**，
烘焙不需任何魔法因子：bake rgb = GammaToLinear(tex)×texA、alpha = texA、
att.color 不中和、blend 尊重 skel 資料（additive=One/One、normal=One/OMISA）。
Spine/Skeleton-PMA-Additive 變體（同資料夾）即 additive 槽的材質。

## 我們的實作路徑
光槽自訂 shader（pixi batcher 客製或 filter）：取樣 raw straight 貼圖，
輸出 tex.rgb(lin)×tex.a×4.2 加法項＋alpha=tex.a×0.302 的 dst 衰減。

## 受控單元測試結論（2026-10-02，tests/hdr_unit.html＋tests/unit_main.js）

用常數貼圖／真實 atlas region／真實 Spine 物件在 SwiftShader-free 的真 GPU 上
逐環節 readPixels 比對 CPU 黃金模型（T0-T11，全數收斂）。要點：

1. **管線基礎全對**：rgba16float BufferImageSource 上傳保真（half 精度內）；
   PMA 資料＋blend 'normal' ＝ **ONE, OneMinusSrcAlpha（＝遊戲 blend）**；
   float RT 中 HDR 值（>1）存活；自訂 quad shader 的 sRGB encode 像素級正確；
   真實 toplight region 烘焙 vs CPU 黃金模型 mean err 0.001。
2. **摺疊確實存在**：pixi colorBit 頂點著色器做 `vColor *= vec4(aColor.rgb*aColor.a, aColor.a)`
   （shader 端 PMA 打包），spine 的 BatchableSpineSlot 把 cache color
   （skeleton×slot×attachment，直值）打進頂點 → **frag.rgb 被 ×(slot.a×att.a) 摺疊**。
   常數貼響應掃描：out = tex.rgb×att.rgb×a（斜率精確線性）。
   → `prepareHdrLights` 的 `att.color.a=1` 中和是**必要**的，且值會持久
   （spine runtime 不會覆寫；Idle_01 無 toplight 的顏色軌，整週期 out(t) 平坦）。
3. **darkTint batcher 的 dark term 對無 darkColor 的槽＝0**（toplight darkColor=none），
   T7 截線其實是「被 Idle_01 RGBA 軌贖身的其他槽」（flare alpha 脈衝 0.66↔1.0）
   畫在 beam 下方的 floor——不是 shader bug。
4. **A/B 比值實驗的陷阱（方法論）**：① `sp.update(0)` 每次呼叫都會微動 physics/骨骼
   姿態 → 跨 grab 的逐像素比值在梯度區出現 0.5-0.9 的假訊號（平坦區 1.00）——
   顏色響應必須用常數貼圖量測；② 藏槽用 `slot.color.a=0` 會被動畫 RGBA 軌贖身，
   完全隔離須移除 attachment。
5. **production hdr=1 的「偏暗 ×0.3＋鋸齒」根因＝UV 空間錯位（致命、已驗證）**：
   `region.texture` 換成 region 尺寸烘焙圖，但 attachment UV 是 **page 空間**座標
   → 只取樣烘焙圖約 30% 子區並放大 ~3.3×（toplight：page v∈[0.0005,0.303]），
   光束內容錯置。修法（二擇一）：
   (a) 烘焙成**全 page 尺寸** float 貼圖（2048×2048×8B ≈ 33MB，UV 不動、最笨但穩）；
   (b) **重映射 attachment UVs** 到烘焙圖的 [0,1]：
       `u' = (u×W_page − rx)/rw`、`v' = ((1−v)×H_page − ry)/rh`（再依 pixi v 慣例翻轉），
       RegionAttachment 8 floats / MeshAttachment 逐頂點。
6. **潛在陷阱（其他大廳/動畫）**：槽 alpha 被動畫驅動時，遊戲端因子＝
   `linear(1/(attA·s))×attA·s`（s→0 時發散），我們的烘焙 F 固定、摺疊 ×s 線性縮小
   ——兩者在 s=1 相符、s<1 發散。toplight 在 Idle 無此問題；flare 槽有 alpha 脈衝軌。
