#!/usr/bin/env python3
"""抽取各 memorial lobby 的互動觸發區（SpineDragIK 系列＋BodyTouch 對照）。

正規位置已移至 Assets repo scripts/extract_interaction.py（dump／bundle
雙模式＋加法合併，CI 可跑）；此檔僅供 dev 機單步深挖保留，不再是產線。

遊戲真相：
  EyeIK / HairPatIK / PinchIK / TouchIK / HandFollowIK 都是掛著
  SpineDragIK（OnPress/OnDrag）＋BoxCollider＋UIWidget 的 GameObject，
  各自的盒子就是按壓觸發區（NGUI layer 5）。BodyTouch（OnClick）管 Talk。
  盒座標走 Transform 父鏈累加（與 bodytouch 同空間：骨架-root 單位）。

輸出 Player assets/data/lobby_ikzones.json：
  { "<lobby>": {"eye": {...}, "hairpat": {...}, "pinch": {...},
                "touch": {...}, "hand": {...}, "pat2": [{...}] } }
  每區：{cx, cy, w, h, depth, trigDelay, dragSpd, relSpd}
"""
import json
import os
import re
import subprocess
import sys

DUMP = os.environ.get("BA_SRC_DUMP", "/home/augus/JP_Extracted_Full/_no_container_path")
GO_DIR = os.path.join(DUMP, "GameObject")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHED = "/home/augus/BA-MemorialLobby-Assets/data/lobby_voice_schedule.json"
DST = os.path.join(ROOT, "assets", "data", "lobby_ikzones.json")

ZONE_OF = {"EyeIK": "eye", "HairPatIK": "hairpat", "PinchIK": "pinch",
           "Pinch_L": "pinch", "TouchIK": "touch", "Touch_IK": "touch",
           "HandFollowIK": "hand"}
# Pat/Pat2 分區→clip（CH0347/CH0346 由 prefab 內 SpineClip PathID 證實；
# 其餘 lobby 無 Pat2，以命名規則解決）
PATCLIP = {
    ("CH0347_home", "HairPatIK"): ("Pat_01_M", "PatEnd_01_M"),
    ("CH0347_home", "HairPatIK_1"): ("Pat_01_M", "PatEnd_01_M"),
    ("CH0347_home", "HairPatIK_2"): ("Pat2_01_M", "PatEnd2_01_M"),
    ("CH0347_home", "HairPatIK_3"): ("Pat2_01_M", "PatEnd2_01_M"),
    ("CH0346_home", "HairPatIK_1"): ("Pat_01_M", "PatEnd_01_M"),
    ("CH0346_home", "HairPatIK_2"): ("Pat2_01_M", "PatEnd2_01_M"),
}

BONE_NAMES = {}
try:
    _bn = json.load(open("/tmp/opencode/bone_names.json"))
    for _pid, _v in _bn.items():
        BONE_NAMES[int(_pid)] = _v["bone"]
except Exception as e:
    print(f"bone_names.json 未載入: {e}", file=sys.stderr)


def load_json(path):
    try:
        with open(path, encoding="utf-8", errors="ignore") as fh:
            return json.load(fh)
    except Exception:
        return None


def comp(kind, pid):
    return load_json(os.path.join(DUMP, kind, f"unnamed_{pid}.json"))


def read_comp(pid):
    for k in ("Transform", "MonoBehaviour", "BoxCollider", "BoxCollider2D"):
        j = comp(k, pid)
        if j is not None:
            return k, j
    return None, None


def go_stem(go_file):
    stem = os.path.basename(go_file)
    stem = stem[:-5] if stem.endswith(".json") else stem
    stem = re.sub(r"_(\d+)$", "", stem)
    m = re.match(r"^(?:Lobby)?(.+?)(?:_?LobbySpine|_?Lobbyspine)$", stem, re.I)
    return (m.group(1) if m else stem).lower()


def norm_lobby(s):
    s = s.lower()
    if s.startswith("lobby"):
        s = s[5:]
    # CH0060 的 skel 叫 ch0060bg_home（BG 共用骨架），去 bg 後綴對齊 GO 名 ch0060
    if s.endswith("bg_home"):
        s = s[:-7] + "_home"
    elif s.endswith("bg"):
        s = s[:-2]
    return s


