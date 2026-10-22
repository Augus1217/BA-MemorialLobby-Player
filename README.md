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
- **分組清單**：系統資源／語音／大廳／可下載的大廳／BGM／其他，每組一張卡（可收合、標題列有包數與總大小），四欄對齊（名稱・資訊・大小・操作）；「可下載的大廳」預設收合，避免近 300 間待下載把已安裝的清單淹掉，需要時展開或直接搜尋
- **逐間下載**：按該列的 ⤓ 就地顯示百分比（不彈中央遮罩、不擋設定頁），完成後自動歸位到「大廳」組
- **BGM 用量**：獨立一行顯示 `BGM：N 首 · 大小`，並標出「未使用」；舊版 `assets-player` 會把整份 bgm 目錄（364 首、約 886 MB）留在磁碟，實際只有 85 首被大廳引用——按「清除」只刪沒有任何已安裝大廳引用的曲子（同曲多廳共用會保留），之後進到那些大廳時由該大廳包自動補回
- 完整性檢查、孤兒檔清理、刪全部大廳包／刪另一語言語音
- 網頁版同樣有上述管理介面；順帶修掉 GitHub Pages 子路徑（`/BA-MemorialLobby-Player/`）下快取路徑解析失敗，導致「檔案清單回填／無主檔統計／清除無主檔」靜默失效的問題

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

## 平台支援

| 平台 | 狀態 | 備註 |
|---|---|---|
| Windows 10/11 | ✅ 完整支援 | WorkerW 掛載（koffi）＋全螢幕暫停 |
| Linux（X11/XWayland） | ✅ 完整支援 | `type:'desktop'`；GNOME 需 AppIndicator 擴充 |
| macOS 11+（Intel/Apple Silicon universal） | 🧪 **Beta** | 桌布層級／互動／狀態列已於 VM 實測（見 `docs/wallpaper-mode.md`）；Space 跟隨、登入自啟（需打包版）與實體 mac 效能未驗證 |
| 手機／平板瀏覽器（線上版） | ✅ 可用 | iOS 需 15+（WebGL2）；建議橫向。首次進大廳需連網下載該大廳資源 |

### Linux 執行需求（desktop 版）

AppImage／deb 需要系統函式庫；精簡發行版若缺會「開不起來但沒有訊息」：

```bash
# Debian/Ubuntu
sudo apt install libasound2t64 libnss3 libgtk-3-0 libxss1 libgbm1   # 22.04 以前是 libasound2
# Fedora
sudo dnf install alsa-lib nss gtk3 libXScrnSaver mesa-libgbm
```

- Ubuntu 24.04+ 的 AppArmor 限制（未簽章 AppImage）會顯示 `The SUID sandbox helper binary was found, but is not configured correctly` → 以 `--no-sandbox` 啟動，或改用 deb／AppImage `--appimage-extract` 後執行。
- AppImage 需要 FUSE（`libfuse2`）；沒有時用 `./BA-MemorialLobby-*.AppImage --appimage-extract`。
- Wayland：預設以 XWayland 執行（`ozone-platform-hint=x11`）。原生 Wayland 無 XWayland 時請設 `ELECTRON_OZONE_PLATFORM_HINT=wayland`，但全螢幕暫停偵測在 Wayland 下無效。

### macOS 首次開啟

產物未簽章／未公證，Gatekeeper 會擋。macOS 14 以前：右鍵 →「打開」；**macOS 15 起已移除此繞道**，請到「系統設定 → 隱私權與安全性」→ 找到被擋的 App →「仍要打開」。

### 影片匯出需要 ffmpeg

影片匯出以系統 `ffmpeg` 編碼（`ffmpeg-static` 未列入依賴，避免每次安裝多抓 ~70MB）：

- 有裝 ffmpeg 且 `ffmpeg -version` 可用 → 匯出正常。
- 沒裝 → 匯出會回報「找不到 ffmpeg」，其他功能不受影響。Windows 可 `winget install Gyan.FFmpeg`；macOS `brew install ffmpeg`；Linux 用發行版套件。

### 效能／畫格率

- 播放器預設上限 60fps（高刷螢幕上不會白燒 2.4 倍電力）；`#fps=0` 可解除上限、`#fps=120` 可指定，供診斷用。
- 桌布模式預設 30fps，電池供電自動 −15；設定頁可直接調整。

### 慢速網路／斷線

