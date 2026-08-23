#!/usr/bin/env python3
"""從 Unity dump（_no_container_path 的 GameObject/Transform）抽出每個 lobby 的
本體/背景/場景 Transform，產生 assets/data/lobby_transforms.json。

mode "char"：與本體完全同變換（同父、同 localPosition、同 localScale），
  如 CH0060BG_home —— 必須沿用人物同一變換繪製。
mode "fill"：獨立座標系（如 Akari_BG / Yuzu_BG 的 (0,0)/scale1），
  以「內容中心對齊視窗中心」還原 BA 填滿效果。
"""
import os
import json
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DUMP = os.environ.get("BA_SRC_DUMP", "/home/augus/JP_Extracted_Full/_no_container_path")
GO_DIR = os.path.join(SRC_DUMP, "GameObject")
TR_DIR = os.path.join(SRC_DUMP, "Transform")
DST = os.path.join(ROOT, "assets", "data", "lobby_transforms.json")


def base_of(path):
    return os.path.splitext(os.path.basename(path))[0] if path else None


def read_transform(go_path):
    try:
        with open(go_path, encoding="utf-8", errors="ignore") as fh:
            go = json.load(fh)
    except Exception:
        return None
    for comp in go.get("m_Component", []):
        pid = (comp.get("component") or {}).get("m_PathID")
        if pid is None:
            continue
        tp = os.path.join(TR_DIR, f"unnamed_{pid}.json")
        if not os.path.exists(tp):
            continue
        try:
            with open(tp, encoding="utf-8", errors="ignore") as fh:
                t = json.load(fh)
        except Exception:
            continue
        p = t.get("m_LocalPosition") or {}
        s = t.get("m_LocalScale") or {}
        return {"pos": [p.get("x", 0.0), p.get("y", 0.0)],
                "scale": s.get("x", 1.0),
                "father": (t.get("m_Father") or {}).get("m_PathID")}
    return None


def same_as_char(t, home_t):
    if not t or not home_t:
        return False
    return (t["father"] == home_t["father"]
            and abs(t["pos"][0] - home_t["pos"][0]) < 0.01
            and abs(t["pos"][1] - home_t["pos"][1]) < 0.01
            and abs(t["scale"] - home_t["scale"]) < 0.01)


def main():
    if not os.path.isdir(GO_DIR) or not os.path.isdir(TR_DIR):
        print(f"Unity dump 不存在: {SRC_DUMP}", file=sys.stderr)
        return
    with open(os.path.join(ROOT, "assets", "data", "lobby_index.json"), encoding="utf-8") as fh:
        idx = json.load(fh)

    needed = {}
    for e in idx.values():
        bases = [base_of(e.get("skel"))]
        for role in ("bg", "scene"):
            r = e.get(role)
            if isinstance(r, dict):
                bases.append(base_of(r.get("skel")))
        for b in bases:
            if b:
                needed.setdefault(b.lower(), b)

    found = {}
    with os.scandir(GO_DIR) as it:
        for ent in it:
            n = ent.name
            if not n.endswith(".json"):
                continue
            low = n[:-5].lower()
            if low in needed and low not in found:
                found[low] = ent.path

    out = {}
    n_char = n_fill = n_miss = 0
    miss_names = []
    for key, e in sorted(idx.items()):
        rec = {}
        home_t = None
        hb = base_of(e.get("skel"))
        if hb and hb.lower() in found:
            home_t = read_transform(found[hb.lower()])
            rec["home"] = home_t
        for role in ("bg", "scene"):
            r = e.get(role)
            b = base_of(r.get("skel")) if isinstance(r, dict) else None
            if not b:
                continue
            t = read_transform(found[b.lower()]) if b.lower() in found else None
            if t is None:
                n_miss += 1
                miss_names.append(f"{key}:{b}")
                rec[role] = {"missing": b}
                continue
            if role == "bg":
                t["mode"] = "char" if same_as_char(t, home_t) else "fill"
                if t["mode"] == "char":
                    n_char += 1
                else:
                    n_fill += 1
            rec[role] = t
        if rec:
            out[key] = rec

    with open(DST, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print(f"lobby_transforms: {len(out)} lobbies -> {DST}")
    print(f"bg mode: char={n_char}, fill={n_fill}; 找不到 Transform: {n_miss}")
    for m in miss_names[:20]:
        print(f"  missing: {m}", file=sys.stderr)


if __name__ == "__main__":
    main()
