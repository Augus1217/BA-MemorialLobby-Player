#!/usr/bin/env python3
"""check_asset_core_parity.py — renderer/asset-core.js 與 main.js 鏡像一致性檢查。

main.js 是 CJS 且正式版不帶 renderer/ 源碼，無法直接 import 共用模組，
故 voiceLangKeep/audioPackFor/selectPacks 在兩檔各存一份。本腳本逐字比對
三函數本體（正規化空白），漂移即 exit 1。供 CI／本地驗證用。

用法：python3 scripts/check_asset_core_parity.py [--quiet] [--debug]
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FUNCS = ["voiceLangKeep", "audioPackFor", "selectPacks"]


def _mask(src: str) -> str:
    """等長遮罩：字串字面量與註解內容換成空白，其餘原樣。

    掃描結構（括號/大括號）必須用遮罩，否則參數解構或字串裡的括號會讓
    配對跑掉——舊版直接 index('{') 會把 selectPacks 的參數解構
    `{ voice, audioFmt, packages }` 誤判成函式本體，比對等於沒比。
    """
    out = list(src)
    i, n = 0, len(src)
    while i < n:
        ch = src[i]
        if ch == "/" and i + 1 < n and src[i + 1] == "/":
            j = src.find("\n", i)
            j = n if j < 0 else j
            for k in range(i, j):
                if out[k] != "\n":
                    out[k] = " "
            i = j
        elif ch == "/" and i + 1 < n and src[i + 1] == "*":
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            for k in range(i, j):
                if out[k] != "\n":
                    out[k] = " "
            i = j
        elif ch in "\"'`":
            j = i + 1
            while j < n and src[j] != ch:
                j += 2 if src[j] == "\\" else 1
            j = min(j, n - 1)
            for k in range(i, j + 1):
                if out[k] != "\n":
                    out[k] = " "
            i = j + 1
        else:
            i += 1
    return "".join(out)


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
    mask = _mask(src)
    m = re.search(r"function\s+" + re.escape(name) + r"\s*\(", mask)
    if not m:
        raise SystemExit(f"::error::{path.name} 找不到 function {name}")
    # ① 先跳過參數列：從 '(' 配對到對應的 ')'
    i = m.end() - 1
    depth = 0
    j = i
    while j < len(mask):
        c = mask[j]
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                break
        j += 1
    else:
        raise SystemExit(f"::error::{path.name}:{name} 參數列括號不平衡")
    # ② 參數列之後的第一個 '{' 才是函式本體
    start = mask.find("{", j)
    if start < 0:
        raise SystemExit(f"::error::{path.name}:{name} 找不到函式本體")
    depth = 0
    for k in range(start, len(mask)):
        if mask[k] == "{":
            depth += 1
        elif mask[k] == "}":
            depth -= 1
            if depth == 0:
                return _normalize(src[start:k + 1])
    raise SystemExit(f"::error::{path.name}:{name} 大括號不平衡")


def main() -> int:
    quiet = "--quiet" in sys.argv
    debug = "--debug" in sys.argv
    core = ROOT / "renderer" / "asset-core.js"
    main = ROOT / "main.js"
    bad = 0
    for name in FUNCS:
        a, b = extract(core, name), extract(main, name)
        if debug:
            print(f"[parity] {name}: core {len(a)} 字元 / main {len(b)} 字元")
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
