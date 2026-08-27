#!/usr/bin/env python3
"""copy_web_assets.py — 挑選網頁版核心資產到 dist/（GitHub Pages 部署用）。

核心 = data + ui + fonts + students + clickfx + intro（開場影片）+ lobby_index。
spine / bgm / voice / scene 不進 Pages：走 Worker 串流（ba-web.js + sw.js）。

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

# 核心目錄（整個拷）
CORE_DIRS = ["data", "ui", "fonts", "students", "clickfx"]
# 核心檔案（相對 assets/）
CORE_FILES = [
    "lobby_index.json",
]
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

    for d in CORE_DIRS:
        s = ASSETS / d
        if not s.exists():
            print(f"[web] warn: 缺 {s}")
            continue
        for f in sorted(s.rglob("*")):
            if f.is_file():
                copy(f, f.relative_to(ASSETS).as_posix())

    for rel in CORE_FILES + INTRO_FILES + TITLE_BGM_FILES:
        s = ASSETS / rel
        if s.exists():
            copy(s, rel)
        else:
            print(f"[web] warn: 缺 {s}")

    print(f"[web] 核心資產 → {dst_assets} ({total / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
