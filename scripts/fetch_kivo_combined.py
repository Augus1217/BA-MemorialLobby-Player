#!/usr/bin/env python3
"""從 kivo.wiki 下載「回憶大廳合併骨架」（<X>_home_Combined）。

kivo 把人物＋背景／場景合併成單一 skeleton（同一座標系、4 頁貼圖），
播放端用一般人物管線（charScale=畫布寬/3000、相機線 962 錨點）即可正確
呈現，徹底消除分離背景的定位/黑邊問題。目前已知的合併骨架：
Akari / CH0060 / Hoshino / Yuzu（kivo 未來增加時本腳本會自動跟上）。

來源（公開 API/CDN，可用環境變數覆蓋）：
  API 清單  https://api.kivo.wiki/api/v1/data/spines?page=N&page_size=1000
  API 詳情  https://api.kivo.wiki/api/v1/data/spines/{id}
  CDN       https://static.kivo.wiki/spines/<Name>/<file>
"""
import os
import sys
import json
import shutil
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DST_SPINE = os.path.join(ROOT, "assets", "spine")
API_LIST = os.environ.get(
    "KIVO_API_LIST", "https://api.kivo.wiki/api/v1/data/spines?page={page}&page_size=1000")
API_DETAIL = os.environ.get(
    "KIVO_API_DETAIL", "https://api.kivo.wiki/api/v1/data/spines/{id}")
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) BA-MemorialLobby-Player"}


def fetch_json(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def fetch_bin(url, dest):
    url = "https:" + url if url.startswith("//") else url
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)


def list_combined():
    """回傳 [{id, name}]，只取 type=home 且名稱含 _Combined。"""
    out, page = [], 1
    while True:
        d = fetch_json(API_LIST.format(page=page))
        sp = (d.get("data") or {}).get("spine") or []
        out += [x for x in sp
                if x.get("type") == "home" and "_Combined" in x.get("name", "")]
        max_page = (d.get("data") or {}).get("max_page") or 1
        if page >= max_page or not sp:
            break
        page += 1
    return out


def lobby_dir_for(combined_name):
    """Yuzu_home_Combined -> 本專案的 lobby 目錄名（大小寫不敏感比對）。"""
    base = combined_name[:-len("_Combined")]          # Yuzu_home / CH0060_Home
    for d in sorted(os.listdir(DST_SPINE)):
        if d.lower() == base.lower() and os.path.isdir(os.path.join(DST_SPINE, d)):
            return d
    return None


def main():
    only = sys.argv[1:] or None
    combos = list_combined()
    print(f"kivo 合併骨架: {[c['name'] for c in combos]}")
    n_ok = 0
    for c in combos:
        name = c["name"]
        if only and not any(o.lower() in name.lower() for o in only):
            continue
        lobby = lobby_dir_for(name)
        if not lobby:
            print(f"  {name}: 對應不到本專案 lobby，略過", file=sys.stderr)
            continue
        det = (fetch_json(API_DETAIL.format(id=c["id"])).get("data") or {})
        skel = det.get("skel_file")
        atlas = det.get("atlas_file")
        images = det.get("images") or []
        if not (skel and atlas):
            print(f"  {name}: API 缺 skel/atlas，略過", file=sys.stderr)
            continue
        dst = os.path.join(DST_SPINE, lobby, name)
        os.makedirs(dst, exist_ok=True)
        # 檔名保留 kivo 原名（atlas 內的頁面引用是相對路徑，不可改）
        for url in [skel, atlas] + images:
            fetch_bin(url, os.path.join(dst, os.path.basename(url)))
        n_ok += 1
        print(f"  {name} -> assets/spine/{lobby}/{name}/ "
              f"({1 + 1 + len(images)} 檔)")
    print(f"完成: {n_ok}/{len(combos)}")


if __name__ == "__main__":
    main()
