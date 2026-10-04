# GT(viewer 語義) vs plain 對位分類——十輪裁定（2026-10-04）

## 模型裁定（證據鏈見 git 3c7f325／fd209d8／4b42377）

**遊戲大廳渲染＝gamma 域合成（＝plain＝官方 viewer 語義）**，非線性合成＋後處理鏈。

- 遊戲 shader 鐵譜的 PMAGammaToTargetSpace 在 **gamma 專案分支＝identity**
  （Spine-Common.cginc `#if UNITY_COLORSPACE_GAMMA return gammaPMAColor;`）
  ——線性分支（G2L(rgb/a)×a）的前提「遊戲是線性專案」被實測否定。
- 「×45.25 曝光→LGG→tonemap＝C 曲線本體」模型被校準矩陣否定：
  e=45.25 全組合爆白（all B 180 vs 實機 116）；Neutral/ACES 越調越偏；
  v2 的線性合成把暗部壓成 [0,0,0]（實機 [10.5,15.5,41.3]），逐像素曲線無法挽回。
- GT(viewer 語義) 的暗部 [13.6,15.2,48.9] ≈ 實機暗部 [10.5,15.5,41.3]
  ＝「暖色暗層」就是 gamma 域加法合成的自然行為，不是缺的效果。

## 批量分類表（scripts/gt_vs_plain_batch.sh，六廳樣本）

| lobby | anchor | align(dy,dx) | \|diff\| | signed R,G,B | 判讀 |
|---|---|---|---|---|---|
| CH0070_home | 28 | (1,2) | **2.86** | +1.1,+1.1,+1.3 | ✓ plain＝viewer |
| Hanako_home | 35 | (0,0) | **3.37** | +1.7,+1.3,+1.1 | ✓ plain＝viewer |
| CH0284_home | 23.667 | (0,0) | **6.87** | −4.1,−3.3,−5.4 | ✓ plain＝viewer（實機直證 ±3） |
| Atsuko_home | 16 | (0,0) | 10.13 | +4.5,+0.8,**−14.6** | B 偏暗：有色光槽（bokeh/top light_00）累積差 |
| Aris_home | 16 | (0,0) | 10.42 | **+10.4,+7.1**,−0.9 | R/G 偏亮：有色 Top_Light（rgb .357/.616/.761） |
| CH0230_home | 20 | (−1,3) | 15.29 | +1.7,+0.5,−4.7 | beam 累積＋暗部暖層差（實機另有溫和 C 曲線） |

判讀基準：signed |Δ|≤2 ＝匹配（AA/抖動級）；5~15＝局部光層差；>15＝結構差需查。

## 工具鏈

- `scripts/GT.java`：GT 渲染器（8afb7c6）。十輪修：mtxTx 未存欄位、up=(0,-1,0)
  180° 旋轉；mtx 模式 (a,tx,ty) 來自探針上報的 `spine.worldTransform`（screen=a×world+t）。
- `scripts/probe_mtx.py`：beam JSON 的 view record → GT mtx 參數。
- `scripts/gt_vs_plain.py`：對位（±12px 搜尋）＋zone stats＋JSON 報告（--scale 估縮放）。
- `scripts/gt_vs_plain_batch.sh`：逐廳批量（probe plain → GT 同 t → 對位 → CSV）。
  鐵律：單實例；GT 前清 /tmp/lwjgl_augus；逐廳隔離 userData；逐廳 ~1-3 分鐘。

## 殘餘議題（下輪）

1. **CH0230 實機 vs plain 的溫和 C 曲線**（mids −14/−11/−16，brights −6）：候選＝
   DoF gaussian veil／錄影管線處理／gentle filmic。plain+Neutral 離線擬合 ±7（best so far）。
2. **有色光槽廳的 plain-vs-viewer 差**（Aris R+10 / Atsuko B−15）：additive 累積
   語義（pixi 'add' 預乘 vs viewer straight SrcAlpha）在多次疊加下的細微差。
3. 全量 269 廳批量（每廳 1-3 分鐘，一夜可完）。
4. 預設渲染路徑決策：證據支持 plain 為預設（v2 系統性偏離）——**待用戶裁定**。
