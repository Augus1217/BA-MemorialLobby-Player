#!/usr/bin/env python3
"""Copy needed BA Memorial Lobby assets into this project.

Sources:
  - /home/augus/BA_Extracted_Full/Assets/_MX/SpineLobbies  (skel/atlas/png/clips/timeline/pppv)
  - /home/augus/Blue-Archive-Asset-Downloader/GL_Extracted/Media/JP_*   (voice)
  - /home/augus/Blue-Archive-Asset-Downloader/GL_RawData/Media/Audio/BGM (BGM)
  - /home/augus/BA_MemorialLobby/data (schedule + mappings, reuse)

Only the MAIN skeleton variant is copied (_1/_2/_3 LOD copies skipped).
Lobby room/scene skeletons (folders like Aru_Scene) go to assets/scene/.
"""
import os
import shutil
import sys
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_SPINE = os.environ.get("BA_SRC_SPINE", "/home/augus/JP_Extracted_Full/Assets/_MX/SpineLobbies")
SRC_MEDIA = os.environ.get("BA_SRC_MEDIA", "/home/augus/JP_Voice_Extracted")
SRC_BGM = os.environ.get("BA_SRC_BGM", "/home/augus/Blue-Archive-Asset-Downloader/JP_Android_RawData/Media/GameData/Audio/BGM")
SRC_DATA = os.environ.get("BA_SRC_DATA", "/home/augus/BA_MemorialLobby/data")

DST_SPINE = os.path.join(ROOT, "assets", "spine")
DST_SCENE = os.path.join(ROOT, "assets", "scene")
DST_VOICE = os.path.join(ROOT, "assets", "voice")
DST_BGM = os.path.join(ROOT, "assets", "bgm")
DST_DATA = os.path.join(ROOT, "assets", "data")


