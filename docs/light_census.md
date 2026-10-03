# 大廳光線內容普查（light census）——「哪些大廳需要光線層」分類

產生：`scripts/light_census.mjs`（spine-core 解析 .skel，播 Start_Idle_01→Idle_01 至 idle 5s，
量每個 additive/screen 槽的世界面積×slotA）＋ `scripts/light_score.py`（接 atlas 貼圖亮度、
材質 dump 語義、post config）。資料快照：`/tmp/bq/light_census.json`、`light_tiers.json`、
`light_classify.json`（tmpfs，重跑即得）。

## 三層分類（依「idle 時最大單一 additive 槽的視口覆蓋率」）

| 層 | 定義 | 廳數 | 意義 |
|---|---|---|---|
| **T1** | 單槽覆蓋 ≥80% 視口 | 164 | 全屏光（dome/toplight/screen 濾鏡）。光線合成語義直接決定全 frame 色調——Seia/Hanako 都在這層 |
| **T2** | 10–80% | 79 | 局部光（光束/flare/窗光）。光層影響局部 |
| **T3** | <10% 或無 | 37 | **光線層永遠不是問題源**——壞點必在 post/相機/其他 |

T3 名單（37）：Akane, Ayane, CH0081, CH0086, CH0114, CH0135, CH0139, CH0177, CH0190, CH0194,
CH0198, CH0216, CH0221, CH0224, CH0242, CH0246, CH0251, CH0264, CH0296, CH0319, CH0325, CH0326,
CH0336, CH0346, CH0347, CH0356, Chinatsu, Hihumi, Karin, LobbyHoshino_multi, LobbyNonomi_multi,
LobbySerika_multi, LobbyShiroko_multi, Marina, Nonomi, Shiroko, Sumire（皆 `_home`）。

## 兩個材質族（自洽，非年代差）

| 族 | 廳數 | 材質特徵 | 光槽貼圖 alpha 結構（實測 dominat 光槽） | 對 v2 烘焙的意義 |
|---|---|---|---|---|
| **straight** | 172 | `_STRAIGHT_ALPHA_INPUT`＋`_StraightAlphaInput=1`（Hanako/CH0230 同族） | midAlpha 佔比 ≈**1.0**（純軟梯度） | 烘焙 ×texA 正確且必要 |
| **PMA** | 75 | 無 straight keyword、`_StraightAlphaInput=0`、明確 `_SrcBlend=1/_DstBlend=10`（Seia 同族） | midAlpha 佔比 ≈**0.11**（硬邊、核心不透明） | 烘焙 ×texA 對核心≈無操作，僅 ~11% 邊緣 texel 有二次預乘誤差（Seia 驗證已過關，低風險） |

mixed 5 廳：CH0100, CH0141, CH0232, Chinatsu, Hihumi。無材質 dump（?）29 廳：資料抽取缺，重跑
`ba_spine_extractor.py` 可補。

## 分診配方（某廳「看起來壞」時）

1. **查本表 tier**：T3 → 光線層結案，直接查 post/相機/資料層。
2. **T1/T2 → 先過兩關再談光**（CH0230 教訓）：
   a. 實機對照幀的**錄影解碼**（limited-range 標 full-range 會污染一切數字——驗證法：最暗 5% 像素
      是否 ≈[19,21,33]）；
   b. **相機比例**（charScale=vw/2800 已修，非 16:9 視窗才受影響）。
3. **光層檢查順序**（資料驅動、零魔法數字）：該廳 `top_light_slot` 的貼圖 alpha 結構 →
   straight 族軟梯度＝合成空間敏感（v2 線性 RT 是正解）；PMA 族硬邊＝邊緣半透明誤差可能。
4. 已知與光無關的殘餘差異：遊戲 URP **DoF/bloom 未復刻**（CH0230 實機暖偏 +27R 的主嫌疑）。

## 校準錨點

- CH0070（Seia）：T1，top_light 覆蓋 2.03×視口，attA=1，PMA 族 → **需要光線修復**（歷史驗證）
- Hanako：T1，toplight 1.64×＋Lens_flare 1.87×，straight 族 → **需要光線修復**（歷史驗證）
- CH0230：T1，intro_02_L 1.40×，straight 族 → 光層已驗證正確（B 通道與實機逐位相等），
  殘餘差異非光 → **不需要光線修復**

注意：T1 是大廳常態（164 廳）——「有全屏光」不等於「光壞了」；本表回答的是「光層是不是
該廳問題的**可能**來源」，單廳歸因仍需一幀實機對照（並遵守解碼驗證）。
