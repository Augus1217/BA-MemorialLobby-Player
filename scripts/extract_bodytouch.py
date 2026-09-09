#!/usr/bin/env python3
"""抽取各 memorial lobby 的 tap-to-talk 觸摸盒（v2）。

正規位置已移至 Assets repo scripts/extract_interaction.py（dump／bundle
雙模式＋加法合併，CI 可跑）；此檔僅供 dev 機單步深挖保留，不再是產線。

遊戲真相（dump.cs + prefab 實測）：
  SpineCharacterBodyTouch : MonoBehaviour（掛在名為 BodyTouch 的 GameObject 上）
  OnClick（NGUI 點選事件）→ SpineCharacter.BodyTouch() → BodyTouchCB → Talk。
  點擊判定＝同一物件上的 BoxCollider（NGUI UIWidget autoResize，大小因 lobby
  而異，如 Airi 1200x1100、Hanako 1400x750），中心＝Transform 位置
  （lobby root 單位系，與 chat anchor 的 tx/ty 同空間）。

歸屬規則：
  * BodyTouch MB → SpineCharacter 元件 → 所在 skeleton GO 檔
    （*LobbySpine*.json，且其元件須被 lobby-info MB 引用——紀念大廳權威集合）
  * skeleton GO 名 → lobby skel 檔名（schedule 為準）：
    完全對應（airi→airi_home、serika_multi→lobbyserika_multi、
    ch0070→ch0070_home_gl），變體不互串
  * 太小的盒（<50u，約 30px，如 multi 場景 root 的 10x10 預設值）視為無效、
    不輸出；該 lobby 在 Player 退回舊行為（點哪都 Talk），不退化
  * Shiroko_home／CH0060_home 在 dump 沒有專屬 skeleton：共用近親盒並標 shared

輸出 Player assets/data/lobby_bodytouch.json：
  { "<lobbyKey>": [{"cx":..,"cy":..,"w":..,"h":..,"shared":bool}] }
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
DST = os.path.join(ROOT, "assets", "data", "lobby_bodytouch.json")

BODYTOUCH_SCRIPT = 2569249183565438130  # SpineCharacterBodyTouch 的 m_Script
VALID_MIN = 50.0  # 有效盒最小邊（lobby 單位）


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
    golist_path = "/tmp/opencode/golist.txt"
    if os.path.exists(golist_path):
        with open(golist_path) as fh:
            go_files = [l.strip() for l in fh if l.strip().endswith(".json")]
    else:
        go_files = [os.path.join(GO_DIR, e) for e in os.listdir(GO_DIR) if e.endswith(".json")]
        go_files = [os.path.basename(p) for p in go_files]

    skel_files = [f for f in go_files if "lobbyspine" in f.lower()]
    bt_files = [f for f in go_files if os.path.basename(f).lower().startswith("bodytouch")]
    print(f"GO={len(go_files)} skel={len(skel_files)} bodytouch={len(bt_files)}", file=sys.stderr)

    comp2skel = {}
    for f in skel_files:
        j = load_json(os.path.join(GO_DIR, os.path.basename(f)))
        if not j:
            continue
        for c in j.get("m_Component", []):
            pid = (c.get("component") or {}).get("m_PathID")
            if pid is not None:
                comp2skel[pid] = os.path.basename(f)

    # 紀念大廳權威集合：lobby-info MB（帶 ChatDialog）引用的 SpineCharacter
    mb_list = subprocess.run(
        ["rg", "-l", '"SpineCharacter":', os.path.join(DUMP, "MonoBehaviour")],
        capture_output=True, text=True).stdout.split()
    info_pids, info_by_char = set(), {}
    for f in mb_list:
        d = load_json(f)
        if not d or "ChatDialog" not in d:
            continue
        r = (d.get("SpineCharacter") or {}).get("m_PathID")
        if r:
            info_pids.add(r)
            info_by_char.setdefault(r, []).append({
                "mb": os.path.basename(f),
                "characterId": d.get("CharacterId"),
                "dialogCat": d.get("DialogCategory"),
            })
    print(f"lobby-info MBs reference {len(info_pids)} characters", file=sys.stderr)

    # lobby → skel stem（schedule，runtime key 為準）
    sched = json.load(open(SCHED)).get("lobbies", {})
    lobby_skel = {}
    for lobby, e in sched.items():
        s = (e.get("skel") or "").lower().split("/")[-1].replace(".skel", "")
        lobby_skel[lobby] = s

    records = []   # (goFile, mbPid, charPid, skelGO|None, box)
    for f in bt_files:
        j = load_json(os.path.join(GO_DIR, os.path.basename(f)))
        if not j:
            continue
        tr_pid = mb_pid = box_pid = None
        for c in j.get("m_Component", []):
            pid = (c.get("component") or {}).get("m_PathID")
            if pid is None:
                continue
            kind, cj = read_comp(pid)
            if cj is None:
                continue
            if kind == "Transform" and tr_pid is None:
                tr_pid = pid
            elif kind == "MonoBehaviour" and "SpineCharacter" in cj and "ChatDialog" not in cj:
                if mb_pid is None:
                    mb_pid = pid
            elif kind in ("BoxCollider", "BoxCollider2D") and box_pid is None:
                box_pid = pid
        if mb_pid is None or tr_pid is None or box_pid is None:
            continue
        mb = comp("MonoBehaviour", mb_pid)
        char_pid = ((mb.get("SpineCharacter") or {}).get("m_PathID")) if mb else None
        skel = comp2skel.get(char_pid)
        if skel is not None:
            sk = comp("MonoBehaviour", char_pid)
            # skeleton 元件須屬於紀念大廳（被 lobby-info 引用），否則是同名他場景實例
            if char_pid not in info_pids:
                skel = None
        # 變換鏈累加
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
        _, box = read_comp(box_pid)
        size, center = (box.get("m_Size") or {}), (box.get("m_Center") or {})
        records.append({
            "go": os.path.basename(f), "char": char_pid,
            "skel": skel,
            "cx": round(px + (center.get("x", 0.0) or 0.0) * sc, 2),
            "cy": round(py + (center.get("y", 0.0) or 0.0) * sc, 2),
            "w": round((size.get("x", 0.0) or 0.0) * sc, 2),
            "h": round((size.get("y", 0.0) or 0.0) * sc, 2),
            "depth": depth,
        })

    # 歸屬：skeleton GO stem → lobby skel stem
    go_to_lobbies = {}
    all_lobby_stems = sorted(set(lobby_skel.values()))
    for gs in sorted({go_stem(r["skel"]) for r in records if r["skel"]}):
        ng = norm_lobby(gs)
        cands = [ls for ls in all_lobby_stems
                 if norm_lobby(ls) == ng or norm_lobby(ls).startswith(ng + "_")]
        # 同字首多候選時只取完全對應（airi→airi_home，不串 serika_newyear…此處無此例；
        # azusa 類已由檔名區分，故 cands 正常為 1~2 個同 skel 家族）
        exact = [ls for ls in cands if norm_lobby(ls) == ng or norm_lobby(ls) == ng + "_home"]
        go_to_lobbies[gs] = exact or cands

    skel_to_lobbies = {}
    for lobby, ls in lobby_skel.items():
        skel_to_lobbies.setdefault(ls, []).append(lobby)

    out, dropped, review = {}, [], []
    for r in records:
        if not r["skel"]:
            if r["char"] in info_pids:
                review.append(r)  # 權威紀念大廳字但 skeleton 檔名非典型（multi 成員候選）
            continue
        gs = go_stem(r["skel"])
        if min(r["w"], r["h"]) < VALID_MIN:
            dropped.append((gs, r["w"], r["h"]))
            continue
        for ls in go_to_lobbies.get(gs, []):
            for lobby in skel_to_lobbies.get(ls, []):
                # 座標系轉換：dump 盒子是 NGUI 大廳系（y 朝上，原點＝大廳 root）；
                # Player 的 spine.toGlobal 吃骨架系（y 朝下，原點＝骨架 root）。
                # 實測（Airi/Hanako 骨架 Touch_Eye/Point 世界座標對照）：
                # skel=(x,-y-962)，誤差 <170u 且落在盒內；-962 全 lobby 通用。
                out.setdefault(lobby, []).append(
                    {"cx": r["cx"], "cy": round(-r["cy"] - 962.0, 2),
                     "w": r["w"], "h": r["h"]})

    # 無專屬 skeleton 的 lobby：共用近親（Shiroko_home←ridingsuit；CH0060 查家族）
    for lobby, ls in lobby_skel.items():
        if lobby in out or lobby not in sched:
            continue
    # 找近親：同 characterId 的其他 lobby
    char_of = {k: (v.get("characterId") or "") for k, v in sched.items()}
    # 明示共用（characterId 不同的同 rig：Shiroko 本體 dump 無專屬 skeleton，
    # 與 ridingsuit 同骨架，沿用其盒並標 shared）
    SHARED_DONORS = {"Shiroko_home": "Shiroko_ridingsuit_home"}
    for lobby, donor in SHARED_DONORS.items():
        if lobby not in out and donor in out:
            out[lobby] = [dict(b, shared=True) for b in out[donor]]
            print(f"shared(explicit): {lobby} <- {donor}", file=sys.stderr)
    for lobby in [l for l in sched if l not in out]:
        ch = char_of[lobby]
        donors = [l for l in out if char_of.get(l) == ch and ch]
        if donors:
            d = sorted(donors)[0]
            out[lobby] = [dict(b, shared=True) for b in out[d]]
            print(f"shared: {lobby} <- {d} (char {ch})", file=sys.stderr)

    print(f"review (info-char but atypical skeleton, likely multi members): {len(review)}",
          file=sys.stderr)
    for r in review[:12]:
        print(f"   {r['go']} charInfo={info_by_char.get(r['char'])} "
              f"box=({r['cx']},{r['cy']},{r['w']}x{r['h']})", file=sys.stderr)
    print(f"dropped tiny: {len(dropped)}", file=sys.stderr)

    with open(DST, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print(f"wrote {DST}: {len(out)} lobbies, {sum(len(v) for v in out.values())} boxes")
    nolobby = [l for l in sched if l not in out]
    print(f"lobbies without box (fallback tap-anywhere): {len(nolobby)} {nolobby[:12]}")


if __name__ == "__main__":
    main()