- **只下載需要的**：開機只等 `core`＋`meta`（intro 背景補齊），其他大廳是「進場才下載」。想離線看就先在設定 → 資源狀態預先下載。
- **看得出有在動**：進度顯示百分比、速度與預估剩餘時間；速度低於 ~150KB/s 會多一行「網路較慢」提示（只是提示，不會中斷）。
- **慢而活的連線不會被砍**：桌機版只在「連續 25 秒完全沒有資料」時重試；低於 4KB/s 連續兩分鐘才視為掉速換線。
- **斷線自動重試**：
  - 桌機版：最多 5 次指數退避，且用 HTTP Range **續傳**（`.part` 保留，關掉 App 下次再開也會接著抓）。
  - 網頁版：最多 3 次，停滯 30 秒即重試（不支援續傳，重新下載該包）。
- **開機檢查**（讀 manifest）15 秒沒回應會自動重試一次並顯示「網路較慢，請稍候」，不會直接失敗。
- 下載後都會驗 sha256；中斷/損毀的包不會被當成已安裝。

如果完全連不上 Worker：開機仍可進入（顯示既有資源），設定頁的資源狀態會顯示離線，之後按「開始下載」即可重試。

### 版本更新：只下載有變動的包

更新判斷看的是**每個包的 sha256**，不是版本字串——版本換了但內容沒變的包不會重抓。網頁版跨版本時會把 sha 未變的包從舊快取**本機搬**到新快取（不經網路），進度會顯示「沿用既有資源」。

以 2026.10 的兩次實際發布為例：

| 版本 | 變動的包 | 需要重新下載 |
|---|---|---|
| 2026.1008.0 → 2026.1012.0 | 3 包（`meta`＋2 個大廳） | 13.5 MB（全量 4.1GB 的 0.3%） |
| 2026.1012.0 → 2026.1015.0 | 4 包 | 924 MB（其中 `assets-player` 909 MB；該包在 2026.1022.0 移除） |
| 2026.1015.0 → 2026.1022.0 | 277 包 | 2.3 GB（`assets-player` 退役、BGM 改由各 lobby 包帶 → 大廳包各重抓一次；只裝幾間大廳的人實際只抓那幾包） |

- `meta`（大廳索引／角色資料，<1 MB）幾乎每次都會更新，也只佔開機門檻的一小角。
- 大廳包只在自己的素材變動時更新；語音包依語言資料夾各自獨立。
- `core`（students/ui/loading/fonts/voice_title/clickfx）很少變動；`intro` 只在影片換檔時更新。
- `core` 的 `fonts/` 只帶程式實際註冊的四個字體（NotoSansTC、NotoSans、MalgunGothic、NotoSansKR）；2026.1022.0 起移除先前多包的 `BA-LineSeedKR-Bold.ttf`（3.4 MB，沒有任何程式引用）。
- **`assets-player`（954 MB）在 2026.1022.0 移除**：它把 BGM 和各 lobby 包、`core` 已有的檔案重新打包一輪，真正獨有的只有 35 張、約 0.5 MB 的 `clickfx` 貼圖（已併進 `core`，網頁版的原版點擊特效也因此修好）。BGM 改由各 lobby 包帶自己的曲子（ogg＋m4a，同檔名在磁碟上仍只佔一份）；全量下載 4.43 GB → 3.87 GB（−556 MB），代價是換版時所有大廳包會重抓一次。桌機打包 CI 也不再每次發布抓 954 MB（3 個 job 各一次）。
- 改版不會主動刪除「新版已移除」的舊檔案；需要回收空間時用設定 → 管理空間的清理功能。

## 已知限制

- 偶爾顯示日文＝該角色 Global 版尚未實裝，無官方翻譯時 fallback 日文；實裝後管線自動補上
- 資源更新以 Global 版本為準
- 簡體中文沒有官方字幕／角色簡介（遊戲本身只有 en/ja/kr/tw 四語），選「簡」時字幕沿用繁體
- 手機（線上版）的儲存空間可能被瀏覽器回收（iOS 約 7 天未使用）；被清掉後下次進大廳會自動重新下載

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

## Platform support

| Platform | Status | Notes |
|---|---|---|
| Windows 10/11 | ✅ Fully supported | WorkerW mounting (koffi) + fullscreen pause |
| Linux (X11/XWayland) | ✅ Fully supported | `type:'desktop'`; GNOME needs AppIndicator extension |
| macOS 11+ (Intel/Apple Silicon universal) | 🧪 **Beta** | Wallpaper layering / interaction / menu-bar icon tested in a VM (see `docs/wallpaper-mode.md`); Space following, login autostart (packaged build only) and real-hardware performance unverified |
| Mobile / tablet browser (web build) | ✅ Usable | iOS 15+ (WebGL2); landscape recommended. The first visit to a lobby downloads its assets (needs internet) |

### Linux runtime requirements (desktop)

AppImage/deb need system libraries; on minimal distros the app can fail to start
without any message:

