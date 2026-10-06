# 參數總審計：渲染路徑所有在用數值的驗證（2026-10-06）

方法：把 mode=auto 預設路徑上**每一個在用數值**盤點出來，對回遊戲原始資料
（ppp_extracted.json＝PPV Volume profiles 逐廳抽取）或 Unity URP 2021.3 官方源碼
（已收錄 docs/urp_2021_3_ref/）。兩支驗證器可隨時重跑：
- `scripts/verify_post_config.py`（逐廳用量對回 PPV 鐵譜）
- `scripts/verify_shader_constants.py`（shader 常數對回 URP 源碼）

## 1. 逐廳後處理用量（lobby_post_config.json ↔ ppp_extracted.json）

| 項目 | 驗證方式 | 結果 |
|---|---|---|
| **e 曝光** | e == 2^ColorAdjustments.postExposure | **✓ 260/260**（全庫 45.25=2^5.5；例外 aris_home e=4=2^2 為遊戲資料本值） |
| **g/gm LGG** | URP 2021.3 core `ColorUtils.PrepareLiftGammaGain` 官方公式逐步重算 | **✓ 248/248** |
| **ch 色差** | ch == intensity×k，k 應全庫一致 | **✓ 264/264（k=0.05，離散 0%）**——修正 hanako_home 12× 抽取錯誤（0.0005→0.006） |
| **p panini** | p == [distance, cropToFit] | **✓ 189/189** |
| **l lift** | config.l == Prepare(lift) | **✓ 0 缺口**——修正 13 廳抽取缺口（原 config 無 l 欄位） |
| **cf colorFilter** | 非恆等覆寫入 config | **✓ 11 廳補齊**（ako/koharu_home=(2,2,2)！ch0229/264/292/296/307/317/325/336/337/wakamo 分通道色調） |
| **c contrast** | c == 1+contrast/100 | **✓ 1 廳補齊**（ch0318 contrast=68.1 → 1.681） |
| hueShift | shader 未實作 | **✗ 已知缺口**（ch0325_home −86°，唯一無法用現有管線套用的欄位） |
| 覆蓋 | PPV 抽取缺 14 廳 | **✗ 無法驗證**（ch0172/173/174/246/247/303/344/345 等，待重掃 bundle） |

修正共 32 筆（`scripts/fix_post_config_from_ppv.py`，可重入；已同步 assets repo 副本）。
修正後 e/ch/LGG/p/lift 全綠。**注意**：ako/koharu 的 cf=2× 會實際改變渲染（mild/faithful
路徑 uCF）——請目視比對遊戲；若過曝，表示 colorFilter 的作用域解讀需再修（URL `POST=0` 可逐廳比對）。

## 2. Shader 常數 ↔ URP 2021.3 官方源碼：**27/27 ✓**

| 常數 | app 值 | 官方值 | 源 |
|---|---|---|---|
| LogC cut/a/b/c/d/e/f | 0.011361/5.555556/0.047996/0.244161/0.386036/5.301883/0.092819 | 同 | Color.hlsl ParamsLogC |
| MIDGRAY（對比樞） | 0.4135884 | 同 | ACES.hlsl `ACEScc_MIDGRAY` |
| Neutral a-f/whiteLevel | 0.2/0.29/0.24/0.272/0.02/0.3/5.3 | 同 | Color.hlsl NeutralTonemap |
| ACES fitting 8 常數＋AP1_RGB2Y | 全同 | 同 | ACES.hlsl |
| 曝光 | 2^5.5 = 45.25483399593904 | 同 | ColorAdjustments.postExposure=5.5 |
| sRGB G2L/L2S | IEC 分段線性式 | 同 | 標準 |

## 3. 結構性數值（活躍渲染路徑）

| 數值 | 位置 | 來源／驗證 | 狀態 |
|---|---|---|---|
| charScale = vw/2800 | fitScene | 相機 D=120 authored 反解（舊 2900 反解非整數否決） | ✓ GT 對位 3 廳 scale=1.0 |
| 相機可見寬 2800 / 高 1574.8 | 同上 | D=120 × fov 10° 幾何 | ✓ |
| blend One/One、One/OneMinusSrcAlpha | 材質 dump | 遊戲 shader 鐵譜（docs/game_shader_ref） | ✓ |
| 頂點色 G2L（v2 組）／identity（plain 組） | shader 鐵譜 | PMAGammaToTargetSpace 兩分支 | ✓（CH0070 身體用戶確認） |
| 烘焙 G2L(rgb)×a（兩族統一） | prepareHdrLights | 十一輪用戶窗光實機否證 gamma 域預乘 | ✓（窗區 [251.3,253.0,242.9]） |
| panini fov 10° | postPaniniParams | CameraFovScaler STANDARD_FOV | ✓（warp 已對齊截圖） |
| DoF maxRadius 1.5 | flashBlur | PPPV _D profile | ✓；像素換算 dofScale=8 為估計 ⚠ |
| 曝光在 encode 鏈（chain=1） | FS_FRAG | 校準矩陣否定其為預設行為 | 預設關（儀器保留） |
| bloom 常數 | BLOOM | URP Bloom.shader 鐵譜 | ✓（預設關） |
| 粒子 M2E=100 | 粒子模組 | d16c172 單位鏈推導 | ✓（四芒星 48px 對齊實機） |
| WATER_STR=0（預設關） | water 模組 | d410520（視覺未證實不進預設） | ⚠ 開放：用戶曾目視證實遊戲有波光動畫；waterStr=3.0 可實驗 |
| atlas page scale（CH0070 page3=0.65） | spine-core 解析 | UV 以 header page size 計算 | ✓（GT 對位 1:1） |
| probe DT=1/30 | 探針 | 30fps 假設 | ⚠ 探針專用不影響渲染 |
| GT clear color (111,111,118) | GT.java | 大廳背景灰 | 工具用 |

## 4. 開放項

1. hueShift 未實作（ch0325_home −86°）——POST_FRAG 無 HSV hue 旋轉。
2. 14 廳 PPV 抽取缺口（ch0172/173/174/246/247/303/344/345/346/347/355/356 + 2）——待重掃 bundle。
3. ako/koharu cf=2× 的實機觀感待用戶目視。
4. CH0230 溫和 C 曲線殘差（實機 mids −14/−11/−16）。
5. WATER_STR 預設關 vs 用戶目視證詞。