def main():
    with open("/tmp/opencode/golist.txt") as fh:
        go_files = [l.strip() for l in fh if l.strip().endswith(".json")]
    skel_files = [f for f in go_files if "lobbyspine" in f.lower()]
    comp2skel = {}
    for f in skel_files:
        j = load_json(os.path.join(GO_DIR, os.path.basename(f)))
        if not j:
            continue
        for c in j.get("m_Component", []):
            pid = (c.get("component") or {}).get("m_PathID")
            if pid is not None:
                comp2skel[pid] = os.path.basename(f)

    mb_list = subprocess.run(
        ["rg", "-l", '"SpineCharacter":', os.path.join(DUMP, "MonoBehaviour")],
        capture_output=True, text=True).stdout.split()
    info_pids = set()
    for f in mb_list:
        d = load_json(f)
        if d and "ChatDialog" in d:
            r = (d.get("SpineCharacter") or {}).get("m_PathID")
            if r:
                info_pids.add(r)

    with open("/tmp/opencode/drag_go.txt") as fh:
        ik_go_files = [l.strip() for l in fh]

    sched = json.load(open(SCHED)).get("lobbies", {})
    lobby_skel = {}
    for lobby, e in sched.items():
        lobby_skel[lobby] = (e.get("skel") or "").lower().split("/")[-1].replace(".skel", "")
    skel_to_lobbies = {}
    for lobby, ls in lobby_skel.items():
        skel_to_lobbies.setdefault(ls, []).append(lobby)
    all_lobby_stems = sorted(set(lobby_skel.values()))

    def gos_to_lobbies(gs):
        ng = norm_lobby(gs)
        cands = [ls for ls in all_lobby_stems
                 if norm_lobby(ls) == ng or norm_lobby(ls).startswith(ng + "_")]
        exact = [ls for ls in cands if norm_lobby(ls) == ng or norm_lobby(ls) == ng + "_home"]
        out = []
        for ls in exact or cands:
            out.extend(skel_to_lobbies.get(ls, []))
        return out

    out = {}
    stats = {"zones": 0, "skipped": 0}
    for gf in ik_go_files:
        j = load_json(gf)
        if not j:
            continue
        name = j.get("m_Name", "")
        zone = ZONE_OF.get(name)
        if zone is None:
            if name.startswith("HairPatIK"):
                zone = "pat2"
            else:
                stats["skipped"] += 1
                continue
        tr_pid = ik_pid = box_pid = None
        widget = {}
        for c in j.get("m_Component", []):
            pid = (c.get("component") or {}).get("m_PathID")
            if pid is None:
                continue
            kind, cj = read_comp(pid)
            if cj is None:
                continue
            if kind == "Transform" and tr_pid is None:
                tr_pid = pid
            elif kind == "MonoBehaviour" and "FollowDragSpeed01" in cj:
                ik_pid = pid
                ik = cj
            elif kind in ("BoxCollider", "BoxCollider2D") and box_pid is None:
                box_pid = pid
                box_kind, box = kind, cj
            elif kind == "MonoBehaviour" and "mWidth" in cj:
                widget = {"w": cj.get("mWidth"), "h": cj.get("mHeight"),
                          "depth": cj.get("mDepth")}
        if tr_pid is None or ik_pid is None or box_pid is None:
            stats["skipped"] += 1
            continue
        ctl = (ik.get("SpineController") or {}).get("m_PathID")
        skel = comp2skel.get(ctl)
        if skel is None or ctl not in info_pids:
            stats["skipped"] += 1
            continue
        px, py, sc, depth = 0.0, 0.0, 1.0, 0
        pid = tr_pid
        while pid not in (None, 0) and depth < 8:
            t = comp("Transform", pid)
            if t is None:
                break
            lp, ls = t.get("m_LocalPosition") or {}, t.get("m_LocalScale") or {}
            s = ls.get("x", 1.0) or 1.0
            px = px * s + (lp.get("x", 0.0) or 0.0)
            py = py * s + (lp.get("y", 0.0) or 0.0)
            sc *= s
            pid = (t.get("m_Father") or {}).get("m_PathID")
            depth += 1
        size, center = (box.get("m_Size") or {}), (box.get("m_Center") or {})
        # 座標系同 bodytouch：skel = (x, -y-962)（大廳 y 朝上 → 骨架 y 朝下）。
        qx = px + (center.get("x", 0.0) or 0.0) * sc
        qy = py + (center.get("y", 0.0) or 0.0) * sc
        rec = {"cx": round(qx, 2),
               "cy": round(-qy - 962.0, 2),
               "w": round((size.get("x", 0.0) or 0.0) * sc, 2),
               "h": round((size.get("y", 0.0) or 0.0) * sc, 2),
               "depth": widget.get("depth"),
               "trigDelay": ik.get("TriggerDelay"),
               "dragSpd": ik.get("FollowDragSpeed01"),
               "relSpd": ik.get("FollowReleaseSpeed01"),
               "src": name}
        # drag：Min/Max/Orig（Bone-Transform parent 空間）→ 骨架單位。
        # parent 世界 scale（沿 Bone 父鏈累乘，正常恆 100＝skScale）記為 scale。
        bone_pid = (ik.get("Bone") or {}).get("m_PathID")
        rec["dragBone"] = BONE_NAMES.get(bone_pid)
        mn, mx, og = (ik.get("MinLocalPos") or {}), (ik.get("MaxLocalPos") or {}), \
            (ik.get("OrigLocalPos") or {})
        off = (ik.get("BoneCenterOffset") or {})
        bt = comp("Transform", bone_pid)
        pscale, warned = 1.0, False
        if bt is not None:
            if abs((bt.get("m_LocalScale") or {}).get("x", 1.0) - 1.0) > 1e-6:
                warned = True
            pid = (bt.get("m_Father") or {}).get("m_PathID")
            guard = 0
            while pid not in (None, 0) and guard < 25:
                t = comp("Transform", pid)
                if t is None:
                    break
                pscale *= (t.get("m_LocalScale") or {}).get("x", 1.0) or 1.0
                pid = (t.get("m_Father") or {}).get("m_PathID")
                guard += 1
        # drag 的 y 也要翻 sign（同系轉換；只有偏移量，不含 -962）。
        _oy = (og.get("y", 0.0) or 0.0) * pscale
        _y0 = (mn.get("y", 0.0) or 0.0) * pscale
        _y1 = (mx.get("y", 0.0) or 0.0) * pscale
        _offy = (off.get("y", 0.0) or 0.0) * pscale
        rec["drag"] = {
            "ox": round((og.get("x", 0.0) or 0.0) * pscale, 3),
            "oy": round(-_oy, 3),
            "x0": round((mn.get("x", 0.0) or 0.0) * pscale, 3),
            "y0": round(-_y1, 3),
            "x1": round((mx.get("x", 0.0) or 0.0) * pscale, 3),
            "y1": round(-_y0, 3),
            "offx": round((off.get("x", 0.0) or 0.0) * pscale, 3),
            "offy": round(-_offy, 3),
            "scale": round(pscale, 3),
        }
        if warned or abs(pscale - 100.0) > 1.0:
            print(f"WARN scale {name} {skel}: boneScale!=1 or pscale={pscale}",
                  file=sys.stderr)
        for lobby in gos_to_lobbies(go_stem(skel)):
            e = out.setdefault(lobby, {})
            if zone == "pat2":
                e.setdefault("pat2", []).append(rec)
            else:
                e[zone] = rec
            stats["zones"] += 1
        # Pat/Pat2 明示 clip（有歧義的 lobby 才需要）
        for lobby in gos_to_lobbies(go_stem(skel)):
            key = (lobby, name)
            if key in PATCLIP:
                clip, end = PATCLIP[key]
                e = out[lobby]
                target = None
                if zone == "pat2":
                    target = [b for b in e["pat2"] if b["src"] == name]
                elif e.get(zone, {}).get("src") == name:
                    target = [e[zone]]
                for b in target or []:
                    b["clip"], b["end"] = clip, end

    # 無專屬資料的 lobby：同 characterId 近親共用（GL/Teen 變體，與 bodytouch 同規則）
    import copy
    char_of = {k: ((sched.get(k) or {}).get("characterId") or "") for k in sched}
    # 明示共用（characterId 不同的同 rig：Shiroko 本體 dump 無專屬 skeleton）
    for lobby, donor in {"Shiroko_home": "Shiroko_ridingsuit_home"}.items():
        if lobby not in out and donor in out:
            out[lobby] = copy.deepcopy(out[donor])
            for z in out[lobby].values():
                if isinstance(z, dict):
                    z["shared"] = True
                elif isinstance(z, list):
                    for b in z:
                        b["shared"] = True
            print(f"shared(explicit): {lobby} <- {donor}", file=sys.stderr)
    for lobby in [l for l in sched if l not in out]:
        ch = char_of[lobby]
        donors = [l for l in out if char_of.get(l) == ch and ch]
        if donors:
            d = sorted(donors)[0]
            out[lobby] = copy.deepcopy(out[d])
            for z in out[lobby].values():
                if isinstance(z, dict):
                    z["shared"] = True
                elif isinstance(z, list):
                    for b in z:
                        b["shared"] = True
            print(f"shared: {lobby} <- {d} (char {ch})", file=sys.stderr)

    with open(DST, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print("stats:", stats)
    print(f"wrote {DST}: {len(out)} lobbies")
    # 各區覆蓋＋depth 分布
    from collections import Counter
    print("zone coverage:", Counter(z for v in out.values() for z in v if z != "pat2"))
    print("eye depths:", Counter(v["eye"]["depth"] for v in out.values() if "eye" in v).most_common(5))
    print("hairpat depths:", Counter(v["hairpat"]["depth"] for v in out.values() if "hairpat" in v).most_common(5))
    # Airi/Hanako 例
    for k in ("Airi_home", "Hanako_home"):
        print(k, json.dumps(out.get(k), ensure_ascii=False)[:600])


if __name__ == "__main__":
    main()
