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

- **十二輪起 `mode=auto` 為預設**（用戶核准 2026-10-05）：T3 或有 LGG → plain、其餘 → v2。
  URL `mode=v2|plain` 可強制覆寫（舊全庫 v2 行為＝`mode=v2`）。
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

## 十一輪更新（2026-10-05 用戶回饋）

1. **T3 廳要 plain**（用戶裁定）→ 規則更新：`mode=auto` = T3 或有 LGG → plain；
   其餘（T1/T2 無 LGG）→ v2。v2 組由 99 縮至 84 廳（15 個 T3 移入 plain 組）。
   tier 資料：assets/data/lobby_light_tier.json（census 280 廳）。
2. **烘焙語義更正**：用戶實機比對（CH0070 截圖）否證「PMA 族 bake=G2L(rgb×a)」——
   BG/window_Blur（22.5% mid-alpha）在該烘焙下貢獻只剩 0.38×＝「背景窗射出來的光不見了」；
   遊戲窗區實測＝G2L(rgb)×a（舊烘焙）命中（窗區 [251.3,253.0,242.9] vs 遊戲 [250.7,253.7,238.9]）。
   **兩族統一 bake＝G2L(rgb)×a（線性域預乘）**：straight 族＝硬體解碼後 shader ×a；
   PMA 族＝自訂 loader 解碼到線性後預乘（「CPU byte 運算必在 gamma 域」的推論鏈
   在此斷裂——自訂 loader 不走 byte 數學）。top_light（page3，0 mid-alpha）不受影響；
   身體部分（頂點色 G2L）維持正確——用戶確認「身體已經快要一模一樣」。
3. 驗證：CH0070 mode=auto 窗區恢復 [251.3,253.0,242.9]；Akane_home（T3）mode=auto
   無烘焙 log（plain）；Hanako_home（T1 無 LGG）有烘焙 log（v2）；單元 16/16。

## 十三輪更新（2026-10-06 用戶回饋二）：LGG 規則破功，遊戲實際開關未解

用戶裁定兩則：**yuuka_home → plain**（v2 反而壞）、**koharu_home → v2**（「目前感覺沒被修，
太亮了」）。LGG 規則在這兩廳破功（yuuka 無 LGG 被判 v2、koharu 有 LGG 被判 plain）→ 4/6。

**「太亮了」根因＝十三輪審計的 cf=(2,2,2) 補丁**：`_C` profile（ColorAdjustments——曝光/
cf/contrast 所在）實證非 idle 後處理（曝光若生效全庫 45× 爆白，plain 命中遊戲）——cf=2 被
我錯誤套進 idle＝koharu plain×2。已回退 15 筆 _C 欄位（cf×14、c×1）；lift（主 profile）保留。

**逐廳分隔特徵搜剿（全部失敗）**：以六廳實測（探針修正大小寫污染——LOBBY 必須用 index
原大小寫，小寫會 fallback 渲染成 Airi0_home）——LGG 有無 4/6、元件激活矩陣 ✗、tier ✗、
材質族 ✗、idle 期 additive 覆蓋（CH0230 2.32× 光卻 plain；Koharu 0.16× 光卻 v2——**方向反轉**）✗、
主光槽貼圖軟度 ✗、SkeletonData 旗標 ✗、plain-vs-v2 分歧幅度/色罩 ✗（CH0230 23.0 plain
vs Hanako 16.5 v2 交疊）。

**目視證據**：Koharu plain＝置物櫃背景被添加光層洗成慘白（gamma 合成對亮底+半透明層的
爆洗），v2＝深藍飽和（遊戲方向）；CH0230 plain 命中遊戲（2.32× 光照樣對）。逐廳差異真實
存在但觸發器不在 spine/PPV 可算特徵裡——**最後嫌疑＝lobby prefab（ui-uilobbyelement bundle）
的 Volume 綁定/圖層激活**（遊戲實際的逐廳開關），待解碼。

**十四輪結案（2026-10-07 用戶重看）**：**koharu_home → plain**（cf 毒除去後重看翻案；
先前 v2 判斷受 cf=2 污染）。LGG 規則回升 **5/6**——唯一例外 yuuka_home（T2、idle 覆蓋僅
0.14×、無 LGG；候選精化：無 LGG 且 idle 光覆蓋低 → plain，儀器已備待更多裁定樣本）。
Hanako/CH0070 維持 v2（用戶裁定，並排圖已供重看未翻案）。

## 後續

1. **解碼 lobby prefab 的 Volume 綁定**（koharu vs yuuka vs ch0070 對比）＝遊戲實際判斷方式。
2. 用戶重看 koharu（乾淨 v2）與 hanako/ch0070。
3. CH0230 溫和 C 曲線殘差仍開放。
