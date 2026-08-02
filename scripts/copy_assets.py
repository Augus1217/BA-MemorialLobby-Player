#!/usr/bin/env python3
"""Copy needed BA Memorial Lobby assets into this project.

Sources:
  - /home/augus/BA_Extracted_Full/Assets/_MX/SpineLobbies  (skel/atlas/png/clips/timeline/pppv)
  - /home/augus/Blue-Archive-Asset-Downloader/GL_Extracted/Media/JP_*   (voice)
  - /home/augus/Blue-Archive-Asset-Downloader/GL_RawData/Media/Audio/BGM (BGM)
  - /home/augus/BA_MemorialLobby/data (schedule + mappings, reuse)

Only the MAIN skeleton variant is copied (_1/_2/_3 LOD copies skipped).
"""
import os
import shutil
import sys
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_SPINE = os.environ.get("BA_SRC_SPINE", "/home/augus/BA_Extracted_Full/Assets/_MX/SpineLobbies")
SRC_MEDIA = os.environ.get("BA_SRC_MEDIA", "/home/augus/Blue-Archive-Asset-Downloader/GL_Extracted/Media")
SRC_BGM = os.environ.get("BA_SRC_BGM", "/home/augus/Blue-Archive-Asset-Downloader/GL_RawData/Media/Audio/BGM")
SRC_DATA = os.environ.get("BA_SRC_DATA", "/home/augus/BA_MemorialLobby/data")

DST_SPINE = os.path.join(ROOT, "assets", "spine")
DST_VOICE = os.path.join(ROOT, "assets", "voice")
DST_BGM = os.path.join(ROOT, "assets", "bgm")
DST_DATA = os.path.join(ROOT, "assets", "data")


def main():
    only = sys.argv[1:] if len(sys.argv) > 1 else None
    os.makedirs(DST_SPINE, exist_ok=True)
    os.makedirs(DST_VOICE, exist_ok=True)
    os.makedirs(DST_BGM, exist_ok=True)
    os.makedirs(DST_DATA, exist_ok=True)
    n_lobby = 0
    for name in sorted(os.listdir(SRC_SPINE)):
        if only and name not in only:
            continue
        src = os.path.join(SRC_SPINE, name)
        if not os.path.isdir(src):
            continue
        dst = os.path.join(DST_SPINE, name)
        os.makedirs(dst, exist_ok=True)
        copied = 0
        # find all files recursively, skip LOD variants and scene/bg subfolders for the char
        for dirpath, _dirs, files in os.walk(src):
            rel = os.path.relpath(dirpath, src)
            if rel != "." and rel.startswith(("_",)):
                continue
            for f in files:
                if re.search(r"_(1|2|3)\.(skel|atlas|png)$", f):
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

    n_voice = 0
    for d in sorted(os.listdir(SRC_MEDIA)):
        if not d.startswith("JP_"):
            continue
        src = os.path.join(SRC_MEDIA, d)
        shutil.copytree(src, os.path.join(DST_VOICE, d), dirs_exist_ok=True)
        n_voice += 1
    print(f"voice folders copied: {n_voice}")

    n_bgm = 0
    for f in sorted(os.listdir(SRC_BGM)):
        if f.startswith("Theme_"):
            shutil.copy2(os.path.join(SRC_BGM, f), os.path.join(DST_BGM, f))
            n_bgm += 1
    print(f"bgm copied: {n_bgm}")

    os.makedirs(DST_DATA, exist_ok=True)
    for f in ["lobby_voice_schedule.json", "lobby_bgm_mapping.csv",
              "lobby_camera_config.json", "characters_index.csv",
              "voice_index.json"]:
        p = os.path.join(SRC_DATA, f)
        if os.path.exists(p):
            shutil.copy2(p, os.path.join(DST_DATA, f))
    print("data copied")


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
        # main skel: any .skel, not a _N LOD copy, not _scene/_bg
        skels = sorted(f for f in files
                       if f.endswith(".skel") and not re.search(r"_[1-3]\.skel$", f)
                       and "_scene" not in f and "_bg" not in f)
        atlases = sorted(f for f in files
                         if f.endswith(".atlas") and not re.search(r"_[1-3]\.atlas$", f)
                         and "_scene" not in f and "_bg" not in f)
        if not skels or not atlases:
            continue
        atlas = atlases[0]
        # prefer the skel sharing the atlas base name (case-insensitive), else first candidate
        atlas_base = os.path.splitext(os.path.basename(atlas))[0].lower()
        skel = None
        for s in skels:
            if os.path.splitext(os.path.basename(s))[0].lower() == atlas_base:
                skel = s
                break
        if not skel:
            skel = skels[0]
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
    with open(os.path.join(ROOT, "assets", "lobby_index.json"), "w") as fh:
        _json.dump(idx, fh, ensure_ascii=False, indent=1)
    print(f"manifest: {len(idx)} lobbies")


if __name__ == "__main__":
    main()
    gen_manifest()
