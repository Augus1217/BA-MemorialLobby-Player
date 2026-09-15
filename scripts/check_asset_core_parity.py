#!/usr/bin/env python3
"""check_asset_core_parity.py — renderer/asset-core.js 與 main.js 鏡像一致性檢查。

main.js 是 CJS 且正式版不帶 renderer/ 源碼，無法直接 import 共用模組，
故 voiceLangKeep/audioPackFor/selectPacks 在兩檔各存一份。本腳本逐字比對
三函數本體（正規化空白），漂移即 exit 1。供 CI／本地驗證用。

用法：python3 scripts/check_asset_core_parity.py [--quiet]
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FUNCS = ["voiceLangKeep", "audioPackFor", "selectPacks"]


def _normalize(body: str) -> str:
    """壓掉字串字面量之外的所有空白，字串內容逐字保留。"""
    out, i, n = [], 0, len(body)
    while i < n:
        ch = body[i]
        if ch in "\"'`":
            j = i + 1
            while j < n and body[j] != ch:
                j += 2 if body[j] == "\\" else 1
            out.append(body[i:j + 1])
            i = j + 1
        elif ch.isspace():
            i += 1
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def extract(path: Path, name: str) -> str:
    src = path.read_text(encoding="utf-8")
    m = re.search(r"function\s+" + re.escape(name) + r"\s*\(", src)
    if not m:
        raise SystemExit(f"::error::{path.name} 找不到 function {name}")
    i = src.index("{", m.end())
    depth = 0
    for j in range(i, len(src)):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                body = src[i:j + 1]
                break
    else:
        raise SystemExit(f"::error::{path.name}:{name} 大括號不平衡")
    return _normalize(body)


def main() -> int:
    quiet = "--quiet" in sys.argv
    core = ROOT / "renderer" / "asset-core.js"
    main = ROOT / "main.js"
    bad = 0
    for name in FUNCS:
        a, b = extract(core, name), extract(main, name)
        if a != b:
            print(f"::error::parity 破裂：{name} 在 asset-core.js 與 main.js 不一致（改一邊必須改另一邊）")
            bad += 1
        elif not quiet:
            print(f"[parity] {name}: OK")
    if not bad and not quiet:
        print("[parity] asset-core.js ↔ main.js 一致")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
