# BA Memorial Lobby — 專案計畫書

## 專案概述

Blue Archive Memorial Lobby Electron 模擬器，完整還原蔚藍檔案紀念大廳的播放流程。

- **技術棧**：Electron 33 + Vite 8 + PixiJS 8.19 + spine-pixi-v8 4.2
- **版本**：0.1.0
- **授權**：MIT

---

## 現狀

### 已完成功能

| 功能 | 狀態 |
|------|------|
| Spine 骨骼動畫載入與渲染 | ✅ |
| Rail 相機系統（66.67s 循環） | ✅ |
| 語音播放 + WebAudio 唇形同步 | ✅ |
| 白色閃憶特效（exposure + sprite alpha） | ✅ |
| 對話氣泡（Talk / Think / UITalk 三種） | ✅ |
| 視線追蹤 + 觸碰互動（摸頭/說話） | ✅ |
| BGM 播放（每角色獨立） | ✅ |
| 開場影片（HEVC → H.264 轉碼） | ✅ |
| 逐字稿字幕（多語言：tw/jp/en/kr） | ✅ |
| 學生側欄（搜尋 + 頭像） | ✅ |
| 影片匯出（MP4/WebM，逐幀渲染） | ✅ |
| 截圖功能 | ✅ |
| Deep linking（`#lobby=<name>`） | ✅ |
| 無頭截圖模式（`CAPTURE=<path>`） | ✅ |
| 14 個 JP 獨佔新角色（CH0172-CH0356） | ✅ |
| 387 首 BGM（含 JP 新增） | ✅ |

### 資料來源

| 類別 | 來源 | 大小 |
|------|------|------|
| Spine 骨骼（281 個 lobby） | JP 伺服器 | 1.9 GB |
| Voice 語音（300 個資料夾） | JP 伺服器 | 774 MB |
| BGM（387 首） | JP 伺服器 | 410 MB |
| Scene 場景疊加（6 個） | JP 伺服器 | 11 MB |
| Data metadata（10 個 JSON/CSV） | 手動維護 | 2.3 MB |
| Intro 影片 | APK 解包 | 9 MB |
| UI 圖片（氣泡/游標） | 手動 | 56 KB |
| 學生頭像（173 個） | 手動 | 1.5 MB |
| **合計** | | **~3.2 GB** |

### CostumeGroupId → CH Number 映射（ CostumeDB DevName 驗證）

| CostumeGroupId | 角色 | CostumeGroupId | 角色 |
|---|---|---|---|
| 10139 → CH0172 吉野妮可 | | 10146 → CH0344 羽沼真琴 |
| 10140 → CH0173 高倉胡桃 | | 10147 → CH0345 京極皋月 |
| 10141 → CH0247 伊草遙香 | | 10148 → CH0346 棗伊呂波 |
| 10142 → CH0303 御稜名草 | | 16020 → CH0174 天神山音葵 |
| 10143 → CH0355 春原瞬 | | 20059 → CH0246 浅黄睦月 |
| 10145 → CH0356 龍華妃咲 | | 20060 → CH0347 丹花伊吹 |
| | | 26016 → CH0348 元宮千明 |
| | | 19004 → Erika（無 CDB 資料） |

---

## 目標

1. **可發布**：讓其他人能下載使用，不限於開發者電腦
2. **自動更新**：BA 更新時，一條指令完成資料重建與發佈
3. **跨平台**：Windows / macOS / Linux 都能跑

---

## 架構設計

### 使用者流程

```
首次安裝：
  下載 App（~200MB）→ 開啟 → 偵測無 assets → 自動下載 assets（~3.2GB）→ 完成

後續更新（BA 更新時）：
  你觸發 GitHub Actions → 自動下載/提取/打包 → 發佈新版 assets
  用戶開啟 App → 偵測版本不同 → 通知下載 → 用戶確認 → 下載差異 package → 完成
```

### 資料打包策略

Assets 3.2GB 拆分為 8 個 tar.gz，每個 < 2GB（GitHub Releases 限制）：

| Package | 大小 | 內容 |
|---------|------|------|
| `assets-spine-v{VER}.tar.gz` | ~1.7 GB | Spine 骨骼（skel/atlas/png） |
| `assets-voice-v{VER}.tar.gz` | ~774 MB | 語音（.ogg） |
| `assets-bgm-v{VER}.tar.gz` | ~410 MB | BGM（.ogg） |
| `assets-scene-v{VER}.tar.gz` | ~11 MB | 場景疊加骨骼 |
| `assets-data-v{VER}.tar.gz` | ~460 KB | Metadata JSON/CSV |
| `assets-intro-v{VER}.tar.gz` | ~9 MB | 開場影片 + 音效 |
| `assets-ui-v{VER}.tar.gz` | ~54 KB | 氣泡/游標圖片 |
| `assets-students-v{VER}.tar.gz` | ~1.2 MB | 學生頭像 |

