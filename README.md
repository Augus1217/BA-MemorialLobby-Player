# BA Memorial Lobby Player

《蔚藍檔案》(Blue Archive) 記憶大廳（Memorial Lobby）**播放器** —— Electron + PixiJS + Spine。
重現遊戲內的大廳體驗：角色在房間裡待機、對你的動作有反應、開口說話（即時嘴型）、多語言字幕氣泡，並支援影片匯出。

> 線上版（GitHub Pages）：<https://augus1217.github.io/BA-MemorialLobby-Player/>
> 資源建置管線請見姊妹倉庫 [BA-MemorialLobby-Assets](https://github.com/Augus1217/BA-MemorialLobby-Assets)。
> English version below（英文版在下方）。

## 功能

### 呈現

- **280+ 大廳骨架**（`lobby_bodytouch.json` / `lobby_ikzones.json` 全數 280/280 覆蓋；處理 `Airi0/Airi`、`CH9996/CH0996` 等命名異例）
- 沉浸式呈現：自動隱藏 HUD、電影黑邊（遊戲 `UILetterBox` 常數：比例超出 `[4/3, 2.1733]` 才蓋）
- 房間場景層：有開場特寫的 lobby 會在角色背後渲染房間
- 開場動畫（`Start_Idle_01`）完整播放，含 PlayableDirector 時間軸對位；可用 `≫` 按鈕跳過（帶確認彈窗，比照遊戲流程）
- **多段開場時間軸**（`lobby_timelines.json`）：per-clip skeleton 驅動多骨架平行播出
- 攝影機取景依 `lobby_camera_config.json`：相機線置於畫面垂直中央，人物縮放 `vw/2900`

### 互動（對齊遊戲逆向）

| 操作 | 反應 |
| --- | --- |
| 移動游標 | 眼睛跟著你看（逐幀驅動 `Look_01`） |
| 點擊 | 隨機有聲 `Talk_NN`（`_M` 嘴型 + `_A` 表情雙 track） |
| 長按拖曳 | 摸頭 `Pat_01`／`Pat2` 迴圈，放開回彈 |
| 捏臉／戳臉 | Pinch / Touch IK（按 NGUI depth 判定優先級） |
| ESC（專注模式中） | 退出專注模式 |

- 語音由骨架內嵌動畫事件驅動，WebAudio analyser 即時 RMS 疊加在烘焙嘴型上
- 自主閒聊：待機時隨機觸發語音

### 對話氣泡（本專案的核心還原）

- **Talk / Think 兩種氣泡樣式**：官方 `CharacterDialogDB.DialogType` 判定
- **多語言字幕**（繁中／簡中／日文／英文／韓文），跟隨介面語言；字體依語言自動換
- 字幕來源：官方表 GL/JP `CharacterDialogDB`（UILobbySpecial 分類）＋ faster-whisper 全量轉錄交叉驗證
- SFX 短音效正確地不顯示氣泡

### 角色介紹（ⓘ 按鈕）

官方 `LocalizeCharProfile`：頭貼＋五語名稱、打招呼、生日／年齡／身高／學年／興趣／CV、簡介、該角色全部大廳台詞。

### 資源管理（設定 → 管理空間）

- **增量更新**：`assets_version.json`（schema 2）記每包 sha256，只下缺的包
- **串流模式**（預設）：初始只下核心，進大廳時隨播隨下
- 表格式清單：人名＋種類＋包名＋檔數＋大小＋刪除（core 不可刪）；另附**未下載大廳**區，可逐間預載
- 完整性檢查、孤兒檔清理、刪全部大廳包／刪另一語言語音

### 人氣排行（可選匿名統計）

- 設定或 HUD 獎盃鈕進入：7／30 天榜，觀看次數／時長／參與人數
- 側邊欄前 10 名掛 🔥改成的手繪徽章，可切人氣排序
- 統計預設**關閉**；開啟後只回報「看了哪間、幾次、幾秒」，每日彙總一次，無 IP／無裝置資訊，關閉即刪本地記錄
- 首次進大廳會邀請一次，之後不再打擾

### 影片匯出

- 比例列（16:9／16:10／4:3／3:2／21:9／1:1）＋常駐解析度輸入框（改一欄自動按比例連動，偶數化＋上下限）
- FPS 滑桿＋數字框連動（10–60）、MP4／WebM、含語音／對話框可選
- 匯出時暫時 resize renderer 並重跑取景，結束自動還原；錄製中保持即時預覽

## 快速開始（一般使用者）

- **線上版**：<https://augus1217.github.io/BA-MemorialLobby-Player/>（Chrome/Edge/Firefox）
- **桌面版**：[Releases](https://github.com/Augus1217/BA-MemorialLobby-Player/releases) 下載安裝包，啟動後自動串流下載資源

## 開發者 Setup

```bash
npm install
# 從本地解包目錄產生 assets/（或先用 Assets repo 的 Actions 產物）
python3 scripts/copy_assets.py
npm start
```

可用環境變數覆寫來源路徑（`BA_SRC_SPINE`、`BA_SRC_MEDIA`、`BA_SRC_BGM`、`BA_SRC_DATA`，詳見 `scripts/copy_assets.py --help`）。資源刻意不入庫。

## 控制摘要

| 按鍵／按鈕 | 動作 |
| --- | --- |
| ‹ / › | 上一位／下一位 |
| ♪ | BGM 開關 |
| ⤢ | 全螢幕 |
| ◉ | 專注模式 |
| ≫ | 跳過開場動畫 |
| ⓘ | 角色介紹 |
| 獎盃 | 人氣排行 |

`CAPTURE=<png path>` headless 截圖、`#lobby=<name>` deep-link、`PROBE=1` 自檢、`LAYOUT=1` 版面量測。

## 技術棧

- Electron、Vite（dev 由 main.js spawn；production 用 vite build）
- pixi.js 8、@esotericsoftware/spine-pixi-v8（spine-core 4.2）
- WebAudio `AnalyserNode` 即時嘴幅；ffmpeg（ffmpeg-static）影片編碼
- i18n：`assets/ui/ui_i18n.json`（五語言）＋ app 內 `CTL_I18N`（HUD 文字）

## 已知限制

- 偶爾顯示日文＝該角色 Global 版尚未實裝，無官方翻譯時 fallback 日文；實裝後管線自動補上
- 資源更新以 Global 版本為準

---

# BA Memorial Lobby Player (English)

A Blue Archive Memorial Lobby **player** — Electron + PixiJS + Spine.
Recreates the in-game lobby experience: idle characters that react to you, talking with real-time lip-sync, multilingual subtitle bubbles, and video export.

> Live web build: <https://augus1217.github.io/BA-MemorialLobby-Player/>
> Asset pipeline: sister repo [BA-MemorialLobby-Assets](https://github.com/Augus1217/BA-MemorialLobby-Assets).

## Features

### Presentation

- **280+ lobby skeletons** (`lobby_bodytouch.json` / `lobby_ikzones.json` at 280/280 coverage; handles naming quirks like `Airi0/Airi`, `CH9996/CH0996`)
- Immersive view: auto-hiding HUD, cinematic letterbox (game `UILetterBox` constants: bars only outside aspect `[4/3, 2.1733]`)
- Room layers behind characters for lobbies with intro close-ups
- Full intro animations (`Start_Idle_01`) with PlayableDirector timeline alignment; skippable via `≫` (with confirm, mirroring the game flow)
- **Multi-part intro timelines** (`lobby_timelines.json`): per-clip skeletons drive parallel playback
- Camera framing from `lobby_camera_config.json`: camera line pinned to vertical center, character scale `vw/2900`

### Interaction (reverse-engineered from the game)

| Input | Reaction |
| --- | --- |
| Move cursor | Eyes follow you (per-frame `Look_01`) |
| Click | Random voiced `Talk_NN` (`_M` lip + `_A` face dual track) |
| Long-press drag | Head-pat `Pat_01`/`Pat2` loop with spring-back release |
| Pinch / poke | Pinch / Touch IK (NGUI-depth priority routing) |
| ESC (in focus mode) | Exit focus mode |

- Voice driven by embedded skeleton animation events; WebAudio analyser RMS layered over baked lip shapes
- Ambient chatter: random voiced lines while idle

### Dialog bubbles (the core restoration)

- **Talk / Think styles** from official `CharacterDialogDB.DialogType`
- **Multilingual subtitles** (TW/CN/JP/EN/KR) following UI language; fonts switch per language
- Sources: official GL/JP `CharacterDialogDB` (UILobbySpecial) + faster-whisper full-transcription cross-check
- SFX clips correctly show no bubble

### Character profiles (ⓘ button)

Official `LocalizeCharProfile`: avatar + 5-language names, greeting, birthday/age/height/year/hobby/CV, bio, and all lobby lines for that character.

### Storage manager (Settings → Storage)

- **Delta updates**: `assets_version.json` (schema 2) tracks per-pack sha256; only missing packs download
- **Streaming mode** (default): core first, per-lobby packs on visit
- Tabular list: student name + kind + pack key + file count + size + delete (core locked); plus a **not-yet-downloaded** section with per-lobby preload
- Integrity check, orphan cleanup, bulk delete (all lobbies / other-language voices)

### Popularity ranking (opt-in anonymous stats)

- Via Settings or the HUD trophy button: 7/30-day boards with views / watch time / participants
- Top-10 fire badges in the sidebar + popularity sort toggle
- Stats are **off by default**; when on, only "which lobby, how many views, how long" is reported in one daily batch — no IPs, no device info; turning off deletes local records
- One-time invite on first lobby visit, never nags again

### Video export

- Aspect row (16:9 / 16:10 / 4:3 / 3:2 / 21:9 / 1:1) + always-visible resolution inputs (editing one re-fits the other, even-rounded + clamped)
- FPS slider + number box (10–60), MP4 / WebM, optional voice / dialog overlay
- Renderer is temporarily resized and re-framed during export, then restored; live preview kept throughout

## Quick start (users)

- **Web**: <https://augus1217.github.io/BA-MemorialLobby-Player/> (Chrome/Edge/Firefox)
- **Desktop**: download from [Releases](https://github.com/Augus1217/BA-MemorialLobby-Player/releases); resources stream on first run

## Developer setup

```bash
npm install
# Generate assets/ from local unpacked dirs (or use Assets repo Actions artifacts)
python3 scripts/copy_assets.py
npm start
```

Source paths overridable via env (`BA_SRC_SPINE`, `BA_SRC_MEDIA`, `BA_SRC_BGM`, `BA_SRC_DATA`; see `scripts/copy_assets.py --help`). Assets are deliberately untracked.

## Controls

| Input | Action |
| --- | --- |
| ‹ / › | Previous / next student |
| ♪ | BGM toggle |
| ⤢ | Fullscreen |
| ◉ | Focus mode |
| ≫ | Skip intro |
| ⓘ | Character profile |
| Trophy | Popularity ranking |

`CAPTURE=<png path>` headless screenshots, `#lobby=<name>` deep-links, `PROBE=1` self-test, `LAYOUT=1` layout metrics.

## Stack

- Electron, Vite (dev spawned by main.js; vite build for production)
- pixi.js 8, @esotericsoftware/spine-pixi-v8 (spine-core 4.2)
- WebAudio `AnalyserNode` live mouth amplitude; ffmpeg (ffmpeg-static) encoding
- i18n: `assets/ui/ui_i18n.json` (5 languages) + in-app `CTL_I18N` (HUD strings)

## Known limitations

- Occasional Japanese text = character not yet in Global; falls back to Japanese until official translations land (pipeline backfills automatically)
- Resources track the Global version