def main():
    only = sys.argv[1:] if len(sys.argv) > 1 else None
    os.makedirs(DST_SPINE, exist_ok=True)
    os.makedirs(DST_SCENE, exist_ok=True)
    os.makedirs(DST_VOICE, exist_ok=True)
    os.makedirs(DST_BGM, exist_ok=True)
    os.makedirs(DST_DATA, exist_ok=True)
    n_lobby = 0
    if not os.path.exists(SRC_SPINE):
        print(f"SRC_SPINE not found: {SRC_SPINE}, skipping spine copy", file=sys.stderr)
    for name in (sorted(os.listdir(SRC_SPINE)) if os.path.exists(SRC_SPINE) else []):
        if only and name not in only:
            continue
        src = os.path.join(SRC_SPINE, name)
        if not os.path.isdir(src):
            continue
        dst = os.path.join(DST_SPINE, name)
        os.makedirs(dst, exist_ok=True)
        copied = 0
        main_atlas_refs = set()
        for f in os.listdir(src):
            if not f.endswith(".atlas") or re.search(r"_(1|2|3)\.atlas$", f):
                continue
            with open(os.path.join(src, f), encoding="utf-8", errors="ignore") as atlas:
                main_atlas_refs.update(
                    line.strip() for line in atlas
                    if line.strip().endswith(".png")
                )
        for dirpath, _dirs, files in os.walk(src):
            rel = os.path.relpath(dirpath, src)
            if rel != "." and rel.startswith(("_",)):
                continue
            for f in files:
                if re.search(r"_(1|2|3)\.(skel|atlas)$", f):
                    continue
                if f.endswith(".png") and re.search(r"_(1|2|3)\.png$", f) and f not in main_atlas_refs:
                    continue
                if "_scene" in f or "_bg" in f:
                    continue
                if f.endswith((".skel", ".atlas", ".png", ".json")):
                    sub = os.path.join(dst, rel) if rel != "." else dst
                    os.makedirs(sub, exist_ok=True)
                    shutil.copy2(os.path.join(dirpath, f), os.path.join(sub, f))
                    copied += 1
        if copied:
            n_lobby += 1
            print(f"lobby {name}: {copied} files")
    print(f"lobbies copied: {n_lobby}")

    # Room/scene overlay skeletons (few lobbies ship one, e.g. Aru_Scene).
    n_scene = 0
    if not os.path.exists(SRC_SPINE):
        print(f"SRC_SPINE not found for scene, skipping", file=sys.stderr)
    for name in (sorted(os.listdir(SRC_SPINE)) if os.path.exists(SRC_SPINE) else []):
        if only and name not in only:
            continue
        src_lobby = os.path.join(SRC_SPINE, name)
        if not os.path.isdir(src_lobby):
            continue
        for sub in os.listdir(src_lobby):
            if "Scene" not in sub:
                continue
            src = os.path.join(src_lobby, sub)
            if not os.path.isdir(src):
                continue
            dst = os.path.join(DST_SCENE, name)
            os.makedirs(dst, exist_ok=True)
            copied = 0
            for f in os.listdir(src):
                if re.search(r"_(1|2|3)\.(skel|atlas|png)$", f):
                    continue
                if f.endswith((".skel", ".atlas", ".png")):
                    shutil.copy2(os.path.join(src, f), os.path.join(dst, f))
                    copied += 1
            if copied:
                n_scene += 1
                print(f"scene {name}: {copied} files")
    print(f"scenes copied: {n_scene}")

    n_voice = 0
    if not os.path.exists(SRC_MEDIA):
        print(f"SRC_MEDIA not found: {SRC_MEDIA}, skipping voice copy", file=sys.stderr)
    for d in (sorted(os.listdir(SRC_MEDIA)) if os.path.exists(SRC_MEDIA) else []):
        if not d.startswith("JP_"):
            continue
        src = os.path.join(SRC_MEDIA, d)
        shutil.copytree(src, os.path.join(DST_VOICE, d), dirs_exist_ok=True)
        n_voice += 1
    print(f"voice folders copied: {n_voice}")

    n_bgm = 0
    if not os.path.exists(SRC_BGM):
        print(f"SRC_BGM not found: {SRC_BGM}, skipping bgm copy", file=sys.stderr)
    # Theme_* 全拷之外，lobby_bgm_mapping.csv 引用的非 Theme 檔
    # （如 BlueNewWorld_Lobby.ogg）也要拷，否則對應 lobby 靜音。
    extra_bgm = set()
    mapping_csv = os.path.join(SRC_DATA, "lobby_bgm_mapping.csv")
    if os.path.exists(mapping_csv):
        try:
            import csv as _csv
            with open(mapping_csv, newline="", encoding="utf-8", errors="ignore") as fh:
                for row in _csv.DictReader(fh):
                    fn = (row.get("bgm_filename") or "").strip()
                    if fn:
                        extra_bgm.add(fn)
        except Exception as e:
            print(f"lobby_bgm_mapping.csv 讀取失敗({e})，僅拷 Theme_*", file=sys.stderr)
    for f in (sorted(os.listdir(SRC_BGM)) if os.path.exists(SRC_BGM) else []):
        if f.startswith("Theme_") or f in extra_bgm:
            shutil.copy2(os.path.join(SRC_BGM, f), os.path.join(DST_BGM, f))
            n_bgm += 1
    print(f"bgm copied: {n_bgm}" + (f" (mapping 引用 {len(extra_bgm)} 檔)" if extra_bgm else ""))

    os.makedirs(DST_DATA, exist_ok=True)
    if not os.path.exists(SRC_DATA):
        print(f"SRC_DATA not found: {SRC_DATA}, skipping data copy", file=sys.stderr)
    else:
        # 全量拷貝 data/ 下所有 json/csv（flash_curves.json、lobby_chat_anchors.json、
        # icon_index.json 等手動維護檔都一併帶上，避免漏包）
        n_data = 0
        for f in sorted(os.listdir(SRC_DATA)):
            if f.endswith((".json", ".csv")):
                shutil.copy2(os.path.join(SRC_DATA, f), os.path.join(DST_DATA, f))
                n_data += 1
        print(f"data copied: {n_data} files")

    # 手動素材（intro 影片/音訊、ui 氣泡/游標、students 頭像）從 repo manual/ 拷入
    MANUAL_ROOT = os.environ.get("BA_SRC_MANUAL", os.path.join(ROOT, "manual"))
    for sub in ("intro", "ui", "students"):
        src = os.path.join(MANUAL_ROOT, sub)
        dst = os.path.join(ROOT, "assets", sub)
        if not os.path.isdir(src):
            print(f"manual/{sub} not found, skipping", file=sys.stderr)
            continue
        os.makedirs(dst, exist_ok=True)
        n = 0
        for f in sorted(os.listdir(src)):
            p = os.path.join(src, f)
            if os.path.isfile(p):
                shutil.copy2(p, os.path.join(dst, f))
                n += 1
        print(f"manual/{sub} copied: {n} files")


