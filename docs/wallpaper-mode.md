# 桌布模式（Wallpaper Mode）

跨平台互動桌布——同一個 app 的第三種用法（播放器／桌布／影片導出）。
計畫全文見 memory `ba-wallpaper-mode`；架構裁定＝留在 Electron 不換（CEF 模式同 Wallpaper Engine/Lively）。

## 使用方式

| 入口 | 操作 |
|---|---|
| 設定 →「桌布」分頁 | 啟停／桌布大廳／音樂／互動模式／影格率／全螢幕暫停／電池降幀／開機自啟 |
| 系統匣圖示 | 顯示播放器／啟停桌布／互動模式／開機自啟／離開 |
| CLI | `--wallpaper`（開機自啟用；第二實例帶此參數會轉交首實例） |

## 架構

- **Manager**：一般主視窗＋tray＋設定分頁。單例鎖（`requestSingleInstanceLock`），
  第二實例的 `--wallpaper` argv 轉交首實例。
- **Worker**：每螢幕一個 BrowserWindow（`wallpaper.js` 管理），URL 帶
  `#wallpaper=1&autostart=1&lobby=<名>`。資產就緒（renderer 回報 `stage=ready`）才 show。
- **狀態持久化**：`userData/wallpaper.json`：

```json
{
  "enabled": false,      // packaged 啟動時自動恢復；dev 需 --wallpaper
  "fps": 30,            // 可選 15/24/30/60（設定分頁；電池再 −15）
  "lobby": "",           // 空＝跟隨播放器上次選擇（localStorage ba_lastLobby）
  "perScreen": {},       // { "1": "Hanako_home" } 顯示器 index → lobby（多螢幕個別指定）
  "sound": false,        // 桌布 BGM（預設關）
  "interact": false,     // true＝桌布可點擊（摸頭/說話）；false＝滑鼠穿透
  "pauseFullscreen": true,
  "pauseBattery": true
}
```

- **watchdog**：renderer 每 2s 心跳；20s 無心跳 → reload（≤3 次）；boot 逾時 10 分鐘重試
  （首訪串流下載可能很慢）、20 分鐘判死；`render-process-gone` → 2s 後自癒；
  螢幕增減/解析度變更 → 重建 worker。
- **互動與穿透**：預設 `setIgnoreMouseEvents(true)`。Win/mac 開 `forward:true`（原生游標事件）；
  **Linux 無 forward → main 端 80ms 輪詢 `screen.getCursorScreenPoint()` 下發游標**，
  眼球跟隨/相機照常運作（點擊類互動需開互動模式）。
- **開機動畫**：桌布 worker **跳過開場演出**（`playStart()` 開頭分流）——不播 Start_Idle／開場
  timeline／白閃／特寫／額外骨架進場，直接進 Idle loop；BG 常駐動畫（水族館鯨魚等）照常。
  檢視器（manager）不受影響，仍播完整開場。
- **工作列隱形（無痕引擎）**：worker 建構子 `skipTaskbar: true` 在 **Linux X11 是 no-op**
  （`_NET_WM_STATE` 恆空 → 任務列/dock 照列 worker），`win.setSkipTaskbar()` 同樣無效；
  map 前用 xprop 預寫屬性也會被 Chromium 在 map 時覆寫。正解＝mapped 後由
  `wallpaper-x11.js`（koffi+Xlib）對 root 送 **`_NET_WM_STATE` ClientMessage**（wmctrl 同款、
  EWMH 規定），KWin 更新內部 skipTaskbar → TasksModel/dock 排除。macOS 運行中
  `app.dock.hide()`／停止時 `app.dock.show()`（真·隱形引擎，檢視器照常從系統列開啟）。
- **暫停策略**：全螢幕前景偵測（見平台矩陣）→ `ticker.stop()`＋BGM 暫停；
  電池供電 → fps −15（下限 10，`powerMonitor`）。

## 平台矩陣（v1）