```bash
sudo apt install libasound2t64 libnss3 libgtk-3-0 libxss1 libgbm1   # libasound2 before 22.04
sudo dnf install alsa-lib nss gtk3 libXScrnSaver mesa-libgbm
```

- Ubuntu 24.04+ AppArmor restrictions on unsigned AppImages can produce
  `The SUID sandbox helper binary was found, but is not configured correctly`
  → start with `--no-sandbox`, use the deb, or run `--appimage-extract` first.
- AppImage needs FUSE (`libfuse2`).
- Wayland: runs through XWayland by default (`ozone-platform-hint=x11`). On a
  pure-Wayland session set `ELECTRON_OZONE_PLATFORM_HINT=wayland` (fullscreen
  pause detection is unavailable there).

### macOS first launch

Artifacts are unsigned/un-notarized, so Gatekeeper blocks them. macOS <=14:
right-click > Open. **macOS 15 removed that shortcut**: System Settings >
Privacy & Security > "Open Anyway".

### Video export needs ffmpeg

Video export uses the system `ffmpeg` (`ffmpeg-static` is intentionally not a
dependency, to avoid a ~70 MB download on every install):

- ffmpeg present (`ffmpeg -version` works) -> export works.
- Otherwise export reports "ffmpeg not found"; everything else still works.
  Windows: `winget install Gyan.FFmpeg`; macOS: `brew install ffmpeg`; Linux: distro package.

### Performance / frame rate

- The player caps at 60 fps by default (avoids burning 2.4x power on 144 Hz
  panels); `#fps=0` uncaps and `#fps=120` sets an explicit cap (diagnostics).
- Wallpaper mode defaults to 30 fps, with a -15 reduction on battery.

### Slow / flaky networks

- **Only what you need is downloaded**: boot waits for `core` + `meta` only
  (`intro` fills in the background); other lobbies download when you open them.
  Use Settings -> Storage to pre-download for offline viewing.
- **You can see it moving**: progress shows percent, speed and ETA; below
  ~150 KB/s a "slow network" note is added (informational only).
- **Slow-but-alive connections are not killed**: desktop only retries after 25 s
  of *zero* bytes; sustained < 4 KB/s for two minutes counts as a dying link.
- **Automatic retry on drop**:
  - Desktop: up to 5 attempts with exponential backoff, resuming via HTTP Range
    (`.part` survives restarts).
  - Web: up to 3 attempts, retrying after 30 s of no data (no resume; the pack
    is re-downloaded).
- **Boot check** (manifest fetch) retries once after 15 s and shows a
  "slow network, please wait" note instead of failing outright.
- Every install verifies sha256, so interrupted/corrupt packs never count as installed.

If the worker is unreachable the app still boots with whatever is installed, and
Settings -> Storage shows offline with a button to retry.

### Updating: only changed packs are downloaded

Update detection compares the **sha256 of every pack**, not the version string -
a release bump with identical pack contents downloads nothing. On the web build,
packs whose sha is unchanged are **copied locally** from the previous version's
Cache Storage into the new one (no network) and the progress line says so.

Two real releases in October 2026:

| Release | Changed packs | Re-download |
|---|---|---|
| 2026.1008.0 -> 2026.1012.0 | 3 (`meta` + 2 lobbies) | 13.5 MB (0.3% of 4.1 GB) |
| 2026.1012.0 -> 2026.1015.0 | 4 | 924 MB (909 MB of it `assets-player`, retired afterwards) |

- `meta` (lobby index / character data, <1 MB) changes almost every release and
  is only a small part of the boot gate.
- Lobby packs change only when their own assets change; voice packs are split
  per language folder.
- `core` (students/ui/loading/fonts) changes rarely; `intro` only when the video
  is re-rendered.
- **`assets-player` (909 MB) was retired in 2026-10**: it was a re-pack of files
  already shipped by the lobby packs (BGM) and `core` (students/ui/loading/fonts);
  only 35 `clickfx` texture PNGs (~0.5 MB) were unique. `clickfx` now lives in `core`
  (downloaded at boot, which also fixes the authentic click effect on the web
  build) and BGM comes with each lobby pack. The desktop build no longer pulls
  953 MB per job, and "download all" no longer stores a duplicate BGM set.
- Updating does not delete files that the new release dropped; use
  Settings -> Storage cleanup when you want the space back.

## Known limitations

- Occasional Japanese text = character not yet in Global; falls back to Japanese until official translations land (pipeline backfills automatically)
- Resources track the Global version
- Simplified Chinese has no official subtitles/profile text (the game ships en/ja/kr/tw only); choosing CHS reuses the Traditional Chinese strings
- Mobile (web build) storage can be evicted by the browser (~7 days of inactivity on iOS); evicted packs are re-downloaded automatically on the next lobby visit
