#!/usr/bin/env python3
"""copy_web_assets.py — 挑選網頁版核心資產到 dist/（GitHub Pages 部署用）。

原則：官方遊戲素材（data/students/spine/voice/bgm/scene/ui 圖/clickfx/fonts）
一律不進 dist，交由 private Assets repo 的 worker pack 串流（ba-web.js + sw.js
安裝進 Cache Storage）。dist 只裝：

  1. vite build 產物（renderer JS/CSS）
  2. assets/loading/（title_h264.mp4/font.otf/spinner.png/pv-a.ogg）——開場畫面，
     必須在 pack 下載開始前呈現，屬 app 啟動資源
  3. assets/ui/ui_i18n.json — 本應用自製 UI 字典（首訪需在 pack 安裝前讀取）
  4. intro/title_h264.mp4 + pv-a.ogg（開機畫面媒體）

用法：
  python3 scripts/copy_web_assets.py            # 拷貝到 dist/
  python3 scripts/copy_web_assets.py --out DIR
"""
import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"

# 官方素材目錄一律不拷；無 CORE_DIRS。
# ui/：只帶自製檔（ui_i18n.json）。
UI_KEEP = ["ui_i18n.json"]
# loading/：開場畫面（首屏在 core pack 安裝前就要顯示，不能等到 pack 下載完）——
# title_h264.mp4 背景影片、spinner.png、font.otf 開場字型。缺了它們 Pages 版首屏
# 會是破圖＋系統字型（舊版原始碼註解說「build 會拷進 dist」但實際沒有，這裡補上）。
# 影片只有 H.264：來源 APK 是 HEVC，Chromium 解不了；原本另轉的 VP9 webm 體積
# 更大、實測 PSNR 更低，已移除（mp4 帶 +faststart，可邊下載邊播）。
LOADING_KEEP = ["title_h264.mp4", "spinner.png", "font.otf"]
# intro：只帶 h264 mp4 + ogg（title.mp4 原始編碼瀏覽器不一定能播）
INTRO_FILES = ["intro/title_h264.mp4", "intro/pv-a.ogg"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "dist"), help="輸出目錄（預設 dist/）")
    args = ap.parse_args()
    out = Path(args.out)
    dst_assets = out / "assets"
    if not ASSETS.exists():
        print(f"[web] 找不到 {ASSETS}", file=sys.stderr)
        return 1

    total = 0
    def copy(src: Path, rel: str):
        nonlocal total
        d = dst_assets / rel
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, d)
        total += src.stat().st_size

    # ui/：只拷自製檔（見 UI_KEEP）
    ui_dir = ASSETS / "ui"
    if ui_dir.exists():
        for f in UI_KEEP:
            s = ui_dir / f
            if s.exists():
                copy(s, "ui/" + f)

    # loading/：開場畫面素材（缺檔視為部署錯誤——首屏會壞）
    loading_dir = ASSETS / "loading"
    missing_loading = []
    for f in LOADING_KEEP:
        s = loading_dir / f
        if s.exists():
            copy(s, "loading/" + f)
        else:
            missing_loading.append(f)
    if missing_loading:
        print(f"[web] 錯誤：缺開場素材 assets/loading/{{{','.join(missing_loading)}}}"
              f"——Pages 首屏會破圖；請先跑 core pack 下載步驟。", file=sys.stderr)
        return 1

    for rel in INTRO_FILES:
        s = ASSETS / rel
        if s.exists():
            copy(s, rel)
        else:
            print(f"[web] warn: 缺 {s}")

    print(f"[web] 核心資產 → {dst_assets} ({total / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())