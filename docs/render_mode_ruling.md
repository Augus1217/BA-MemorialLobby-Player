# 逐廳渲染模式裁定（十輪補完）：誰走 plain、誰走 v2

## 規則

**lobby_post_config.json 是否有 LGG 覆寫（`g`/`gm` 欄位）——與用戶遊戲經驗裁定 4/4 吻合：**

| 廳 | LGG 覆寫 | 用戶裁定 | 模式 |
|---|---|---|---|
| ch0284_home | 有（g1.08483+gm0.96367） | 不需修復（plain＝實機 ±3） | **plain** |
| ch0230_home | 有（gm0.89156） | 不需修復（viewer=遊戲 ±1.5-8） | **plain** |
| hanako_home | 無（只有 e/ch） | 需要 v2 光線修復 | **v2** |
| ch0070_home | 無（只有 e/ch） | 需要 v2 光線修復（Seia 泛黃案源頭） | **v2** |

**plain 組（有 LGG）：177 廳。v2 組（無 LGG）：99 廳。**
tier／材質族在兩組間分布近乎相同（T1 56%/59%、straight 63%/60%）——LGG 有無是唯一分隔特徵
（round 7「PPV 的 LGG 調色覆寫有無 4/4 完美分隔」的延伸應用）。

機制假說（未鎖死）：有 LGG 的廳，遊戲自己的分級把線性合成的輸出調回 gamma 合成般的觀感
→ plain 近似最終畫面；無 LGG 的廳暴露線性合成原貌（Seia 案的泛黃校正、Hanako dome）→ v2。

## 證據狀態（誠實欄）

- plain＝官方 viewer 語義：六廳 GT 對位實證（docs/gt_vs_plain.md）。
- viewer＝遊戲：**只在 CH0230/CH0284 被用戶截圖驗證**——Hanako/CH0070 沒有實機錄影
  （錄影是載入畫面），這兩廳的遊戲觀感以用戶遊戲經驗為真值。
- 因此「plain＝遊戲」不能外推到 Hanako/CH0070；本規則以用戶裁定為錨、LGG 為預測特徵。
- 待驗證：兩組各抽幾廳由用戶目視裁決（`#mode=auto` 直接試）。

## 運行時接線（renderer/app.js）

- `RENDER_MODE`：URL `mode=v2|plain` 強制；`mode=auto` 走規則；**預設 v2（現行行為不變）**。
- plain 模式＝跳過 fixAdditiveSlots／prepareHdrLights／線性 RT encode，直渲 gamma 畫布；
  頂點色 G2L 同步關閉（VC_G2L_ACTIVE）＝純 viewer 語義。
- 驗證：ch0284_home `mode=auto` zone all=[152.1,140.0,166.5]＝plain 基線原值（實機 ±3）；
  hanako_home `mode=auto` 呈 v2 線性合成觀感（all [181.8,197.0,222.6] vs plain [210.7,223.9,239.5]）。
- 單元測試 16/16；預設（無 mode）beam 場景幀逐位元組穩定（HUD 文字反鋸齒/圖示狀態為
  run 間非確定雜訊，場景 y≥60 僅 0.04% 差＝姿勢抖動級）。

## v2 組名單（99 廳，無 LGG 覆寫）

akane, ako, ayane, azusa, azusa_swimsuit, ch0064, ch0066, ch0070, ch0087, ch0088, ch0095,
ch0098, ch0099, ch0100, ch0135, ch0137, ch0139, ch0141, ch0145, ch0155, ch0161, ch0163,
ch0164, ch0165, ch0166, ch0170, ch0173, ch0175, ch0177, ch0179, ch0182, ch0183, ch0184,
ch0185, ch0186, ch0190, ch0194, ch0195, ch0196, ch0197, ch0202, ch0203, ch0204, ch0219,
ch0220, ch0221, ch0225, ch0232, ch0235, ch0243, ch0255, ch0258, ch0261, ch0266, ch0269,
ch0274, ch0286, ch0287, ch0291, ch0295, ch0297, ch0303, ch0305, ch0309, ch0318, ch0331,
ch0336, ch0344, ch0355, ch0356, cherino, eimi, hanako, haruka, haruna, hihumi, ibuki,
izumi_swimsuit, karin, kirara, kotori, maki, mari, mashiro_swimsuit, midori, nonomi,
sakurako, saya_casual, saya, serika_newyear, shimiko, shiroko, shiroko_ridingsuit,
sumire, tomoe, tsubaki, wakamo, yoshimi, yuuka（皆 `_home`）

其餘 177 廳（含 CH0230/CH0284/Aris/Atsuko/Serika/Hoshino 系）＝plain 組。

## 後續

1. 用戶目視驗證：兩組各抽 3-5 廳 `#mode=auto` vs `#mode=v2` vs 遊戲——特別是 v2 組的
   邊緣廳（shiroko/akane/tsubaki 等 T3 廳，光層極少，理論上兩模式應該都很接近遊戲）。
2. 若規則獲確認 → 把 `mode=auto` 設為預設。
3. CH0230 的溫和 C 曲線殘差（實機 mids −14/−11/−16）仍開放。