### 版本管理

```json
// assets_version.json（放在 GitHub Release）
{
  "version": "2025.0819.0",
  "packages": {
    "spine":  { "url": "...", "sha256": "...", "size": 1792500788 },
    "voice":  { "url": "...", "sha256": "...", "size": 811448637 },
    "bgm":    { "url": "...", "sha256": "...", "size": 430211740 },
    "scene":  { "url": "...", "sha256": "...", "size": 11102519 },
    "data":   { "url": "...", "sha256": "...", "size": 470121 },
    "intro":  { "url": "...", "sha256": "...", "size": 9332153 },
    "ui":     { "url": "...", "sha256": "...", "size": 55013 },
    "students": { "url": "...", "sha256": "...", "size": 1234328 }
  },
  "buildDate": "2025-08-19T00:00:00Z"
}
```

本地端在 `assets/.version` 存放當前版本號。

---

## Phase 1: 數據管線自動化 ✅

### 1.1 `scripts/build_assets.py`

統一 pipeline 腳本，整合完整流程：

```
ba-downloader sync --region jp          （下載 JP bundles + media）
ba-downloader sync --region gl -rt table （下載 GL CharacterDialogDB）
ba_spine_extractor.py                   （Unity bundle 提取）
copy_assets.py                          （複製到 assets/ + 生成 lobby_index.json）
extract_events.mjs                      （提取 spine voice events）
GL CharacterDialogDB → lobby_dialog_types.json（替換 GL 版）
打包為 8 個 tar.gz                      （每個 < 2GB）
```

支援的參數：
- `--version VERSION`（必填）
- `--skip-download`（跳過 ba-downloader）
- `--skip-extract`（跳過 bundle 提取）
- `--skip-copy`（跳過 copy_assets）
- `--skip-events`（跳過 events 提取）
- `--skip-dialog-types`（跳過 dialog types 提取）
- `--only-package`（只打包現有 assets）

環境變數覆蓋：`WORK_DIR`、`JP_RAW_DIR`、`JP_EXTRACT_DIR`、`GL_RAW_DIR`、`GL_EXTRACT_DIR`、`BA_APP_DIR`

### 1.2 GitHub Actions Workflow（`.github/workflows/update_assets.yml`）

```yaml
on:
  workflow_dispatch:
    inputs:
      version: '2025.0819.0'     # 必填
      skip_download: false        # 可選：用現有資料
  schedule:
    - cron: '0 0 1 * *'          # 每月自動（可選）
```

流程：安裝依賴 → 跑 build_assets.py → 上傳到 GitHub Release → 清理

### 1.3 Lobby Dialog Types 提取

從 GL CharacterDialogDB（`UILobbySpecial` 類別）提取，映射為：
- AnimationName → spine 動畫名（`{CharName}_MemorialLobby_{GroupId}_{Idx}`）
- DialogType → Talk / Think / UITalk

JP 新角色在此表中缺失時，app 自動回退到 `Talk`。

---

## Phase 2: 生產建置 ✅

### 2.1 main.js 改造

| 改動 | 說明 |
|------|------|
| `app.isPackaged` 判斷 | dev 跑 Vite dev server、production 用 `loadFile()` |
| `findNode()` 跨平台 | Windows 用 `where`、POSIX 用 `command -v` |
| `findFfmpeg()` | 先找 `ffmpeg-static`、fallback 到系統 PATH |
| `getAssetsDir()` | dev 用 `__dirname/assets`、production 用 `process.resourcesPath/assets` |
| 移除硬編碼 intro 路徑 | 改為環境變數 `INTRO_VIDEO_SRC` / `INTRO_AUDIO_SRC` |
| IPC handlers 更新 | 全部改用 `getAssetsDir()` 取代 `path.join(__dirname, 'assets')` |

### 2.2 Vite Build Config

```js
// vite.config.js
base: './',           // 相對路徑
build: { outDir: 'dist' },
plugins: [{
  name: 'copy-root-index',
  closeBundle() {
    // dist/index.html → index.prod.html（路徑改寫 ./assets/ → ./dist/assets/）
  }
}]
```

### 2.3 electron-builder 配置（package.json）

```json
{
  "build": {
    "appId": "com.ba.memorial-lobby",
    "productName": "BA Memorial Lobby",
    "directories": { "output": "release" },
    "files": ["dist/**", "main.js", "preload.js", "package.json", "index.prod.html"],
    "extraResources": [{ "from": "assets", "to": "assets" }],
    "linux": { "target": ["AppImage", "deb"] },
    "win": { "target": ["nsis", "portable"] },
    "mac": { "target": ["dmg"] }
  }
}
```

### 2.4 Build Scripts

