# BA Memorial Lobby Player

《蔚藍檔案》(Blue Archive) 記憶大廳（Memorial Lobby）**模擬器** — Electron + PixiJS + Spine。
重現遊戲內的大廳體驗：全螢幕沉浸場景，角色在房間裡待機、對你的動作有反應、開口說話（即時嘴型）、並顯示與語音逐句對應的多語言字幕氣泡。

> 線上版（GitHub Pages）：<https://augus1217.github.io/BA-MemorialLobby-Player/>
> 資源建置管線請見姊妹倉庫 [BA-MemorialLobby-Assets](https://github.com/Augus1217/BA-MemorialLobby-Assets)。

## 功能

### 呈現

- **266+ 大廳骨架**（`assets/lobby_index.json`，每 lobby 取主要 LOD 變體；處理 `Airi0/Airi`、`CH9996/CH0996`、`juri/Juri` 等命名異例）
- 沉浸式呈現：自動隱藏 HUD、電影黑邊
- 房間場景層：有開場特寫的 lobby（`Aru_Scene`、`Akari_Scene` 等）會在角色背後渲染房間
- 開場動畫（`Start_Idle_01`）完整播放，含 PlayableDirector 時間軸對位（bodyStart 延遲、白閃切換）；可用 `≫` 按鈕跳過（帶確認彈窗，比照遊戲的 `UIPopup_System` 流程）
- **多段開場時間軸**（`lobby_timelines.json`）：依官方 PlayableDirector 的 per-track 排程精確播放（體育服優香 Start_Idle_01 → 4s 額外骨架 CH0184_00 → 10.67s Start_Idle_02 → 24s Idle_01 這類多段開場自動正確）；非本體骨架（`CH0184_00`、`Shigure_00/01` 等）由 timeline 的 per-clip skeleton 欄位驅動、載入獨立 spine 物件平行播出，已作為 bg/scene 載入的同名骨架則沿用既有機制不重複載入
- 攝影機取景依 `lobby_camera_config.json`：骨架攝影機骨頭對齊畫面中心 + kivo fill 縮放規則

### 互動（對齊遊戲 UILobbySpineController 逆向）

| 操作 | 反應 |
| --- | --- |
| 移動游標 | 眼睛跟著你看（逐幀驅動 `Look_01`，即「抓眼睛」機制） |
| 點擊 | 隨機有聲 `Talk_NN`（雙 track 同步 `_M` 嘴型 + `_A` 表情） |
| 長按 | 摸頭 `Pat_01` 迴圈，放開結束 |
| ESC（專注模式中） | 退出專注模式 |

- 語音由骨架內嵌動畫事件驅動，WebAudio analyser 即時 RMS 疊加在烘焙嘴型上
- 自主閒聊：待機時隨機觸發語音（不強制看鏡頭）

### 對話氣泡（本專案的核心還原）

- **Talk / Think 兩種氣泡樣式**：從官方 `CharacterDialogDB.DialogType` 判定——說話用 `Lobby_balloon.png`、內心 OS 用 `Lobby_balloon2.png`
- **多語言字幕**（繁中/日文/英文/韓文），跟隨介面語言切換；字體也依語言自動換（繁中 Noto Sans TC／日文 M PLUS 1p）
- 字幕資料來源：
  - 官方表 GL/JP `CharacterDialogDB`（UILobbySpecial 分類）＝遊戲中大廳點擊台詞的真實來源
  - GL 表提供 Tw/En 翻譯；JP 缺漏新角色的韓文對齊由文字正規化模糊比對完成
  - **faster-whisper 全量轉錄交叉驗證**（2573 檔語音），確保表格行 ↔ 音檔一句一句對得上
  - SFX（舔冰淇淋等短音效）正確地不顯示任何氣泡

### 角色介紹（ⓘ 按鈕）

右上 `ⓘ` 開啟目前播放角色的檔案面板，內容全部來自官方資料：

- **頭貼 + 名稱**：與側欄同源的學生頭貼；名稱跟隨介面語言（`students_data.csv` 五語言）
- **打招呼**：`LocalizeCharProfile.StatusMessage`（大廳開場的第一句）
- **檔案欄位**：生日／年齡／身高／學年／興趣／CV（`LocalizeCharProfile`，繁中/日/英/韓隨介面語言切換）
- **簡介**：`LocalizeCharProfile.ProfileIntroduction`（GL 表 267 角色五語言＋JP 表 15 個 JP 限定新角色日文）
- **紀念大廳台詞**：該角色全部大廳語音的逐句台詞（`voice_index` × `lobby_subtitle`；SFX 自動略過）

資料由 Assets 管線的 `extract_char_profiles.py` 從官方 ExcelDB 產生（`char_profiles.json`，約 280 角色）；JP 限定角色無官方翻譯時 fallback 日文，與字幕行為一致。

### 專注模式

底部 `◉` 按鈕一鍵進入：隱藏所有按鈕與介面文字，只留人物與對話框，互動照常運作。`ESC` 退出。

### 資源管理

- **增量更新**：`assets_version.json`（schema 2）記錄每個包 sha256，啟動時只下載缺的包
- **串流模式**（預設）：初始只下載核心資源，第一次進入某角色大廳時才下載該 lobby＋語音包
- **管理空間**（設定面板）：列出已下載的所有資源包與磁碟用量，可自行刪除（core 必載不可刪），刪除後下次進入會重新下載
- BGM、點擊特效、BA 遊標皆可在設定中調整

## 快速開始（一般使用者）

- **線上版**：直接開 <https://augus1217.github.io/BA-MemorialLobby-Player/>（Service Worker 快取 + 串流下載，瀏覽器支援 Chrome/Edge/Firefox）
- **桌面版**：到 [Releases](https://github.com/Augus1217/BA-MemorialLobby-Player/releases) 下載安裝包，啟動後程式會自動串流下載需要的資源。

## 開發者 Setup

```bash
npm install
# 從本地解包目錄產生 assets/（或先用 Assets repo 的 GitHub Actions 產物）
python3 scripts/copy_assets.py
npm start
```

資源刻意不入庫。copy script 支援環境變數覆寫來源路徑：

```bash
BA_SRC_SPINE=/path/to/SpineLobbies \
BA_SRC_MEDIA=/path/to/GL_Extracted/Media \
BA_SRC_BGM=/path/to/Media/Audio/BGM \
BA_SRC_DATA=/path/to/BA_MemorialLobby/data \
python3 scripts/copy_assets.py
```

- `SpineLobbies`：客戶端解包的 `Assets/_MX/SpineLobbies`（`.skel`/`.atlas`/.png）
- `Media`：含 `JP_*` 語音資料夾
- BGM：`Theme_*.ogg` 所在目錄
- data：各 mapping JSON（可改用 Assets repo 的 build 產物）

## 控制摘要

| Input | Action |
| --- | --- |
| ‹ / › | 上一位 / 下一位 |
| ♪ | BGM 開關 |
| ⤢ | 全螢幕 |
| ◉ | 專注模式 |
| ≫ | 跳過開場動畫 |
| ⓘ | 角色介紹（頭貼／檔案／簡介／台詞） |

`CAPTURE=<png path>` headless 截圖、`#lobby=<name>` deep-link 到指定大廳。

## 技術棧

- Electron、Vite（dev 由 main.js spawn；production 用 vite build）
- pixi.js 8.19.0、@esotericsoftware/spine-pixi-v8 4.2.119（spine-core 4.2 解析 4.2.x lobby 檔）
- WebAudio `AnalyserNode` 即時嘴幅
- i18n：ui_i18n.json（五語言）

## 已知限制

- 偶爾顯示日文 = 該角色 Global 版尚未實裝（如部分 CH03xx 新角色），無官方翻譯時 fallback 日文；實裝後管線會自動補上
- Yostar JP 服 CDN 偶爾限流；資源更新以 Global 版本為準