def gen_manifest():
    """Per-lobby resolved main assets (handle Airi0/Airi, CH9996/CH0996, juri/Juri quirks)."""
    import json as _json
    idx = {}
    for name in sorted(os.listdir(DST_SPINE)):
        d = os.path.join(DST_SPINE, name)
        if not os.path.isdir(d):
            continue
        files = []
        for dirpath, _dirs, fnames in os.walk(d):
            for f in fnames:
                files.append(os.path.join(os.path.relpath(dirpath, d), f))
        # main skel: prefer merged .json (may contain merged skeletons),
        # fallback to .skel. Skip _N LOD copies and _scene/_bg.
        jsons = sorted(f for f in files
                       if f.endswith(".json") and not re.search(r"_[1-3]\.json$", f)
                       and "_scene" not in f and "_bg" not in f
                       and not f.endswith(("_Atlas.json", "_Material.json", "_SkeletonData.json",
                                          "Atlas_1.json", "Material_1.json", "SkeletonData_1.json")))
        skels = sorted(f for f in files
                       if f.endswith(".skel") and not re.search(r"_[1-3]\.skel$", f)
                       and "_scene" not in f and "_bg" not in f)
        atlases = sorted(f for f in files
                         if f.endswith(".atlas") and not re.search(r"_[1-3]\.atlas$", f)
                         and "_scene" not in f and "_bg" not in f)
        if not atlases:
            continue
        atlas = atlases[0]
        atlas_base = os.path.splitext(os.path.basename(atlas))[0].lower()
        # Prefer merged .json matching atlas name, then .skel, then first candidate
        skel = None
        for pool in (jsons, skels):
            for s in pool:
                if os.path.splitext(os.path.basename(s))[0].lower() == atlas_base:
                    skel = s
                    break
            if skel:
                break
        if not skel:
            skel = (jsons or skels)[0]
        # png pages referenced by the atlas (best-effort: pages listed in the atlas text)
        pages = []
        atxt = os.path.join(d, atlas.replace("\\", os.sep))
        if os.path.exists(atxt):
            with open(atxt) as fh:
                pages = [l.strip() for l in fh.read().splitlines() if l.strip().endswith(".png")]
        idx[name] = {
            "skel": skel,
            "atlas": atlas,
            "png": pages,
        }
    # scene overlays (assets/scene/<name>)
    for name in sorted(os.listdir(DST_SCENE)):
        d = os.path.join(DST_SCENE, name)
        if not os.path.isdir(d):
            continue
        skels = sorted(f for f in os.listdir(d)
                       if f.endswith(".skel") and not re.search(r"_[1-3]\.skel$", f))
        atlases = sorted(f for f in os.listdir(d)
                         if f.endswith(".atlas") and not re.search(r"_[1-3]\.atlas$", f))
        if not skels or not atlases:
            continue
        atlas = atlases[0]
        atlas_base = os.path.splitext(atlas)[0].lower()
        skel = next((s for s in skels
                     if os.path.splitext(s)[0].lower() == atlas_base), skels[0])
        pages = []
        atxt = os.path.join(d, atlas)
        if os.path.exists(atxt):
            with open(atxt) as fh:
                pages = [l.strip() for l in fh.read().splitlines() if l.strip().endswith(".png")]
        idx.setdefault(name, {})["scene"] = {"skel": skel, "atlas": atlas, "png": pages}
    # manifest 同時寫到 assets/ 根目錄（開發模式）與 assets/data/
    # （打包模式：lobby_index.json 必須進 data 包，否則純下載的
    # Player fetch assets/lobby_index.json 會 404 起不來）
    out_paths = [
        os.path.join(ROOT, "assets", "lobby_index.json"),
        os.path.join(DST_DATA, "lobby_index.json"),
    ]
    for p in out_paths:
        with open(p, "w") as fh:
            _json.dump(idx, fh, ensure_ascii=False, indent=1)
    print(f"manifest: {len(idx)} lobbies -> {out_paths}")


if __name__ == "__main__":
    main()
    gen_manifest()