```bash
npm run dev              # 開發模式（Vite dev server）
npm run build            # 只 build renderer
npm run build:linux      # build + 打包 Linux
npm run build:win        # build + 打包 Windows
npm run build:mac        # build + 打包 macOS
npm run update-assets    # 跑 build_assets.py
```

---

## Phase 3: 首次啟動 Asset 下載 UI（待實作）

### 設計

App 啟動時在 main.js 檢查 `assets/.version`：
- 若不存在或版本不匹配 → renderer 顯示下載介面
- 從 GitHub Releases 下載 8 個 tar.gz
- 顯示進度條（已知大小，有百分比）
- 下載完成後解壓縮到 `assets/`
- 寫入 `.version` 檔案
- 重新載入 app

### IPC 通道（新增）

| Channel | 方向 | 功能 |
|---------|------|------|
| `check-assets` | invoke | 檢查 assets 是否存在 + 版本 |
| `download-assets` | invoke | 從遠端下載 assets |
| `download-progress` | send | 回報下載進度 |

### Renderer UI

- 全屏遮罩 + 下載進度 UI
- 顯示各 package 下載狀態（等待/下載中/完成）
- 整體進度百分比
- 支援暫停/繼續

---

## Phase 4: App 內建更新器（待實作）

### 設計

1. App 啟動時 fetch `assets_version.json`（從 GitHub raw URL）
2. 比對本地 `.version` 與遠端 version
3. 比對每個 package 的 SHA256
4. 只下載有變化的 package（增量更新）
5. 解壓縮 → 替換舊資料 → 重啟 app

### IPC 通道（新增）

| Channel | 方向 | 功能 |
|---------|------|------|
| `check-update` | invoke | 檢查遠端是否有新版本 |
| `apply-update` | invoke | 下載並套用更新 |

---

## 開發者操作流程

### 日常開發

```bash
npm run dev              # 啟動開發模式
```

### BA 更新時

```
1. 到 GitHub → Actions → Build & Release Assets → Run workflow
2. 填入版本號（如 2025.0819.0）
3. 等待 ~30-60 分鐘（CI 自動跑完）
4. 完成！用戶端自動偵測並下載
```

### 手動打包 App

```bash
npm install              # 安裝依賴（含 electron-builder）
npm run build:linux      # 或 build:win / build:mac
# 產出在 release/ 目錄
```

---

## 檔案結構

```
BA_MemorialLobbyElectron/
├── main.js                    # Electron main process（已支援 dev/production）
├── preload.js                 # IPC bridge
├── index.html                 # 開發用 HTML
├── index.prod.html            # Production HTML（build 自動生成）
├── vite.config.js             # Vite build + copy plugin
├── package.json               # 含 electron-builder 配置
├── renderer/
│   └── app.js                 # 所有 renderer 邏輯（3,626 行）
├── assets/                    # 遊戲資料（gitignored，3.2GB）
│   ├── spine/                 # Spine 骨骼（281 lobby）
│   ├── voice/                 # 語音（300 資料夾）
│   ├── bgm/                   # BGM（387 首）
│   ├── scene/                 # 場景疊加（6 個）
│   ├── data/                  # Metadata JSON/CSV
│   ├── intro/                 # 開場影片
│   ├── ui/                    # 氣泡/游標
│   ├── students/              # 學生頭像
│   ├── fonts/                 # 字體（build 時被 Vite 內嵌）
│   ├── lobby_index.json       # 主索引
│   └── .version               # 當前版本號
├── dist/                      # Vite build 產出
├── release/                   # electron-builder 產出
├── scripts/
│   ├── build_assets.py        # 統一 pipeline 腳本
│   ├── copy_assets.py         # 資料複製 + manifest 生成
│   ├── extract_events.mjs     # Spine events 提取
│   ├── spine-serialize.mjs    # Skel → JSON 序列化
│   └── spine-merge.mjs        # 多層骨骼合併
├── .github/
│   └── workflows/
│       └── update_assets.yml  # CI 自動化
└── README.md
```

---

## 已知限制

| 限制 | 影響 | 處理方式 |
|------|------|---------|
| Erika（CID=19004）無 CharacterDialogDB 資料 | 無逐字稿 | 需替代資料來源 |
| `lobby_dialog_types.json` 從 GL 提取 | JP 新角色缺 Think/UITalk 資料 | 自動回退到 Talk |
| ffmpeg 需系統安裝或 bundled | 影片匯出/轉碼 | `ffmpeg-static` fallback |
| Assets 3.2GB | 首次下載較慢 | 拆分 8 個 package |
| Spine events 在 binary .skel 中 | 需專門工具提取 | `extract_events.mjs` |
| JP ExcelDB schema 錯位 | AnimationName 欄存韓文、LocalizeKR 存日文 | 已知，用 LocalizeKR |
