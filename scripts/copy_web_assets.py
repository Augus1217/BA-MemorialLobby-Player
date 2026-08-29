#!/usr/bin/env python3
"""copy_web_assets.py — 挑選網頁版核心資產到 dist/（GitHub Pages 部署用）。

原則：官方遊戲素材（data/students/spine/voice/bgm/scene/ui 圖/clickfx/fonts）
一律不進 dist，交由 private Assets repo 的 worker pack 串流（ba-web.js + sw.js
安裝進 Cache Storage）。dist 只裝：

  1. vite build 產物（renderer JS/CSS）
  2. assets/loading/（title.webm/font.otf/spinner.png/pv-a.ogg）——開場畫面，
     必須在 pack 下載開始前呈現，屬 app 啟動資源
  3. assets/ui/ui_i18n.json — 本應用自製 UI 字典（首訪需在 pack 安裝前讀取）
  4. intro/title_h264.mp4 + pv-a.ogg、bgm/Theme_152_Title.ogg（開機畫面媒體）

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
# intro：只帶 h264 mp4 + ogg（title.mp4 原始編碼瀏覽器不一定能播）
INTRO_FILES = ["intro/title_h264.mp4", "intro/pv-a.ogg"]
# 標題畫面 BGM（標題畫面在資產下載完成前就播，必須內建）
TITLE_BGM_FILES = ["bgm/Theme_152_Title.ogg"]


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

    for rel in INTRO_FILES + TITLE_BGM_FILES:
        s = ASSETS / rel
        if s.exists():
            copy(s, rel)
        else:
            print(f"[web] warn: 缺 {s}")

    print(f"[web] 核心資產 → {dst_assets} ({total / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())