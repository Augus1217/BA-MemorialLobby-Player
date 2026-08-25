# GitHub Pages 線上檢視器 — 評估與發佈規劃

> 狀態：規劃中（待任務 1–3 完成後執行）
> 目標：在 `https://augus1217.github.io/BA-MemorialLobby-Player/` 提供「免安裝、瀏覽器即開即看」的 Memorial Lobby 檢視器

---

## 1. 評估

### 現況
- **Electron 版**：`main.js` 透過 `app://` 協議 + `userData/assets` 讀取本地 tar 解壓資源；`renderer` 用 PIXI v8 + spine-pixi-v8（WASM 未用到，純 JS）。
- **資源**：`assets/` 約 4GB（spine 1.9G + voice 1.8G + bgm 413M + 其他）。一次性下載不適合 Web。
- **打包**：`BA-MemorialLobby-Assets` repo 的 `build_assets.py` 已改為增量包（`core`、`lobby/<L>`、`voice/<VF>`），每個 lobby 約 12MB；Web 版可直接複用。

### 可行性
- **資產跨域**：GitHub Releases 的 `raw.githubusercontent` / `githubusercontent` 對 `fetch()` 的 CORS 支援有限（`Access-Control-Allow-Origin: *` 通常有，但 Release 的 `objects.githubusercontent.com` 有時缺少）。**GitHub Pages** 託管的靜態資產則 гарантированно 同源、無 CORS 問題。
- **方案**：
  - **A（推薦）**：檢視器本身部署到 Pages（`gh-pages` 分支的 `dist/`），**資產仍從 Releases 拉**（串流模式，每 lobby 一包）。首次進入只拉 `core`（~30MB，不含 voice/bgm 也可先看 Spine），選角色時再拉 `lobby/<L>` + `voice/<VF>`。
  - **B**：把資產也推送到 Pages（`gh-pages` 的 `assets/`），檢視器同源 `fetch('./assets/...')`。優點是同源、快；缺點是 Pages 單倉庫建議 <1GB，4GB 超標。因此僅適合「子集」或與 Releases 混合。

### 風險
- **Release 下載限流**：GitHub 對匿名 `raw` 有速率限制，但對單一 lobby 12MB 尚可；大量併發需退避重試（已在 `downloadFile` 有）。
- **Spine WASM**：目前 `spine-core`/`spine-pixi-v8` 為純 JS，未用到 WASM；Web 版無需額外處理。若將來切 `spine-wasm`，需確保 `wasm` 檔案同源且 `COOP/COEP` 正確。
- **音訊**：Web 版可用 WebAudio（`AudioContext`）直接播 OGG，與 Electron 的 `Audio` 相同，無需改動；BGM/voice 的串流下載同理。
- **容量**：Pages 的 1GB 軟上限 → 不適合全量資產託管；**必須用串流**（任務 3 的前提）。

---

## 2. 架構（Web 版）

```
Browser (GitHub Pages)
  └─ dist/index.html + assets (Vite build, ~幾 MB)
       └─ JS (renderer/app.js — 同一份，偵測環境)
            ├─ isWeb = !window.ba  (沒有 preload/Electron)
            ├─ fetch('https://.../assets_version.json') — 小檔，取得 lobbies→packs 映射
            ├─ 若串流：ensureLobby(lobby) → fetch('https://.../assets-lobby_<L>-vX.tar.gz')
            │     → 陣列緩衝 → 解壓（瀏覽器內用 fflate/pako + tar 解析，或改由 Service Worker
            │        轉成 Blob URL；最簡：後端提供已解壓的「裸檔」CDN 而非 tar）
            └─ 載入：Spine.from({ skeleton: blobUrl, atlas: blobUrl })
```

**關鍵差異 vs Electron**：
- Electron：`app://assets/...` → `net.fetch('file://...')` + `tar.x` 到磁碟。
- Web：`fetch(tarUrl) → arrayBuffer → 解 tar（瀏覽器） → Cache API / IndexedDB / OPFS`，或更簡：**讓打包同時輸出「裸檔」清單**（`spines/<L>/*.skel` 逐檔可 `fetch`），Web 直接 `fetch(單檔)`，省去瀏覽器解 tar。

**建議**：`build_assets.py` 同時為 Web 輸出「裸檔清單」——除了 tar，也在 `out/` 保留 `assets/` 樹；Pages 部署時把 `out/assets` 一併推送（或讓 Web 直接 `fetch` Release 的 tar 並用 `fflate` 解）。

### 渲染層
- 复用 `renderer/app.js` 的 `Spine` / `fitScene` / `applyCamera` 邏輯；僅抽換 `assetUrl()`：
  - Electron：`assetUrl(p) => isDev ? '/assets/...' : 'app://assets/...'`
  - Web：`assetUrl(p) => blobUrlCache.get(p) || fetchAndCache(p)`

---

## 3. 發佈流程

### 建構
```bash
# 1) Assets repo：只打包一次，產增量 tar + assets_version.json（schema 2）
python3 scripts/build_assets.py --version 2025.08.26.0 --only-package

# 2) Player repo：Vite 產物
npm run build   # → dist/
```

### 部署（GitHub Actions）
- **Assets Release**（已有 `update_assets.yml`）：建構 → `gh release create vX --generate-notes out/*`
- **Pages 部署**（新增 `deploy-pages.yml`）：
  ```yaml
  on:
    push:
      branches: [main]
    workflow_dispatch:
  jobs:
    build:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: '22' }
        - run: npm ci && npm run build
        - uses: actions/configure-pages@v5
        - uses: actions/upload-pages-artifact@v3
          with: { path: 'dist' }
        - uses: actions/deploy-pages@v4
  ```
- **Settings → Pages → Source: GitHub Actions**，自訂域名可選。

---

## 4. 依賴與先決條件

- 任務 2（增量包）與任務 3（串流 `ensureLobby`）完成後，Web 版的「隨播隨下」才有後端支援。
- `assets_version.json` 需同時包含 `packages` 與 `lobbies` 映射，且 CORS 可被 Pages 的 `fetch()` 讀取（`latest/download` 會 302 到 `objects.githubusercontent.com`，需確認該域名回應 `Access-Control-Allow-Origin: *`；若無，改由 Pages 同源代理 `/api/assets_version.json`）。

---

## 5. 下一步（待執行）

- [ ] `build_assets.py` 增加「裸檔」輸出選項（`--emit-loose`）供 Web 直連。
- [ ] `main.js` 的 `isWeb` 分支實作（`fetch` + Cache API）。
- [ ] Pages 首次發布後，驗證 1600×900 與 1920×1080 下的 Yuzu/Akari/Hoshino 構圖與 Electron 一致。