| 平台 | 掛載 | 全螢幕暫停 | 備註 |
|---|---|---|---|
| Windows | koffi FFI：`Progman → 0x052C → WorkerW(sibling of SHELLDLL_DefView) → SetParent`；WS_CHILD＋實體像素 SetWindowPos；5s 健康巡檢（IsIconic 還原/父親失效重掛，涵蓋 explorer 重啟） | `SHQueryUserNotificationState` 2s 輪詢（QUNS 1/2/3/4/7） | Win11 24H2/26xxx WorkerW 結構變動 → 找不到 host 降級為全螢幕窗＋通知；`node_modules/koffi` 已 asarUnpack。**koffi 3.x 方言**（已在 Linux 以 libX11/libc 等價實證）：`func(name, ret, [args])`、callback 參數記 `'Proto*'`、`koffi.register(fn, koffi.pointer(proto))`、無 `'long32'`（用 `'int32'`）。**未實機驗證**。驗證清單：①掛 WorkerW 且在圖示之下 ②多螢幕各廳就位（單一 host WorkerW 座標換算是否涵蓋虛擬桌面全域——Lively 用多 WorkerW，是首要觀察點）③DPI 縮放（DIP→實體像素）④Win+D 顯示桌面後 5s 內還原 ⑤explorer 重啟重掛 ⑥全螢幕 app/鎖屏暫停 ⑦24H2 降級路徑＋通知 ⑧登入自啟 |
| macOS | `type:'desktop'`（= kCGDesktopWindowLevel-1＋canJoinAllSpaces＋stationary），零 native code；運行中 `app.dock.hide()`（真·隱形引擎，停止還原） | v1 無（需 Swift helper，v2） | **🧪 Beta（2026-10 黑蘋果 VM 實測，Sonoma 14/QEMU，軟體渲染 2fps）**。驗證結果：①層級（圖示下/視窗上）✓ ③Dock 無圖示＋正規選單 ✓（dev 顯示 Electron binary 名＝無解）⑤解析度渲染 ✓ ④互動：穿透模式 forward:true 游標轉送 ✓；**互動模式需點擊代理**——desktop 層視窗在 Finder 桌面之下，點擊被 Finder 攔走（forward 只轉送移動）→ 透明代理（正常層壓至 level −500：桌面之上/視窗之下）收事件 `sendInputEvent` 注入 worker（a85cbf0 代理、9be118d 壓層修搶聚焦——壓層後未複測）。②Space 跟隨 ✗ 未測。⑥登入自啟：macOS login item 存不了 args → checkbox 彈回已修（不帶 args＋意圖記 `config.launchAtLogin`，`maybeLoginAutostart()` 判定），**真實登入啟動需打包版驗證**。實體 mac 效能未測 |
| Linux (X11/XWayland) | `type:'desktop'`（`_NET_WM_WINDOW_TYPE_DESKTOP`）；工作列隱形＝koffi 送 `_NET_WM_STATE` ClientMessage（見上） | `xprop` 查 active window 的 `_NET_WM_STATE_FULLSCREEN`（2s 輪詢） | KDE/GNOME Wayland 走 XWayland（main 啟動時 pin `ozone-platform-hint=x11`）；GNOME Wayland 原生不支援 layer-shell（計畫標註）；KDE/wlroots 原生支援＝v2 |
| GNOME (XWayland) | 同 Linux 路線；已補 `_NET_WM_STATE_STICKY`（GNOME 的 DESKTOP 視窗不會自動跨 workspace，KDE 是 KWin 自動、STICKY 為 no-op） | ⚠️ 同上，但**只涵蓋 XWayland 前景**——原生 Wayland 全螢幕 app 偵測不到（Mutter 不經 XWayland 轉播狀態） | **未實機驗證**（開發機＝KDE）。驗證清單：①桌布壓最底、面板/視窗在其上 ②切 workspace 桌布跟著（STICKY）③Overview/alt-tab 看不到 worker ④原生全螢幕不暫停＝已知限制 ⑤系統匣需 AppIndicator 擴充（GNOME 生態限制） |

## 除錯旋鈕

| 旋鈕 | 作用 |
|---|---|
| `BA_WALLPAPER_TYPE=normal` | 以一般視窗代理桌布（不動真桌面；自動化測試用） |
| `BA_WALLPAPER=1` | dev 下等同 `--wallpaper` |
| `CAPTURE_WORKER=<file>` | worker ready 後截圖存檔並退出（`CAPTURE_DELAY` 毫秒，預設 4000） |
| `ELECTRON_OZONE_PLATFORM_HINT` | 已設則尊重（main 不會 pin x11） |

日誌前綴：main `[wallpaper]`／`[wallpaper-win]`／`[tray]`；worker console 以 `[wallpaper]` 轉發（僅 dev）。

**dev Vite 穩定性**：main 內建 watchdog（`startViteWatchdog`，5s 輪詢）——dev server 無預警退出
自動重啟（60s 內限 5 次），vite stdout/stderr 以 `[vite]` 前綴轉發（崩潰原因可見，原本被吞）。
`vite.config.js` 排除 `assets/**`（6.6 萬檔）的 watch——assets 由 serve-assets-dir middleware
直讀、執行期 fetch、不需 HMR；程式碼照常熱更新。worker 端大廳載入失敗自動重試 4 次（5s 間隔，
以 `currentLobby===first` 判成敗），vite 恢復後自癒；`hideErr()` 於每次載入開始清舊錯誤列。

## 已知陷阱：Linux `focusable:false` → override-redirect

**Chromium 的 X11/ozone backend 對 `focusable:false` 的視窗一律建 override-redirect（OR）**，
與 `type:'desktop'` 無關。OR 視窗繞過 KWin 管理（不進 `_NET_CLIENT_LIST`），KWin 以
Unmanaged 層渲染 → **蓋過面板、圖示與所有視窗**（實測 KWin 6.6.6 / Ubuntu 26.04 Wayland session）。

診斷指紋：`xwininfo -id <win> | grep Override` = yes；`xprop -root _NET_CLIENT_LIST_STACKING` 找不到該視窗。

修法＝Linux worker 用 `focusable: true`＋`showInactive()`（不搶焦點；`ignoreMouseEvents(true)`
下也不會收到點擊）。修正後：OR=no、進 stacking list 且在最底層、面板/圖示/視窗全部在其上。

## 驗收

```bash
bash scripts/wallpaper_acceptance.sh   # 單實例紀律：起→ready→截圖→記憶體→清場驗證
```

已知限制（v1）：多螢幕 per-screen lobby 需手編 `wallpaper.json`；mac 全螢幕暫停未做；
互動模式（可點擊）下桌布會擋住該區域的桌面右鍵選單（這是穿透關閉的本質）；
Linux 原生 Wayland（無 XWayland）不支援。
